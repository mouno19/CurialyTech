import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Cancelling never publishes: whatever state the run is in, no repository is created, nothing is
// pushed, no pull request is opened, nothing is deployed and nothing is uploaded.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-cancel-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

type Call = { text: string; values: unknown[] };
const db = vi.hoisted(() => ({ calls: [] as Call[], handler: (_call: Call): unknown => ({ rows: [], rowCount: 0 }) }));
const publish = vi.hoisted(() => ({
  createRepo: vi.fn(async () => { throw new Error("createRepo must not be called"); }),
  pushProjectToRepo: vi.fn(async () => { throw new Error("pushProjectToRepo must not be called"); }),
  createPullRequest: vi.fn(async () => { throw new Error("createPullRequest must not be called"); }),
  commitAndPush: vi.fn(async () => { throw new Error("commitAndPush must not be called"); }),
  deployPreview: vi.fn(async (_req: any): Promise<any> => { throw new Error("deployPreview must not be called"); }),
  storeMedia: vi.fn(async () => { throw new Error("storeMedia must not be called"); }),
}));

vi.mock("./db/pg", () => {
  const run = async (text: string, values: unknown[] = []) => {
    const call = { text, values };
    db.calls.push(call);
    return db.handler(call);
  };
  return { query: vi.fn(run), heartbeatQuery: vi.fn(run), db: () => { throw new Error("no pool in tests"); }, adminUserId: async () => "admin" };
});
vi.mock("./services/github", async importOriginal => ({
  ...(await importOriginal<typeof import("./services/github")>()),
  createRepo: publish.createRepo, pushProjectToRepo: publish.pushProjectToRepo, createPullRequest: publish.createPullRequest,
  getConnection: async () => ({ login: "octo", name: null, email: null, avatarUrl: null, scopes: "repo", connectedAt: "", token: "test-token" }),
}));
vi.mock("./agent/repos", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/repos")>()), commitAndPush: publish.commitAndPush, linkedRepo: async () => null }));
vi.mock("./agent/deploy", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/deploy")>()), deployPreview: publish.deployPreview }));
vi.mock("./media/snowflake", async importOriginal => ({ ...(await importOriginal<typeof import("./media/snowflake")>()), storeMedia: publish.storeMedia }));

// A scripted model for the agent loop: each turn's content comes from `script`; `duringStream`
// runs while the turn is streaming (e.g. the user presses Cancel).
const model = vi.hoisted(() => ({ script: (_turn: number): Record<string, unknown>[] => [], duringStream: (_turn: number) => undefined as void, turns: 0, requests: [] as unknown[] }));
vi.mock("./agent/providers", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/providers")>()),
  anthropicClient: () => ({
    messages: {
      stream: (params: { model: string; messages?: unknown[] }) => {
        const turn = ++model.turns;
        model.requests.push(JSON.parse(JSON.stringify(params.messages ?? [])));
        const content = model.script(turn);
        const message = { id: `msg${turn}`, type: "message", role: "assistant", model: params.model, content, stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
        return {
          async *[Symbol.asyncIterator]() {
            for (const [index, block] of content.entries()) {
              yield { type: "content_block_start", index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" } };
              if (block.type === "text") yield { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } };
              yield { type: "content_block_stop", index };
            }
            model.duringStream(turn);
          },
          finalMessage: async () => message,
        };
      },
    },
  }),
}));

const { requestCancel, TaskRejected, runAgentLoop } = await import("./agent/runner");
const { executeTool } = await import("./agent/tools");
const { WORKER_ID } = await import("./agent/lifecycle");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TASK = "00000000-0000-4000-8000-0000000000c1";
const RUN = "10000000-0000-4000-8000-000000000001";
const NEWER = "10000000-0000-4000-8000-000000000002";

type Row = { status: string; run_id: string | null; worker_id: string | null; lease_live: boolean; lease_expired_for: number | null; cancel_requested: boolean; status_reason: string | null };
const row = (patch: Partial<Row>): Row => ({ status: "running", run_id: RUN, worker_id: null, lease_live: false, lease_expired_for: null, cancel_requested: false, status_reason: null, ...patch });

function eventsOf(call: Call) {
  const index = /jsonb_array_elements\(\$(\d+)::jsonb\)/.exec(call.text)?.[1];
  return index ? JSON.parse(call.values[Number(index) - 1] as string) : null;
}

/**
 * The task row as the database holds it; transitions apply when their WHERE clause matches it.
 * `racedTo`: another writer changes the row just before our first transition lands.
 */
function scriptRow(initial: Row, opts: { sessions?: { sid: string; last: string }[]; racedTo?: Partial<Row> } = {}) {
  let current = { ...initial };
  db.handler = call => {
    if (call.text.includes("lease_live") && call.text.includes("WHERE id = $1")) return { rows: [{ id: TASK, attempt: 1, ...current }] };
    if (call.text.includes("type = 'browser_session' GROUP BY 1")) return { rows: opts.sessions ?? [] };
    if (call.text.includes("WITH moved AS")) {
      const [, to, from, runId] = call.values as [string, string, string[], string | null];
      if (opts.racedTo) current = { ...current, ...opts.racedTo };
      const applies = from.includes(current.status) && runId === current.run_id;
      if (!applies) return { rows: [{ moved: "0", inserted: null }] };
      current = { ...current, status: to };
      const inserted = eventsOf(call).map((data: unknown, index: number) => ({ seq: 50 + index, ts: new Date().toISOString(), data }));
      return { rows: [{ moved: "1", inserted }] };
    }
    throw new Error(`unexpected statement: ${call.text.slice(0, 80)}`);
  };
}

const writes = () => db.calls.filter(call => !/^\s*SELECT/i.test(call.text));
function expectNothingPublished() {
  for (const [name, spy] of Object.entries(publish)) expect(spy, name).not.toHaveBeenCalled();
}

beforeEach(() => {
  db.calls.length = 0;
  for (const spy of Object.values(publish)) spy.mockClear();
});

describe("requestCancel", () => {
  it("reports a finished task as it is and writes nothing", async () => {
    scriptRow(row({ status: "completed" }));
    expect(await requestCancel(TASK, RUN)).toEqual({ status: "completed", runId: RUN, changed: false });
    // A stale tab cancelling a finished task is not an error either.
    expect(await requestCancel(TASK, NEWER)).toEqual({ status: "completed", runId: RUN, changed: false });
    scriptRow(row({ status: "cancelled", status_reason: "cancel_timeout" }));
    expect(await requestCancel(TASK, RUN)).toEqual({ status: "cancelled", statusReason: "cancel_timeout", runId: RUN, changed: false });
    expect(writes()).toEqual([]);
    expectNothingPublished();
  });

  it("cancels an orphaned run at once, with its terminal events", async () => {
    scriptRow(row({ worker_id: null }), { sessions: [{ sid: "s1", last: "live" }] });
    expect(await requestCancel(TASK)).toEqual({ status: "cancelled", statusReason: "user_cancel", runId: RUN, changed: true });
    const [transition] = writes();
    expect(transition.values.slice(1, 4)).toEqual(["cancelled", ["running"], RUN]);
    expect(eventsOf(transition)).toEqual([
      { type: "browser_session", sessionId: "s1", status: "ended", liveUrl: null, replayUrl: "", reason: "interrupted" },
      { type: "status", status: "cancelled", reason: "user_cancel" },
      { type: "done", status: "cancelled", answer: "", reason: "user_cancel" },
    ]);
    expectNothingPublished();
  });

  it("reports the row's real status and reason when another writer settled the orphan first", async () => {
    scriptRow(row({ worker_id: "other-box:7:abcd", lease_live: false, lease_expired_for: 120 }), { racedTo: { status: "interrupted", status_reason: "lease_expired", worker_id: null } });
    expect(await requestCancel(TASK, RUN)).toEqual({ status: "interrupted", statusReason: "lease_expired", runId: RUN, changed: false });
    expectNothingPublished();
  });

  it("does not report a run that completed before the cancel landed as cancelling", async () => {
    scriptRow(row({ worker_id: "other-box:7:abcd", lease_live: true }), { racedTo: { status: "completed", worker_id: null, lease_live: false } });
    expect(await requestCancel(TASK, RUN)).toEqual({ status: "completed", runId: RUN, changed: false });
    expectNothingPublished();
  });

  it("only flags a run another live worker owns (that worker stops it), without terminal events", async () => {
    for (const owner of ["other-box:7:abcd", `${os.hostname()}:${process.ppid}:abcd`]) {
      db.calls.length = 0;
      scriptRow(row({ worker_id: owner, lease_live: true }));
      expect(await requestCancel(TASK, RUN)).toEqual({ status: "cancelling", statusReason: "user_cancel", runId: RUN, changed: true });
      const [transition, ...rest] = writes();
      expect(rest).toEqual([]);
      expect(transition.values.slice(1, 4)).toEqual(["cancelling", ["queued", "running"], RUN]);
      expect(transition.text).toContain("cancel_requested_at = COALESCE(cancel_requested_at, now())");
      expect(eventsOf(transition)).toEqual([]);
      expect(db.calls.some(call => call.text.includes("browser_session"))).toBe(false);
    }
    // Asking again while that worker is stopping it changes nothing.
    db.calls.length = 0;
    scriptRow(row({ status: "cancelling", worker_id: "other-box:7:abcd", lease_live: true }));
    expect(await requestCancel(TASK, RUN)).toEqual({ status: "cancelling", statusReason: "user_cancel", runId: RUN, changed: false });
    expect(writes()).toEqual([]);
    expectNothingPublished();
  });

  it("refuses a stale run id while a newer run is active", async () => {
    scriptRow(row({ run_id: NEWER, worker_id: "other-box:7:abcd", lease_live: true }));
    const attempt = requestCancel(TASK, RUN);
    await expect(attempt).rejects.toBeInstanceOf(TaskRejected);
    await expect(attempt).rejects.toThrow(/newer run/);
    expect(writes()).toEqual([]);
    expectNothingPublished();
  });

  it("rejects an unknown task", async () => {
    db.handler = () => ({ rows: [] });
    await expect(requestCancel(TASK)).rejects.toThrow(/not found/i);
    expect(writes()).toEqual([]);
  });

  it("treats a row this worker holds but no longer runs as lost, not as live", async () => {
    scriptRow(row({ worker_id: WORKER_ID, lease_live: true }));
    expect(await requestCancel(TASK, RUN)).toMatchObject({ status: "cancelled", changed: true });
    expectNothingPublished();
  });
});

function toolContext(grants?: { deploy?: boolean }) {
  const events: any[] = [];
  const root = path.join(tmp, "tools");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<h1>hi</h1>");
  return { events, ctx: { root, sessionId: TASK, vision: false, callId: "call-deploy", signal: new AbortController().signal, emit: (event: unknown) => events.push(event), onPlan: vi.fn(), onFileChange: vi.fn(), onCommand: vi.fn(), grants } };
}

describe("deploy_preview grant", () => {
  it("refuses without the grant and makes no call", async () => {
    for (const grants of [undefined, {}, { deploy: false }]) {
      const { ctx } = toolContext(grants);
      const outcome = await executeTool("deploy_preview", { kind: "static" }, ctx);
      expect(outcome).toMatchObject({ ok: false, summary: "Deploy not requested" });
    }
    expect(publish.deployPreview).not.toHaveBeenCalled();
  });

  it("consumes the grant: one preview per run", async () => {
    publish.deployPreview.mockImplementationOnce(async req => {
      req.onCreated("dep-row-1", "2026-10-27T14:00:00.000Z");
      req.onProgress("creating", "Creating temporary private repo octo/curialy-preview-12345678…");
      req.onProgress("live", "Live", "https://preview.example");
      return { id: "dep-row-1", url: "https://preview.example", serviceId: "srv-1", repo: "octo/curialy-preview-12345678", expiresAt: "2026-10-27T14:00:00.000Z" };
    });
    const grants = { deploy: true };
    const { ctx, events } = toolContext(grants);
    const first = await executeTool("deploy_preview", { kind: "static", publish_path: "." }, ctx);
    expect(first.ok).toBe(true);
    expect(grants.deploy).toBe(false);
    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
    expect(publish.deployPreview.mock.calls[0][0]).toMatchObject({ sessionId: TASK, callId: "call-deploy", kind: "static", publishPath: ".", signal: ctx.signal });
    // Every deployment event carries the database row id.
    const deployments = events.filter(event => event.type === "deployment");
    expect(deployments.map(event => [event.deploymentId, event.callId, event.status])).toEqual([["dep-row-1", "call-deploy", "creating"], ["dep-row-1", "call-deploy", "live"]]);

    const second = await executeTool("deploy_preview", { kind: "static" }, ctx);
    expect(second).toMatchObject({ ok: false, summary: "Already deployed in this run" });
    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
  });

  it("allows one more attempt after a failed deploy (it was cleaned up), and no third", async () => {
    publish.deployPreview.mockClear();
    publish.deployPreview.mockRejectedValueOnce(new Error("GitHub POST /repos/octo/curialy-preview-1/git/blobs failed (403): You have exceeded a secondary rate limit."));
    publish.deployPreview.mockRejectedValueOnce(new Error("Build failed: npm ERR! missing script: build"));
    const grants = { deploy: true };
    const { ctx } = toolContext(grants);
    const first = await executeTool("deploy_preview", { kind: "static" }, ctx);
    expect(first.ok).toBe(false);
    expect(first.content).toContain("You may call deploy_preview once more in this run");
    expect(grants.deploy).toBe(true);
    const second = await executeTool("deploy_preview", { kind: "static" }, ctx);
    expect(second.ok).toBe(false);
    expect(second.content).not.toContain("once more");
    expect(grants.deploy).toBe(false);
    const third = await executeTool("deploy_preview", { kind: "static" }, ctx);
    expect(third).toMatchObject({ ok: false, summary: "Already deployed in this run" });
    expect(publish.deployPreview).toHaveBeenCalledTimes(2);
  });

  it("offers no second attempt when GitHub's rate limit outlasts the push's own waits", async () => {
    const { GitHubError } = await import("./services/github");
    publish.deployPreview.mockClear();
    publish.deployPreview.mockRejectedValueOnce(new GitHubError("GitHub POST /repos/octo/curialy-preview-2/git/trees failed (403): API rate limit exceeded", 403, 25 * 60_000));
    const grants = { deploy: true };
    const { ctx } = toolContext(grants);
    const first = await executeTool("deploy_preview", { kind: "static" }, ctx);
    expect(first.ok).toBe(false);
    expect(first.content).toMatch(/about 25 more minute/);
    expect(first.content).not.toContain("once more");
    expect(grants.deploy).toBe(false);
  });
});

describe("the run's publishing outcome", () => {
  const live = (id: string) => async (req: any) => {
    req.onCreated(id, "2026-11-02T16:00:00.000Z");
    req.onProgress("live", "Live", "https://preview.example");
    return { id, url: "https://preview.example", serviceId: `srv-${id}`, repo: `octo/curialy-preview-${id}`, expiresAt: "2026-11-02T16:00:00.000Z" };
  };

  it("counts a deploy whose allowed second attempt went live as published, but never clears a failed push", async () => {
    db.handler = () => ({ rows: [], rowCount: 0 });
    model.duringStream = () => undefined;
    publish.deployPreview.mockClear();
    publish.deployPreview.mockRejectedValueOnce(new Error("Deploy build failed. Check the build and start commands."));
    publish.deployPreview.mockImplementationOnce(live("dep-row-3"));
    const first = await loopContext("00000000-0000-4000-8000-0000000000c4");
    model.turns = 0;
    model.script = turn => turn <= 2 ? [{ type: "tool_use", id: `tu_dep${turn}`, name: "deploy_preview", input: { kind: "static" } }] : [{ type: "text", text: "Deployed." }];
    await runAgentLoop(first.ctx, [{ role: "user", content: "Deploy it." }]);
    expect(publish.deployPreview).toHaveBeenCalledTimes(2);
    expect(first.ctx.outcome.publish).toBe("done");

    publish.deployPreview.mockImplementationOnce(live("dep-row-4"));
    const second = await loopContext("00000000-0000-4000-8000-0000000000c5");
    model.turns = 0;
    model.script = turn => turn === 1 ? [{ type: "tool_use", id: "tu_push", name: "github_commit_and_push", input: { message: "Ship it" } }]
      : turn === 2 ? [{ type: "tool_use", id: "tu_dep", name: "deploy_preview", input: { kind: "static" } }]
      : [{ type: "text", text: "Done." }];
    await runAgentLoop(second.ctx, [{ role: "user", content: "Push it and deploy it." }]);
    expect(second.events.find(event => event.type === "tool_result" && event.callId === "tu_push")).toMatchObject({ ok: false });
    expect(second.ctx.outcome.publish).toBe("failed");
  });
});

describe("the turn limit and the self-healing breaker", () => {
  it("asks for a wrap-up in the last fifth of the turns, then ends with a summary instead of failing", async () => {
    db.handler = () => ({ rows: [], rowCount: 0 });
    model.duringStream = () => undefined;
    const busy = (turn: number) => [{ type: "tool_use", id: `tu_ls${turn}`, name: "list_files", input: {} }];
    const { ctx, events } = await loopContext("00000000-0000-4000-8000-0000000000d1");
    model.turns = 0;
    model.requests.length = 0;
    model.script = turn => (turn <= 5 ? busy(turn) : [{ type: "text", text: "Summary: listed the files; the build is not started yet." }]);
    const result = await runAgentLoop(ctx, [{ role: "user", content: "Build it." }], { maxTurns: 5 });
    expect(result.text).toContain("Summary: listed the files");
    expect(ctx.outcome.turnLimit).toBe(true);
    expect(model.turns).toBe(6); // five turns, then one summary reply
    // The wrap-up note arrives once, with turn 4 (80% of 5); the summary turn is told not to use tools.
    expect(model.requests.map(messages => JSON.stringify(messages).includes("[Turn budget] 2 of 5 model turns are left"))).toEqual([false, false, false, true, true, true]);
    expect(JSON.stringify(model.requests.at(-1))).toContain("[Turn limit]");
    expect(events.some(event => event.type === "notice" && /5-turn limit/.test(event.message))).toBe(true);

    // A summary turn that still calls a tool: the call is not run, the history stays valid, the run still ends.
    const again = await loopContext("00000000-0000-4000-8000-0000000000d3");
    model.turns = 0;
    model.script = turn => busy(turn);
    const conversation: any[] = [{ role: "user", content: "Build it." }];
    const stopped = await runAgentLoop(again.ctx, conversation, { maxTurns: 3 });
    expect(stopped.text).toMatch(/Stopped at the 3-turn limit before finishing/);
    expect(conversation.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_ls4", is_error: true, content: "Not run: the turn limit was reached." }] });
    expect(again.events.filter(event => event.type === "tool_call").map(event => event.callId)).toEqual(["tu_ls1", "tu_ls2", "tu_ls3"]);
  });

  it("stops self-healing when the same check fails the same way twice", async () => {
    db.handler = () => ({ rows: [], rowCount: 0 });
    model.duringStream = () => undefined;
    const { ctx, events } = await loopContext("00000000-0000-4000-8000-0000000000d2");
    fs.writeFileSync(path.join(ctx.root, "package.json"), JSON.stringify({ name: "t", scripts: { test: "node -e \"console.log('2 tests failed in 0.41s'); process.exit(1)\"" } }));
    model.turns = 0;
    model.script = turn => (turn === 1 ? [{ type: "tool_use", id: "tu_w", name: "write_file", input: { path: "a.js", content: "x\n" } }] : [{ type: "text", text: turn === 2 ? "Done." : "Fixed it." }]);
    const result = await runAgentLoop(ctx, [{ role: "user", content: "Build it." }]);
    expect(events.filter(event => event.type === "heal")).toHaveLength(1);
    expect(model.turns).toBe(3);
    expect(ctx.outcome).toMatchObject({ verification: "failed", failedCheck: { command: "npm run --silent test", exitCode: 1 } });
    expect(result.text).toMatch(/Verification failed\*\* the same way twice: `npm run --silent test`/);
    expect(events.some(event => event.type === "notice" && /failed the same way twice/.test(event.message))).toBe(true);
  });
});

async function loopContext(taskId: string) {
  const { RecoveryEngine, ToolFailureWatch } = await import("./agent/recovery");
  const { getModel } = await import("../shared/agent");
  const root = path.join(tmp, taskId);
  fs.mkdirSync(root, { recursive: true });
  const events: any[] = [];
  const controller = new AbortController();
  const ctx: any = {
    taskId, runId: "run1", runToken: RUN, root, mode: "agent", effort: "medium", webSearch: false, spec: getModel("claude-sonnet-4-5"),
    emit: (event: unknown) => events.push(event), signal: controller.signal, phases: { advance: vi.fn(), set: vi.fn(), get: () => "pending", finish: vi.fn() },
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, changedFiles: new Set(), agentVerifyCommands: [], manifest: new Map(), attached: new Map(), images: new Map(),
    context: "", github: true, flags: { noEager: false, noThinking: false, noEffort: false }, toolWatch: new ToolFailureWatch(), persist: () => undefined,
    outcome: { verification: "none" }, grants: { deploy: true }, failedPublishing: new Set(), taskModel: "claude-sonnet-4-5", publishing: { count: 0 },
  };
  ctx.recovery = new RecoveryEngine({ signal: ctx.signal, format: "anthropic", conversation: [], spec: ctx.spec, flags: ctx.flags, switchModel: () => undefined, persist: () => undefined, emit: () => undefined });
  return { ctx, events, controller };
}

describe("a run cancelled while the model is answering", () => {
  it("starts none of the tool calls of that turn, publishing included", async () => {
    db.handler = () => ({ rows: [], rowCount: 0 });
    const { ctx, events, controller } = await loopContext("00000000-0000-4000-8000-0000000000c2");
    model.turns = 0;
    model.script = () => [
      { type: "tool_use", id: "tu_push", name: "github_commit_and_push", input: { message: "Ship it" } },
      { type: "tool_use", id: "tu_pr", name: "github_create_pr", input: { title: "Ship it" } },
      { type: "tool_use", id: "tu_deploy", name: "deploy_preview", input: { kind: "static" } },
      { type: "tool_use", id: "tu_attach", name: "attach_files", input: { paths: ["index.html"] } },
    ];
    model.duringStream = () => controller.abort();

    await expect(runAgentLoop(ctx, [{ role: "user", content: "Build it, push it and deploy it." }])).rejects.toThrow();

    expectNothingPublished();
    expect(ctx.grants.deploy).toBe(true); // never consumed: the call never started
    const results = events.filter(event => event.type === "tool_result");
    expect(results).toEqual([expect.objectContaining({ callId: "tu_push", ok: false, summary: "Not run: the run was stopped" })]);
    // The later calls never started (no tool_call); their cards are settled by the run's done event.
    expect(events.filter(event => event.type === "tool_call").map(event => event.callId)).toEqual(["tu_push"]);
  });

  it("reports a deploy that finished before the stop took effect as done, not as failed", async () => {
    const { ctx, events, controller } = await loopContext("00000000-0000-4000-8000-0000000000c3");
    publish.deployPreview.mockImplementationOnce(async req => {
      req.onCreated("dep-row-2", "2026-10-27T14:00:00.000Z");
      controller.abort(); // Cancel pressed while the preview was going live
      req.onProgress("live", "Live", "https://preview.example");
      return { id: "dep-row-2", url: "https://preview.example", serviceId: "srv-2", repo: "octo/curialy-preview-87654321", expiresAt: "2026-10-27T14:00:00.000Z" };
    });
    model.turns = 0;
    model.script = () => [{ type: "tool_use", id: "tu_deploy2", name: "deploy_preview", input: { kind: "static" } }];
    model.duringStream = () => undefined;

    await expect(runAgentLoop(ctx, [{ role: "user", content: "Deploy it." }])).rejects.toThrow();

    expect(publish.deployPreview).toHaveBeenCalledTimes(1);
    expect(ctx.publishing.count).toBe(0);
    expect(events.filter(event => event.type === "tool_result")).toEqual([
      expect.objectContaining({ callId: "tu_deploy2", ok: true, summary: "Live preview deployed (finished before the stop took effect)" }),
    ]);
    expect(model.turns).toBe(1); // no further model turn after the stop
  });
});
