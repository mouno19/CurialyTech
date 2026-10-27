import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanText, isDeterministicDataError, toJsonb } from "./db/json";

// One bad byte must never drop a batch of events or a conversation write, and run data written
// after a run lost its task must never land.

type Call = { text: string; values: unknown[] };
const db = vi.hoisted(() => ({ calls: [] as Call[], handler: async (_call: Call): Promise<unknown> => ({ rows: [], rowCount: 1 }) }));
vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    const call = { text, values };
    db.calls.push(call);
    return db.handler(call);
  }),
  heartbeatQuery: vi.fn(async () => ({ rows: [] })),
  db: () => { throw new Error("no pool in tests"); },
  adminUserId: async () => "admin",
}));

const store = await import("./agent/store");
const { LEGACY_RESTART_ERROR } = await import("../shared/taskStatus");

const TASK = "00000000-0000-4000-8000-0000000000f1";
const RUN = "10000000-0000-4000-8000-0000000000f1";

beforeEach(() => {
  db.calls.length = 0;
  db.handler = async () => ({ rows: [], rowCount: 1 });
});

describe("text and jsonb sanitizing", () => {
  it("strips NUL bytes and replaces lone surrogates, keeping valid pairs", () => {
    expect(cleanText("a\u0000b\u0000")).toBe("ab");
    expect(cleanText("x\uD800y")).toBe("x�y");
    expect(cleanText("\uDC00")).toBe("�");
    expect(cleanText("emoji 😀 ok")).toBe("emoji 😀 ok");
    expect(cleanText("plain")).toBe("plain");
  });

  it("cleans every string at every depth, keys included", () => {
    const json = toJsonb({ text: "out\u0000put", nested: [{ chunk: "\uD83D" }, "ok\u0000"], ["bad\u0000key"]: 1, ["\uDFFFk"]: { deep: "x\u0000" }, n: 1, b: true, nil: null });
    expect(json).not.toContain("\\u0000");
    expect(json).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(JSON.parse(json)).toEqual({ text: "output", nested: [{ chunk: "�" }, "ok"], badkey: 1, "�k": { deep: "x" }, n: 1, b: true, nil: null });
    expect(toJsonb([{ type: "tool_output", chunk: "\u0000" }])).toBe('[{"type":"tool_output","chunk":""}]');
  });

  it("tells deterministic data errors from transient ones", () => {
    for (const code of ["22P05", "22021", "22P02", "22023"]) expect(isDeterministicDataError({ code })).toBe(true);
    for (const error of [{ code: "23505" }, { code: "40001" }, { code: "ECONNRESET" }, new Error("timeout"), null, undefined]) expect(isDeterministicDataError(error)).toBe(false);
  });
});

describe("updateAgentTask", () => {
  it("merges patches queued behind a write into one UPDATE, later values winning", async () => {
    let release!: () => void;
    db.handler = call => (call.values.includes("first") ? new Promise(resolve => { release = () => resolve({ rows: [], rowCount: 1 }); }) : Promise.resolve({ rows: [], rowCount: 1 }));
    const first = store.updateAgentTask(TASK, { model: "first" }, RUN);
    await vi.waitFor(() => expect(db.calls).toHaveLength(1));
    const conversation: Record<string, unknown>[] = [{ role: "user", content: "hi" }];
    const second = store.updateAgentTask(TASK, { phase: "planning", conversation }, RUN);
    const third = store.updateAgentTask(TASK, { phase: "implementation", usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 0 } }, RUN);
    conversation.push({ role: "assistant", content: "hello\u0000" }); // serialized when the write runs, not when queued
    release();
    await Promise.all([first, second, third]);
    expect(db.calls).toHaveLength(2);
    const merged = db.calls[1];
    expect(merged.text).toBe("UPDATE curialy.chat_sessions SET phase = $2, conversation = $3, usage = $4, updated_at = now(), last_activity_at = now() WHERE id = $1 AND run_id = $5 AND status IN ('queued', 'running', 'cancelling')");
    expect(merged.values).toEqual([TASK, "implementation", JSON.stringify([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]), '{"inputTokens":1,"outputTokens":2,"thinkingTokens":0}', RUN]);
  });

  it("merges two patches issued in the same tick into a single statement", async () => {
    await Promise.all([store.updateAgentTask(TASK, { phase: "planning" }, RUN), store.updateAgentTask(TASK, { model: "m" }, RUN)]);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].values).toEqual([TASK, "planning", "m", RUN]);
  });

  it("keeps writes with different fences apart and in order", async () => {
    await Promise.all([
      store.updateAgentTask(TASK, { phase: "planning" }, RUN),
      store.updateAgentTask(TASK, { workspaceState: "archived" }),
      store.updateAgentTask(TASK, { phase: "review" }, RUN),
    ]);
    expect(db.calls.map(call => call.values)).toEqual([[TASK, "planning", RUN], [TASK, "archived"], [TASK, "review", RUN]]);
    expect(db.calls[1].text).toBe("UPDATE curialy.chat_sessions SET workspace_state = $2, updated_at = now(), last_activity_at = now() WHERE id = $1");
  });

  it("keeps the chain going after a failed write, and settles", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    db.handler = async call => {
      if (call.values.includes("boom")) throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
      return { rows: [], rowCount: 1 };
    };
    const failed = store.updateAgentTask(TASK, { model: "boom" }, RUN);
    await failed;
    await store.updateAgentTask(TASK, { model: "ok" }, RUN);
    await store.settleTaskWrites(TASK);
    expect(db.calls.map(call => call.values[1])).toEqual(["boom", "ok"]);
  });

  it("writes nothing for an empty patch", async () => {
    await store.updateAgentTask(TASK, {}, RUN);
    await store.updateAgentTask(TASK, { phase: undefined }, RUN);
    expect(db.calls).toHaveLength(0);
  });
});

describe("insertEvents", () => {
  const event = (seq: number, chunk: string) => ({ type: "tool_output", callId: "c1", stream: "stdout", chunk, seq, ts: "2026-10-27T10:00:00.000Z" }) as never;

  it("stores only while the run still owns the task and is active, with clean jsonb", async () => {
    db.handler = async () => ({ rows: [], rowCount: 2 });
    expect(await store.insertEvents(TASK, [event(1, "a\u0000"), event(2, "b")], RUN)).toBe(2);
    const [call] = db.calls;
    // Recovery keeps the run id when it interrupts a run, so a worker that lost its lease still
    // matches it: without the status check its late batches would land after the run's done.
    expect(call.text).toContain("WHERE EXISTS (SELECT 1 FROM curialy.chat_sessions WHERE id = v.session_id AND run_id = $11::uuid AND status IN ('queued', 'running', 'cancelling'))");
    expect(call.values.at(-1)).toBe(RUN);
    expect(call.values[3]).toBe('{"type":"tool_output","callId":"c1","stream":"stdout","chunk":"a"}');
    expect(await store.insertEvents(TASK, [])).toBe(0);
    expect(db.calls).toHaveLength(1);
  });
});

describe("task rows", () => {
  const row = (patch: Record<string, unknown>) => ({
    id: TASK, prompt: "p", status: "failed", mode: "agent", model: "m", effort: "medium", web_search: false, phase: null, answer: null, error: null,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, files_changed: 0, workspace_state: "live", github_repo: null, github_repo_url: null, github_pushed_at: null,
    github_mode: null, github_branch: null, team: false, created_at: new Date(), updated_at: new Date(), status_reason: null, status_changed_at: null, started_at: null, finished_at: null,
    run_id: null, attempt: 0, cancel_requested_at: null, outcome: null, ...patch,
  });

  it("shows a row the old restart recovery marked failed as interrupted by a restart", async () => {
    db.handler = async () => ({ rows: [row({ error: LEGACY_RESTART_ERROR })] });
    expect(await store.getAgentTask(TASK)).toMatchObject({ status: "interrupted", statusReason: "server_restart", error: undefined });
    db.handler = async () => ({ rows: [row({ error: "Boom", status_reason: "error" })] });
    expect(await store.getAgentTask(TASK)).toMatchObject({ status: "failed", statusReason: "error", error: "Boom" });
    expect(await store.getAgentTask("not-a-uuid")).toBeUndefined();
  });

  it("never sends answers in the task list", async () => {
    db.handler = async () => ({ rows: [] });
    await store.listAgentTasks();
    expect(db.calls[0].text).toContain("NULL::text AS answer");
    expect(db.calls[0].text).not.toMatch(/,\s*answer,/);
  });

  it("counts legacy restart rows as interrupted, not failed", async () => {
    db.handler = async () => ({ rows: [{ total: "5", completed: "2", failed: "1", cancelled: "0", interrupted: "2", running: "0", files: "3" }] });
    expect(await store.agentStats()).toEqual({ total: 5, completed: 2, completedWithIssues: 0, failed: 1, cancelled: 0, interrupted: 2, running: 0, filesChanged: 3 });
    expect(db.calls[0].values).toEqual([LEGACY_RESTART_ERROR, ["queued", "running", "cancelling"]]);
  });
});
