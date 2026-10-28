import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Each task gets its own directory under WORKSPACE_ROOT. Commands run as the
// unprivileged sandbox user inside a transient systemd scope (memory/CPU/task limits,
// killed as a unit afterwards). File tools run in this process, so every path is
// resolved through realpath and confined to the workspace to defeat symlink escapes.

export const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT || "/srv/curialy-workspaces";
const SANDBOX_USER = process.env.AGENT_SANDBOX_USER || "curialy-agent";
// "systemd" (production) or "none" (local development without the sandbox user).
const SANDBOX_MODE = process.env.AGENT_SANDBOX === "none" ? "none" : "systemd";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class SandboxError extends Error {}

export function workspacePath(taskId: string) {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(taskId)) throw new SandboxError("Invalid task id.");
  return path.join(WORKSPACE_ROOT, taskId);
}

export function ensureWorkspace(taskId: string) {
  const dir = workspacePath(taskId);
  if (fs.existsSync(dir)) return dir;
  if (SANDBOX_MODE === "systemd") {
    const result = spawnSync("sudo", ["-n", "install", "-d", "-o", SANDBOX_USER, "-g", SANDBOX_USER, "-m", "2775", dir], { encoding: "utf8" });
    if (result.status !== 0) throw new SandboxError(`Could not create workspace: ${result.stderr.trim()}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function isInside(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Resolve a model-supplied path inside the workspace. Rejects traversal and symlinks pointing outside. */
export function resolveInWorkspace(root: string, requested: string) {
  if (typeof requested !== "string" || requested.includes("\0")) throw new SandboxError("Invalid path.");
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, requested.replace(/^\/+/, ""));
  if (!isInside(realRoot, target)) throw new SandboxError(`Path escapes the workspace: ${requested}`);
  // Walk up to the deepest existing ancestor and make sure its real location is still inside.
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (!isInside(realRoot, realProbe)) throw new SandboxError(`Path resolves outside the workspace: ${requested}`);
  return { absolute: probe === target ? realProbe : path.join(realProbe, path.relative(probe, target)), relative: path.relative(realRoot, target) || "." };
}

export function readWorkspaceFile(root: string, requested: string) {
  const { absolute, relative } = resolveInWorkspace(root, requested);
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return { exists: false as const, relative, absolute };
  if (!stat.isFile()) throw new SandboxError(`${relative} is not a regular file.`);
  if (stat.size > MAX_FILE_BYTES) throw new SandboxError(`${relative} is larger than ${MAX_FILE_BYTES} bytes.`);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    return { exists: true as const, relative, absolute, content: fs.readFileSync(fd, "utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

export function writeWorkspaceFile(root: string, requested: string, content: string) {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new SandboxError(`Refusing to write more than ${MAX_FILE_BYTES} bytes.`);
  const { absolute, relative } = resolveInWorkspace(root, requested);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o2775 });
  // Re-check after mkdir in case an intermediate directory was swapped for a symlink.
  resolveInWorkspace(root, requested);
  const fd = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o664);
  try {
    fs.writeFileSync(fd, content, "utf8");
  } finally {
    fs.closeSync(fd);
  }
  return { absolute, relative };
}

export function writeWorkspaceBytes(root: string, requested: string, content: Buffer, maxBytes = MAX_FILE_BYTES * 4) {
  if (content.length > maxBytes) throw new SandboxError(`Refusing to write more than ${maxBytes} bytes.`);
  const { absolute, relative } = resolveInWorkspace(root, requested);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o2775 });
  resolveInWorkspace(root, requested);
  const fd = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o664);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  return { absolute, relative };
}

/** Remove a task's scratch directory with the sandbox user's privileges (it owns files created by commands). */
export function removeWorkspace(taskId: string) {
  const dir = workspacePath(taskId);
  if (!fs.existsSync(dir) || path.dirname(dir) !== WORKSPACE_ROOT) return;
  if (SANDBOX_MODE === "systemd") spawnSync("sudo", ["-n", "-u", SANDBOX_USER, "rm", "-rf", "--", dir], { stdio: "ignore" });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Let the app (a member of the sandbox group) read what the agent's commands wrote: some tools
 * create owner-only files and folders, which the archive, an export or a deploy could not read.
 * Runs as the sandbox user, which owns them, and leaves `skipDirs` (caches, dependencies) alone.
 * Best effort: anything still unreadable makes the caller fail, so nothing is left out silently.
 */
export function shareWorkspaceFiles(root: string, skipDirs: Iterable<string>) {
  if (SANDBOX_MODE !== "systemd" || path.dirname(root) !== WORKSPACE_ROOT || !fs.existsSync(root)) return Promise.resolve();
  const prune = [...skipDirs].flatMap(name => ["-type", "d", "-name", name, "-prune", "-o"]);
  const unreadable = ["(", "-type", "d", "!", "-perm", "-0050", "-o", "-type", "f", "!", "-perm", "-0040", ")"];
  return new Promise<void>(resolve => {
    // Started inside the workspace: find can't run its -exec from a directory the sandbox user can't enter (the app's).
    const child = spawn("sudo", ["-n", "-u", SANDBOX_USER, "timeout", "60", "find", root, ...prune, ...unreadable, "-exec", "chmod", "g+rX", "--", "{}", "+"], { cwd: root, stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

export function copyIntoWorkspace(root: string, source: string, requested: string) {
  const { absolute } = resolveInWorkspace(root, requested);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o2775 });
  fs.copyFileSync(source, absolute, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(absolute, 0o664);
}

export function deleteWorkspaceFile(root: string, requested: string) {
  const { absolute, relative } = resolveInWorkspace(root, requested);
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new SandboxError(`${relative} is not a regular file.`);
  fs.unlinkSync(absolute);
  return { relative };
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".venv", "venv", ".cache"]);

export type TreeEntry = { path: string; type: "file" | "dir"; size: number };

export function listWorkspaceTree(root: string, sub = ".", maxDepth = 4, limit = 800): TreeEntry[] {
  const { absolute } = resolveInWorkspace(root, sub);
  const realRoot = fs.realpathSync(root);
  const out: TreeEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(realRoot, full);
      if (entry.isDirectory()) {
        out.push({ path: rel, type: "dir", size: 0 });
        if (!IGNORED_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push({ path: rel, type: "file", size: fs.statSync(full).size });
      }
    }
  };
  walk(absolute, 1);
  return out;
}

export type CommandResult = { exitCode: number | null; timedOut: boolean; output: string; durationMs: number };

// Commands share a single small VPS with production; run them one at a time.
let commandQueue: Promise<unknown> = Promise.resolve();
let commandCounter = 0;

export function runCommand(opts: {
  root: string;
  command: string;
  timeoutSec: number;
  signal?: AbortSignal;
  onOutput: (stream: "stdout" | "stderr", chunk: string) => void;
  /** Keep NUL bytes in `output` (machine-readable output such as git -z); streamed chunks are always clean. */
  raw?: boolean;
}): Promise<CommandResult> {
  // A run cancelled while its command waits behind another task's gets its answer at once (and the
  // command never starts), instead of waiting its turn in the queue.
  return new Promise<CommandResult>(resolve => {
    let settled = false;
    const cancelled = () => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, timedOut: false, output: "Cancelled before it started.", durationMs: 0 });
    };
    if (opts.signal?.aborted) return cancelled();
    opts.signal?.addEventListener("abort", cancelled, { once: true });
    commandQueue = commandQueue.then(async () => {
      opts.signal?.removeEventListener("abort", cancelled);
      if (settled) return;
      settled = true;
      // spawn throws synchronously on arguments it cannot pass (e.g. a NUL byte): answer, never hang the run.
      resolve(await runCommandNow(opts).catch(error => ({ exitCode: null, timedOut: false, output: `Failed to start command: ${error instanceof Error ? error.message : String(error)}`, durationMs: 0 })));
    }).catch(() => undefined);
  });
}

const OUTPUT_CAP = 400_000;

function runCommandNow({ root, command, timeoutSec, signal, onOutput, raw }: Parameters<typeof runCommand>[0]): Promise<CommandResult> {
  const started = Date.now();
  const timeout = Math.max(5, Math.min(600, Math.round(timeoutSec)));
  const unit = `curialy-agent-${process.pid}-${++commandCounter}-${Date.now()}`;
  const script = 'umask 002; cd -- "$1" || exit 97; eval "$2"';
  const shellArgs = ["/usr/bin/timeout", "--kill-after=5", `${timeout}s`, "/bin/bash", "-c", script, "curialy", root, command];
  // Repos fetched by the app are owned by the app user; let the sandbox's git operate on them.
  // Temporary files go into the workspace (swept with it), not the VPS-wide /tmp.
  const tmp = path.join(root, ".tmp");
  try {
    fs.mkdirSync(tmp, { recursive: true });
    fs.chmodSync(tmp, 0o2775); // the sandbox user writes here through the shared group (umask would strip it)
  } catch { /* the command reports a missing workspace itself */ }
  const env = ["HOME=/var/lib/curialy-agent", "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "CI=1", "TERM=dumb", "NO_COLOR=1", "npm_config_update_notifier=false", `TMPDIR=${tmp}`,
    "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=safe.directory", "GIT_CONFIG_VALUE_0=*", "GIT_TERMINAL_PROMPT=0"];
  const [file, args] = SANDBOX_MODE === "systemd"
    ? ["sudo", ["-n", "systemd-run", "--quiet", "--scope", "--collect", "--unit", unit, "--description=Curialy agent command",
        "-p", "MemoryMax=512M", "-p", "MemorySwapMax=512M", "-p", "TasksMax=256", "-p", "CPUQuota=150%",
        "--", "/usr/bin/setpriv", `--reuid=${SANDBOX_USER}`, `--regid=${SANDBOX_USER}`, "--init-groups", "--reset-env",
        "--", "/usr/bin/env", ...env, ...shellArgs]] as const
    : ["/usr/bin/env", [...env, ...shellArgs]] as const;

  return new Promise(resolve => {
    const child = spawn(file, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let streamed = 0;
    const capture = (stream: "stdout" | "stderr") => (data: Buffer) => {
      const text = data.toString("utf8");
      // NUL bytes (binary output) cannot be stored or shown as text; only raw callers keep them.
      const chunk = text.includes("\u0000") ? text.replace(/\u0000/g, "") : text;
      if (output.length < OUTPUT_CAP) output += raw ? text : chunk;
      if (streamed < OUTPUT_CAP) {
        streamed += chunk.length;
        onOutput(stream, chunk);
      }
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    const stopScope = () => {
      if (SANDBOX_MODE === "systemd") spawn("sudo", ["-n", "systemctl", "stop", `${unit}.scope`], { stdio: "ignore" }).on("error", () => undefined);
      else child.kill("SIGKILL");
    };
    const onAbort = () => stopScope();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.on("error", error => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: null, timedOut: false, output: `Failed to start command: ${error.message}`, durationMs: Date.now() - started });
    });
    child.on("close", code => {
      signal?.removeEventListener("abort", onAbort);
      // Background processes the command left behind die with the scope.
      stopScope();
      resolve({ exitCode: code, timedOut: code === 124 || code === 137, output, durationMs: Date.now() - started });
    });
  });
}

/** Keep the head and tail of long tool output so the model sees the error and the summary. */
export function clip(text: string, max = 24_000) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.35);
  return `${text.slice(0, head)}\n\n… [${text.length - max} characters omitted] …\n\n${text.slice(text.length - (max - head))}`;
}
