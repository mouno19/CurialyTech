import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventBody } from "@shared/agent";

// Secrets and approvals: values wiped from output (also when split across chunks), the masked-box
// request and its answers, secrets reaching real commands without appearing in their arguments,
// GitHub Actions changes waiting for approval (or not, when the account turned asking off), and
// the Secrets page's API never handing a value back.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-secrets-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const state = vi.hoisted(() => ({
  secrets: new Map<string, any>(),
  autoApprove: false,
  owners: {} as Record<string, string>,
  spawnArgs: [] as string[][],
}));

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: ((file: string, args: readonly string[], options: object) => { state.spawnArgs.push([file, ...args]); return actual.spawn(file, args, options); }) as typeof actual.spawn };
});

vi.mock("./db/pg", () => {
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  return {
    query: vi.fn(async (text: string, values: any[] = []) => {
      const sql = norm(text);
      const key = (user: string, name: string) => `${user}:${name}`;
      if (sql.startsWith("INSERT INTO curialy.user_secrets")) {
        const [user, name, note, ciphertext, iv, tag, max] = values;
        const others = [...state.secrets.values()].filter(row => row.user_id === user && row.name !== name).length;
        if (others >= max) return { rows: [] };
        const now = new Date();
        const existing = state.secrets.get(key(user, name));
        state.secrets.set(key(user, name), { user_id: user, name, note: note ?? existing?.note ?? null, ciphertext, iv, tag, created_at: existing?.created_at ?? now, updated_at: now, last_used_at: existing?.last_used_at ?? null });
        return { rows: [{ name }] };
      }
      if (sql.startsWith("SELECT name, note, created_at")) return { rows: [...state.secrets.values()].filter(row => row.user_id === values[0]).sort((a, b) => a.name.localeCompare(b.name)) };
      if (sql.startsWith("SELECT name FROM curialy.user_secrets")) return { rows: [...state.secrets.values()].filter(row => row.user_id === values[0]).map(row => ({ name: row.name })) };
      if (sql.startsWith("UPDATE curialy.user_secrets SET last_used_at")) {
        const row = state.secrets.get(key(values[0], values[1]));
        if (row) row.last_used_at = new Date();
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith("DELETE FROM curialy.user_secrets")) return { rows: [], rowCount: state.secrets.delete(key(values[0], values[1])) ? 1 : 0 };
      throw new Error(`unexpected query: ${sql.slice(0, 100)}`);
    }),
    db: () => { throw new Error("no transactions here"); },
  };
});

vi.mock("./services/github", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/github")>();
  return {
    ...actual,
    getConnection: async (userId: string) => (userId === "user-a" ? { login: "jane", name: null, email: null, avatarUrl: null, scopes: "repo workflow", connectedAt: "", token: "gho_test" } : null),
    githubAutoApprove: async () => state.autoApprove,
  };
});

vi.mock("./agent/store", () => ({ taskOwner: async (id: string) => state.owners[id] ?? null }));
vi.mock("./agent/repos", () => ({ linkedRepo: async () => ({ fullName: "jane/shop", branch: "main", baseSha: "a".repeat(40), repoPath: ".", url: "", pushed: {}, deleted: [] }) }));

vi.mock("./auth", async importOriginal => {
  const actual = await importOriginal<typeof import("./auth")>();
  return { ...actual, requireUser: (_req: unknown, _res: unknown, next: () => void) => next(), accountOf: () => ({ id: "user-a", role: "user" }), rateLimited: () => false };
});

// ---- A fake GitHub ----
const github = { calls: [] as { method: string; path: string }[] };
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  if (url.hostname !== "api.github.com") throw new Error(`unexpected request to ${url.href}`);
  const method = init.method ?? "GET";
  github.calls.push({ method, path: `${url.pathname}${url.search}` });
  const p = url.pathname;
  if (p === "/repos/jane/shop") return json(200, { id: 1, name: "shop", full_name: "jane/shop", private: true, default_branch: "main", html_url: "https://github.com/jane/shop" });
  if (p === "/repos/jane/shop/actions/runs/7") return json(200, { id: 7, name: "CI", run_number: 12, run_attempt: 1, status: "completed", conclusion: "failure", event: "push", head_branch: "main", head_sha: "abc1234def5678", html_url: "https://github.com/jane/shop/actions/runs/7", created_at: "2026-11-14T08:00:00Z" });
  if (p === "/repos/jane/shop/actions/runs/7/jobs") return json(200, { jobs: [{ id: 70, name: "test", status: "completed", conclusion: "failure", steps: [{ number: 4, name: "Run tests", status: "completed", conclusion: "failure" }] }, { id: 71, name: "lint", status: "completed", conclusion: "success", steps: [] }] });
  if (p === "/repos/jane/shop/actions/jobs/70/logs") {
    const lines = Array.from({ length: 200 }, (_, index) => `2026-11-14T08:01:${String(index % 60).padStart(2, "0")}.1234567Z step output ${index}`);
    lines[120] = "2026-11-14T08:02:00.0000000Z ##[error]Process completed with exit code 1: FAIL src/cart.test.ts";
    return new Response(lines.join("\n"), { status: 200 });
  }
  if (method === "POST" && /\/actions\/runs\/7\/(rerun-failed-jobs|rerun|cancel)$/.test(p)) return json(201, {});
  return json(404, { message: "Not Found" });
});

const { redactDeep, redactText, streamRedactor } = await import("./agent/redact");
const requests = await import("./agent/requests");
const { runCommand } = await import("./agent/sandbox");
const { runGitHubCiTool } = await import("./agent/github-ci-tools");
const secrets = await import("./secrets");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  requests.resetRequests();
  state.secrets.clear();
  state.autoApprove = false;
  state.owners = { "task-a": "user-a" };
  state.spawnArgs = [];
  github.calls = [];
});

/** A run's context that records its events. */
function runContext(taskId = "task-a") {
  const events: AgentEventBody[] = [];
  const controller = new AbortController();
  return { events, controller, ctx: { taskId, sessionId: taskId, emit: (body: AgentEventBody) => { events.push(body); }, signal: controller.signal } };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(check()).toBe(true);
};
const requestOf = (events: AgentEventBody[], type: "approval_request" | "secret_request") => events.find(event => event.type === type) as Extract<AgentEventBody, { requestId: string }> | undefined;

describe("redaction", () => {
  const secret = { name: "API_TOKEN", value: "s3cr3t-Value-0042" };
  it("replaces every occurrence, longest first, deep inside events", () => {
    expect(redactText(`a ${secret.value} b ${secret.value}`, [secret])).toBe("a [secret API_TOKEN] b [secret API_TOKEN]");
    const nested = { type: "x", list: [{ text: `key=${secret.value}` }], untouched: 3 };
    expect(redactDeep(nested, [secret])).toEqual({ type: "x", list: [{ text: "key=[secret API_TOKEN]" }], untouched: 3 });
    const clean = { a: "nothing here" };
    expect(redactDeep(clean, [secret])).toBe(clean);
    expect(redactText("ab-s3cr3t-Value-0042-long", [secret, { name: "LONG", value: "s3cr3t-Value-0042-long" }])).toBe("ab-[secret LONG]");
  });

  it("catches a value split across streamed chunks, at every split point", () => {
    const full = `start ${secret.value} middle ${secret.value}end`;
    for (let first = 1; first < full.length; first++) {
      for (const second of [first + 1, first + 7, full.length]) {
        const stream = streamRedactor([secret]);
        const out = [full.slice(0, first), full.slice(first, second), full.slice(second)].map(chunk => stream.push(chunk)).join("") + stream.flush();
        expect(out).toBe(redactText(full, [secret]));
        expect(out).not.toContain(secret.value.slice(0, 8));
      }
    }
  });
});

describe("secrets in commands", () => {
  const root = path.join(tmp, "task-cmd");
  fs.mkdirSync(root, { recursive: true });
  const value = "pa'ss$word with spaces \"and\" quotes";

  it("reach the command as environment variables, never in its arguments, and are wiped from the output", async () => {
    const streamed: string[] = [];
    const result = await runCommand({ root, command: 'echo "got=$DB_PASSWORD"; [ "$DB_PASSWORD" = "$EXPECTED" ] && echo same', timeoutSec: 20, secrets: [{ name: "DB_PASSWORD", value }, { name: "EXPECTED", value }], onOutput: (_stream, chunk) => streamed.push(chunk) });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("got=[secret DB_PASSWORD]");
    expect(result.output).toContain("same");
    expect(result.output).not.toContain("pa'ss");
    expect(streamed.join("")).not.toContain("pa'ss");
    expect(state.spawnArgs.flat().join(" ")).not.toContain("pa'ss");
  });

  it("a task's own secrets (given once) reach all of its commands", async () => {
    const taskRoot = path.join(tmp, "task-own");
    fs.mkdirSync(taskRoot, { recursive: true });
    const { ctx } = runContext("task-own");
    await requests.askSecret(ctx, { name: "STRIPE_KEY", reason: "Charge a test card" }, { load: async () => "sk_test_1234567890", save: async () => undefined });
    const result = await runCommand({ root: taskRoot, command: 'printf "%s" "$STRIPE_KEY" | wc -c; echo "$STRIPE_KEY"', timeoutSec: 20, onOutput: () => undefined });
    expect(result.output).toContain("18");
    expect(result.output).toContain("[secret STRIPE_KEY]");
    expect(result.output).not.toContain("sk_test_1234567890");
    // Another task never gets them.
    const other = path.join(tmp, "task-other");
    fs.mkdirSync(other, { recursive: true });
    expect((await runCommand({ root: other, command: 'echo "[$STRIPE_KEY]"', timeoutSec: 20, onOutput: () => undefined })).output.trim()).toBe("[]");
  });
});

describe("the secret box", () => {
  it("asks, takes the value from the answer only, and never puts it in an event", async () => {
    const { ctx, events } = runContext();
    const saved: string[] = [];
    const pending = requests.askSecret(ctx, { name: "OPENAI_API_KEY", reason: "Call the model in the tests" }, { load: async () => null, save: async name => { saved.push(name); } });
    await until(() => Boolean(requestOf(events, "secret_request")));
    const request = requestOf(events, "secret_request")!;
    expect(request).toMatchObject({ name: "OPENAI_API_KEY", reason: "Call the model in the tests", canSave: true });
    expect(requests.answerRequest("task-other", request.requestId, { value: "sk-abcdefgh", save: true })).toBe("not_found");
    expect(requests.answerRequest("task-a", request.requestId, { decision: "approved" })).toBe("wrong_kind");
    expect(requests.answerRequest("task-a", request.requestId, { value: "sk-abcdefgh", save: true })).toBe("ok");
    const answer = await pending;
    expect(answer).toMatchObject({ ok: true, outcome: "saved" });
    expect(answer.message).toContain("$OPENAI_API_KEY");
    expect(answer.message).not.toContain("sk-abcdefgh");
    expect(saved).toEqual(["OPENAI_API_KEY"]);
    expect(JSON.stringify(events)).not.toContain("sk-abcdefgh");
    expect(events.at(-1)).toMatchObject({ type: "secret_result", name: "OPENAI_API_KEY", outcome: "saved" });
    expect(requests.taskSecrets("task-a")).toEqual([{ name: "OPENAI_API_KEY", value: "sk-abcdefgh" }]);
    expect(requests.redactForTask("task-a", { type: "notice", message: "key sk-abcdefgh" })).toEqual({ type: "notice", message: "key [secret OPENAI_API_KEY]" });
    // Asked again in the task: already set, no new box.
    expect((await requests.askSecret(ctx, { name: "OPENAI_API_KEY", reason: "again" }, null)).outcome).toBe("known");
    expect(events.filter(event => event.type === "secret_request")).toHaveLength(1);
  });

  it("uses a saved secret without asking, and reports a decline or no answer", async () => {
    const { ctx, events } = runContext();
    expect((await requests.askSecret(ctx, { name: "SAVED_ONE", reason: "x" }, { load: async () => "from-the-vault", save: async () => undefined })).outcome).toBe("from_vault");
    expect(events.some(event => event.type === "secret_request")).toBe(false);
    const declined = requests.askSecret(ctx, { name: "NOT_GIVEN", reason: "x" }, null);
    await until(() => Boolean(requestOf(events, "secret_request")));
    expect(requestOf(events, "secret_request")).toMatchObject({ canSave: false });
    requests.answerRequest("task-a", requestOf(events, "secret_request")!.requestId, { decline: true });
    expect(await declined).toMatchObject({ ok: false, outcome: "declined" });
    expect(await requests.askSecret(ctx, { name: "TOO_SLOW", reason: "x" }, null, { ttlMs: 20 })).toMatchObject({ ok: false, outcome: "expired" });
  });

  it("a cancelled run stops waiting", async () => {
    const { ctx, controller, events } = runContext();
    const pending = requests.askSecret(ctx, { name: "WAITING", reason: "x" }, null);
    await until(() => Boolean(requestOf(events, "secret_request")));
    controller.abort(new Error("cancelled by the user"));
    await expect(pending).rejects.toThrow("cancelled by the user");
    expect(requests.answerRequest("task-a", requestOf(events, "secret_request")!.requestId, { value: "late-value", save: false })).toBe("not_found");
  });
});

describe("approvals", () => {
  const change = { action: "github_commit_and_push", title: "Push 2 file change(s) to jane/shop (main)", details: ["Repository: jane/shop", "Branch: main"] };

  it("waits for the user: approve once, deny, or approve for the rest of the task", async () => {
    const { ctx, events } = runContext();
    const first = requests.askApproval(ctx, change, { autoApprove: false });
    await until(() => Boolean(requestOf(events, "approval_request")));
    expect(requestOf(events, "approval_request")).toMatchObject({ action: change.action, title: change.title, details: change.details });
    requests.answerRequest("task-a", requestOf(events, "approval_request")!.requestId, { decision: "denied" });
    expect(await first).toMatchObject({ approved: false, message: expect.stringMatching(/denied/) });

    events.length = 0;
    const second = requests.askApproval(ctx, change, { autoApprove: false });
    await until(() => Boolean(requestOf(events, "approval_request")));
    requests.answerRequest("task-a", requestOf(events, "approval_request")!.requestId, { decision: "approved_task" });
    expect(await second).toMatchObject({ approved: true });
    // The rest of the task goes ahead, and says so.
    events.length = 0;
    expect(await requests.askApproval(ctx, change, { autoApprove: false })).toMatchObject({ approved: true });
    expect(events).toEqual([expect.objectContaining({ type: "approval_result", decision: "task" })]);
    // Another task still asks.
    const other = runContext("task-b");
    const third = requests.askApproval(other.ctx, change, { autoApprove: false, ttlMs: 30 });
    expect(await third).toMatchObject({ approved: false, message: expect.stringMatching(/didn't answer/) });
    expect(other.events.map(event => event.type)).toEqual(["approval_request", "approval_result"]);
  });

  it("goes ahead without asking when the account turned asking off (and logs it)", async () => {
    const { ctx, events } = runContext();
    expect(await requests.askApproval(ctx, change, { autoApprove: true })).toMatchObject({ approved: true });
    expect(events).toEqual([expect.objectContaining({ type: "approval_result", decision: "auto", title: change.title })]);
  });
});

describe("GitHub Actions tools", () => {
  const tool = (name: Parameters<typeof runGitHubCiTool>[0], input: Record<string, unknown>) => {
    const { ctx, events } = runContext();
    return { events, done: runGitHubCiTool(name, input, ctx as never) };
  };
  const posts = () => github.calls.filter(call => call.method === "POST").map(call => call.path);

  it("reruns failed jobs only after the user approves, showing exactly what will run", async () => {
    const { events, done } = tool("github_rerun", { repo: "jane/shop", run_id: 7, failed_only: true });
    await until(() => Boolean(requestOf(events, "approval_request")));
    const request = requestOf(events, "approval_request") as Extract<AgentEventBody, { type: "approval_request" }>;
    expect(request.title).toBe('Rerun 1 failed job(s) of "CI" #12 on jane/shop');
    expect(request.details).toEqual(expect.arrayContaining(["Repository: jane/shop", "Jobs to rerun: test", "Commit: main@abc1234"]));
    expect(posts()).toEqual([]);
    requests.answerRequest("task-a", request.requestId, { decision: "approved" });
    expect(await done).toMatchObject({ ok: true });
    expect(posts()).toEqual(["/repos/jane/shop/actions/runs/7/rerun-failed-jobs"]);
  });

  it("changes nothing when the user denies", async () => {
    const { events, done } = tool("github_rerun", { repo: "jane/shop", run_id: 7, failed_only: false });
    await until(() => Boolean(requestOf(events, "approval_request")));
    requests.answerRequest("task-a", requestOf(events, "approval_request")!.requestId, { decision: "denied" });
    expect(await done).toMatchObject({ ok: false, declined: true });
    expect(posts()).toEqual([]);
  });

  it("goes ahead without asking when approvals are off", async () => {
    state.autoApprove = true;
    const { events, done } = tool("github_rerun", { run_id: 7, failed_only: true });
    expect(await done).toMatchObject({ ok: true });
    expect(events.some(event => event.type === "approval_request")).toBe(false);
    expect(posts()).toEqual(["/repos/jane/shop/actions/runs/7/rerun-failed-jobs"]);
  });

  it("reads a run's jobs and the failed job's log without changing anything", async () => {
    const run = await tool("github_get_run", { run_id: 7 }).done;
    expect(run.content).toContain("CI #12 on jane/shop: failure");
    expect(run.content).toContain("step 4 Run tests: failure");
    const logs = await tool("github_run_logs", { run_id: 7, failed_only: true }).done;
    expect(logs.content).toContain("=== job 70 test: failure ===");
    expect(logs.content).toContain("##[error]Process completed with exit code 1: FAIL src/cart.test.ts");
    expect(logs.content).not.toMatch(/2026-11-14T08/);
    expect(logs.content).not.toContain("job 71");
    expect(posts()).toEqual([]);
  });

  it("pages through a job's complete log", async () => {
    const page = await tool("github_run_logs", { job_id: 70, from_line: 120, lines: 3 }).done;
    expect(page.content).toBe("Job 70, lines 120–122 of 200:\nstep output 119\n##[error]Process completed with exit code 1: FAIL src/cart.test.ts\nstep output 121\n[lines 123–200 remain: from_line 123]");
    const last = await tool("github_run_logs", { job_id: 70, from_line: 199, lines: 10 }).done;
    expect(last.content).toMatch(/lines 199–200 of 200:[\s\S]*\[end of the log\]$/);
  });

  it("never uses another account's connection", async () => {
    state.owners = { "task-a": "user-b" };
    expect(await tool("github_list_runs", { limit: 5 }).done).toMatchObject({ ok: false, summary: "GitHub not connected" });
    expect(github.calls).toEqual([]);
  });
});

describe("saved secrets", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/secrets", secrets.secretsRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/secrets`;
  });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
  const put = (name: string, body: unknown) => fetch(`${base}/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("stores values encrypted and never hands one back", async () => {
    expect((await put("stripe_key", { value: "sk_live_abcdef123", note: "shop" })).status).toBe(200);
    const row = state.secrets.get("user-a:STRIPE_KEY");
    expect(row.ciphertext.includes(Buffer.from("sk_live_abcdef123"))).toBe(false);
    const listed = await (await fetch(base)).text();
    expect(JSON.parse(listed)).toMatchObject({ configured: true, secrets: [{ name: "STRIPE_KEY", note: "shop", lastUsedAt: null }] });
    expect(listed).not.toContain("sk_live");
    expect(listed).not.toContain("ciphertext");
    expect(await secrets.loadSecret("user-a", "STRIPE_KEY")).toBe("sk_live_abcdef123");
    expect(state.secrets.get("user-a:STRIPE_KEY").last_used_at).toBeInstanceOf(Date);
    expect(await (await fetch(`${base}/STRIPE_KEY`, { method: "DELETE" })).json()).toEqual({ deleted: true });
    expect(await secrets.loadSecret("user-a", "STRIPE_KEY")).toBeNull();
  });

  it("refuses bad names, reserved names and short values, without repeating the value", async () => {
    const bad = await put("1BAD", { value: "long-enough-value" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("long-enough-value");
    expect((await put("PATH", { value: "long-enough-value" })).status).toBe(400);
    expect((await put("GIT_TOKEN", { value: "long-enough-value" })).status).toBe(400);
    const short = await put("SHORT_ONE", { value: "abc" });
    expect(short.status).toBe(400);
    expect(await short.text()).toContain("at least 6 characters");
  });
});
