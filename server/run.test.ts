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
    // Since the latest run that took a request (retries continue it).
    if (!text.includes("<> 'retry'")) fake.unexpected.push("side effects since the latest run, not the latest request");
    const entries = log(values[0]);
    const start = Math.max(0, ...entries.filter(entry => entry.type === "run_start" && entry.data.trigger !== "retry").map(entry => entry.seq));
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
// "refuse" answers the turn the way a route that lost access does (403 "Not authorized for this endpoint").
const model = vi.hoisted(() => ({ script: (_turn: number): Record<string, any>[] | "hang" | "refuse" => [], turns: 0, hanging: false, systems: [] as { text: string }[][], models: [] as string[] }));
vi.mock("./agent/providers", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/providers")>()),
  anthropicClient: () => ({
    messages: {
      stream: (params: { model: string; system?: { text: string }[] }, options: { signal?: AbortSignal } = {}) => {
        const turn = ++model.turns;
        model.systems.push(JSON.parse(JSON.stringify(params.system ?? [])));
        model.models.push(params.model);
        const planned = model.script(turn);
        const content = planned === "hang" || planned === "refuse" ? [] : planned;
        const message = { id: `msg${turn}`, type: "message", role: "assistant", model: params.model, content, stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
        return {
          async *[Symbol.asyncIterator]() {
            if (planned === "refuse") throw Object.assign(new Error("403 Not authorized for this endpoint."), { status: 403 });
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
  model.systems.length = 0;
  model.models.length = 0;
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

    // A later run inherits nothing from the Deploy action: without a request for a deploy in the
    // message, deploy_preview is refused, and a refusal ("don't deploy") is not a request.
    const toolResults = () => latestRun(id).map(entry => entry.data).filter(event => event.type === "tool_result");
    for (const [n, message] of [[3, "Make the header blue"], [4, "Don't deploy yet, just fix the footer"]] as const) {
      model.turns = 0;
      model.script = turn => (turn === 1 ? [deployCall(n)] : [{ type: "text", text: "Not deployed." }]);
      await runner.followUp(id, message, []);
      await finished(id);
      expect(toolResults()).toEqual([expect.objectContaining({ callId: `tu_deploy${n}`, ok: false, summary: "Deploy not requested" })]);
    }
    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
    // On the operator's own task, asking for one in the message is the go-ahead.
    model.turns = 0;
    model.script = turn => (turn === 1 ? [deployCall(5)] : [{ type: "text", text: "Deployed again." }]);
    await runner.followUp(id, "Deploy it again", []);
    await finished(id);
    expect(toolResults()).toEqual([expect.objectContaining({ callId: "tu_deploy5", ok: true, summary: "Live preview deployed" })]);
    expect(publish.deployPreview).toHaveBeenCalledTimes(2);
    expect(fake.unexpected).toEqual([]);
  });

  it("reads a deploy request in the operator's message, refusals included", () => {
    const asks = [
      "Build a landing page and deploy it", "Give me a live preview of the app", "Please put it on Render when it's done", "Can you host it so I can share a public link?",
      // A negation elsewhere in the sentence is not a refusal of the deploy.
      "Remove the console logs and deploy it", "Don't change the design, just deploy it", "Don't forget to deploy it", "Without changing anything else, deploy a live preview",
      "Build a portfolio without a database and deploy it", "Make sure there are no console errors and deploy it", "Drop the carousel and give me a live preview",
      "Redeploy it", "Re-deploy the site", "Change the hero color to blue and redeploy",
      "Fix the footer and get it deployed", "Finish deploying it", "Proceed with deployment", "Use deploy_preview to put it up", "Could you deploy it?",
      // One plain ask is enough, whatever else is refused.
      "I can't deploy it myself, please deploy it for me", "Deploy it, but don't deploy the admin panel",
    ];
    const refuses = [
      "Write a deployment guide", "Build a landing page", "Make the header blue",
      "Don't deploy yet, just fix the footer", "Don\u2019t deploy yet, just push it to GitHub", "We shouldn't deploy this until QA signs off", "Please wait, I won't need a live preview",
      "Hold the deploy for now, just fix the footer", "We can't deploy until QA signs off; push the branch", "No need for a live preview",
      // "deploy" naming a thing, a report about one, or "render" the verb.
      "Fix the deploy script's exit code", "Add a deploy.sh script that builds the project and commit it", "The deploy is failing because of a missing env var; fix the build config and push",
      "Update the README with how to deploy and push", "Add pre-deploy checks to CI", "Fix the chart that fails to render on Safari and open a PR", "Fix the useEffect that runs on render and open a PR",
      "Fix the bug on the live site and push the fix",
      // A feature of the app, not now, a take-down, or a question.
      "Build a markdown editor with a live preview pane", "Add a live preview to the resume builder", "Add a Go Live button to the stream page", "Add a 'copy public link' button to each document",
      "I'll deploy it myself later", "Do everything except deploy", "Build it now and deploy it later", "Take down the live preview", "Cancel the deploy",
      "Is it ready to deploy?", "What's the live URL?", "Deploy it? No, don't deploy yet", "The deploy isn't working, check the logs", "The app crashes on Render, here are the logs",
    ];
    for (const text of asks) expect(runner.asksToDeploy(text), text).toBe(true);
    for (const text of refuses) expect(runner.asksToDeploy(text), text).toBe(false);
    // Attached file names are the harness's note, not the user's words.
    const request = runner.latestRequest([{ role: "user", content: [{ type: "text", text: "Why does this script fail? Fix it.\n\nAttached files (saved in the workspace):\n- attachments/deploy-ab12cd.sh (text/x-sh, 120 bytes)" }] }]);
    expect(request.text).toBe("Why does this script fail? Fix it.");
    expect(runner.asksToDeploy(request.text)).toBe(false);
  });

  it("lets a retry of a requested deploy deploy, unless the stopped run already put a preview live", async () => {
    const conversation = [{ role: "user", content: "Build a landing page and deploy it" }, { role: "assistant", content: [{ type: "text", text: "Working on it." }] }];
    const deployCall = (n: number) => ({ type: "tool_use", id: `tu_retry${n}`, name: "deploy_preview", input: { kind: "static" } });
    const toolResults = (id: string) => latestRun(id).map(entry => entry.data).filter(event => event.type === "tool_result");
    // Stopped before it deployed: the retry re-reads the request.
    const fresh = seedTask({ prompt: "Build a landing page and deploy it", conversation });
    model.script = turn => (turn === 1 ? [deployCall(1)] : [{ type: "text", text: "Deployed." }]);
    await runner.retryTask(fresh);
    await finished(fresh);
    expect(toolResults(fresh)).toEqual([expect.objectContaining({ callId: "tu_retry1", ok: true, summary: "Live preview deployed" })]);
    // Its preview went live, then it stopped, and so did a first retry: a second retry does not put up another one.
    const deployed = seedTask({ prompt: "Build a landing page and deploy it", conversation });
    const logs = fake.logs.get(deployed)!;
    logs.splice(2, 0, { seq: 0, type: "deployment", data: { type: "deployment", deploymentId: "dep-0", callId: "tu_old", status: "live", url: "https://preview.example" }, created_at: new Date() });
    logs.push(
      { seq: 0, type: "run_start", data: { type: "run_start", runId: "10000000-0000-4000-8000-0000000000ab", attempt: 2, trigger: "retry" }, created_at: new Date() },
      { seq: 0, type: "status", data: { type: "status", status: "interrupted", reason: "server_restart" }, created_at: new Date() },
      { seq: 0, type: "done", data: { type: "done", status: "interrupted", answer: "", reason: "server_restart" }, created_at: new Date() },
    );
    logs.forEach((entry, index) => { entry.seq = index + 1; });
    model.turns = 0;
    model.script = turn => (turn === 1 ? [deployCall(2)] : [{ type: "text", text: "Already live." }]);
    await runner.retryTask(deployed);
    await finished(deployed);
    expect(toolResults(deployed)).toEqual([expect.objectContaining({ callId: "tu_retry2", ok: false, summary: "Deploy not requested" })]);
    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
    expect(fake.unexpected).toEqual([]);
  });

  it("only deploys agent tasks", async () => {
    const id = seedTask({ status: "completed", mode: "chat" });
    await expect(runner.startDeployRun(id)).rejects.toThrow(/Only agent tasks/);
    expect(fake.rows.get(id)!.run_id).toBe(OLD_RUN);
  });
});

describe("a route that refuses every request", () => {
  beforeEach(() => vi.stubEnv("RELAY_API_KEY", "test-relay-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("moves the run to another route for this run only: the task keeps its own model", async () => {
    const id = seedTask({ status: "completed", status_reason: null, model: "claude-opus-5-5" });
    model.script = turn => (turn === 1 ? "refuse" : [{ type: "text", text: "Done on the backup route." }]);
    await runner.followUp(id, "Make the header blue", []);
    await finished(id);
    expect(model.models).toHaveLength(2);
    expect(model.models[1]).toBe("r/claude-opus-5-5"); // the same model on the backup route
    expect(latestRun(id).map(entry => entry.data)).toContainEqual(expect.objectContaining({ type: "dispatch", model: "r/claude-opus-5-5" }));
    // The next follow-up starts on the task's own model again, once the route is back.
    expect(fake.rows.get(id)).toMatchObject({ status: "completed", answer: "Done on the backup route.", model: "claude-opus-5-5" });
    expect(fake.unexpected).toEqual([]);
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
describe("design brief and design check", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends interface work a design brief as its own system block, the same on every turn, and nothing for other work", async () => {
    const id = seedTask();
    model.script = turn => (turn === 1 ? [{ type: "tool_use", id: "tu_ls", name: "list_files", input: {} }] : [{ type: "text", text: "Done." }]);
    await runner.retryTask(id);
    await finished(id);
    expect(model.systems.length).toBeGreaterThanOrEqual(2);
    // The static prompt stays first and unchanged (it is what caches); the brief follows it.
    expect(model.systems[0][0].text).toBe(runner.AGENT_SYSTEM);
    const brief = model.systems[0].at(-1)!.text;
    expect(brief).toContain("Design brief for this task");
    expect(brief).toContain("### Recipe: product landing page");
    expect(model.systems[1]).toEqual(model.systems[0]);
    expect(latestRun(id).some(entry => entry.type === "notice" && /^Design brief: landing, brand register, \d+ guidelines\.$/.test(entry.data.message))).toBe(true);

    const other = seedTask({ prompt: "Write a cron job that rotates the logs", conversation: [{ role: "user", content: "Write a cron job that rotates the logs" }] });
    model.systems.length = 0;
    model.script = () => [{ type: "text", text: "Done." }];
    await runner.retryTask(other);
    await finished(other);
    expect(model.systems[0]).toHaveLength(1);
    expect(fake.unexpected).toEqual([]);
  });

  it("sends interface work that was never looked at back once for a visual check, without failing the run", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", "bb-test");
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "bb-project");
    const id = seedTask();
    model.script = turn => (turn === 1 ? [{ type: "tool_use", id: "tu_write", name: "write_file", input: { path: "index.html", content: "<!doctype html><title>Lumen</title><h1>Lumen</h1>" } }] : [{ type: "text", text: `Done (${turn}).` }]);
    await runner.retryTask(id);
    await finished(id);
    const row = fake.rows.get(id)!;
    expect(row).toMatchObject({ status: "completed", answer: "Done (3)." });
    const checks = (row.conversation as { role: string; content: unknown }[]).filter(message => message.role === "user" && typeof message.content === "string" && message.content.startsWith("[Design check]"));
    expect(checks).toHaveLength(1);
    expect(checks[0].content).toContain("You changed the interface (index.html) but never looked at it");
    expect(latestRun(id).some(entry => entry.type === "notice" && entry.data.message === "Design check: the interface was not checked visually; asking for another look.")).toBe(true);
    // The only extra statement is the run handing over its new file; the design check itself sends no SQL.
    expect(fake.unexpected.filter(statement => !statement.startsWith("INSERT INTO curialy.workspace_files"))).toEqual([]);
  });

  it("raises each reason once, at most two per run, and never for read-only roles, tests, generated output or identical rebuilds", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", "bb-test");
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "bb-project");
    const { uiFingerprint } = await import("./agent/design");
    const root = fs.mkdtempSync(path.join(tmp, "design-"));
    const state = () => ({ printCache: new Map(), startPrint: uiFingerprint(root), checkedPrint: null as Map<string, string> | null, lastAudit: null as any, raised: new Set<"unchecked" | "stale" | "fix">() });
    const ctx: any = { root, design: { intent: {}, facts: {}, entries: [] }, designState: state() };
    // Notes, build output, tests, stories and dot-directories are not the interface.
    fs.writeFileSync(path.join(root, "README.md"), "notes");
    for (const dir of ["dist", "src", ".svelte-kit"]) fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, "dist/index.html"), "<h1>built</h1>");
    fs.writeFileSync(path.join(root, "src/App.test.tsx"), "test('x', () => {});");
    fs.writeFileSync(path.join(root, "src/Button.stories.tsx"), "export default {};");
    fs.writeFileSync(path.join(root, ".svelte-kit/out.css"), "body{}");
    expect(runner.designCheck(ctx)).toBeNull();
    fs.writeFileSync(path.join(root, "styles.css"), "body{}");
    expect(runner.designCheck({ ...ctx, readOnly: true })).toBeNull();
    expect(runner.designCheck({ ...ctx, design: null })).toBeNull();
    expect(runner.designCheck({ ...ctx, allowedTools: new Set(["write_file"]) })).toBeNull();
    expect(runner.designCheck(ctx)?.reason).toBe("the interface was not checked visually");
    expect(runner.designCheck(ctx)).toBeNull();
    ctx.designState.checkedPrint = uiFingerprint(root);
    ctx.designState.lastAudit = { findings: [{ id: "contrast", level: "fix", viewport: "desktop", message: "Text contrast too low on 2 elements." }, { id: "measure", level: "improve", viewport: "desktop", message: "Long lines." }], stats: [] };
    const fix = runner.designCheck(ctx)!;
    expect(fix.reason).toBe("1 design finding still to fix");
    expect(fix.message).toContain("- Text contrast too low on 2 elements.");
    expect(fix.message).not.toContain("Long lines.");
    expect(runner.designCheck(ctx)).toBeNull();

    // After a check: rewriting a file with the same bytes (a rebuild) is no change; new content is.
    const fresh: any = { ...ctx, designState: state() };
    fs.writeFileSync(path.join(root, "app.jsx"), "export default 1;");
    fresh.designState.checkedPrint = uiFingerprint(root);
    fs.writeFileSync(path.join(root, "app.jsx"), "export default 1;");
    expect(runner.designCheck(fresh)).toBeNull();
    fs.writeFileSync(path.join(root, "app.jsx"), "export default 2;");
    expect(runner.designCheck(fresh)?.reason).toBe("the interface changed after its last visual check");
    // Two reasons raised ("unchecked" earlier on another state is not this one's): unchecked + stale, then the cap.
    const capped: any = { ...ctx, designState: state() };
    fs.writeFileSync(path.join(root, "nav.css"), "nav{}");
    expect(runner.designCheck(capped)?.reason).toBe("the interface was not checked visually");
    capped.designState.checkedPrint = uiFingerprint(root);
    fs.writeFileSync(path.join(root, "nav.css"), "nav{color:red}");
    expect(runner.designCheck(capped)?.reason).toBe("the interface changed after its last visual check");
    capped.designState.checkedPrint = uiFingerprint(root);
    capped.designState.lastAudit = { findings: [{ id: "contrast", level: "fix", viewport: "desktop", message: "Text contrast too low." }], stats: [], measured: { desktop: true, phone: true }, problems: [] };
    expect(runner.designCheck(capped)).toBeNull(); // "fix" was never raised: only the cap stops it
    expect(capped.designState.raised.has("fix")).toBe(false);
    vi.unstubAllEnvs();
    expect(runner.designCheck({ ...ctx, designState: state() })).toBeNull();
  });

  it("asks a free account to cover a follow-up of about six turns before a design check", async () => {
    const asked: number[] = [];
    const canSpend = async (credits: number) => { asked.push(credits); return credits < 3; };
    expect(await runner.designCheckAffordable({ canSpend, turnCredits: () => 0.4 })).toBe(true);
    expect(await runner.designCheckAffordable({ canSpend, turnCredits: () => 0.05 })).toBe(true);
    expect(await runner.designCheckAffordable({ canSpend, turnCredits: () => 1 })).toBe(false);
    expect(asked.map(value => Math.round(value * 100) / 100)).toEqual([2.4, 1, 6]);
  });

  it("delivers the accepted answer when a design check's follow-up runs out of turns, instead of failing the run", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", "bb-test");
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "bb-project");
    const id = seedTask();
    // Writes the page, browses for a while, answers at turn 50 (the last turn a check may be raised), then keeps using tools.
    model.script = turn => (turn === 1 ? [{ type: "tool_use", id: "tu_write", name: "write_file", input: { path: "index.html", content: "<!doctype html><title>Lumen</title>" } }]
      : turn === 50 ? [{ type: "text", text: "Accepted answer at turn 50." }]
        : [{ type: "tool_use", id: `tu_ls${turn}`, name: "list_files", input: {} }]);
    await runner.retryTask(id);
    await finished(id);
    const row = fake.rows.get(id)!;
    expect(row).toMatchObject({ status: "completed", answer: "Accepted answer at turn 50." });
    expect(model.turns).toBe(60);
    expect(latestRun(id).some(entry => entry.type === "notice" && /didn't finish within the turn limit/.test(entry.data.message))).toBe(true);
  }, 30_000);

  it("reads the user's own latest request: past retry notes, without the clone note", () => {
    const { latestRequest } = runner;
    expect(latestRequest([
      { role: "user", content: "Build a landing page\n\n[The repository acme/portfolio has already been cloned into the workspace: acme/portfolio@main · 12 files.]" },
    ])).toEqual({ text: "Build a landing page", image: false });
    expect(latestRequest([
      { role: "user", content: "Create an API endpoint that stores orders" },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
      { role: "user", content: [{ type: "image", source: { type: "curialy_vault", media_id: "m1", media_type: "image/png" } }, { type: "text", text: "Now build a dashboard like this" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_files", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "text", text: "[Retry] The previous run was cancelled. Continue the user's request from where it stopped." }] },
    ])).toEqual({ text: "Now build a dashboard like this", image: true });
  });
});

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
