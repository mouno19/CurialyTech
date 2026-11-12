import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "e2b";
import type { RemoteBox } from "./agent/e2b";

// Background commands and the harness's checks, end to end: the real loop with a scripted model,
// the real tools, and the cloud sandbox runtime over a fake sandbox (a folder and real bash), so
// commands really run side by side, stream, are stopped with everything they started, and sync
// their files back.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-bg-"));
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "workspaces");
process.env.AGENT_SANDBOX = "e2b";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });

type Block = Record<string, unknown>;
type Message = { role: string; content: unknown };
const model = { script: (_turn: number): Block[] => [], turns: 0, calls: [] as { tools: string[]; messages: Message[] }[] };

class FakeStream {
  private message: Record<string, unknown>;
  constructor(params: { messages: Message[]; model: string; tools?: { name: string }[] }) {
    model.calls.push({ tools: (params.tools ?? []).map(tool => tool.name), messages: JSON.parse(JSON.stringify(params.messages)) });
    const content = model.script(++model.turns);
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
vi.mock("./agent/store", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/store")>()), updateAgentTask: async () => undefined }));

// The sandbox: a folder per task and real bash (as in e2b.test.ts); keepAlive calls are recorded.
const REMOTE = "/home/user/workspace";
const fakes = new Map<string, { dir: string; keepAlive: number[] }>();
function fakeSandbox(taskId: string): RemoteBox {
  const fake = { dir: fs.mkdtempSync(path.join(tmp, "remote-")), keepAlive: [] as number[] };
  fakes.set(taskId, fake);
  const local = (text: string) => text.split(REMOTE).join(fake.dir);
  return {
    id: `fake-${taskId.slice(-4)}`,
    keepAlive: async ms => { fake.keepAlive.push(ms); },
    start: async (command, opts) => {
      const child = spawn("bash", ["-c", local(command)], { cwd: fake.dir });
      child.stdout.on("data", data => opts.onStdout(data.toString()));
      child.stderr.on("data", data => opts.onStderr(data.toString()));
      const exit = new Promise<number>(resolve => child.on("close", code => resolve(code ?? -1)));
      return {
        wait: () => new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new TimeoutError("command timed out")), opts.timeoutMs);
          void exit.then(code => { clearTimeout(timer); resolve(code); });
        }),
        kill: async () => { child.kill("SIGKILL"); },
      };
    },
    exec: async command => {
      const result = spawnSync("bash", ["-c", local(command)], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
      return result.stdout;
    },
    write: async files => {
      for (const file of files) {
        fs.mkdirSync(path.dirname(local(file.path)), { recursive: true });
        fs.writeFileSync(local(file.path), file.data);
      }
    },
    read: async file => fs.readFileSync(local(file)),
    host: port => `${port}-${taskId.slice(0, 8)}.sandbox.test`,
    kill: async () => undefined,
  };
}

const { ensureWorkspace, runCommand } = await import("./agent/sandbox");
const { startCloudSandboxForTests, useSandboxFactory } = await import("./agent/e2b");
useSandboxFactory(async taskId => fakeSandbox(taskId));
startCloudSandboxForTests();
const { detectVerificationCommands, runAgentLoop, runWork } = await import("./agent/runner");
const { jobKind } = await import("./agent/jobs");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
async function setup(files: Record<string, string> = {}) {
  const { RecoveryEngine, ToolFailureWatch } = await import("./agent/recovery");
  const { workspaceManifest } = await import("./agent/artifacts");
  const { getModel } = await import("../shared/agent");
  const taskId = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const root = ensureWorkspace(taskId);
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(root, file), content);
  const events: any[] = [];
  const controller = new AbortController();
  const ctx: any = {
    taskId, runId: "run1", runToken: "run1", root, mode: "agent", effort: "medium", webSearch: false, spec: getModel("claude-sonnet-5-5"), operator: true,
    emit: (event: unknown) => events.push(event), signal: controller.signal, phases: { advance: vi.fn(), set: vi.fn(), get: () => "pending", finish: vi.fn() },
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, changedFiles: new Set(), agentVerifyCommands: [], manifest: workspaceManifest(root), attached: new Map(), images: new Map(),
    context: "", github: false, flags: { noEager: false, noThinking: false, noEffort: false }, toolWatch: new ToolFailureWatch(), persist: () => undefined, outcome: { verification: "none" },
    grants: {}, failedPublishing: new Set(), taskModel: "claude-sonnet-5-5", publishing: { count: 0 }, spendable: async () => null, canSpend: async () => true, chargeCredits: () => undefined,
    ...runWork(root, controller.signal),
  };
  ctx.recovery = new RecoveryEngine({ signal: ctx.signal, format: "anthropic", conversation: [], spec: ctx.spec, flags: ctx.flags, switchModel: () => undefined, persist: () => undefined, emit: () => undefined });
  model.turns = 0;
  model.calls.length = 0;
  return { ctx, root, events, controller, taskId };
}

const use = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: "tool_use", id, name, input });
const say = (text: string): Block[] => [{ type: "text", text }];
/** The result the model got for one of its tool calls. */
function resultOf(messages: Message[], id: string) {
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    const block = (message.content as Record<string, any>[]).find(part => part.type === "tool_result" && part.tool_use_id === id);
    if (block) return { error: Boolean(block.is_error), text: typeof block.content === "string" ? block.content : block.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") };
  }
  throw new Error(`no result for ${id}`);
}
const dead = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };

describe("background commands", () => {
  it("knows which commands to run in the background", () => {
    for (const command of ["npm run dev", "pnpm dev -- --port 3000", "npx vite --host", "vite", "next dev", "python3 -m http.server 8000", "python3 -u -m http.server", "uvicorn main:app --reload", "node server.js", "cd web && npm start", "tsc --watch"]) expect(jobKind(command), command).toBe("server");
    for (const command of ["npm install", "npm i", "npm ci", "pnpm add zod", "npm run build", "npx vite build", "vite build", "next build", "pip install -r requirements.txt", "python3 -m pip install flask", "sudo apt-get install -y ffmpeg", "apt-get update", "npm create vite@latest app -- --template react", "npx -y create-next-app@latest web", "git clone https://github.com/a/b", "curl -sSLo out.zip https://x.test/y.zip", "wget https://x.test/y.tar.gz", "cargo build --release"]) expect(jobKind(command), command).toBe("task");
    for (const command of ["npm test", "npm run test", "npx tsc --noEmit", "ls -la", "cat package.json", "git status", "node -e 'console.log(1)'", "npm info react", "curl -s https://api.example.com", "python3 script.py", "node scripts/build-app.js"]) expect(jobKind(command), command).toBeNull();
  });

  it("returns at once with a token, lets the agent work meanwhile, reports the end and syncs the files back", { timeout: 30_000 }, async () => {
    const { ctx, root, events } = await setup();
    model.script = turn => turn === 1 ? [use("t1", "run_command", { command: "sleep 3; echo built; echo ok > built.txt", background: true })]
      : turn === 2 ? [use("t2", "write_file", { path: "notes.md", content: "# Notes\n" })]
        : turn === 3 ? [use("t3", "command_status", { wait_sec: 20 })]
          : say("Done.");
    const result = await runAgentLoop(ctx, [{ role: "user", content: "Build it." }]);
    expect(result.text).toBe("Done.");
    expect(model.calls[0].tools).toEqual(expect.arrayContaining(["run_command", "command_status", "stop_command"]));
    const started = resultOf(model.calls[1].messages, "t1");
    expect(started.error).toBe(false);
    expect(started.text).toMatch(/^Running in the background as bg-[0-9a-f]{4}/);
    const id = started.text.match(/bg-[0-9a-f]{4}/)![0];
    expect(resultOf(model.calls[3].messages, "t3").text).toContain(`${id} \`sleep 3; echo built; echo ok > built.txt\` finished after`);
    // Its card: output streamed into it, and its one result came when it ended.
    expect(events.filter(event => event.type === "tool_result" && event.callId === "t1")).toEqual([expect.objectContaining({ ok: true, exitCode: 0, summary: "exit code 0" })]);
    expect(events.filter(event => event.type === "tool_output" && event.callId === "t1").map(event => event.chunk).join("")).toContain("built");
    expect(fs.readFileSync(path.join(root, "built.txt"), "utf8")).toBe("ok\n");
    expect(ctx.jobs.running()).toHaveLength(0);
  });

  it("answers a slow-looking command that finishes quickly like any other", async () => {
    const { ctx, events } = await setup();
    model.script = turn => turn === 1 ? [use("q1", "run_command", { command: "echo fetched # git clone https://example.test/repo" })] : say("Done.");
    await runAgentLoop(ctx, [{ role: "user", content: "Clone it." }]);
    expect(resultOf(model.calls[1].messages, "q1").text).toMatch(/^fetched[^]*\[exit code 0, \d+ ms\]$/);
    expect(events.filter(event => event.type === "tool_result" && event.callId === "q1")).toHaveLength(1);
  });

  it("sends a background command that failed after the agent finished back to it, with its error lines", { timeout: 30_000 }, async () => {
    const { ctx, events } = await setup();
    model.script = turn => turn === 1 ? [use("f1", "run_command", { command: "sleep 3; echo 'src/app.js:3:7 error: boom' >&2; exit 2", background: true })]
      : turn === 2 ? say("All done.")
        : say("Fixed it.");
    const result = await runAgentLoop(ctx, [{ role: "user", content: "Build it." }]);
    expect(result.text).toBe("Fixed it.");
    const heal = String(model.calls[2].messages.at(-1)!.content);
    expect(heal).toContain("A command you started in the background failed");
    expect(heal).toContain("[exit code 2]");
    expect(heal).toContain("src/app.js:3:7 error: boom");
    expect(events.some(event => event.type === "notice" && /^Waiting for a background command before checking the work: bg-/.test(event.message))).toBe(true);
    expect(events.filter(event => event.type === "heal").map(event => event.iteration)).toEqual([1]);
  });

  it("stops a dev server when the agent finishes, with everything it started", { timeout: 30_000 }, async () => {
    const server = `require("http").createServer((q, s) => s.end("hi")).listen(0, "127.0.0.1", function () { require("fs").writeFileSync("server.pid", String(process.pid)); console.log("listening on http://localhost:" + this.address().port); });`;
    const { ctx, root, events } = await setup({ "server.js": server });
    model.script = turn => turn === 1 ? [use("s1", "run_command", { command: "sleep 600 & echo $! > sleeper.pid; node server.js" })] : say("Server checked.");
    await runAgentLoop(ctx, [{ role: "user", content: "Start it." }]);
    // Back as soon as it said it was up, not after the whole allowance.
    expect(resultOf(model.calls[1].messages, "s1").text).toMatch(/^Running in the background as bg-[0-9a-f]{4} \(started [0-7] s ago; it stops by itself when this run ends\)[^]*listening on http:\/\/localhost:\d+/);
    expect(events.filter(event => event.type === "tool_result" && event.callId === "s1")).toEqual([expect.objectContaining({ ok: false, summary: "stopped" })]);
    expect(events.some(event => event.type === "notice" && /^Waiting for/.test(event.message))).toBe(false);
    const pids = ["server.pid", "sleeper.pid"].map(file => Number(fs.readFileSync(path.join(root, file), "utf8")));
    await vi.waitFor(() => expect(pids.filter(dead)).toEqual(pids), { timeout: 5000, interval: 100 });
  });

  it("stops every background command when the run is stopped", { timeout: 30_000 }, async () => {
    const { ctx, controller, events } = await setup();
    model.script = turn => turn === 1 ? [use("c1", "run_command", { command: "sleep 120", background: true })] : turn === 2 ? [use("c2", "run_command", { command: "sleep 120", background: true })] : say("Waiting.");
    const loop = runAgentLoop(ctx, [{ role: "user", content: "Go." }]).catch(error => error);
    await vi.waitFor(() => expect(ctx.jobs.running()).toHaveLength(2), { timeout: 10_000, interval: 50 });
    controller.abort();
    await loop;
    await vi.waitFor(() => expect(ctx.jobs.running()).toHaveLength(0), { timeout: 10_000, interval: 50 });
    expect(ctx.jobs.list().map((job: any) => job.state)).toEqual(["stopped", "stopped"]);
    expect(events.filter(event => event.type === "tool_result" && ["c1", "c2"].includes(event.callId)).map(event => event.summary)).toEqual(["stopped", "stopped"]);
  });

  it("runs at most three at a time and keeps the sandbox alive as long as the longest one needs", { timeout: 30_000 }, async () => {
    const { ctx, root, taskId } = await setup();
    const up = new Set<string>();
    const spec = (callId: string) => ({ command: "echo up; sleep 60", kind: "server" as const, timeoutSec: 1800, callId, emit: (event: any) => { if (event.type === "tool_output") up.add(event.callId); } });
    const started = ["a", "b", "c"].map(callId => ctx.jobs.start(spec(callId)));
    expect(started.every((job: unknown) => typeof job === "object")).toBe(true);
    expect(ctx.jobs.start(spec("d"))).toMatch(/^3 background commands are already running/);
    await vi.waitFor(() => expect(up.size).toBe(3), { timeout: 10_000, interval: 50 });
    await runCommand({ root, command: "true", timeoutSec: 30, onOutput: () => undefined });
    expect(fakes.get(taskId)!.keepAlive.at(-1)).toBeGreaterThan(1_800_000);
    await ctx.jobs.stopAll("test over");
    expect(ctx.jobs.running()).toHaveLength(0);
  });
});

describe("the harness's checks", () => {
  it("doesn't run again a check the agent passed after its last change, and counts changes made by commands", { timeout: 30_000 }, async () => {
    const { ctx, events } = await setup({ "package.json": JSON.stringify({ name: "t", scripts: { test: "node test.js" } }), "test.js": "require('assert').equal(1 + 1, 2);\n" });
    model.script = turn => turn === 1 ? [use("c1", "run_command", { command: "printf 'exports.add = (a, b) => a + b;\\n' > add.js" })]
      : turn === 2 ? [use("c2", "run_command", { command: "node --test test.js" })]
        : say("Tests pass.");
    await runAgentLoop(ctx, [{ role: "user", content: "Add add.js." }]);
    expect(events.filter(event => event.type === "verify_result").map(event => [event.command, event.ok, event.durationMs === 0])).toEqual([["npm run --silent test", true, false], ["node --test test.js", true, true]]);
    expect(ctx.outcome.verification).toBe("passed");
  });

  it("runs the agent's check again once something changed after it", { timeout: 30_000 }, async () => {
    const { ctx, events } = await setup({ "test.js": "require('assert').equal(1 + 1, 2);\n" });
    model.script = turn => turn === 1 ? [use("c1", "run_command", { command: "node --test test.js" })]
      : turn === 2 ? [use("c2", "write_file", { path: "add.js", content: "exports.add = (a, b) => a + b;\n" })]
        : say("Done.");
    await runAgentLoop(ctx, [{ role: "user", content: "Add add.js." }]);
    const checks = events.filter(event => event.type === "verify_result");
    expect(checks.find(event => event.command === "node --test test.js")).toMatchObject({ ok: true });
    expect(checks.find(event => event.command === "node --test test.js")!.durationMs).toBeGreaterThan(0);
  });

  it("won't let write_file replace a file that was there before the run until the agent has read it", { timeout: 30_000 }, async () => {
    const { ctx, root } = await setup({ "app.js": "const keep = 1;\n" });
    model.script = turn => turn === 1 ? [use("w1", "write_file", { path: "app.js", content: "const replaced = 2;\n" }), use("w2", "write_file", { path: "new.js", content: "1;\n" })]
      : turn === 2 ? [use("r1", "read_file", { path: "app.js" })]
        : turn === 3 ? [use("w3", "write_file", { path: "app.js", content: "const replaced = 2;\n" }), use("w4", "write_file", { path: "new.js", content: "2;\n" })]
          : say("Done.");
    await runAgentLoop(ctx, [{ role: "user", content: "Rewrite app.js." }]);
    const refused = resultOf(model.calls[1].messages, "w1");
    expect(refused).toMatchObject({ error: true });
    expect(refused.text).toContain("app.js was in the workspace before this run and you haven't read it");
    expect(resultOf(model.calls[1].messages, "w2").error).toBe(false);
    expect(resultOf(model.calls[3].messages, "w3").error).toBe(false);
    expect(resultOf(model.calls[3].messages, "w4").error).toBe(false);
    expect(fs.readFileSync(path.join(root, "app.js"), "utf8")).toBe("const replaced = 2;\n");
  });

  it("falls back to the build, then to syntax checks of the changed files, and installs only what the sandbox lacks", () => {
    const dir = fs.mkdtempSync(path.join(tmp, "detect-"));
    const write = (file: string, content: string) => fs.writeFileSync(path.join(dir, file), content);
    write("package.json", JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "^7" } }));
    expect(detectVerificationCommands(dir, new Set(["src/main.js"]), [])).toEqual(["{ [ node_modules/.package-lock.json -nt package.json ] || npm install --no-audit --no-fund --loglevel=error; } && npm run --silent build"]);
    write("package.json", JSON.stringify({ scripts: { test: "vitest run", build: "vite build" }, devDependencies: { vitest: "^2" } }));
    expect(detectVerificationCommands(dir, new Set(), [])).toEqual(["{ [ node_modules/.package-lock.json -nt package.json ] || npm install --no-audit --no-fund --loglevel=error; } && npm run --silent test"]);
    fs.rmSync(path.join(dir, "package.json"));
    write("plain.js", "document.title = 'x';\n");
    write("module.js", "import x from './x.js';\nexport default x;\n");
    write("view.js", "const App = () => (<div>hi</div>);\n");
    write("data.json", "{}");
    write("tsconfig.json", "{ // comments allowed\n}");
    write("run.sh", "echo hi\n");
    const changed = new Set(["plain.js", "module.js", "view.js", "data.json", "tsconfig.json", "run.sh", "gone.js"]);
    const commands = detectVerificationCommands(dir, changed, []);
    expect(commands).toHaveLength(3);
    expect(commands[0]).toBe("for f in './plain.js'; do node --check \"$f\" || exit 1; done");
    expect(commands[1]).toMatch(/^node -e '.*' '.\/data.json'$/);
    expect(commands[2]).toBe("for f in './run.sh'; do bash -n \"$f\" || exit 1; done");
    // They pass on good files and fail on broken ones.
    const check = (command: string) => spawnSync("bash", ["-c", command], { cwd: dir, encoding: "utf8" }).status;
    expect(commands.map(check)).toEqual([0, 0, 0]);
    write("plain.js", "document.title = ;\n");
    write("data.json", "{ \"a\": 1, }");
    write("run.sh", "if then\n");
    expect(commands.map(check)).toEqual([1, 1, 1]);
  });
});
