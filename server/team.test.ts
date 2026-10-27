import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// End-to-end Dev Team run with a scripted model: real loop, real tools (sandbox off, temp
// workspace), no network or database. Architect plans → Engineer builds → Reviewer requests
// changes (and tries to edit, which must be refused) → Engineer fixes → Reviewer approves.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-team-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

type Block = Record<string, unknown>;
const calls: { role: string; model: string; tools: string[]; messages: { role: string; content: unknown }[] }[] = [];
let reviewerRounds = 0;
type Script = (role: string, messages: { role: string; content: unknown }[]) => Block[];

function roleOf(system: string) {
  return system.includes("You are the Architect") ? "architect" : system.includes("You are the Reviewer") ? "reviewer" : "engineer";
}

/** What the scripted model "says" next, given who is asking and the conversation so far. */
const happyPath: Script = (role, messages) => {
  const last = messages[messages.length - 1];
  const lastText = JSON.stringify(last.content);
  if (role === "architect") return [{ type: "tool_use", id: "tu_plan", name: "submit_plan", input: { summary: "Create greet.js exporting greet(name).", steps: [{ title: "Write greet.js", detail: "module.exports = { greet }", acceptance: "greet('Ada') returns 'Hello, Ada!'" }], risks: ["empty names"], test_plan: "node -e \"require('./greet.js')\"" } }];
  if (role === "engineer") {
    if (lastText.includes("Reviewer approved your changes")) return [{ type: "text", text: "Pushed to GitHub: https://github.com/example/greet/commit/abc123" }];
    if (lastText.includes("tu_write") || lastText.includes("tu_fix")) return [{ type: "text", text: lastText.includes("tu_fix") ? "Fixed: greet trims and handles empty names." : "Implemented greet.js." }];
    if (lastText.includes("requested changes")) return [{ type: "tool_use", id: "tu_fix", name: "write_file", input: { path: "greet.js", content: "exports.greet = (name) => `Hello, ${(name || 'friend').trim()}!`;\n" } }];
    return [{ type: "tool_use", id: "tu_write", name: "write_file", input: { path: "greet.js", content: "exports.greet = (name) => `Hello, ${name}!`;\n" } }];
  }
  // reviewer
  if (lastText.includes("tu_sneaky")) return [{ type: "tool_use", id: `tu_review${reviewerRounds}`, name: "submit_review", input: reviewerRounds === 1
    ? { verdict: "request_changes", summary: "Empty names print 'undefined'.", issues: [{ severity: "major", file: "greet.js", description: "greet() with no name returns 'Hello, undefined!'", suggestion: "Default to 'friend'." }], tests_run: [{ command: "node -e greet()", result: "Hello, undefined!" }] }
    : { verdict: "approve", summary: "Handles empty names now.", issues: [], tests_run: [{ command: "node -e greet()", result: "Hello, friend!" }] } }];
  reviewerRounds++;
  // Before verdict, the Reviewer tries to "just fix it" itself: must be refused by the allowlist.
  return [{ type: "tool_use", id: "tu_sneaky", name: "write_file", input: { path: "greet.js", content: "// reviewer was here\n" } }];
};

let script: Script = happyPath;

class FakeStream {
  private message: Record<string, unknown>;
  constructor(params: { system: { text: string }[]; messages: { role: string; content: unknown }[]; model: string; tools?: { name: string }[] }) {
    const role = roleOf(params.system[0].text);
    calls.push({ role, model: params.model, tools: (params.tools ?? []).map(tool => tool.name), messages: JSON.parse(JSON.stringify(params.messages)) });
    const content = script(role, params.messages);
    this.message = { id: "msg", type: "message", role: "assistant", model: params.model, content, stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
  }
  async *[Symbol.asyncIterator]() {
    const content = this.message.content as Block[];
    for (const [index, block] of content.entries()) {
      yield { type: "content_block_start", index, content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" } };
      if (block.type === "text") yield { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } };
      yield { type: "content_block_stop", index };
    }
  }
  async finalMessage() { return this.message; }
}

vi.mock("./agent/providers", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/providers")>()),
  anthropicClient: () => ({ messages: { stream: (params: never) => new FakeStream(params) } }),
}));

const saved: unknown[] = [];
vi.mock("./agent/store", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/store")>()),
  updateAgentTask: async () => undefined,
  getTeamState: async () => null,
  saveTeamState: async (_id: string, state: unknown) => { saved.push(JSON.parse(JSON.stringify(state))); },
  settleTeamWrites: async () => undefined,
}));

async function setup(taskId: string, files: Record<string, string> = {}) {
  const { RecoveryEngine, ToolFailureWatch } = await import("./agent/recovery");
  const { getModel } = await import("../shared/agent");
  const root = path.join(tmp, taskId);
  fs.mkdirSync(root, { recursive: true });
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(root, file), content);
  const events: any[] = [];
  const controller = new AbortController();
  const phases = { advance: vi.fn(), set: vi.fn(), get: () => "pending", finish: vi.fn() };
  const ctx: any = {
    taskId, runId: "run1", root, mode: "agent", effort: "medium", webSearch: false, spec: getModel("claude-sonnet-4-5"),
    emit: (event: unknown) => events.push(event), signal: controller.signal, phases,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, changedFiles: new Set(), agentVerifyCommands: [],
    manifest: new Map(), attached: new Map(), images: new Map(), context: "", github: true,
    flags: { noEager: false, noThinking: false, noEffort: false }, toolWatch: new ToolFailureWatch(), persist: () => undefined, outcome: { verification: "none" },
  };
  ctx.recovery = new RecoveryEngine({ signal: ctx.signal, format: "anthropic", conversation: [], spec: ctx.spec, flags: ctx.flags, switchModel: () => undefined, persist: () => undefined, emit: () => undefined });
  return { ctx, root, events, controller };
}

const byRole = (role: string) => calls.filter(call => call.role === role);
const lastTeamStatus = (events: any[], role: string) => events.filter(event => event.type === "team_agent" && event.role === role).at(-1);

describe("Dev Team orchestration", () => {
  it("plans, builds, enforces the reviewer's read-only role, iterates on review, publishes after approval and reports", { timeout: 60_000 }, async () => {
    const { runTeam } = await import("./agent/team");
    const { ctx, root, events } = await setup("00000000-0000-4000-8000-0000000000aa");
    script = happyPath;
    calls.length = 0;

    const answer = await runTeam(ctx, [{ role: "user", content: "Write greet.js exporting greet(name), then push it to GitHub." }]);

    // Final file is the Engineer's fix, untouched by the Reviewer's refused write.
    expect(fs.readFileSync(path.join(root, "greet.js"), "utf8")).toContain("'friend'");
    const refused = events.find(event => event.type === "tool_result" && event.callId === "tu_sneaky");
    expect(refused).toMatchObject({ ok: false, summary: "Not allowed for this role", agent: "reviewer" });

    // Role models and tool sets.
    expect(byRole("architect")[0].model).toBe("claude-opus-5-5");
    expect(byRole("engineer")[0].model).toBe("claude-sonnet-4-5");
    expect(byRole("reviewer")[0].model).toBe("claude-opus-5"); // independent of the Engineer
    expect(byRole("architect")[0].tools).toContain("submit_plan");
    expect(byRole("architect")[0].tools).not.toContain("write_file");
    expect(byRole("reviewer")[0].tools).toEqual(expect.arrayContaining(["submit_review", "run_command"]));
    expect(byRole("reviewer")[0].tools).not.toContain("edit_file");
    // Publishing tools only in the post-approval run.
    const engineerCalls = byRole("engineer");
    expect(engineerCalls.slice(0, -1).every(call => !call.tools.includes("github_commit_and_push") && !call.tools.includes("deploy_preview"))).toBe(true);
    expect(engineerCalls.at(-1)!.tools).toEqual(expect.arrayContaining(["github_commit_and_push", "github_create_pr"])); // deploy_preview is offered only when deploys are configured
    expect(answer).toContain("**Publishing:**");
    expect(answer).toContain("Pushed to GitHub");

    // Hand-offs in order, with one fix round.
    const handoffs = events.filter(event => event.type === "handoff").map(event => `${event.from}->${event.to}:${event.kind}`);
    expect(handoffs).toEqual(["architect->engineer:plan", "reviewer->engineer:review", "reviewer->user:review", "reviewer->user:report"]);
    expect(answer).toMatch(/approved by the Reviewer after 2 rounds/);

    // Every member event is tagged with its role; orchestration events are not.
    expect(events.filter(event => event.type === "tool_call" && event.name === "write_file").every(event => event.agent === "engineer" || event.agent === "reviewer")).toBe(true);
    expect(events.find(event => event.type === "handoff")?.agent).toBeUndefined();

    // Team state persisted with each member's history.
    const last = saved[saved.length - 1] as any;
    expect(last.plans).toHaveLength(1);
    expect(last.reviews.map((review: any) => review.verdict)).toEqual(["request_changes", "approve"]);
    expect(last.reviewer.length).toBeGreaterThan(2);
    // Roles keep alternating in every saved history (follow-up turns merge into trailing tool results).
    for (const history of [last.architect, last.engineer, last.reviewer]) {
      expect(history.every((message: any, index: number) => index === 0 || message.role !== history[index - 1].role)).toBe(true);
    }
    expect(["architect", "engineer", "reviewer"].map(role => lastTeamStatus(events, role).status)).toEqual(["done", "done", "done"]);
  });

  it("reverts read-only shell writes, survives turn caps, fails closed without a verdict and never publishes unapproved work", { timeout: 60_000 }, async () => {
    const { runTeam } = await import("./agent/team");
    const { ctx, root, events } = await setup("00000000-0000-4000-8000-0000000000bb", { "README.md": "original\n" });
    calls.length = 0;
    script = (role, messages) => {
      const lastText = JSON.stringify(messages[messages.length - 1].content);
      if (role === "architect") {
        // Tries to write through the shell, then never submits a plan (hits the 30-turn cap).
        if (messages.length === 1) return [{ type: "tool_use", id: "tu_arch_cmd", name: "run_command", input: { command: "echo hacked > README.md; echo note > notes.md; mkdir -p dist && echo built > dist/out.txt" } }];
        return [{ type: "tool_use", id: `tu_ls${messages.length}`, name: "list_files", input: {} }];
      }
      if (role === "engineer") {
        if (lastText.includes("tu_gen")) return [{ type: "text", text: "Done." }];
        if (lastText.includes("tu_write") || lastText.includes("tu_fix")) return [{ type: "tool_use", id: "tu_gen", name: "run_command", input: { command: "echo generated > gen.txt" } }];
        if (lastText.includes("requested changes")) return [{ type: "tool_use", id: "tu_fix", name: "write_file", input: { path: "greet.js", content: "exports.greet = n => n;\n" } }];
        return [{ type: "tool_use", id: "tu_write", name: "write_file", input: { path: "greet.js", content: "exports.greet = n => n;\n" } }];
      }
      return [{ type: "text", text: "Looks fine to me." }]; // Reviewer never calls submit_review.
    };

    const answer = await runTeam(ctx, [{ role: "user", content: "Write greet.js and deploy it." }]);

    // Read-only Architect: source changes reverted, build output allowed, model and user told.
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe("original\n");
    expect(fs.existsSync(path.join(root, "notes.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "dist/out.txt"))).toBe(true);
    const archResult = byRole("architect")[1].messages.at(-1) as any;
    expect(JSON.stringify(archResult.content)).toContain("[Read-only role]");
    expect(events.some(event => event.type === "notice" && /architect changed 2 workspace file/.test(event.message))).toBe(true);

    // Turn cap: fallback plan instead of a failed run.
    expect(byRole("architect")).toHaveLength(30);
    expect(events.some(event => event.type === "notice" && /30-turn budget/.test(event.message))).toBe(true);
    expect(events.find(event => event.type === "handoff" && event.kind === "plan").title).toBe("Plan · 1 step");

    // Engineer's shell-created file is listed for the Reviewer.
    expect(JSON.stringify(byRole("reviewer")[0].messages.at(-1))).toMatch(/Also created or changed by the Engineer's commands[^]*gen\.txt/);

    // No verdict = not approved: three fix rounds, open items, nothing published.
    const reviews = events.filter(event => event.type === "handoff" && event.kind === "review");
    expect(reviews.map(event => event.title)).toEqual(Array(3).fill("No verdict submitted · not approved"));
    expect(answer).toMatch(/not approved after 3 review rounds/);
    expect(answer).toContain("Not published");
    expect(calls.some(call => call.tools.includes("deploy_preview"))).toBe(false);

    // Block ids are unique across review rounds.
    const reviewerText = events.filter(event => event.type === "text_delta" && event.agent === "reviewer").map(event => event.blockId);
    expect(reviewerText).toHaveLength(9);
    expect(new Set(reviewerText).size).toBe(9);
  });

  it("marks the active member and the waiting ones as stopped when the run is cancelled", { timeout: 60_000 }, async () => {
    const { runTeam } = await import("./agent/team");
    const { ctx, events, controller } = await setup("00000000-0000-4000-8000-0000000000cc");
    calls.length = 0;
    reviewerRounds = 0;
    script = (role, messages) => {
      if (role === "engineer") { controller.abort(); return [{ type: "tool_use", id: "tu_cancel", name: "list_files", input: {} }]; }
      return happyPath(role, messages);
    };
    await expect(runTeam(ctx, [{ role: "user", content: "Write greet.js." }])).rejects.toThrow();
    expect(lastTeamStatus(events, "engineer")).toMatchObject({ status: "failed", activity: "Cancelled" });
    expect(lastTeamStatus(events, "reviewer")).toMatchObject({ status: "failed", activity: "Cancelled" });
    expect(lastTeamStatus(events, "architect").status).toBe("done");
  });
});
