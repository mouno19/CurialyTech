import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The agent API mounted on an in-process server (127.0.0.1, ephemeral port), with the database and
// file storage replaced: what status codes and bodies the client gets when storage misbehaves.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-routes-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

type Call = { text: string; values: unknown[] };
const db = vi.hoisted(() => ({ calls: [] as Call[], handler: (_call: Call): unknown => ({ rows: [], rowCount: 0 }) }));
const media = vi.hoisted(() => ({
  getMedia: vi.fn(), listMedia: vi.fn(async () => []), markMediaMissing: vi.fn(async () => undefined), mediaStatus: vi.fn(), openStoredObject: vi.fn(),
  storeMedia: vi.fn(), assertStorageAvailable: vi.fn(), deleteMedia: vi.fn(), aiComplete: vi.fn(), fetchMediaBytes: vi.fn(),
  isElsewhere: vi.fn((row: { stage_account?: string | null }) => row.stage_account !== "acct-now"), storageConfig: vi.fn(() => ({ ok: true, missing: [] as string[] })),
  openMedia: vi.fn(),
}));
const publish = vi.hoisted(() => ({ createRepo: vi.fn(), pushProjectToRepo: vi.fn(), createPullRequest: vi.fn(), deployPreview: vi.fn(), commitAndPush: vi.fn(), branchHead: vi.fn(), githubApi: vi.fn() }));
const github = vi.hoisted(() => ({ getConnection: vi.fn() }));

vi.mock("./db/pg", () => {
  const run = async (text: string, values: unknown[] = []) => {
    const call = { text, values };
    db.calls.push(call);
    return db.handler(call);
  };
  return { query: vi.fn(run), heartbeatQuery: vi.fn(run), db: () => { throw new Error("no pool in tests"); }, adminUserId: async () => "admin" };
});
vi.mock("./media/snowflake", () => media);
vi.mock("./services/github", async importOriginal => ({
  ...(await importOriginal<typeof import("./services/github")>()),
  createRepo: publish.createRepo, pushProjectToRepo: publish.pushProjectToRepo, createPullRequest: publish.createPullRequest, getConnection: github.getConnection,
  branchHead: publish.branchHead, githubApi: publish.githubApi,
}));
vi.mock("./agent/repos", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/repos")>()), commitAndPush: publish.commitAndPush }));
vi.mock("./agent/deploy", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/deploy")>()), deployPreview: publish.deployPreview }));

const { agentRouter } = await import("./agent/routes");
const { StorageError } = await import("./media/storage-errors");
const { RemoteChangedError } = await import("./services/github");

let server: http.Server;
let base = "";
beforeAll(async () => {
  // Cloud deploys are not configured in these tests, whatever the shell has.
  vi.stubEnv("RENDER_API_KEY", "");
  vi.stubEnv("RENDER_OWNER_ID", "");
  vi.stubEnv("SESSION_SECRET", "test-only-session-secret-0123456789abcdef");
  vi.stubEnv("GITHUB_TOKEN", "");
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter());
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent`;
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ID = "00000000-0000-4000-8000-0000000000d1";
const TASK = "00000000-0000-4000-8000-0000000000e1";
const RUN = "10000000-0000-4000-8000-0000000000e1";
const mediaRow = (patch: Record<string, unknown> = {}) => ({ id: ID, filename: "shot.png", mime_type: "image/png", size_bytes: 7, kind: "upload", stage_path: "upload/x/shot.png", created_at: new Date(), session_id: null, source_path: null, state: "stored", stage_account: "acct-now", ...patch });
const INTERNALS = /snowflake|cortex|sql|stage|curialy_db|warehouse|amazonaws|@/i;

beforeEach(() => {
  db.calls.length = 0;
  db.handler = () => ({ rows: [], rowCount: 0 });
  for (const fn of [...Object.values(media), ...Object.values(publish), github.getConnection]) fn.mockReset();
  github.getConnection.mockResolvedValue(null);
  media.mediaStatus.mockResolvedValue({ ok: true, state: "ok", kind: null, retryAfter: 0, detail: "File storage is ready." });
  media.listMedia.mockResolvedValue([]);
  media.markMediaMissing.mockResolvedValue(undefined);
  media.isElsewhere.mockImplementation((row: { stage_account?: string | null }) => row.stage_account !== "acct-now");
  media.storageConfig.mockImplementation(() => ({ ok: true, missing: [] }));
  // Routes open files through openMedia (placement rules); here it reaches the storage mock directly.
  media.openMedia.mockImplementation((row: { stage_path: string }, signal?: AbortSignal) => media.openStoredObject(row.stage_path, signal));
});

describe("files stored in another storage account", () => {
  it("answers 410 media_elsewhere without asking storage, and never marks them missing", async () => {
    media.getMedia.mockResolvedValue(mediaRow({ stage_account: "older.region.aws" }));
    media.openMedia.mockRejectedValue(new StorageError("elsewhere"));
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "media_elsewhere" });
    const head = await fetch(`${base}/media/${ID}`, { method: "HEAD" });
    expect(head.status).toBe(410);
    expect(media.openStoredObject).not.toHaveBeenCalled();
    expect(media.markMediaMissing).not.toHaveBeenCalled();
  });

  it("says when deleting removed the record but kept the copy in the other account", async () => {
    media.deleteMedia.mockResolvedValue("kept");
    const response = await fetch(`${base}/media/${ID}`, { method: "DELETE" });
    expect(await response.json()).toEqual({ deleted: true, kept: true });
  });
});

describe("GET /media/:id", () => {
  it("answers 404 for an unknown file", async () => {
    media.getMedia.mockResolvedValue(undefined);
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "media_not_found" });
    expect(media.openStoredObject).not.toHaveBeenCalled();
  });

  it("answers 410 for a file known to be gone, without asking storage", async () => {
    media.getMedia.mockResolvedValue(mediaRow({ state: "missing" }));
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "media_gone" });
    // An artifact without an archived copy is gone too.
    media.getMedia.mockResolvedValue(mediaRow({ state: "missing", kind: "artifact", session_id: TASK, source_path: "out/shot.png" }));
    expect((await fetch(`${base}/media/${ID}`)).status).toBe(410);
    expect(db.calls.some(call => call.text.includes("FROM curialy.workspace_files"))).toBe(true);
    expect(media.openStoredObject).not.toHaveBeenCalled();
  });

  it("serves an artifact from the task's archive when its stored copy is gone", async () => {
    media.getMedia.mockResolvedValue(mediaRow({ state: "missing", kind: "artifact", session_id: TASK, source_path: "out/shot.png" }));
    db.handler = call => (call.text.includes("FROM curialy.workspace_files") ? { rows: [{ content: Buffer.from("PNGDATA") }] } : { rows: [] });
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("PNGDATA");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("answers 503 with Retry-After while storage is unavailable", async () => {
    media.getMedia.mockResolvedValue(mediaRow());
    media.openStoredObject.mockRejectedValue(new StorageError("unreachable", 12));
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ code: "storage_unavailable", retryAfter: 12 });
    expect(body.error).not.toMatch(INTERNALS);

    media.openStoredObject.mockRejectedValue(new StorageError("stage_missing", 0, "Stage '@CURIALY_DB.PUBLIC.USER_MEDIA_STAGE' does not exist"));
    const missingStage = await fetch(`${base}/media/${ID}`);
    expect(missingStage.status).toBe(503);
    expect(missingStage.headers.get("retry-after")).toBe("30");
    expect(JSON.stringify(await missingStage.json())).not.toMatch(INTERNALS);
  });

  it("marks an object storage no longer has as missing and answers 410", async () => {
    media.getMedia.mockResolvedValue(mediaRow());
    media.openStoredObject.mockRejectedValue(new StorageError("object_missing"));
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(410);
    expect(media.markMediaMissing).toHaveBeenCalledWith(ID);
  });

  it("never answers 500 for a storage failure", async () => {
    media.getMedia.mockResolvedValue(mediaRow());
    for (const kind of ["not_configured", "unauthorized", "stage_missing", "unreachable", "object_missing", "rejected"] as const) {
      media.openStoredObject.mockRejectedValueOnce(new StorageError(kind, 3, "internal"));
      const response = await fetch(`${base}/media/${ID}`);
      expect([410, 422, 503], kind).toContain(response.status);
      expect(JSON.stringify(await response.json())).not.toMatch(INTERNALS);
    }
  });

  it("streams the stored bytes through this origin, sandboxed and cacheable", async () => {
    media.getMedia.mockResolvedValue(mediaRow());
    media.openStoredObject.mockResolvedValue(new Response("PNGDATA", { headers: { "content-length": "7" } }));
    const response = await fetch(`${base}/media/${ID}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("PNGDATA");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("etag")).toBe(`"${ID}"`);
    media.openStoredObject.mockClear();
    const cached = await fetch(`${base}/media/${ID}`, { headers: { "if-none-match": `"${ID}"` } });
    expect(cached.status).toBe(304);
    expect(media.openStoredObject).not.toHaveBeenCalled();
  });
});

describe("HEAD /media/:id", () => {
  it("explains a failed image from the row and the breaker only", async () => {
    media.getMedia.mockResolvedValueOnce(undefined);
    expect((await fetch(`${base}/media/${ID}`, { method: "HEAD" })).status).toBe(404);
    media.getMedia.mockResolvedValueOnce(mediaRow({ state: "missing" }));
    expect((await fetch(`${base}/media/${ID}`, { method: "HEAD" })).status).toBe(410);
    media.getMedia.mockResolvedValue(mediaRow());
    expect((await fetch(`${base}/media/${ID}`, { method: "HEAD" })).status).toBe(200);
    media.mediaStatus.mockResolvedValue({ ok: false, state: "unavailable", kind: "unreachable", retryAfter: 9, detail: "File storage is temporarily unreachable." });
    const down = await fetch(`${base}/media/${ID}`, { method: "HEAD" });
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("9");
    expect(media.openStoredObject).not.toHaveBeenCalled();
    // Health from memory: never the probing variant.
    for (const args of media.mediaStatus.mock.calls) expect(args[0]).toBeFalsy();
  });
});

describe("POST /media", () => {
  it("refuses an upload while storage is unavailable before reading its body", async () => {
    media.assertStorageAvailable.mockImplementation(() => { throw new StorageError("unreachable", 20); });
    const { port } = server.address() as AddressInfo;
    // A 10 MB upload of which only the first bytes are ever sent: the answer must not wait for the rest.
    const answer = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, path: "/api/agent/media", method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(10 * 1024 * 1024) } }, response => {
        let body = "";
        response.on("data", chunk => { body += chunk; });
        response.on("end", () => { resolve({ status: response.statusCode ?? 0, headers: response.headers, body }); request.destroy(); });
      });
      request.on("error", error => (error.message.includes("socket hang up") ? undefined : reject(error)));
      request.write("--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n\r\n");
    });
    expect(answer.status).toBe(503);
    expect(answer.headers["retry-after"]).toBe("20");
    expect(JSON.parse(answer.body)).toMatchObject({ code: "storage_unavailable", retryAfter: 20 });
    expect(media.storeMedia).not.toHaveBeenCalled();
  });

  it("stores an upload and returns its public description only", async () => {
    media.storeMedia.mockImplementation(async (input: { filename: string; mimeType: string; buffer: Buffer }) => ({ id: ID, filename: input.filename, mimeType: input.mimeType, sizeBytes: input.buffer.length, kind: "upload", stagePath: "upload/secret/a.txt" }));
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "a.txt");
    const response = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ file: { id: ID, filename: "a.txt", mimeType: "text/plain", sizeBytes: 5, kind: "upload" } });
  });
});

describe("DELETE /media/:id", () => {
  it("deletes nothing while storage is unavailable", async () => {
    media.deleteMedia.mockRejectedValueOnce(new StorageError("unreachable", 15));
    const down = await fetch(`${base}/media/${ID}`, { method: "DELETE" });
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("15");
    media.deleteMedia.mockResolvedValueOnce(false);
    expect((await fetch(`${base}/media/${ID}`, { method: "DELETE" })).status).toBe(404);
    media.deleteMedia.mockResolvedValueOnce("removed");
    const deleted = await fetch(`${base}/media/${ID}`, { method: "DELETE" });
    expect(await deleted.json()).toEqual({ deleted: true, kept: false });
  });
});

// ---- Task routes over a scripted row ----

type Session = Record<string, unknown>;
const session = (patch: Session = {}): Session => ({
  id: TASK, prompt: "Build it", status: "completed", mode: "agent", model: "claude-sonnet-4-5", effort: "medium", web_search: false, phase: null, answer: "Done.", error: null,
  usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, files_changed: 0, workspace_state: "archived", github_repo: null, github_repo_url: null, github_pushed_at: null,
  github_mode: null, github_branch: null, team: false, created_at: new Date("2026-10-27T10:00:00Z"), updated_at: new Date("2026-10-27T10:05:00Z"), status_reason: null,
  status_changed_at: new Date("2026-10-27T10:05:00Z"), started_at: null, finished_at: new Date("2026-10-27T10:05:00Z"), run_id: RUN, attempt: 1, cancel_requested_at: null, outcome: null,
  worker_id: null, lease_live: false, lease_expired_for: null, cancel_requested: false, ...patch,
});

function scriptTask(row: Session, extra: (call: Call) => unknown = () => undefined) {
  db.handler = call => {
    const answer = extra(call);
    if (answer !== undefined) return answer;
    if (call.text.includes("github_mode = 'linked'")) return { rows: [] };
    if (call.text.includes("FROM curialy.chat_sessions WHERE id = $1")) return { rows: [row] };
    if (call.text.includes("WITH moved AS")) {
      const [, to, from, runId] = call.values as [string, string, string[], string];
      const applies = from.includes(row.status as string) && runId === row.run_id;
      if (applies) row.status = to;
      return { rows: [{ moved: applies ? "1" : "0", inserted: [] }] };
    }
    return { rows: [], rowCount: 0 };
  };
}

describe("POST /tasks/:id/cancel", () => {
  const cancel = (runId?: string) => fetch(`${base}/tasks/${TASK}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(runId ? { runId } : {}) });

  it("answers 200 for a finished task, 202 while another worker stops it, 409 for a stale run", async () => {
    scriptTask(session());
    const done = await cancel(RUN);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ status: "completed", changed: false });

    scriptTask(session({ status: "running", worker_id: "other-box:7:abcd", lease_live: true }));
    const stopping = await cancel(RUN);
    expect(stopping.status).toBe(202);
    expect(await stopping.json()).toMatchObject({ status: "cancelling", statusReason: "user_cancel", runId: RUN });

    scriptTask(session({ status: "running", run_id: "10000000-0000-4000-8000-0000000000e2", worker_id: "other-box:7:abcd", lease_live: true }));
    const stale = await cancel(RUN);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/newer run/);

    for (const spy of Object.values(publish)) expect(spy).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown task", async () => {
    db.handler = () => ({ rows: [] });
    expect((await cancel()).status).toBe(404);
  });
});

describe("DELETE /tasks/:id", () => {
  const remove = () => fetch(`${base}/tasks/${TASK}`, { method: "DELETE" });
  const deleting = (call: Call) => (call.text.startsWith("DELETE FROM curialy.chat_sessions") ? { rows: [], rowCount: 1 } : undefined);

  it("refuses while a live worker runs the task", async () => {
    scriptTask(session({ status: "running", worker_id: "other-box:7:abcd", lease_live: true }), deleting);
    const response = await remove();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: "running" });
    expect(db.calls.some(call => call.text.startsWith("DELETE"))).toBe(false);
  });

  it("deletes a task whose run lost its worker long ago, as cancel would", async () => {
    scriptTask(session({ status: "running", worker_id: `${os.hostname()}:${process.ppid}:abcd`, lease_live: false, lease_expired_for: 600 }), deleting);
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, previewsRemoved: 0, filesRemoved: 0, filesKept: 0 });
  });

  it("takes its previews down and removes its stored files, keeping count of what storage could not delete", async () => {
    const future = new Date(Date.now() + 3600_000);
    scriptTask(session(), call => {
      if (call.text.includes("FROM curialy.deployments WHERE session_id = $1")) return { rows: [{ id: "d-1", call_id: null, status: "live", url: "https://p.example", detail: null, repo: null, repo_owned_by_user: false, created_at: new Date(), expires_at: future, deleted_at: null, removed_reason: null }] };
      if (call.text.startsWith("SELECT session_id, service_id, repo, name")) return { rows: [{ session_id: TASK, service_id: null, repo: null, name: null, repo_owned_by_user: false, status: "live", url: "https://p.example" }] };
      if (call.text.startsWith("SELECT id FROM curialy.file_metadata")) return { rows: [{ id: "f-1" }, { id: "f-2" }] };
      if (call.text.includes("WITH base AS")) return { rows: [] };
      return deleting(call);
    });
    media.deleteMedia.mockImplementation(async (id: string) => { if (id === "f-2") throw new StorageError("unreachable", 10); return true; });
    const response = await remove();
    expect(await response.json()).toEqual({ deleted: true, previewsRemoved: 1, filesRemoved: 1, filesKept: 1 });
    expect(db.calls.find(call => call.text.includes("removed_reason = COALESCE(removed_reason, $2)"))!.values).toEqual(["d-1", "user", "service deleted; repo kept"]);
  });
});

describe("POST /tasks/:id/retry", () => {
  it("refuses a completed task and points to a follow-up", async () => {
    scriptTask(session());
    const response = await fetch(`${base}/tasks/${TASK}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/follow-up/);
  });

  it("refuses a retry from a tab that saw an older run", async () => {
    scriptTask(session({ status: "failed", error: "Boom" }), call => (call.text.includes("SET status = 'queued'") ? { rows: [] } : undefined));
    const response = await fetch(`${base}/tasks/${TASK}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: "10000000-0000-4000-8000-0000000000e9" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/changed since you loaded it/);
    const claim = db.calls.find(call => call.text.includes("SET status = 'queued'"))!;
    expect(claim.values.at(-1)).toBe("10000000-0000-4000-8000-0000000000e9");
  });
});

describe("POST /tasks/:id/deploy", () => {
  it("needs an explicit confirmation and a configured deploy target", async () => {
    scriptTask(session());
    const unconfirmed = await fetch(`${base}/tasks/${TASK}/deploy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(unconfirmed.status).toBe(400);
    const unconfigured = await fetch(`${base}/tasks/${TASK}/deploy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    expect(unconfigured.status).toBe(409);
    expect(publish.deployPreview).not.toHaveBeenCalled();
    expect(db.calls.some(call => call.text.includes("SET status = 'queued'"))).toBe(false);
  });
});

describe("GET /tasks/:id/deployments", () => {
  it("derives each preview's state from its row: an expired preview is never live", async () => {
    const hourAgo = new Date(Date.now() - 3600_000);
    const inAnHour = new Date(Date.now() + 3600_000);
    const deployment = (id: string, patch: Record<string, unknown>) => ({ id, call_id: `call-${id}`, status: "live", url: `https://${id}.example`, detail: null, repo: `octo/curialy-preview-${id}`, repo_owned_by_user: false, created_at: hourAgo, expires_at: inAnHour, deleted_at: null, removed_reason: null, ...patch });
    scriptTask(session(), call => (call.text.includes("FROM curialy.deployments WHERE session_id = $1") ? {
      rows: [
        deployment("live", {}),
        deployment("stale", { expires_at: hourAgo }),
        deployment("building", { status: "building" }),
        deployment("removed", { deleted_at: hourAgo, removed_reason: "user" }),
      ],
    } : undefined));
    const response = await fetch(`${base}/tasks/${TASK}/deployments`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deployments.map((item: { id: string; state: string; canRemove: boolean }) => [item.id, item.state, item.canRemove])).toEqual([
      ["live", "live", true], ["stale", "expired", true], ["building", "interrupted", true], ["removed", "removed", false],
    ]);
    expect(body.deployments[0].target).toEqual({ kind: "temp_repo", repo: "octo/curialy-preview-live", private: true });
    expect(body.capabilities).toEqual({ configured: false, github: false });
  });
});

describe("live browser sessions", () => {
  const logWith = (events: Record<string, unknown>[]) => (call: Call) => {
    if (call.text.includes("FROM curialy.agent_execution_logs WHERE session_id = $1 AND seq > $2")) return { rows: events.map((data, index) => ({ seq: index + 1, data, created_at: new Date() })) };
    if (call.text.includes("INSERT INTO curialy.agent_execution_logs")) return { rows: JSON.parse(call.values[1] as string).map((data: unknown, index: number) => ({ seq: events.length + index + 1, created_at: new Date(), data })) };
    return undefined;
  };

  it("reports a session this process does not drive as ended, without a viewer", async () => {
    scriptTask(session());
    const response = await fetch(`${base}/tasks/${TASK}/browser/s-unknown?fresh=1`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ended", viewer: null, title: "", url: "" });
  });

  it("corrects a log that still shows a dead session live, and rate-limits reconnects", async () => {
    scriptTask(session({ status: "interrupted" }), logWith([{ type: "browser_session", sessionId: "s1", status: "live", liveUrl: null, replayUrl: "" }]));
    const reconnect = () => fetch(`${base}/tasks/${TASK}/browser/s1/reconnect`, { method: "POST" });
    const first = await reconnect();
    expect(first.status).toBe(410);
    expect(await first.json()).toMatchObject({ status: "ended", viewer: null });
    const appended = db.calls.find(call => call.text.includes("INSERT INTO curialy.agent_execution_logs"))!;
    expect(JSON.parse(appended.values[1] as string)).toEqual([{ type: "browser_session", sessionId: "s1", status: "ended", liveUrl: null, replayUrl: "", reason: "interrupted" }]);
    expect((await reconnect()).status).toBe(429);
  });

  it("leaves a log alone when the session already ended", async () => {
    scriptTask(session(), logWith([{ type: "browser_session", sessionId: "s2", status: "live", liveUrl: null, replayUrl: "" }, { type: "browser_session", sessionId: "s2", status: "ended", liveUrl: null, replayUrl: "", reason: "done" }]));
    expect((await fetch(`${base}/tasks/${TASK}/browser/s2/reconnect`, { method: "POST" })).status).toBe(410);
    expect(db.calls.some(call => call.text.includes("INSERT INTO curialy.agent_execution_logs"))).toBe(false);
  });
});

describe("GET /tasks/:id/events", () => {
  it("starts with a sync message, replays the log and ends when nothing is live", async () => {
    scriptTask(session({ status: "interrupted", status_reason: "server_restart" }), call => {
      if (call.text.includes("SELECT MAX(seq) AS seq")) return { rows: [{ seq: 2 }] };
      if (call.text.includes("FROM curialy.agent_execution_logs WHERE session_id = $1 AND seq > $2")) {
        return { rows: [
          { seq: 1, data: { type: "status", status: "running" }, created_at: new Date() },
          { seq: 2, data: { type: "done", status: "interrupted", answer: "", reason: "server_restart" }, created_at: new Date() },
        ] };
      }
      return undefined;
    });
    const response = await fetch(`${base}/tasks/${TASK}/events?after=0`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const messages = text.trim().split("\n\n");
    expect(messages[0]).toBe(`event: sync\ndata: ${JSON.stringify({ maxSeq: 2, status: "interrupted", statusReason: "server_restart", runId: RUN, live: false })}`);
    expect(messages.slice(1, 3).map(message => message.split("\n")[0])).toEqual(["id: 1", "id: 2"]);
    expect(messages.at(-1)).toBe("event: end\ndata: {}");
  });
});

// ---- Export and preview over a real (temporary) workspace directory ----

function workspaceWith(files: Record<string, string>) {
  const root = path.join(tmp, TASK);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}
const BUILT = '<!doctype html><script type="module" src="./assets/index-BSEziAk6.js"></script>';
const TEMPLATE = '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>';
const post = (route: string, body: unknown) => fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /tasks/:id/export", () => {
  const connection = { login: "octo", name: null, email: null, avatarUrl: null, scopes: "repo", connectedAt: "", token: "gh-token" };
  beforeEach(() => {
    workspaceWith({ "index.html": "<h1>Hi</h1>", ".env": "SECRET=1", "attachments/upload.png": "png", "src/app.js": "x" });
    github.getConnection.mockResolvedValue(connection);
    publish.createRepo.mockImplementation(async (_token: string, name: string, isPrivate: boolean) => ({ full_name: `octo/${name}`, html_url: `https://github.com/octo/${name}`, private: isPrivate, default_branch: "main" }));
    publish.pushProjectToRepo.mockImplementation(async (_token: string, fullName: string) => ({ branch: "main", commitSha: "abc", commitUrl: `https://github.com/${fullName}/commit/abc`, repoUrl: `https://github.com/${fullName}` }));
    publish.branchHead.mockResolvedValue("1".repeat(40));
    publish.githubApi.mockResolvedValue({ default_branch: "main" });
  });

  const exported = (pushed: Record<string, string>) => session({ github_repo: "octo/site", github_repo_url: "https://github.com/octo/site", github_mode: "export", github_pushed: pushed });

  it("re-exports over the workspace's own last push, and asks before replacing commits made elsewhere", async () => {
    const heads = { main: "1".repeat(40) };
    scriptTask(exported(heads));
    const plan = await post(`/tasks/${TASK}/export/plan`, {});
    expect(await plan.json()).toMatchObject({ target: { kind: "existing", repo: "octo/site", branch: "main", remote: "ours" } });
    const response = await post(`/tasks/${TASK}/export`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ repo: "octo/site", created: false, branch: "main" });
    expect(publish.pushProjectToRepo.mock.calls[0][6]).toEqual(heads);
    const recorded = db.calls.find(call => call.text.includes("github_pushed = github_pushed || jsonb_build_object"));
    expect(recorded?.values.slice(3)).toEqual(["main", "abc"]);

    publish.branchHead.mockResolvedValue("2".repeat(40));
    expect(await (await post(`/tasks/${TASK}/export/plan`, {})).json()).toMatchObject({ target: { branch: "main", remote: "changed" } });
    publish.pushProjectToRepo.mockRejectedValueOnce(new RemoteChangedError("main"));
    const refused = await post(`/tasks/${TASK}/export`, {});
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "remote_changed", branch: "main" });

    publish.pushProjectToRepo.mockClear();
    expect((await post(`/tasks/${TASK}/export`, { confirmOverwrite: true })).status).toBe(200);
    expect(publish.pushProjectToRepo.mock.calls[0][6]).toBeUndefined();
    expect(publish.createRepo).not.toHaveBeenCalled();
  });

  it("treats an export without a recorded push as unconfirmed", async () => {
    scriptTask(exported({}));
    expect(await (await post(`/tasks/${TASK}/export/plan`, {})).json()).toMatchObject({ target: { kind: "existing", remote: "unknown" } });
    publish.githubApi.mockRejectedValueOnce(new Error("GitHub GET /repos/octo/site failed (503): unavailable"));
    expect(await (await post(`/tasks/${TASK}/export/plan`, {})).json()).toMatchObject({ target: { kind: "existing", branch: null, remote: "unknown" } });
    expect((await post(`/tasks/${TASK}/export`, {})).status).toBe(200);
    expect(publish.pushProjectToRepo.mock.calls[0][6]).toEqual({});
  });

  it("never creates a repository without a name and an explicit visibility, and never a public one unconfirmed", async () => {
    scriptTask(session());
    const noName = await post(`/tasks/${TASK}/export`, {});
    expect(noName.status).toBe(400);
    const noVisibility = await post(`/tasks/${TASK}/export`, { repoName: "my-site" });
    expect(noVisibility.status).toBe(400);
    expect(await noVisibility.json()).toMatchObject({ code: "visibility_required" });
    const unconfirmed = await post(`/tasks/${TASK}/export`, { repoName: "my-site", visibility: "public" });
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toMatchObject({ code: "confirm_public" });
    expect((await post(`/tasks/${TASK}/export`, { repoName: "bad name!", visibility: "private" })).status).toBe(422);
    expect(publish.createRepo).not.toHaveBeenCalled();
    expect(publish.pushProjectToRepo).not.toHaveBeenCalled();
  });

  it("creates the repository as chosen, records it before pushing, and pushes no uploads or secrets", async () => {
    scriptTask(session());
    const response = await post(`/tasks/${TASK}/export`, { repoName: "my-site", visibility: "private" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ repo: "octo/my-site", created: true, files: 2 });
    expect(publish.createRepo).toHaveBeenCalledWith("gh-token", "my-site", true, expect.any(String));
    const [, fullName, files] = publish.pushProjectToRepo.mock.calls[0];
    expect(fullName).toBe("octo/my-site");
    expect(files.map((file: { path: string }) => file.path).sort()).toEqual(["index.html", "src/app.js"]);
    const recorded = db.calls.find(call => call.text.includes("SET github_repo = $2") && call.text.includes("github_pushed = $4::jsonb"));
    // The new repository's first commit is recorded as the workspace's own, before anything is pushed.
    expect(recorded?.values[3]).toBe(JSON.stringify({ main: "1".repeat(40) }));
    expect(publish.createRepo.mock.invocationCallOrder[0]).toBeLessThan(publish.pushProjectToRepo.mock.invocationCallOrder[0]);
    expect(publish.pushProjectToRepo.mock.calls[0][6]).toBeUndefined();

    publish.createRepo.mockClear();
    expect((await post(`/tasks/${TASK}/export`, { repoName: "open-site", visibility: "public", confirmPublic: true })).status).toBe(200);
    expect(publish.createRepo).toHaveBeenCalledWith("gh-token", "open-site", false, expect.any(String));
  });

  it("asks for a branch on a linked repository and a confirmation for its default branch", async () => {
    scriptTask(session(), call => (call.text.includes("github_mode = 'linked'") ? { rows: [{ github_repo: "octo/app", github_repo_url: "https://github.com/octo/app", github_branch: "main", github_base_sha: "a".repeat(40), github_repo_path: ".", github_pushed: {}, github_deleted: [] }] } : undefined));
    publish.commitAndPush.mockResolvedValue({ nothingToPush: false, commitUrl: "https://github.com/octo/app/commit/abc", changed: 2, deleted: 0, branch: "curialy/00000000" });
    expect((await post(`/tasks/${TASK}/export`, {})).status).toBe(400);
    const toDefault = await post(`/tasks/${TASK}/export`, { branch: "main" });
    expect(toDefault.status).toBe(400);
    expect(await toDefault.json()).toMatchObject({ code: "confirm_default_branch" });
    expect(publish.commitAndPush).not.toHaveBeenCalled();
    const pushed = await post(`/tasks/${TASK}/export`, { branch: "curialy/00000000" });
    expect(pushed.status).toBe(200);
    expect(publish.commitAndPush).toHaveBeenCalledWith(expect.objectContaining({ branch: "curialy/00000000" }));
    expect(publish.createRepo).not.toHaveBeenCalled();
  });

  it("refuses while the task is running", async () => {
    scriptTask(session({ status: "running" }));
    expect((await post(`/tasks/${TASK}/export`, { repoName: "my-site", visibility: "private" })).status).toBe(409);
    expect(publish.createRepo).not.toHaveBeenCalled();
  });
});

describe("GET /tasks/:id/preview", () => {
  const archive = (rows: { build?: string; files?: number; bytes?: number; sourceIndex?: string }) => (call: Call) => {
    if (call.text.includes("role = 'build' AND (path = 'index.html'")) return { rows: rows.build ? [{ path: rows.build }] : [] };
    if (call.text.includes("SELECT count(*) AS files")) return { rows: [{ files: String(rows.files ?? 0), bytes: String(rows.bytes ?? 0) }] };
    if (call.text.includes("role = 'source' AND path = 'index.html'")) return { rows: rows.sourceIndex ? [{ content: Buffer.from(rows.sourceIndex) }] : [] };
    return undefined;
  };

  it("describes an archived build from the archive, without restoring anything", async () => {
    fs.rmSync(path.join(tmp, TASK), { recursive: true, force: true });
    scriptTask(session(), archive({ build: "frontend/dist/index.html", files: 12, bytes: 3456 }));
    const response = await fetch(`${base}/tasks/${TASK}/preview`);
    expect(await response.json()).toEqual({ available: false, workspace: false, archived: true, build: { dir: "frontend/dist", fileCount: 12, bytes: 3456, kind: "build" }, restorable: true, running: false });
    expect(db.calls.find(call => call.text.includes("SELECT count(*) AS files"))!.values).toEqual([TASK, "frontend/dist", "frontend/dist/%"]);
    expect(fs.existsSync(path.join(tmp, TASK))).toBe(false);

    scriptTask(session(), archive({ sourceIndex: "<h1>Plain site</h1>", files: 3, bytes: 90 }));
    expect((await (await fetch(`${base}/tasks/${TASK}/preview`)).json()).build).toEqual({ dir: ".", fileCount: 3, bytes: 90, kind: "static" });
    scriptTask(session(), archive({ sourceIndex: TEMPLATE }));
    expect((await (await fetch(`${base}/tasks/${TASK}/preview`)).json()).build).toBeNull();
  });

  it("offers a built site in the live workspace, and never an unbuilt template", async () => {
    workspaceWith({ "frontend/package.json": "{}", "frontend/dist/index.html": BUILT, "index.html": TEMPLATE });
    scriptTask(session());
    const built = await (await fetch(`${base}/tasks/${TASK}/preview`)).json();
    expect(built).toMatchObject({ available: true, workspace: true, dir: "frontend/dist", warnings: [] });
    // The build folder is signed into the token (no query string), so relative assets resolve too.
    expect(built.url).toMatch(new RegExp(`^/api/workspace/preview/${TASK}/[^/?]+/$`));
    const { previewTokenDir } = await import("./agent/preview");
    expect(previewTokenDir(built.url.split("/")[5])).toBe("frontend/dist");

    workspaceWith({ "index.html": TEMPLATE, "src/main.tsx": "x" });
    expect(await (await fetch(`${base}/tasks/${TASK}/preview`)).json()).toEqual({ available: false, workspace: true, archived: false, build: null, restorable: false, running: false });
  });
});
