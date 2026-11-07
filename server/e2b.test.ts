import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxNotFoundError, TimeoutError } from "e2b";
import type { RemoteBox } from "./agent/e2b";

// The cloud sandbox runtime: what reaches the sandbox before a command, what comes back after it,
// and what never moves. The sandbox is faked with a folder and real bash, so commands, listings and
// session cleanup behave as they do remotely.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-e2b-"));
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "workspaces");
process.env.AGENT_SANDBOX = "e2b";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });

const { runCommand, workspacePath, ensureWorkspace, removeWorkspace, refreshWorkspace, sandboxPortHost } = await import("./agent/sandbox");
const { parseScan, startCloudSandboxForTests, useSandboxFactory, waitWithin } = await import("./agent/e2b");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const REMOTE = "/home/user/workspace";
type Fake = { dir: string; killed: boolean; created: number };
const fakes = new Map<string, Fake>();

function fakeSandbox(taskId: string): RemoteBox {
  const previous = fakes.get(taskId);
  const fake: Fake = { dir: fs.mkdtempSync(path.join(tmp, "remote-")), killed: false, created: (previous?.created ?? 0) + 1 };
  fakes.set(taskId, fake);
  const local = (text: string) => text.split(REMOTE).join(fake.dir);
  const gone = () => { if (fake.killed) throw new SandboxNotFoundError("sandbox not found"); };
  return {
    id: `fake-${fake.created}`,
    keepAlive: async () => gone(),
    start: async (command, opts) => {
      gone();
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
      gone();
      const result = spawnSync("bash", ["-c", local(command)], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
      return result.stdout;
    },
    write: async files => {
      gone();
      for (const file of files) {
        fs.mkdirSync(path.dirname(local(file.path)), { recursive: true });
        fs.writeFileSync(local(file.path), file.data);
      }
    },
    read: async file => { gone(); return fs.readFileSync(local(file)); },
    host: port => `${port}-${taskId.slice(0, 8)}.sandbox.test`,
    kill: async () => { fake.killed = true; },
  };
}

useSandboxFactory(async taskId => fakeSandbox(taskId));
startCloudSandboxForTests();

let counter = 0;
function task(files: Record<string, string> = {}) {
  const id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const root = ensureWorkspace(id);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return { id, root, remote: () => fakes.get(id)!.dir };
}
const run = (root: string, command: string, extra: Partial<Parameters<typeof runCommand>[0]> = {}) => {
  const streamed: string[] = [];
  return runCommand({ root, command, timeoutSec: 30, onOutput: (_stream, chunk) => streamed.push(chunk), ...extra }).then(result => ({ ...result, streamed: streamed.join("") }));
};
const exists = (file: string) => fs.existsSync(file);

beforeEach(() => fakes.clear());

describe("cloud sandbox sync", () => {
  it("uploads the sources first, runs in the sandbox, and brings back what the command created, changed and deleted", async () => {
    const { root, remote } = task({ "package.json": "{}", "src/old.txt": "old", "src/keep.txt": "v1", "node_modules/x/index.js": "dep" });
    const result = await run(root, "test -f package.json && test ! -e node_modules && pwd && mkdir -p dist && echo built > dist/index.html && rm src/old.txt && echo v2 > src/keep.txt");
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe(remote());
    expect(fs.readFileSync(path.join(root, "dist/index.html"), "utf8")).toBe("built\n");
    expect(fs.readFileSync(path.join(root, "src/keep.txt"), "utf8")).toBe("v2\n");
    expect(exists(path.join(root, "src/old.txt"))).toBe(false);
    // Dependencies installed here before the switch stay here and never travel.
    expect(exists(path.join(root, "node_modules/x/index.js"))).toBe(true);
  });

  it("uploads edits made between commands, and the sandbox's deletions of them", async () => {
    const { root } = task({ "a.txt": "one" });
    await run(root, "true");
    fs.writeFileSync(path.join(root, "a.txt"), "two");
    fs.writeFileSync(path.join(root, "b.txt"), "new");
    expect((await run(root, "cat a.txt b.txt")).output).toBe("twonew");
    fs.rmSync(path.join(root, "b.txt"));
    expect((await run(root, "ls")).output.trim().split("\n")).toEqual(["a.txt"]);
  });

  it("never brings back dependencies or the repository's history, but uploads the history once", async () => {
    const { root } = task({ ".git/HEAD": "ref: refs/heads/main\n", "index.js": "x" });
    const result = await run(root, "cat .git/HEAD && mkdir -p node_modules/pkg .git/objects && echo dep > node_modules/pkg/i.js && echo obj > .git/objects/ab && echo log > .git/COMMIT_EDITMSG");
    expect(result.output).toBe("ref: refs/heads/main\n");
    expect(exists(path.join(root, "node_modules"))).toBe(false);
    expect(exists(path.join(root, ".git/objects/ab"))).toBe(false);
    expect(exists(path.join(root, ".git/COMMIT_EDITMSG"))).toBe(false);
  });

  // A repository cloned into a sub-folder (the root held attachments/) syncs like one at the root.
  const NESTED = { "attachments/a.png": "x", "muzu-new/.git/HEAD": "ref: refs/heads/main\n", "muzu-new/.git/config": "[core]\n", "muzu-new/src/a.kt": "a", "muzu-new/README.md": "r" };

  it("mirrors a deleted clone folder whole, history included, so no folder of history alone is left", async () => {
    const { root, remote } = task(NESTED);
    expect((await run(root, "rm -rf muzu-new && ls")).output).toBe("attachments\n");
    // A folder holding only its history would read as every file deleted (a push would delete them all).
    expect(exists(path.join(root, "muzu-new"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "attachments/a.png"), "utf8")).toBe("x");
    expect((await run(root, "test -e muzu-new || echo gone")).output).toBe("gone\n");
    expect(exists(path.join(remote(), "muzu-new"))).toBe(false);
  });

  it("gives the history back to the sandbox when only .git was deleted, also to a replacement sandbox", async () => {
    const { id, root } = task(NESTED);
    await run(root, "rm -rf muzu-new/.git");
    // Kept here (git there would fail without it, and the sandbox can't fetch it), and uploaded again.
    expect(fs.readFileSync(path.join(root, "muzu-new/.git/HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect((await run(root, "cat muzu-new/.git/HEAD")).output).toBe("ref: refs/heads/main\n");
    fakes.get(id)!.killed = true;
    expect((await run(root, "test -f muzu-new/.git/HEAD && cat muzu-new/src/a.kt")).output).toBe("a");
    expect(fakes.get(id)!.created).toBe(2);
  });

  it("moves a renamed clone's sources and drops its history at the old place", async () => {
    const { root } = task(NESTED);
    await run(root, "mv muzu-new app");
    expect(fs.readFileSync(path.join(root, "app/src/a.kt"), "utf8")).toBe("a");
    expect(exists(path.join(root, "muzu-new"))).toBe(false);
    // The new folder's history stays in the sandbox (history never comes back here).
    expect(exists(path.join(root, "app/.git"))).toBe(false);
  });

  it("never brings back a nested repository's history", async () => {
    const { root } = task(NESTED);
    await run(root, "echo x >> muzu-new/.git/config && mkdir -p muzu-new/.git/objects/ab && echo o > muzu-new/.git/objects/ab/cd && echo b > muzu-new/b.kt");
    expect(fs.readFileSync(path.join(root, "muzu-new/.git/config"), "utf8")).toBe("[core]\n");
    expect(exists(path.join(root, "muzu-new/.git/objects/ab/cd"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "muzu-new/b.kt"), "utf8")).toBe("b\n");
  });

  it("keeps the server's pack when the sandbox repacks a nested repository past the pull limit", async () => {
    const { root } = task({ ...NESTED, "muzu-new/.git/objects/pack/p.pack": "pack" });
    const result = await run(root, "head -c 9000000 /dev/zero > muzu-new/.git/objects/pack/new.pack && rm muzu-new/.git/objects/pack/p.pack");
    expect(fs.readFileSync(path.join(root, "muzu-new/.git/objects/pack/p.pack"), "utf8")).toBe("pack");
    expect(exists(path.join(root, "muzu-new/.git/objects/pack/new.pack"))).toBe(false);
    // History files are never offered back, so they are never "kept only in the sandbox" either.
    expect(result.output).not.toContain("Kept only in the sandbox");
  });

  it("still syncs files that only look like history (.github, .gitignore, .gitkeep, x.git)", async () => {
    const { root } = task();
    const files = [".github/workflows/ci.yml", "repo/.gitignore", "repo/.gitattributes", "a/.gitkeep", "x.git/f", "repo/.gitmodules"];
    await run(root, files.map(file => `mkdir -p "$(dirname ${file})" && echo y > ${file}`).join(" && "));
    for (const file of files) expect(fs.readFileSync(path.join(root, file), "utf8")).toBe("y\n");
    await run(root, `rm ${files.join(" ")}`);
    for (const file of files) expect(exists(path.join(root, file))).toBe(false);
  });

  it("gives uploaded files their executable bit back", async () => {
    const { root } = task({ gradlew: "#!/bin/sh\necho built\n", "notes.txt": "n" });
    fs.chmodSync(path.join(root, "gradlew"), 0o755);
    expect((await run(root, "./gradlew && test ! -x notes.txt && echo plain")).output).toBe("built\nplain\n");
  });

  it.skipIf(process.getuid?.() === 0)("does not delete local files when a sandbox folder can't be listed", async () => {
    const { root, remote } = task({ "secret/a.txt": "a", "b.txt": "b" });
    await run(root, "true");
    fs.chmodSync(path.join(remote(), "secret"), 0o000);
    try {
      await run(root, "echo c > c.txt");
      expect(fs.readFileSync(path.join(root, "secret/a.txt"), "utf8")).toBe("a");
      expect(fs.readFileSync(path.join(root, "c.txt"), "utf8")).toBe("c\n");
    } finally {
      fs.chmodSync(path.join(remote(), "secret"), 0o755);
    }
  });

  it("keeps files that are too large in the sandbox, says so once, and keeps going", async () => {
    const { root } = task();
    const first = await run(root, "head -c 9000000 /dev/zero > big.bin && echo small > small.txt");
    expect(first.output).toContain("Kept only in the sandbox (too large to bring back to the workspace): big.bin.");
    expect(exists(path.join(root, "big.bin"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "small.txt"), "utf8")).toBe("small\n");
    expect((await run(root, "echo again > small.txt")).output).not.toContain("big.bin");
  });

  it("uploads but brings nothing back in push mode, and moves nothing in none mode", async () => {
    const { root, remote } = task({ "a.txt": "a" });
    expect((await run(root, "cat a.txt; echo x > made.txt", { sync: "push" })).output).toBe("a");
    expect(exists(path.join(root, "made.txt"))).toBe(false);
    fs.writeFileSync(path.join(root, "late.txt"), "late");
    await run(root, "true", { sync: "none" });
    expect(exists(path.join(remote(), "late.txt"))).toBe(false);
    // The next full sync catches up both ways.
    await run(root, "true");
    expect(exists(path.join(remote(), "late.txt"))).toBe(true);
    expect(exists(path.join(root, "made.txt"))).toBe(true);
  });

  it("stops what a command leaves running in the background", async () => {
    const { root, remote } = task();
    await run(root, "(sleep 1; touch late) >/dev/null 2>&1 & echo started");
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(exists(path.join(remote(), "late"))).toBe(false);
  });

  it("replaces a sandbox that stopped, uploading the workspace again", async () => {
    const { id, root } = task({ "a.txt": "a" });
    await run(root, "echo dep > installed.txt");
    fakes.get(id)!.killed = true;
    const result = await run(root, "cat a.txt installed.txt");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("adep\n");
    expect(fakes.get(id)!.created).toBe(2);
  });

  it("reports a timeout and a cancel", async () => {
    const { root } = task();
    const slow = await run(root, "sleep 20", { timeoutSec: 5 });
    expect(slow).toMatchObject({ exitCode: 124, timedOut: true });
    const controller = new AbortController();
    const pending = run(root, "sleep 20", { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    expect(await pending).toMatchObject({ exitCode: null, timedOut: false });
  }, 20_000);

  it("keeps NUL bytes for raw output and never mixes sync notes into it", async () => {
    const { root } = task();
    const result = await run(root, "head -c 9000000 /dev/zero > big.bin; printf 'a\\0b\\0'", { raw: true });
    expect(result.output).toBe("a\u0000b\u0000");
    expect(result.streamed).toContain("Kept only in the sandbox");
  });

  it("refreshes the local copy on demand, exposes port hosts, and stops the sandbox with the workspace", async () => {
    const { id, root, remote } = task();
    expect(sandboxPortHost(id, 4173)).toBeNull();
    await run(root, "true");
    expect(sandboxPortHost(id, 4173)).toBe(`4173-${id.slice(0, 8)}.sandbox.test`);
    fs.writeFileSync(path.join(remote(), "from-background.txt"), "bg");
    await refreshWorkspace(root);
    expect(fs.readFileSync(path.join(root, "from-background.txt"), "utf8")).toBe("bg");
    removeWorkspace(id);
    expect(fakes.get(id)!.killed).toBe(true);
    expect(exists(workspacePath(id))).toBe(false);
  });
});

describe("parseScan", () => {
  it("gives up on a command whose end never arrives, past its limit and a grace period", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = waitWithin({ wait: () => new Promise<number>(() => undefined) }, 35_000);
      await vi.advanceTimersByTimeAsync(34_999);
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe("overdue");
      expect(await waitWithin({ wait: async () => 3 }, 35_000)).toBe(3);
      await expect(waitWithin({ wait: async () => { throw new TimeoutError("command timed out"); } }, 35_000)).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads NUL-separated records, keeps tabs in names, and flags a failed listing as partial", () => {
    const ok = parseScan("5\t1793187217.5\ta.txt\u00003\t1793187218.25\tdir/b\tc.txt\u0000\n__find_exit=0");
    expect([...ok.files.keys()]).toEqual(["a.txt", "dir/b\tc.txt"]);
    expect(ok.files.get("a.txt")).toEqual({ size: 5, sig: "5:1793187217.5" });
    expect(ok.partial).toBe(false);
    expect(parseScan("5\t1.0\ta.txt\u0000\n__find_exit=1").partial).toBe(true);
    expect(parseScan("5\t1.0\ta.txt\u0000").partial).toBe(true);
  });
});
