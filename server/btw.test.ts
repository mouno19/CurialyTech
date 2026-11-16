import { beforeEach, describe, expect, it, vi } from "vitest";
import { btwQuery, type AgentEvent, type AgentEventBody } from "@shared/agent";

// /btw: the live state a side question is answered from, the answer's shape, what is charged, and
// when the user's words are passed to the agent. The model, credits and the event log are stand-ins.

const state = vi.hoisted(() => ({
  reply: "" as string | Error,
  requests: [] as Record<string, any>[],
  balance: { unlimited: false, available: 50 } as Record<string, unknown>,
  charges: [] as unknown[][],
  appended: [] as { taskId: string; body: AgentEventBody }[],
  history: [] as AgentEvent[],
}));

vi.mock("./agent/providers", () => ({
  anthropicClient: () => ({
    messages: {
      create: async (params: Record<string, any>) => {
        state.requests.push(params);
        if (state.reply instanceof Error) throw state.reply;
        return { content: [{ type: "text", text: state.reply }], usage: { input_tokens: 4000, output_tokens: 120 } };
      },
    },
  }),
}));
vi.mock("./credits", () => ({
  getBalance: vi.fn(async () => ({ resetsAt: null, plan: null, plans: [], canEarn: false, ...state.balance })),
  charge: vi.fn(async (...args: unknown[]) => { state.charges.push(args); }),
  outOfCreditsMessage: () => "Your account has no credits right now.",
}));
vi.mock("./agent/events", () => ({ appendTaskEvent: vi.fn(async (taskId: string, body: AgentEventBody) => { state.appended.push({ taskId, body }); }) }));
vi.mock("./agent/bus", () => ({ liveChannel: () => ({ history: state.history }) }));
vi.mock("./agent/store", () => ({ lastSeq: async () => 0, listEventsAfter: async () => [] }));
vi.mock("./analytics/usage", () => ({ recordAgentUsage: vi.fn(async () => undefined) }));

const btw = await import("./agent/btw");

const TASK = "00000000-0000-4000-8000-000000000001";
let seq = 0;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const ev = (body: AgentEventBody, minutesAgo = 1): AgentEvent => ({ ...body, seq: ++seq, ts: at(minutesAgo) } as AgentEvent);

/** A run 6 minutes in: a plan, a passing and a failing step, a file changed, an approval waiting. */
function liveRun(): AgentEvent[] {
  return [
    ev({ type: "run_start", runId: "r1", attempt: 1, trigger: "prompt" }, 30),
    ev({ type: "user_message", text: "Build a pricing page" }, 30),
    ev({ type: "done", status: "completed", answer: "Earlier run." }, 29),
    ev({ type: "run_start", runId: "r2", attempt: 1, trigger: "follow_up" }, 6),
    ev({ type: "user_message", text: "Now add a FAQ section" }, 6),
    ev({ type: "turn_start", turn: 1, model: "claude-sonnet-5-5" }, 6),
    ev({ type: "phase", phase: "implementation", state: "active" }, 5),
    ev({ type: "plan", steps: [{ title: "Write the FAQ component", status: "done" }, { title: "Style it", status: "in_progress" }, { title: "Run the tests", status: "pending" }] }, 5),
    ev({ type: "tool_call", callId: "c1", name: "write_file", input: { path: "src/Faq.tsx", content: "…" } }, 4),
    ev({ type: "tool_result", callId: "c1", ok: true, summary: "Wrote src/Faq.tsx", durationMs: 5 }, 4),
    ev({ type: "file_change", callId: "c1", path: "src/Faq.tsx", kind: "create", before: "", after: "…", bytesBefore: 0, bytesAfter: 10, added: 1, removed: 0, truncated: false }, 4),
    ev({ type: "tool_call", callId: "c2", name: "run_command", input: { command: "npx vitest run" } }, 3),
    ev({ type: "tool_result", callId: "c2", ok: false, summary: "2 tests failed", exitCode: 1, durationMs: 900 }, 3),
    ev({ type: "turn_start", turn: 2, model: "claude-sonnet-5-5" }, 2),
    ev({ type: "text_delta", blockId: "b1", text: "Fixing the two failing " }, 2),
    ev({ type: "text_delta", blockId: "b1", text: "tests now." }, 2),
    ev({ type: "tool_call", callId: "c3", name: "edit_file", input: { path: "src/Faq.test.tsx" } }, 1),
    ev({ type: "approval_request", requestId: "a1", action: "push", title: "Push to octo/site", details: [], expiresAt: at(-10) }, 1),
  ];
}

beforeEach(() => {
  state.reply = JSON.stringify({ reply: "It's fixing two failing tests in src/Faq.test.tsx.", forAgent: false });
  state.requests.length = 0;
  state.balance = { unlimited: false, available: 50 };
  state.charges.length = 0;
  state.appended.length = 0;
  state.history = liveRun();
  btw.dropSteerNotes(TASK);
});

describe("the /btw prefix", () => {
  it("takes the question after /btw, any case, and nothing else", () => {
    expect(btwQuery("/btw what file are you editing?")).toBe("what file are you editing?");
    expect(btwQuery("  /BTW: use Tailwind ")).toBe("use Tailwind");
    expect(btwQuery("/btw\nhow many steps left?")).toBe("how many steps left?");
    expect(btwQuery("/btw")).toBeNull();
    expect(btwQuery("/btwx hi")).toBeNull();
    expect(btwQuery("btw what now")).toBeNull();
  });
});

describe("the live state", () => {
  it("describes only the latest run: request, plan, steps and results, files, approvals and the agent's last words", () => {
    const text = btw.describeLiveRun(state.history, "Build a pricing page");
    expect(text).toContain("Task request: Now add a FAQ section");
    expect(text).toMatch(/Status: still running for 6 min, on model turn 2 \(claude-sonnet-5-5\); current phase: Implementation\./);
    expect(text).toContain("- [done] Write the FAQ component\n- [in progress] Style it\n- [to do] Run the tests");
    expect(text).toContain("- write_file src/Faq.tsx → ok: Wrote src/Faq.tsx");
    expect(text).toContain("- run_command npx vitest run → failed: 2 tests failed");
    expect(text).toContain("- edit_file src/Faq.test.tsx → running now");
    expect(text).toContain("Files changed in this run (1): src/Faq.tsx (create)");
    expect(text).toContain("Waiting for the user to approve: Push to octo/site");
    expect(text).toContain('What the agent last wrote: "Fixing the two failing tests now."');
    expect(text).not.toContain("Earlier run");
  });

  it("says when nothing has happened yet", () => {
    const text = btw.describeLiveRun([ev({ type: "run_start", runId: "r", attempt: 1, trigger: "prompt" }, 0)], "Write a haiku");
    expect(text).toContain("Task request: Write a haiku");
    expect(text).toContain("Plan: none recorded yet.");
    expect(text).toContain("Latest steps: no tool used yet.");
  });
});

describe("the answer", () => {
  it("reads the model's JSON, and takes plain text as the reply", () => {
    expect(btw.parseBtwReply('{"reply": "Two steps left.", "forAgent": false}')).toEqual({ reply: "Two steps left.", forAgent: false });
    expect(btw.parseBtwReply('```json\n{"reply": "Noted, it goes to the agent.", "forAgent": true}\n```')).toEqual({ reply: "Noted, it goes to the agent.", forAgent: true });
    expect(btw.parseBtwReply("It's running the tests.")).toEqual({ reply: "It's running the tests.", forAgent: false });
    expect(btw.parseBtwReply('{"forAgent": true}').forAgent).toBe(false);
  });

  it("answers from the live state, charges the task's account and logs the question with its answer", async () => {
    const answer = await btw.answerBtw({ taskId: TASK, runId: "r2", userId: "u1", operator: false, prompt: "Build a pricing page", query: "what file are you editing?", id: "c-1", stillRunning: () => true });
    expect(answer).toEqual({ id: "c-1", reply: "It's fixing two failing tests in src/Faq.test.tsx.", forwarded: false });
    const request = state.requests[0];
    expect(request.model).toBe(btw.BTW_MODEL);
    expect(request.system).toContain("Never pretend the task is finished");
    expect(request.messages[0].content).toContain("Task request: Now add a FAQ section");
    expect(request.messages[0].content).toMatch(/The user's message \(sent with \/btw\):\nwhat file are you editing\?$/);
    // 4,000 in and 120 out on a quarter-weight model: under a tenth of a credit.
    expect(state.charges).toEqual([["u1", expect.closeTo(0.04, 2), TASK, expect.stringMatching(/^\/btw: claude-haiku-5-5: 4000 in, 120 out$/)]]);
    expect(state.appended).toEqual([{ taskId: TASK, body: { type: "btw_reply", id: "c-1", query: "what file are you editing?", reply: answer.reply, forwarded: false } }]);
    expect(btw.takeSteerNotes(TASK, "r2")).toBeNull();
  });

  it("passes an instruction to the agent in the user's own words, for this run only", async () => {
    state.reply = JSON.stringify({ reply: "Got it, the agent hears it at its next step.", forAgent: true });
    const answer = await btw.answerBtw({ taskId: TASK, runId: "r2", userId: "u1", operator: false, prompt: "", query: "keep it mobile responsive", stillRunning: () => true });
    expect(answer.forwarded).toBe(true);
    expect(btw.takeSteerNotes(TASK, "another-run")).toBeNull();
    await btw.answerBtw({ taskId: TASK, runId: "r2", userId: "u1", operator: false, prompt: "", query: "and use Tailwind", stillRunning: () => true });
    await btw.answerBtw({ taskId: TASK, runId: "r2", userId: "u1", operator: false, prompt: "", query: "no dark mode", stillRunning: () => true });
    expect(btw.takeSteerNotes(TASK, "r2")).toBe(`${btw.NOTE_MARK} and use Tailwind\n\n${btw.NOTE_MARK} no dark mode`);
    // Delivered once.
    expect(btw.takeSteerNotes(TASK, "r2")).toBeNull();
  });

  it("says so instead of passing a note on when the run ended meanwhile", async () => {
    state.reply = JSON.stringify({ reply: "Noted for the agent.", forAgent: true });
    const answer = await btw.answerBtw({ taskId: TASK, runId: "r2", userId: "u1", operator: false, prompt: "", query: "use Tailwind", stillRunning: () => false });
    expect(answer).toMatchObject({ forwarded: false, reply: expect.stringContaining("The run finished before this could reach the agent") });
    expect(btw.dropSteerNotes(TASK)).toBe(0);
  });

  it("refuses an account with nothing left, charges the operator nothing, and fails plainly when the model can't answer", async () => {
    state.balance = { unlimited: false, available: 0 };
    await expect(btw.answerBtw({ taskId: TASK, runId: "r2", userId: "u1", operator: false, prompt: "", query: "status?", stillRunning: () => true })).rejects.toMatchObject({ status: 402, code: "no_credits" });
    expect(state.requests).toHaveLength(0);
    await btw.answerBtw({ taskId: TASK, runId: "r2", userId: "admin", operator: true, prompt: "", query: "status?", stillRunning: () => true });
    expect(state.charges).toHaveLength(0);
    state.reply = new Error("upstream 529");
    await expect(btw.answerBtw({ taskId: TASK, runId: "r2", userId: "admin", operator: true, prompt: "", query: "status?", stillRunning: () => true })).rejects.toMatchObject({ status: 503, code: "unavailable" });
    expect(state.appended).toHaveLength(1);
  });

  it("drops the notes a run never read when it ends", () => {
    btw.addSteerNote(TASK, "r2", "one");
    btw.addSteerNote(TASK, "r2", "two");
    expect(btw.dropSteerNotes(TASK)).toBe(2);
    expect(btw.takeSteerNotes(TASK, "r2")).toBeNull();
  });
});
