import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Commands run one at a time. A run cancelled while its command waits behind another task's command
// gets its answer at once, and that command never starts.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-sandbox-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

const spawned = vi.hoisted(() => ({ commands: [] as string[] }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: ((file: string, args: readonly string[], options: object) => {
      spawned.commands.push(String(args.at(-1)));
      return actual.spawn(file, args, options);
    }) as typeof actual.spawn,
  };
});

const { runCommand } = await import("./agent/sandbox");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "task");
fs.mkdirSync(root, { recursive: true });
const run = (command: string, signal?: AbortSignal, timeoutSec = 30) => runCommand({ root, command, timeoutSec, signal, onOutput: () => undefined });

describe("command queue", () => {
  it("answers a queued command that is cancelled at once, and never starts it", async () => {
    const slow = run("sleep 1.5; echo slow-done");
    const controller = new AbortController();
    const queued = run("touch queued-ran", controller.signal);
    await new Promise(resolve => setTimeout(resolve, 100));
    const started = Date.now();
    controller.abort();
    const result = await queued;
    expect(Date.now() - started).toBeLessThan(500);
    expect(result).toEqual({ exitCode: null, timedOut: false, output: "Cancelled before it started.", durationMs: 0 });
    const first = await slow;
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain("slow-done");
    // The queue moved on, and the cancelled command was never spawned.
    expect((await run("echo after")).output).toContain("after");
    expect(fs.existsSync(path.join(root, "queued-ran"))).toBe(false);
    expect(spawned.commands).not.toContain("touch queued-ran");
  });

  it("answers an already-cancelled command immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await run("touch never-ran", controller.signal);
    expect(result.output).toBe("Cancelled before it started.");
    expect(spawned.commands).not.toContain("touch never-ran");
    expect(fs.existsSync(path.join(root, "never-ran"))).toBe(false);
  });

  it("answers a command that cannot be started instead of hanging the queue", async () => {
    // A NUL byte makes spawn throw synchronously; the caller must still get a result.
    const result = await Promise.race([run("echo a\u0000b"), new Promise(resolve => setTimeout(() => resolve("hung"), 3000))]);
    expect(result).toMatchObject({ exitCode: null, timedOut: false });
    expect((result as { output: string }).output).toMatch(/^Failed to start command/);
    expect((await run("echo still-working")).output).toContain("still-working");
  });

  it("strips NUL bytes from command output", async () => {
    const result = await run("printf 'a\\000b'");
    expect(result.output).toBe("ab");
  });
});
