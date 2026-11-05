import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandExitError, Sandbox, SandboxNotFoundError, SandboxNotRunningError, SandboxUnreachableError, TimeoutError, type CommandHandle } from "e2b";
import { brandText } from "@shared/brand";
import { resolveInWorkspace, SandboxError, useRemoteSandbox, writeWorkspaceBytes, type CommandOptions, type CommandResult } from "./sandbox";

// Agent commands run in a cloud sandbox (one per task), never on this server. The task's directory
// here keeps what the file tools, previews, archives, exports and deploys read: sources and build
// output. Dependencies, caches and tool state stay in the sandbox. Around each command the two are
// synced: edits made here are uploaded first, and what the command created, changed or deleted is
// brought back after it.

const REMOTE_ROOT = "/home/user/workspace";
const IDLE_MS = Number(process.env.E2B_IDLE_MINUTES || 15) * 60_000;
const MAX_SANDBOXES = Number(process.env.E2B_MAX_SANDBOXES || 15);
const TEMPLATE = process.env.E2B_TEMPLATE || "";
// Sandboxes are tagged with this server instance, so a restart can stop the ones it left behind.
const INSTANCE = process.env.E2B_INSTANCE || `${os.hostname()}:${process.env.PORT || 3000}`;

/** Never synced: dependencies, caches and virtualenvs live (and are rebuilt) in the sandbox only. */
export const SYNC_SKIP = new Set(["node_modules", ".tmp", ".cache", ".next", ".nuxt", ".svelte-kit", "__pycache__", ".venv", "venv", ".pytest_cache", ".turbo", ".parcel-cache", ".npm", ".pnpm-store", ".yarn"]);
/** Uploaded with the sources (git runs in the sandbox) but never brought back. */
const PUSH_ONLY = ".git/";
const MAX_PULL_FILE = 8 * 1024 * 1024;
const MAX_PULL_BYTES = 150 * 1024 * 1024;
const MAX_PULL_FILES = 3000;
const MAX_LOCAL_BYTES = 400 * 1024 * 1024;
const UPLOAD_BATCH_FILES = 100;
const UPLOAD_BATCH_BYTES = 16 * 1024 * 1024;
const OUTPUT_CAP = 400_000;

const COMMAND_ENV: Record<string, string> = {
  CI: "1", TERM: "dumb", NO_COLOR: "1", LANG: "C.UTF-8", npm_config_update_notifier: "false", GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*",
  // Previews reach dev servers through the sandbox's public host name, which dev servers reject by default.
  __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".e2b.app", DANGEROUSLY_DISABLE_HOST_CHECK: "true",
};

type Entry = { size: number; sig: string };
type Listing = Map<string, Entry>;
/** A sandbox listing; `partial` when some folder could not be read (its files must not count as deleted). */
type Scan = { files: Listing; partial: boolean };

/** What a sandbox can do, as used here (the real one wraps the SDK; tests use a fake). */
export type RemoteBox = {
  id: string;
  keepAlive: (ms: number) => Promise<void>;
  /** Start a command; resolves once it is running. */
  start: (command: string, opts: { timeoutMs: number; onStdout: (data: string) => void; onStderr: (data: string) => void }) => Promise<{ wait: () => Promise<number>; kill: () => Promise<void> }>;
  /** Run a short helper command and return its stdout (throws on failure). */
  exec: (command: string, timeoutMs?: number) => Promise<string>;
  write: (files: { path: string; data: Buffer }[]) => Promise<void>;
  read: (file: string) => Promise<Buffer>;
  host: (port: number) => string;
  kill: () => Promise<void>;
};

type Box = {
  taskId: string;
  remote: RemoteBox;
  /** What each side looked like when they last agreed. */
  local: Listing;
  remoteSeen: Listing;
  /** Files reported as kept only in the sandbox (too large to bring back), so the note is shown once. */
  remoteOnly: Set<string>;
  active: number;
  lastUsed: number;
  /** When the sandbox's own timeout ends unless extended (it also proves the sandbox is still there). */
  aliveUntil: number;
  syncLock: Promise<unknown>;
};

const boxes = new Map<string, Box>();
const opening = new Map<string, Promise<Box>>();
let counter = 0;

export const q = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
// Platform-authored text (sandbox errors reach the command output): no provider names or hosts.
const message = (error: unknown) => brandText(error instanceof Error ? error.message : String(error));

/** Errors that mean the sandbox itself is gone (timed out, killed or unreachable), not a failed command or a missing file. */
export function sandboxGone(error: unknown) {
  if (error instanceof SandboxNotFoundError || error instanceof SandboxNotRunningError || error instanceof SandboxUnreachableError) return true;
  return (error as { gone?: boolean })?.gone === true || /\bsandbox\b[^.]*\b(not found|not running|was killed|is paused)\b/i.test(message(error));
}

// ---- The SDK-backed sandbox ----

let connect: (taskId: string) => Promise<RemoteBox> = async taskId => {
  if (!process.env.E2B_API_KEY) throw new SandboxError("The command sandbox is not configured on this server.");
  const opts = { timeoutMs: IDLE_MS, metadata: { app: "curialy", instance: INSTANCE, taskId }, lifecycle: { onTimeout: "kill" as const } };
  const sandbox = TEMPLATE ? await Sandbox.create(TEMPLATE, opts) : await Sandbox.create(opts);
  await sandbox.commands.run(`mkdir -p ${REMOTE_ROOT}`, { timeoutMs: 30_000 });
  return {
    id: sandbox.sandboxId,
    keepAlive: ms => sandbox.setTimeout(ms),
    start: async (command, opts) => {
      const handle: CommandHandle = await sandbox.commands.run(command, { background: true, envs: COMMAND_ENV, timeoutMs: opts.timeoutMs, onStdout: opts.onStdout, onStderr: opts.onStderr });
      return {
        wait: async () => {
          try {
            return (await handle.wait()).exitCode;
          } catch (error) {
            if (error instanceof CommandExitError) return error.exitCode;
            throw error;
          }
        },
        kill: async () => { await handle.kill().catch(() => undefined); },
      };
    },
    exec: async (command, timeoutMs = 60_000) => {
      const result = await sandbox.commands.run(command, { timeoutMs, envs: COMMAND_ENV });
      return result.stdout;
    },
    write: async files => {
      await sandbox.files.write(files.map(file => ({ path: file.path, data: file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer })));
    },
    read: async file => Buffer.from(await sandbox.files.read(file, { format: "bytes" })),
    host: port => sandbox.getHost(port),
    kill: async () => { await sandbox.kill().catch(() => undefined); },
  };
};

/** Tests swap in a fake sandbox. */
export function useSandboxFactory(factory: (taskId: string) => Promise<RemoteBox>) {
  connect = factory;
}

// ---- Listings ----

function scanLocal(root: string): Listing {
  const out: Listing = new Map();
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SYNC_SKIP.has(entry.name)) walk(path.join(dir, entry.name), relPath);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks and special files are never synced
      const stat = fs.lstatSync(path.join(dir, entry.name), { throwIfNoEntry: false });
      if (stat?.isFile()) out.set(relPath, { size: stat.size, sig: `${stat.size}:${stat.mtimeMs}` });
    }
  };
  walk(root, "");
  return out;
}

const SCAN_COMMAND = `cd ${REMOTE_ROOT} && { find . -mindepth 1 \\( -type d \\( ${[...SYNC_SKIP].map(name => `-name ${q(name)}`).join(" -o ")} \\) -prune \\) -o -type f -printf '%s\\t%T@\\t%P\\0' 2>/dev/null; printf '\\n__find_exit=%s' "$?"; }`;

export function parseScan(output: string): Scan {
  const marker = output.lastIndexOf("\n__find_exit=");
  const partial = marker < 0 || output.slice(marker + 13).trim() !== "0";
  const out: Listing = new Map();
  for (const record of (marker < 0 ? output : output.slice(0, marker)).split("\0")) {
    const first = record.indexOf("\t");
    const second = first < 0 ? -1 : record.indexOf("\t", first + 1);
    if (second < 0) continue;
    const size = Number(record.slice(0, first));
    const file = record.slice(second + 1);
    if (!file || !Number.isFinite(size)) continue;
    out.set(file, { size, sig: `${size}:${record.slice(first + 1, second)}` });
  }
  return { files: out, partial };
}

const scanRemote = async (box: Box, before = "") => parseScan(await box.remote.exec(`${before}${SCAN_COMMAND}`, 120_000));

// ---- Sync ----

async function upload(box: Box, root: string, files: string[]) {
  let batch: { path: string; data: Buffer }[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length) await box.remote.write(batch);
    batch = [];
    bytes = 0;
  };
  for (const file of files) {
    let data: Buffer;
    try {
      const fd = fs.openSync(path.join(root, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { data = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
    } catch {
      continue; // gone or unreadable since the listing
    }
    if (batch.length >= UPLOAD_BATCH_FILES || bytes + data.length > UPLOAD_BATCH_BYTES) await flush();
    batch.push({ path: `${REMOTE_ROOT}/${file}`, data });
    bytes += data.length;
  }
  await flush();
}

async function removeRemote(box: Box, files: string[]) {
  const list = `/tmp/.curialy-rm-${++counter}`;
  await box.remote.write([{ path: list, data: Buffer.from(files.map(file => `${file}\0`).join("")) }]);
  await box.remote.exec(`cd ${REMOTE_ROOT} && xargs -0 -r rm -f -- < ${list}; rm -f ${list}; true`);
}

const localBytes = (listing: Listing) => [...listing.values()].reduce((sum, entry) => sum + entry.size, 0);

/**
 * Bring back what changed in the sandbox since the sides last agreed. `uploaded` paths were just
 * written from here: their sandbox copy is ours already. Returns notes for the command output.
 */
async function pull(box: Box, root: string, { files: scan, partial }: Scan, uploaded = new Set<string>()) {
  const notes: string[] = [];
  const changed: string[] = [];
  const tooLarge: string[] = [];
  let budget = MAX_PULL_BYTES;
  let room = MAX_LOCAL_BYTES - localBytes(box.local);
  for (const [file, entry] of scan) {
    if (uploaded.has(file) || file.startsWith(PUSH_ONLY) || box.remoteSeen.get(file)?.sig === entry.sig) continue;
    if (entry.size > MAX_PULL_FILE || entry.size > budget || entry.size > room || changed.length >= MAX_PULL_FILES) {
      if (!box.remoteOnly.has(file)) tooLarge.push(file);
      box.remoteOnly.add(file);
      continue;
    }
    box.remoteOnly.delete(file);
    changed.push(file);
    budget -= entry.size;
    room -= entry.size;
  }
  // From a partial listing nothing counts as deleted: an unreadable folder is not an empty one.
  const deleted = partial ? [] : [...box.remoteSeen.keys()].filter(file => !scan.has(file) && !uploaded.has(file) && !file.startsWith(PUSH_ONLY));
  const seen: Listing = new Map(scan);
  if (partial) for (const [file, entry] of box.remoteSeen) if (!seen.has(file)) seen.set(file, entry);
  let next = 0;
  const failed: string[] = [];
  const worker = async () => {
    while (next < changed.length) {
      const file = changed[next++];
      try {
        const data = await box.remote.read(`${REMOTE_ROOT}/${file}`);
        try {
          writeWorkspaceBytes(root, file, data, MAX_PULL_FILE);
        } catch (error) {
          // A file the old sandbox user created read-only: replace it (the folder is group-writable).
          if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
          fs.unlinkSync(resolveInWorkspace(root, file).absolute);
          writeWorkspaceBytes(root, file, data, MAX_PULL_FILE);
        }
      } catch (error) {
        if (sandboxGone(error)) throw error;
        failed.push(`${file} (${message(error)})`);
        // Tried again at the next sync.
        const before = box.remoteSeen.get(file);
        if (before) seen.set(file, before);
        else seen.delete(file);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, changed.length) }, worker));
  for (const file of deleted) {
    box.remoteOnly.delete(file);
    try {
      // Resolved through realpath: a folder here that is a symlink never lets a delete reach outside.
      const { absolute } = resolveInWorkspace(root, file);
      if (fs.lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) fs.unlinkSync(absolute);
    } catch (error) {
      failed.push(`${file} (${message(error)})`);
    }
  }
  box.remoteSeen = seen;
  if (changed.length || deleted.length) box.local = scanLocal(root);
  if (tooLarge.length) notes.push(`[sandbox] Kept only in the sandbox (too large to bring back to the workspace): ${tooLarge.slice(0, 8).join(", ")}${tooLarge.length > 8 ? ` and ${tooLarge.length - 8} more` : ""}.`);
  if (failed.length) notes.push(`[sandbox] Could not bring back: ${failed.slice(0, 5).join("; ")}${failed.length > 5 ? ` and ${failed.length - 5} more` : ""}.`);
  return notes;
}

/** Upload what was edited here since the last sync, then bring back anything the sandbox changed meanwhile. */
async function push(box: Box, root: string) {
  const now = scanLocal(root);
  const changed = [...now].filter(([file, entry]) => box.local.get(file)?.sig !== entry.sig).map(([file]) => file);
  const deleted = [...box.local.keys()].filter(file => !now.has(file));
  if (!changed.length && !deleted.length) {
    box.local = now;
    return [];
  }
  await upload(box, root, changed);
  if (deleted.length) await removeRemote(box, deleted);
  box.local = now;
  return pull(box, root, await scanRemote(box), new Set([...changed, ...deleted]));
}

function withSyncLock<T>(box: Box, fn: () => Promise<T>): Promise<T> {
  const run = box.syncLock.catch(() => undefined).then(fn);
  box.syncLock = run;
  return run;
}

// ---- Sandboxes per task ----

async function makeRoom(signal?: AbortSignal) {
  const deadline = Date.now() + 3 * 60_000;
  while (boxes.size + opening.size >= MAX_SANDBOXES) {
    const idle = [...boxes.values()].filter(box => box.active === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (idle) {
      await closeBox(idle.taskId);
      continue;
    }
    if (signal?.aborted) throw new SandboxError("Cancelled while waiting for a free sandbox.");
    if (Date.now() > deadline) throw new SandboxError("Every command sandbox is busy right now. Try again in a few minutes.");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

async function openBox(taskId: string, root: string, signal?: AbortSignal): Promise<Box> {
  const existing = boxes.get(taskId);
  if (existing) return existing;
  const pending = opening.get(taskId);
  if (pending) return pending;
  const promise = (async () => {
    await makeRoom(signal);
    const remote = await connect(taskId);
    const box: Box = { taskId, remote, local: new Map(), remoteSeen: new Map(), remoteOnly: new Set(), active: 0, lastUsed: Date.now(), aliveUntil: Date.now() + IDLE_MS, syncLock: Promise.resolve() };
    try {
      // A new sandbox starts empty: everything here is uploaded.
      await withSyncLock(box, () => push(box, root));
    } catch (error) {
      await remote.kill();
      throw error;
    }
    boxes.set(taskId, box);
    return box;
  })();
  opening.set(taskId, promise);
  try {
    return await promise;
  } finally {
    opening.delete(taskId);
  }
}

async function closeBox(taskId: string) {
  const box = boxes.get(taskId);
  if (!box) return;
  boxes.delete(taskId);
  await box.remote.kill();
}

function extend(box: Box, ms: number) {
  box.aliveUntil = Date.now() + ms;
  return box.remote.keepAlive(ms);
}

/**
 * A live sandbox for the task (counted as in use) with local edits uploaded, replacing one that timed
 * out or was stopped. Its timeout is extended only when it would end during the command.
 */
async function liveBox(taskId: string, root: string, needMs: number, sync: boolean, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    const box = await openBox(taskId, root, signal);
    box.active++;
    box.lastUsed = Date.now();
    try {
      if (box.aliveUntil - Date.now() < needMs) await extend(box, Math.max(IDLE_MS, needMs));
      const notes = sync ? await withSyncLock(box, () => push(box, root)) : [];
      return { box, notes };
    } catch (error) {
      box.active--;
      if (!sandboxGone(error)) throw error;
      boxes.delete(taskId);
      if (attempt > 0) throw error;
    }
  }
}

type Started = Awaited<ReturnType<RemoteBox["start"]>>;

/** The command's exit code, or "overdue" when neither its end nor the sandbox's own time limit arrives within `ms`. */
export function waitWithin(running: Pick<Started, "wait">, ms: number): Promise<number | "overdue"> {
  let timer: NodeJS.Timeout | undefined;
  const overdue = new Promise<"overdue">(resolve => { timer = setTimeout(() => resolve("overdue"), ms); });
  return Promise.race([running.wait(), overdue]).finally(() => clearTimeout(timer));
}

async function runRemote(opts: CommandOptions): Promise<CommandResult> {
  const started = Date.now();
  const taskId = path.basename(opts.root);
  const timeout = Math.max(5, Math.min(600, Math.round(opts.timeoutSec)));
  const sync = opts.sync ?? "full";
  let output = "";
  let streamed = 0;
  const result = (exitCode: number | null, timedOut = false): CommandResult => ({ exitCode, timedOut, output, durationMs: Date.now() - started });
  // Sync notes are streamed; machine-readable (raw) output never has them mixed in.
  const note = (text: string) => {
    if (!opts.raw) output += `${output && !output.endsWith("\n") ? "\n" : ""}${text}\n`;
    opts.onOutput("stderr", `${text}\n`);
  };
  const capture = (stream: "stdout" | "stderr") => (data: string) => {
    const chunk = data.includes("\u0000") ? data.replace(/\u0000/g, "") : data;
    if (output.length < OUTPUT_CAP) output += opts.raw ? data : chunk;
    if (streamed < OUTPUT_CAP) {
      streamed += chunk.length;
      opts.onOutput(stream, chunk);
    }
  };
  if (opts.signal?.aborted) {
    output = "Cancelled before it started.";
    return result(null);
  }

  // Each command is its own session, so whatever it leaves running stops with it.
  const sessionFile = `/tmp/.curialy-sid-${++counter}`;
  const script = `echo $$ > ${sessionFile}; cd -- ${REMOTE_ROOT} || exit 97; eval "$1"`;
  const killSession = `s=$(cat ${sessionFile} 2>/dev/null); [ -n "$s" ] && pkill -KILL -s "$s"; rm -f ${sessionFile}; `;

  let box: Box | undefined;
  let command: Started | undefined;
  for (let attempt = 0; !command; attempt++) {
    box = undefined;
    try {
      const live = await liveBox(taskId, opts.root, (timeout + 120) * 1000, sync !== "none", opts.signal);
      box = live.box;
      for (const line of live.notes) note(line);
      command = await box.remote.start(`exec setsid --wait bash -c ${q(script)} curialy ${q(opts.command)}`, { timeoutMs: (timeout + 5) * 1000, onStdout: capture("stdout"), onStderr: capture("stderr") });
    } catch (error) {
      if (box) {
        box.active--;
        box.lastUsed = Date.now();
      }
      // Gone before the command started (e.g. it reached its time limit): nothing ran, so start over once.
      if (attempt === 0 && sandboxGone(error)) {
        boxes.delete(taskId);
        continue;
      }
      note(`Could not start the command sandbox: ${message(error)}`);
      return result(null);
    }
  }
  const live: Box = box!;
  const running: Started = command;
  const stopSession = () => live.remote.exec(`${killSession}true`, 15_000).catch(() => undefined);
  // Its children too: one holding the output open would otherwise keep the command "running".
  const onAbort = () => { void running.kill(); void stopSession(); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.signal?.aborted) onAbort();
  try {
    let exitCode: number | null = null;
    let timedOut = false;
    let finished = false;
    try {
      // The sandbox's own limit ends the command; this deadline holds even if that answer never comes.
      const ended = await waitWithin(running, (timeout + 30) * 1000);
      if (ended === "overdue") {
        void running.kill();
        timedOut = true;
        exitCode = 124;
      } else {
        exitCode = opts.signal?.aborted ? null : ended;
        finished = true;
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        timedOut = true;
        exitCode = 124;
      } else if (sandboxGone(error)) {
        boxes.delete(taskId);
        note(`[sandbox] The sandbox stopped while the command ran (${message(error)}). Run it again; dependencies may need installing again.`);
        return result(null);
      } else {
        note(`[sandbox] ${message(error)}`);
      }
    }
    opts.signal?.removeEventListener("abort", onAbort);
    if (sync !== "full") {
      await stopSession();
      return result(exitCode, timedOut);
    }
    try {
      // A command that ended normally has its leftovers stopped by the same call that lists the files.
      if (!finished) await stopSession();
      const before = finished ? killSession : "";
      for (const line of await withSyncLock(live, async () => pull(live, opts.root, await scanRemote(live, before)))) note(line);
    } catch (error) {
      if (sandboxGone(error)) boxes.delete(taskId);
      else if (finished) await stopSession();
      note(`[sandbox] Could not bring the command's changes back to the workspace: ${message(error)}`);
    }
    return result(exitCode, timedOut);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    live.active--;
    live.lastUsed = Date.now();
    extend(live, IDLE_MS).catch(() => undefined);
  }
}

/** The public host of a port in the task's sandbox (previews proxy to it), once the sandbox exists. */
export function sandboxHost(taskId: string, port: number) {
  return boxes.get(taskId)?.remote.host(port) ?? null;
}

async function refresh(taskId: string, root: string) {
  const box = boxes.get(taskId);
  if (!box) return;
  try {
    await withSyncLock(box, async () => {
      await push(box, root);
      await pull(box, root, await scanRemote(box));
    });
  } catch (error) {
    if (sandboxGone(error)) boxes.delete(taskId);
    else throw error;
  }
}

let started = false;

/** Route agent commands to cloud sandboxes, stop the ones a previous run of this server left, and stop idle ones. */
export function startCloudSandbox() {
  if (started) return;
  started = true;
  useRemoteSandbox({ run: runRemote, refresh, removed: taskId => void closeBox(taskId), host: sandboxHost });
  void (async () => {
    try {
      const paginator = Sandbox.list({ query: { metadata: { app: "curialy", instance: INSTANCE } } });
      let stopped = 0;
      while (paginator.hasNext) {
        for (const info of await paginator.nextItems()) {
          if (boxes.has(info.metadata.taskId ?? "")) continue;
          await Sandbox.kill(info.sandboxId).catch(() => undefined);
          stopped++;
        }
      }
      if (stopped) console.log(`[sandbox] stopped ${stopped} sandbox(es) left by a previous run`);
    } catch (error) {
      console.error("[sandbox] could not list sandboxes:", message(error));
    }
  })();
  const timer = setInterval(() => {
    for (const box of boxes.values()) if (box.active === 0 && Date.now() - box.lastUsed > IDLE_MS) void closeBox(box.taskId);
  }, 60_000);
  timer.unref();
}

/** Stop every sandbox this process opened (shutdown). */
export async function stopCloudSandboxes() {
  await Promise.all([...boxes.keys()].map(closeBox));
}

/** For tests: the runtime without listing or timers. */
export function startCloudSandboxForTests() {
  useRemoteSandbox({ run: runRemote, refresh, removed: taskId => void closeBox(taskId), host: sandboxHost });
}
