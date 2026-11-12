import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A preview is built from a NEW temporary private repository, never from a repository the user owns
// or linked; a cancel either creates nothing or takes everything it created down again.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-deploy-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

type Call = { text: string; values: unknown[] };
const db = vi.hoisted(() => ({ calls: [] as Call[], deployment: null as Record<string, unknown> | null, owner: "admin", active: 0 }));
const gh = vi.hoisted(() => ({
  order: [] as string[],
  repoToken: vi.fn(async () => ({ token: "gh-token", login: "octo" })),
  createRepo: vi.fn(async (_token: string, name: string, _private: boolean) => { gh.order.push("createRepo"); return { full_name: `octo/${name}`, html_url: `https://github.com/octo/${name}`, default_branch: "main", owner: { login: "octo" }, name, private: true }; }),
  pushProjectToRepo: vi.fn(async (_token: string, fullName: string) => { gh.order.push("push"); return { branch: "main", commitSha: "abc1234", commitUrl: `https://github.com/${fullName}/commit/abc1234`, repoUrl: `https://github.com/${fullName}` }; }),
  retireRepo: vi.fn(async (_token: string, _repo: string) => { gh.order.push("retireRepo"); return "deleted"; }),
}));

vi.mock("./db/pg", () => ({
  adminUserId: async () => "admin",
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    db.calls.push({ text, values });
    // Every task here is the operator's.
    if (text.startsWith("SELECT user_id FROM curialy.chat_sessions WHERE id = $1")) return { rows: [{ user_id: db.owner }] };
    if (text.includes("count(*)")) return { rows: [{ n: String(db.active) }] };
    if (text.startsWith("INSERT INTO curialy.deployments")) {
      gh.order.push("insert");
      const [id, sessionId, , callId, name, repo] = values as string[];
      db.deployment = { id, session_id: sessionId, service_id: null, repo, name, repo_owned_by_user: false, status: "creating", url: null, call_id: callId };
    }
    const status = text.startsWith("UPDATE") ? /\bstatus = '(\w+)'/.exec(text)?.[1] : undefined;
    if (db.deployment && status) db.deployment.status = status;
    if (db.deployment && text.includes("SET service_id = $2, url = $3")) Object.assign(db.deployment, { service_id: values[1], url: values[2] });
    if (text.startsWith("SELECT session_id, service_id, repo, name") && db.deployment && !db.deployment.deleted) return { rows: [db.deployment] };
    if (db.deployment && text.includes("deleted_at = COALESCE(deleted_at, now())")) {
      db.deployment.deleted ??= values[1];
      db.deployment.cleanup = values[2];
    }
    if (db.deployment && text.startsWith("UPDATE curialy.deployments SET cleanup_detail = $2")) db.deployment.cleanup = values[1];
    if (db.deployment && text.startsWith("UPDATE curialy.deployments SET last_error = $2")) db.deployment.lastError = values[1];
    if (text.includes("INSERT INTO curialy.agent_execution_logs")) return { rows: [{ seq: 1, created_at: new Date(), data: JSON.parse(values[1] as string)[0] }] };
    return { rows: [], rowCount: 1 };
  }),
  heartbeatQuery: vi.fn(async () => ({ rows: [] })),
  db: () => { throw new Error("no pool in tests"); },
}));
vi.mock("./services/github", async importOriginal => ({ ...(await importOriginal<typeof import("./services/github")>()), repoToken: gh.repoToken, createRepo: gh.createRepo, pushProjectToRepo: gh.pushProjectToRepo, retireRepo: gh.retireRepo }));

const { deployPreview, destroyDeployment } = await import("./agent/deploy");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TASK = "00000000-0000-4000-8000-0000000000a1";
let hosting: { method: string; url: string; body?: Record<string, unknown> }[] = [];
let deployStatus = "live";

function project() {
  const root = path.join(tmp, `project-${Math.random().toString(16).slice(2)}`);
  const files: Record<string, string> = {
    "index.html": "<h1>Hi</h1>", "app.js": "console.log(1)", ".env": "SECRET=1", ".env.example": "SECRET=", "attachments/upload.png": "png", ".github/workflows/ci.yml": "on: push",
    "package.json": "{}", "dist/index.html": "<h1>built</h1>", "node_modules/x/index.js": "x",
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

function request(root: string, controller = new AbortController(), hooks: { onCreated?: () => void } = {}, sessionId = TASK) {
  const progress: [string, string, string | undefined][] = [];
  const created: string[] = [];
  return {
    progress, created, controller,
    req: {
      sessionId, callId: "call-1", root, kind: "static" as const, buildCommand: "", publishPath: ".", startCommand: "", signal: controller.signal,
      onCreated: (id: string) => { created.push(id); gh.order.push("onCreated"); hooks.onCreated?.(); },
      onProgress: (status: string, detail: string, url?: string) => { progress.push([status, detail, url]); },
    },
  };
}

beforeEach(() => {
  db.calls.length = 0;
  db.deployment = null;
  db.owner = "admin";
  db.active = 0;
  gh.order.length = 0;
  for (const fn of [gh.createRepo, gh.pushProjectToRepo, gh.retireRepo, gh.repoToken]) fn.mockClear();
  hosting = [];
  deployStatus = "live";
  vi.stubEnv("RENDER_API_KEY", "test-render-key");
  vi.stubEnv("RENDER_OWNER_ID", "owner-1");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    hosting.push(init.body ? { method, url, body: JSON.parse(String(init.body)) as Record<string, unknown> } : { method, url });
    if (method === "POST" && url.endsWith("/services")) return new Response(JSON.stringify({ service: { id: "srv-1", serviceDetails: { url: "https://curialy-preview-test.onrender.com" } } }), { status: 201 });
    if (url.includes("/deploys")) return new Response(JSON.stringify([{ deploy: { status: deployStatus } }]), { status: 200 });
    if (url.includes("/services?name=")) return new Response("[]", { status: 200 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deployPreview", () => {
  it("builds from a new private temporary repository with only publishable files", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { req, progress, created } = request(project());
    let settled = false;
    const pending = deployPreview(req).finally(() => { settled = true; });
    // Skip the build polling interval (8 s) without waiting for it.
    for (let i = 0; i < 30 && !settled; i++) await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(gh.createRepo).toHaveBeenCalledTimes(1);
    const [token, name, isPrivate] = gh.createRepo.mock.calls[0];
    expect(token).toBe("gh-token");
    expect(name).toMatch(/^curialy-preview-[0-9a-f]{8}$/);
    expect(isPrivate).toBe(true);
    // The push goes to the repository just created, nowhere else.
    expect(gh.pushProjectToRepo).toHaveBeenCalledTimes(1);
    const [, fullName, files] = gh.pushProjectToRepo.mock.calls[0] as unknown as [string, string, { path: string }[]];
    expect(fullName).toBe(`octo/${name}`);
    expect(files.map(file => file.path).sort()).toEqual([".env.example", "app.js", "index.html", "package.json"]);
    // Recorded (with the names it will use) before any external call, and every event carries the row id.
    expect(gh.order.slice(0, 4)).toEqual(["insert", "onCreated", "createRepo", "push"]);
    expect(db.calls.find(call => call.text.startsWith("INSERT INTO curialy.deployments"))!.values).toContain(`octo/${name}`);
    expect(created).toHaveLength(1);
    expect(result).toMatchObject({ id: created[0], url: `https://curialy.tech/p/${created[0]}/`, repo: `octo/${name}` });
    expect(result.url).not.toContain("onrender.com");
    const posted = hosting.find(call => call.method === "POST");
    expect(posted?.body).toMatchObject({ type: "static_site", autoDeploy: "no", ownerId: "owner-1" });
    expect(progress.map(([status]) => status)).toEqual(["creating", "creating", "building", "building", "live"]);
    expect(db.deployment).toMatchObject({ status: "live", service_id: "srv-1" });
    expect(gh.retireRepo).not.toHaveBeenCalled();
  });

  it("creates nothing when the run is cancelled before the repository exists", async () => {
    const controller = new AbortController();
    const { req, progress } = request(project(), controller, { onCreated: () => controller.abort() });
    await expect(deployPreview(req)).rejects.toThrow();
    expect(gh.createRepo).not.toHaveBeenCalled();
    expect(gh.pushProjectToRepo).not.toHaveBeenCalled();
    expect(hosting.some(call => call.method === "POST")).toBe(false);
    expect(progress.at(-1)).toEqual(["failed", "Cancelled before the preview went live.", undefined]);
    // The row is closed as cancelled, so no sweeper keeps retrying it.
    expect(db.deployment).toMatchObject({ status: "failed", deleted: "cancelled" });
  });

  it("takes the service and the temporary repository down when cancelled while building", async () => {
    deployStatus = "build_in_progress";
    const controller = new AbortController();
    const { req } = request(project(), controller);
    const pending = deployPreview(req);
    await vi.waitFor(() => expect(db.deployment?.status).toBe("building"));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(hosting).toContainEqual({ method: "DELETE", url: "https://api.render.com/v1/services/srv-1" });
    expect(gh.retireRepo).toHaveBeenCalledWith("gh-token", db.deployment!.repo);
    expect(db.deployment).toMatchObject({ status: "failed", deleted: "cancelled", cleanup: "service deleted; repo deleted" });
    // The task log learns that nothing was left running.
    const logged = db.calls.find(call => call.text.includes("INSERT INTO curialy.agent_execution_logs"));
    expect(JSON.parse(logged!.values[1] as string)).toEqual([expect.objectContaining({ type: "deployment", deploymentId: db.deployment!.id, status: "removed", detail: "The deploy was cancelled; nothing was left running." })]);
  });

  it("refuses an empty workspace or a missing configuration before touching anything", async () => {
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty, { recursive: true });
    await expect(deployPreview(request(empty).req)).rejects.toThrow(/empty/);
    vi.stubEnv("RENDER_API_KEY", "");
    await expect(deployPreview(request(project()).req)).rejects.toThrow(/not configured/);
    expect(db.calls).toHaveLength(0);
    expect(gh.createRepo).not.toHaveBeenCalled();
    expect(hosting).toHaveLength(0);
  });

  it("runs a server preview on the paid plan and keeps a second one from the same account off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const made = request(project());
    made.req.kind = "node";
    made.req.startCommand = "npm start";
    let settled = false;
    const pending = deployPreview(made.req).finally(() => { settled = true; });
    for (let i = 0; i < 30 && !settled; i++) await vi.advanceTimersByTimeAsync(1000);
    await pending;
    const posted = hosting.find(call => call.method === "POST");
    expect(posted?.body).toMatchObject({ type: "web_service", serviceDetails: { plan: "0.5c-512mb", runtime: "node" } });

    vi.useRealTimers();
    db.owner = "user-b";
    db.active = 2;
    db.calls.length = 0;
    gh.createRepo.mockClear();
    await expect(deployPreview(request(project(), new AbortController(), {}, "00000000-0000-4000-8000-0000000000b2").req)).rejects.toThrow(/2 live previews/);
    expect(gh.createRepo).not.toHaveBeenCalled();
  });
});

describe("preview address", () => {
  it("serves the preview on this site and rewrites the upstream out of the page", async () => {
    const { publicPreviewUrl, previewUpstream, rewritePreviewHtml, rewritePreviewLocation } = await import("./agent/deploy-proxy");
    const id = "00000000-0000-4000-8000-0000000000aa";
    expect(publicPreviewUrl(id)).toBe(`https://curialy.tech/p/${id}/`);
    const upstream = previewUpstream("https://curialy-preview-abcd1234.onrender.com")!;
    expect(previewUpstream("https://example.com")).toBeNull();
    expect(rewritePreviewLocation("https://curialy-preview-abcd1234.onrender.com/app", upstream, `/p/${id}/`)).toBe(`/p/${id}/app`);
    expect(rewritePreviewLocation("/assets/app.js", upstream, `/p/${id}/`)).toBe(`/p/${id}/assets/app.js`);
    const html = rewritePreviewHtml(`<head><link href="/assets/app.css"></head><a href="https://curialy-preview-abcd1234.onrender.com/next">`, upstream, `/p/${id}/`);
    expect(html).toContain(`<base href="/p/${id}/">`);
    expect(html).toContain(`href="/p/${id}/assets/app.css"`);
    expect(html).not.toContain("onrender.com");
  });
});

describe("destroyDeployment", () => {
  it("never retires a repository the user owns", async () => {
    db.deployment = { id: "d-1", session_id: null, service_id: "srv-9", repo: "octo/my-app", name: null, repo_owned_by_user: true, status: "live", url: "https://x.example" };
    expect(await destroyDeployment("d-1", "expired")).toBe(true);
    expect(hosting).toContainEqual({ method: "DELETE", url: "https://api.render.com/v1/services/srv-9" });
    expect(gh.retireRepo).not.toHaveBeenCalled();
    expect(db.deployment).toMatchObject({ deleted: "expired", cleanup: "service deleted; repo kept" });
    // Already removed: nothing to do.
    expect(await destroyDeployment("d-1", "user")).toBe(false);
  });

  it("records the preview as removed even when the temporary repository can't be retired yet", async () => {
    db.deployment = { id: "d-2", session_id: null, service_id: "srv-7", repo: "octo/curialy-preview-1234abcd", name: null, repo_owned_by_user: false, status: "live", url: "https://y.example" };
    gh.repoToken.mockResolvedValueOnce(null as never);
    expect(await destroyDeployment("d-2", "user")).toBe(true);
    expect(hosting).toContainEqual({ method: "DELETE", url: "https://api.render.com/v1/services/srv-7" });
    expect(gh.retireRepo).not.toHaveBeenCalled();
    // Never "live" again; the sweeper retries the repository (it looks for "repo pending").
    expect(db.deployment).toMatchObject({ deleted: "user", cleanup: "service deleted; repo pending", lastError: "repo cleanup: GitHub is disconnected" });
  });
});
