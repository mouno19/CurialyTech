import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Whole runs (retry, cancel, the Deploy action) through the real runner, lifecycle, store and bus,
// over an in-memory stand-in for the few SQL statements they send, with a scripted model.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-run-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

type Session = Record<string, any>;
type Logged = { seq: number; type: string; data: Record<string, any>; created_at: Date };
const fake = vi.hoisted(() => ({ rows: new Map<string, Session>(), logs: new Map<string, Logged[]>(), unexpected: [] as string[], messages: [] as string[] }));
const ACTIVE = ["queued", "running", "cancelling"];

function answer(text: string, values: any[]): { rows: any[]; rowCount?: number } {
  const log = (id: string) => { if (!fake.logs.has(id)) fake.logs.set(id, []); return fake.logs.get(id)!; };
  const append = (id: string, base: number, bodies: Record<string, any>[]) => bodies.map((data, index) => {
    const entry = { seq: base + index + 1, type: data.type, data, created_at: new Date() };
    log(id).push(entry);
    return entry;
  });
  const maxSeq = (id: string) => Math.max(0, ...log(id).map(entry => entry.seq));
  const row = fake.rows.get(values[0]);
  const param = (pattern: RegExp) => { const index = pattern.exec(text)?.[1]; return index === undefined ? undefined : values[Number(index) - 1]; };

  if (text.startsWith("INSERT INTO curialy.chat_sessions")) {
    const [id, , prompt, mode, modelId, effort, webSearch, format, team, runId, workerId] = values;
    fake.rows.set(id, { ...blankSession(id), prompt, status: "queued", mode, model: modelId, effort, web_search: webSearch, conversation_format: format, team, run_id: runId, attempt: 1, worker_id: workerId, lease_expires_at: new Date(Date.now() + 45_000), status_reason: "prompt" });
    return { rows: [], rowCount: 1 };
  }
  if (text.startsWith("SELECT id, prompt, status")) return { rows: row ? [{ ...row }] : [] };
  if (text.startsWith("SELECT id, status, run_id, attempt, worker_id, status_reason")) {
    if (!row) return { rows: [] };
    const lease = row.lease_expires_at?.getTime() ?? null;
    return { rows: [{ ...row, lease_live: lease !== null && lease > Date.now(), lease_expired_for: lease !== null && lease <= Date.now() ? (Date.now() - lease) / 1000 : null, cancel_requested: Boolean(row.cancel_requested_at) }] };
  }
  if (text.includes("SET status = 'queued', run_id = $2")) {
    const fenced = text.includes("IS NOT DISTINCT FROM");
    if (!row || !values[4].includes(row.status) || (fenced && row.run_id !== values[5])) return { rows: [] };
    Object.assign(row, { status: "queued", run_id: values[1], attempt: row.attempt + 1, worker_id: values[2], lease_expires_at: new Date(Date.now() + 45_000), status_reason: values[3], error: null, cancel_requested_at: null, outcome: null });
    return { rows: [{ attempt: row.attempt }] };
  }
  if (text.startsWith("WITH moved AS")) {
    const [, to, from, runId] = values;
    if (!row || !from.includes(row.status) || row.run_id !== runId) return { rows: [{ moved: "0", inserted: null }] };
    row.status = to;
    for (const [column, pattern] of [["status_reason", /status_reason = \$(\d+)/], ["error", /error = \$(\d+)/], ["answer", /answer = \$(\d+)/]] as const) {
      const value = param(pattern);
      if (value !== undefined) row[column] = value;
    }
    const outcome = param(/outcome = \$(\d+)::jsonb/);
    if (outcome !== undefined) row.outcome = outcome === null ? null : JSON.parse(outcome);
    if (to === "cancelling") row.cancel_requested_at ??= new Date();
    if (!ACTIVE.includes(to)) Object.assign(row, { worker_id: null, lease_expires_at: null, finished_at: new Date() });
    const inserted = append(values[0], Math.max(param(/GREATEST\(\$(\d+)::int/), maxSeq(values[0])), JSON.parse(param(/jsonb_array_elements\(\$(\d+)::jsonb\)/)));
    return { rows: [{ moved: "1", inserted: inserted.map(entry => ({ seq: entry.seq, ts: entry.created_at.toISOString(), data: entry.data })) }] };
  }
  if (text.startsWith("SELECT conversation, conversation_format")) return { rows: row ? [{ conversation: row.conversation, conversation_format: row.conversation_format }] : [] };
  if (text.startsWith("UPDATE curialy.chat_sessions SET") && text.includes("last_activity_at = now() WHERE id = $1")) {
    // Honour exactly the fence the statement carries.
    const fence = param(/AND run_id = \$(\d+)/);
    const activeOnly = text.includes("AND status IN ('queued', 'running', 'cancelling')");
    if (!row || (fence !== undefined && (row.run_id !== fence || (activeOnly && !ACTIVE.includes(row.status))))) return { rows: [], rowCount: 0 };
    for (const [, column, index] of Array.from(text.matchAll(/(\w+) = \$(\d+)/g))) {
      if (column === "id" || column === "run_id") continue;
      const value = values[Number(index) - 1];
      row[column] = column === "conversation" || column === "usage" ? JSON.parse(value) : value;
    }
    return { rows: [], rowCount: 1 };
  }
  if (text.startsWith("INSERT INTO curialy.agent_execution_logs (session_id, seq, type, data, created_at)") && !text.includes("WITH")) {
    const fence = text.includes("WHERE EXISTS") ? values[values.length - 1] : undefined;
    const activeOnly = text.includes("AND status IN ('queued', 'running', 'cancelling')");
    const target = fake.rows.get(values[0]);
    if (fence !== undefined && (!target || target.run_id !== fence || (activeOnly && !ACTIVE.includes(target.status)))) return { rows: [], rowCount: 0 };
    let count = 0;
    for (let index = 0; index + 4 < values.length; index += 5) {
      const [id, seq, type, data, ts] = values.slice(index, index + 5);
      if (log(id).some(entry => entry.seq === seq)) continue;
      log(id).push({ seq, type, data: JSON.parse(data), created_at: new Date(ts) });
      count++;
    }
    log(values[0]).sort((a, b) => a.seq - b.seq);
    return { rows: [], rowCount: count };
  }
  if (text.startsWith("SELECT MAX(seq) AS seq")) return { rows: [{ seq: maxSeq(values[0]) || null }] };
  if (text.startsWith("SELECT data->>'trigger' AS trigger")) {
    const start = log(values[0]).filter(entry => entry.type === "run_start").at(-1);
    return { rows: start ? [{ trigger: start.data.trigger ?? null }] : [] };
  }
  if (text.includes("type IN ('repo_push', 'repo_pr', 'deployment')")) {
    const entries = log(values[0]);
    const start = Math.max(0, ...entries.filter(entry => entry.type === "run_start").map(entry => entry.seq));
    return { rows: entries.filter(entry => entry.seq > start && ["repo_push", "repo_pr", "deployment"].includes(entry.type)).map(entry => ({ data: entry.data })) };
  }
  if (text.includes("type = 'browser_session' GROUP BY 1")) return { rows: [] };
  if (text.includes("github_mode = 'linked'")) return { rows: [] };
  if (text.startsWith("INSERT INTO curialy.messages")) { fake.messages.push(`${values[1]}: ${values[2]}`); return { rows: [], rowCount: 1 }; }
  // Every task here is the operator's.
  if (text.startsWith("SELECT user_id FROM curialy.chat_sessions WHERE id = $1")) return { rows: row ? [{ user_id: "admin" }] : [] };
  if (text.startsWith("SELECT role FROM curialy.users WHERE id = $1")) return { rows: [{ role: "admin" }] };
  fake.unexpected.push(text.slice(0, 120));
  return { rows: [], rowCount: 0 };
}

vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: any[] = []) => answer(text, values)),
  heartbeatQuery: vi.fn(async () => ({ rows: [] })),
  // Workspace snapshots go through a pooled client: accept and forget them.
  db: () => ({ connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) }),
  adminUserId: async () => "admin",
}));

const publish = vi.hoisted(() => ({
  createRepo: vi.fn(), pushProjectToRepo: vi.fn(), createPullRequest: vi.fn(), commitAndPush: vi.fn(), storeMedia: vi.fn(),
  deployPreview: vi.fn(async (req: any) => {
    req.onCreated("dep-1", "2026-10-27T14:00:00.000Z");
    req.onProgress("live", "Live", "https://preview.example");
    return { id: "dep-1", url: "https://preview.example", serviceId: "srv-1", repo: "octo/curialy-preview-00000001", expiresAt: "2026-10-27T14:00:00.000Z" };
  }),
}));
vi.mock("./services/github", async importOriginal => ({ ...(await importOriginal<typeof import("./services/github")>()), createRepo: publish.createRepo, pushProjectToRepo: publish.pushProjectToRepo, createPullRequest: publish.createPullRequest, getConnection: async () => null }));
vi.mock("./agent/repos", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/repos")>()), commitAndPush: publish.commitAndPush }));
vi.mock("./agent/deploy", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/deploy")>()), deployPreview: publish.deployPreview }));
vi.mock("./media/snowflake", async importOriginal => ({ ...(await importOriginal<typeof import("./media/snowflake")>()), storeMedia: publish.storeMedia }));

// The model: each turn's blocks come from `script`; a "hang" turn streams until the run is stopped.
const model = vi.hoisted(() => ({ script: (_turn: number): Record<string, any>[] | "hang" => [], turns: 0, hanging: false }));
vi.mock("./agent/providers", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/providers")>()),
  anthropicClient: () => ({
    messages: {
      stream: (params: { model: string }, options: { signal?: AbortSignal } = {}) => {
        const turn = ++model.turns;
        const planned = model.script(turn);
        const content = planned === "hang" ? [] : planned;
        const message = { id: `msg${turn}`, type: "message", role: "assistant", model: params.model, content, stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
        return {
          async *[Symbol.asyncIterator]() {
            if (planned === "hang") {
              model.hanging = true;
              await new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "AbortError" })), { once: true }));
            }
            for (const [index, block] of content.entries()) {
              yield { type: "content_block_start", index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" } };
              if (block.type === "text") yield { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } };
              yield { type: "content_block_stop", index };
            }
          },
          finalMessage: async () => message,
        };
      },
    },
  }),
}));

const runner = await import("./agent/runner");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function blankSession(id: string): Session {
  return {
    id, prompt: "", status: "queued", mode: "agent", model: "claude-sonnet-4-5", effort: "medium", web_search: false, phase: null, answer: null, error: null,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, files_changed: 0, workspace_state: "none", github_repo: null, github_repo_url: null, github_pushed_at: null,
    github_mode: null, github_branch: null, team: false, created_at: new Date(), updated_at: new Date(), status_reason: null, status_changed_at: new Date(), started_at: null,
    finished_at: null, run_id: null, attempt: 0, cancel_requested_at: null, outcome: null, worker_id: null, lease_expires_at: null, conversation: [], conversation_format: "anthropic",
  };
}

let counter = 0;
const OLD_RUN = "10000000-0000-4000-8000-000000000000";
function seedTask(patch: Session = {}) {
  const id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  fs.mkdirSync(path.join(tmp, id), { recursive: true });
  fake.rows.set(id, {
    ...blankSession(id), prompt: "Build a landing page", status: "interrupted", workspace_state: "live", status_reason: "server_restart", finished_at: new Date(), run_id: OLD_RUN, attempt: 1,
    conversation: [{ role: "user", content: "Build a landing page" }, { role: "assistant", content: [{ type: "text", text: "Working on it." }] }],
    ...patch,
  });
  fake.logs.set(id, [
    { seq: 1, type: "run_start", data: { type: "run_start", runId: OLD_RUN, attempt: 1, trigger: "prompt" }, created_at: new Date() },
    { seq: 2, type: "user_message", data: { type: "user_message", text: "Build a landing page" }, created_at: new Date() },
    { seq: 3, type: "status", data: { type: "status", status: "interrupted", reason: "server_restart" }, created_at: new Date() },
    { seq: 4, type: "done", data: { type: "done", status: "interrupted", answer: "", reason: "server_restart" }, created_at: new Date() },
  ]);
  return id;
}

const finished = (id: string) => vi.waitFor(() => {
  expect(ACTIVE).not.toContain(fake.rows.get(id)!.status);
  expect(runner.isBusy(id)).toBe(false);
}, { timeout: 8000, interval: 20 });
/** The events of the latest run, from its run_start. */
function latestRun(id: string) {
  const entries = fake.logs.get(id)!;
  const start = entries.map(entry => entry.type).lastIndexOf("run_start");
  return entries.slice(start);
}
function expectWellFormed(id: string) {
  const entries = fake.logs.get(id)!;
  expect(entries.map(entry => entry.seq)).toEqual(entries.map((_, index) => index + 1)); // no gaps, no reuse
  const run = latestRun(id);
  expect(run.at(-1)!.type).toBe("done");
  expect(run.filter(entry => entry.type === "done")).toHaveLength(1);
  expect(run.at(-1)!.data.status).toBe(fake.rows.get(id)!.status);
}

beforeEach(() => {
  model.turns = 0;
  model.hanging = false;
  fake.unexpected.length = 0;
  fake.messages.length = 0;
  for (const spy of Object.values(publish)) spy.mockClear();
});

describe("retry", () => {
  it("starts a new attempt of the same conversation, announced without a user message", async () => {
    const id = seedTask();
    model.script = () => [{ type: "text", text: "Finished the landing page." }];
    const started = await runner.retryTask(id);
    expect(started).toEqual({ runId: expect.any(String), attempt: 2 });
    await finished(id);

    const row = fake.rows.get(id)!;
    expect(row).toMatchObject({ status: "completed", answer: "Finished the landing page.", run_id: started.runId, attempt: 2, worker_id: null, lease_expires_at: null });
    const run = latestRun(id);
    expect(run[0].data).toEqual({ type: "run_start", runId: started.runId, attempt: 2, trigger: "retry" });
    expect(run.some(entry => entry.type === "user_message")).toBe(false);
    expect(run[1].data).toEqual({ type: "status", status: "queued" });
    expect(run.slice(-2).map(entry => entry.data)).toEqual([
      { type: "status", status: "completed" },
      { type: "done", status: "completed", answer: "Finished the landing page.", outcome: { verification: "none" } },
    ]);
    expectWellFormed(id);
    // The model was told what happened before continuing.
    expect(JSON.stringify(row.conversation)).toContain("[Retry] The previous run was interrupted before it finished");
    expect(fake.messages).toEqual(["assistant: Finished the landing page."]);
    expect(fake.unexpected).toEqual([]);
  });

  it("refuses a second retry of the same run", async () => {
    const id = seedTask();
    model.script = () => "hang";
    const first = await runner.retryTask(id);
    await expect(runner.retryTask(id, { expectedRunId: OLD_RUN })).rejects.toThrow(/still running/);
    await runner.requestCancel(id, first.runId);
    await finished(id);
  });
});

describe("cancelling a run in this process", () => {
  it("stops it, records cancelled with done as the last event, and publishes nothing", async () => {
    const id = seedTask();
    model.script = () => "hang";
    const { runId } = await runner.retryTask(id);
    await vi.waitFor(() => expect(model.hanging).toBe(true));
    expect(runner.isRunning(id)).toBe(true);

    const result = await runner.requestCancel(id, runId);
    expect(result).toEqual({ status: "cancelled", statusReason: "user_cancel", runId, changed: true });
    await finished(id);
    expect(fake.rows.get(id)).toMatchObject({ status: "cancelled", status_reason: "user_cancel", worker_id: null });
    const run = latestRun(id).map(entry => entry.data);
    expect(run).toContainEqual({ type: "status", status: "cancelling", reason: "user_cancel" });
    expect(run.slice(-2)).toEqual([{ type: "status", status: "cancelled", reason: "user_cancel" }, { type: "done", status: "cancelled", answer: "", reason: "user_cancel" }]);
    expectWellFormed(id);
    for (const [name, spy] of Object.entries(publish)) expect(spy, name).not.toHaveBeenCalled();

    // Cancelling again is a no-op that reports the outcome.
    expect(await runner.requestCancel(id, runId)).toEqual({ status: "cancelled", statusReason: "user_cancel", runId, changed: false });
  });
});

describe("the Deploy action", () => {
  beforeEach(() => {
    // Previews are configured (the deploy itself is the mock above), so deploy_preview is offered.
    vi.stubEnv("RENDER_API_KEY", "test-render-key");
    vi.stubEnv("RENDER_OWNER_ID", "owner-1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("grants exactly one preview to its own run, can't be retried, and a later run inherits nothing", async () => {
    const id = seedTask({ status: "completed", status_reason: null });
    const deployCall = (n: number) => ({ type: "tool_use", id: `tu_deploy${n}`, name: "deploy_preview", input: { kind: "static" } });
    model.script = turn => (turn === 1 ? [deployCall(1)] : turn === 2 ? [deployCall(2)] : [{ type: "text", text: "Deployed: https://preview.example" }]);
    const deploy = await runner.startDeployRun(id);
    await finished(id);

    const run = latestRun(id).map(entry => entry.data);
    expect(run[0]).toEqual({ type: "run_start", runId: deploy.runId, attempt: 2, trigger: "deploy" });
    expect(run[1]).toEqual({ type: "user_message", text: "Deploy a live preview" });
    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
    const results = run.filter(event => event.type === "tool_result");
    expect(results.map(event => [event.callId, event.ok, event.summary])).toEqual([["tu_deploy1", true, "Live preview deployed"], ["tu_deploy2", false, "Already deployed in this run"]]);
    expect(run).toContainEqual(expect.objectContaining({ type: "deployment", deploymentId: "dep-1", callId: "tu_deploy1", status: "live" }));
    expect(fake.rows.get(id)!.status).toBe("completed");
    expectWellFormed(id);

    // A failed deploy run is not retried (a retry has no deploy grant): nothing starts.
    fake.rows.get(id)!.status = "failed";
    const before = fake.logs.get(id)!.length;
    await expect(runner.retryTask(id)).rejects.toThrow(/a retry cannot deploy/);
    expect(fake.rows.get(id)).toMatchObject({ status: "failed", run_id: deploy.runId });
    expect(fake.logs.get(id)).toHaveLength(before);
    expect(runner.isBusy(id)).toBe(false);

    // A later run of the same task inherits nothing: deploy_preview is refused.
    model.turns = 0;
    model.script = turn => (turn === 1 ? [deployCall(3)] : [{ type: "text", text: "Not deployed." }]);
    await runner.followUp(id, "Deploy it again", []);
    await finished(id);
    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
    expect(latestRun(id).map(entry => entry.data).filter(event => event.type === "tool_result")).toEqual([expect.objectContaining({ callId: "tu_deploy3", ok: false, summary: "Deploy not requested" })]);
    expect(fake.unexpected).toEqual([]);
  });

  it("only deploys agent tasks", async () => {
    const id = seedTask({ status: "completed", mode: "chat" });
    await expect(runner.startDeployRun(id)).rejects.toThrow(/Only agent tasks/);
    expect(fake.rows.get(id)!.run_id).toBe(OLD_RUN);
  });
});

describe("a follow-up from a stale tab", () => {
  it("does not start when the task moved on to another run", async () => {
    const id = seedTask({ status: "completed", status_reason: null });
    await expect(runner.followUp(id, "Also add a footer", [], { expectedRunId: "10000000-0000-4000-8000-0000000000ff" })).rejects.toThrow(/changed since you loaded it/);
    expect(fake.rows.get(id)).toMatchObject({ status: "completed", run_id: OLD_RUN, worker_id: null });
    expect(fake.logs.get(id)).toHaveLength(4);
    expect(runner.isBusy(id)).toBe(false);
  });
});

describe("a new task", () => {
  it("is announced (run_start, the user's message, queued) before startTask returns", async () => {
    model.script = () => [{ type: "text", text: "Here is your haiku." }];
    const id = await runner.startTask({ prompt: "Write a haiku about tests", model: "claude-sonnet-4-5", mode: "agent", effort: "medium", webSearch: false, attachmentIds: [], team: false }, [], { clientMessageId: "client-1" });
    const { liveChannel } = await import("./agent/bus");
    const announced = liveChannel(id)!.history.slice(0, 3);
    expect(announced.map(event => event.seq)).toEqual([1, 2, 3]);
    expect(announced[0]).toMatchObject({ type: "run_start", attempt: 1, trigger: "prompt", runId: fake.rows.get(id)!.run_id });
    expect(announced[1]).toMatchObject({ type: "user_message", text: "Write a haiku about tests", clientMessageId: "client-1" });
    expect(announced[2]).toMatchObject({ type: "status", status: "queued" });
    await finished(id);
    expect(fake.rows.get(id)).toMatchObject({ status: "completed", answer: "Here is your haiku.", attempt: 1 });
    expectWellFormed(id);
    expect(fake.messages).toEqual(["user: Write a haiku about tests", "assistant: Here is your haiku."]);
    expect(fake.unexpected).toEqual([]);
  });
});

describe("a run another instance took over", () => {
  it("stops on its next heartbeat and writes nothing after the done event recovery wrote", async () => {
    const id = seedTask();
    model.script = () => "hang";
    const { runId } = await runner.retryTask(id);
    await vi.waitFor(() => expect(model.hanging).toBe(true));
    // Another instance judged this worker gone and interrupted the run; recovery keeps the run id.
    Object.assign(fake.rows.get(id)!, { status: "interrupted", status_reason: "lease_expired", worker_id: null, lease_expires_at: null });
    const entries = fake.logs.get(id)!;
    const base = Math.max(...entries.map(entry => entry.seq));
    entries.push(
      { seq: base + 1, type: "status", data: { type: "status", status: "interrupted", reason: "lease_expired" }, created_at: new Date() },
      { seq: base + 2, type: "done", data: { type: "done", status: "interrupted", answer: "", reason: "lease_expired" }, created_at: new Date() },
    );
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await runner.startLifecycle();
      await vi.advanceTimersByTimeAsync(15_000); // heartbeat: the database no longer says this worker owns the run
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => expect(runner.isBusy(id)).toBe(false), { timeout: 8000, interval: 20 });
    expect(fake.rows.get(id)).toMatchObject({ status: "interrupted", status_reason: "lease_expired", run_id: runId, worker_id: null });
    expect(fake.logs.get(id)!.at(-1)!.data).toEqual({ type: "done", status: "interrupted", answer: "", reason: "lease_expired" });
    expect(fake.logs.get(id)!.filter(entry => entry.type === "done").at(-1)!.seq).toBe(base + 2);
  });
});

// Last: a shutdown leaves the runner draining for the rest of this file.
describe("shutdown", () => {
  it("records a running run as interrupted by the restart, not failed, and refuses new runs", async () => {
    const id = seedTask();
    model.script = () => "hang";
    await runner.retryTask(id);
    await vi.waitFor(() => expect(model.hanging).toBe(true));
    expect(await runner.shutdownRuns(5000)).toBe(1);
    await finished(id);
    expect(fake.rows.get(id)).toMatchObject({ status: "interrupted", status_reason: "server_restart", error: null, worker_id: null });
    expect(latestRun(id).slice(-2).map(entry => entry.data)).toEqual([
      { type: "status", status: "interrupted", reason: "server_restart" },
      { type: "done", status: "interrupted", answer: "", reason: "server_restart" },
    ]);
    expectWellFormed(id);
    await expect(runner.retryTask(seedTask())).rejects.toThrow(runner.RESTARTING);
    for (const [name, spy] of Object.entries(publish)) expect(spy, name).not.toHaveBeenCalled();
  });
});
