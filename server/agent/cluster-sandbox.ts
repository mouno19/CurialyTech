import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { RemoteBox } from "./sandbox";

// Curialy Dedicated Isolated Compute: paid accounts' task sandboxes run as containers on the
// platform's own worker nodes. Each sandbox is a container with 1 GB of memory (plus 1 GB of swap),
// one CPU and 512 processes, on a network that reaches the public internet but not the workers,
// the platform or other sandboxes. Its root is an unprivileged user on the worker. The task's
// workspace on the worker (/srv/curialy-workspaces/<task>) is mounted into it.
// Nodes are reached over SSH (one multiplexed connection per node). New sandboxes go to the node
// with the fewest running ones that still has room (sandbox slots and free disk); when none has, the
// caller falls back. Ports of a sandbox (dev servers for previews) are forwarded over the same
// connection to this server's loopback.

export const COMPUTE = {
  name: "Curialy Dedicated Isolated Compute",
  description: "High-speed dedicated 1 GB isolated execution sandboxes running on Curialy's high-performance compute cluster.",
} as const;

const REMOTE_ROOT = "/home/user/workspace";
const IMAGE = "curialy-sandbox-runner:latest";
const NETWORK = "curialy-sbx";
const WORKSPACES = "/srv/curialy-workspaces";
const MAX_PER_NODE = Number(process.env.CURIALY_COMPUTE_MAX_PER_NODE || 6);
/** A new sandbox needs this much free disk on its node (its installs and builds land there). */
const MIN_FREE_DISK_KB = Number(process.env.CURIALY_COMPUTE_MIN_FREE_DISK_MB || 700) * 1024;
/** Memory a node keeps free besides its sandboxes' limits. */
const MIN_FREE_MEMORY_KB = 1024 * 1024;
const HEALTH_MS = 30_000;
const INSTANCE = (process.env.CURIALY_COMPUTE_INSTANCE || `${os.hostname()}-${process.env.PORT || 3000}`).replace(/[^A-Za-z0-9_.-]/g, "-");
const CONTAINER_LIMITS = [
  "--memory=1024m", "--memory-swap=2048m", "--cpus=1.0", "--pids-limit=512",
  "--security-opt", "no-new-privileges", "--cap-drop", "NET_RAW", "--cap-drop", "MKNOD", "--cap-drop", "AUDIT_WRITE", "--cap-drop", "SETFCAP",
  "--dns", "1.1.1.1", "--dns", "8.8.8.8", "--hostname", "sandbox", "--stop-timeout", "5",
];
/** What every command in a sandbox gets (the task's secrets are added per command, never in arguments). */
const BASE_ENV: Record<string, string> = {
  CI: "1", TERM: "dumb", NO_COLOR: "1", LANG: "C.UTF-8", HOME: "/home/user", npm_config_update_notifier: "false", GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*", NODE_OPTIONS: "--max-old-space-size=1536",
};

export type ComputeNode = {
  name: string;
  /** user@address */
  target: string;
  key: string;
  /** Sandboxes this server runs there (task ids). */
  active: Set<string>;
  /** Being opened there, not yet running. */
  reserved: number;
  healthy: boolean;
  checkedAt: number;
  freeDiskKb: number;
  freeMemoryKb: number;
  /** The worker's id for a sandbox's root (user-namespace remapping), which owns its workspace there. */
  remapId: number;
};

/** CURIALY_COMPUTE_NODES: "name=user@address#/path/to/key;…" */
export function parseNodes(value = process.env.CURIALY_COMPUTE_NODES ?? ""): ComputeNode[] {
  return value.split(/[;\n]+/).map(item => item.trim()).filter(Boolean).flatMap(item => {
    const match = /^([A-Za-z0-9_.-]+)=([A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+)#(\/\S+)$/.exec(item);
    if (!match) { console.error(`[compute] ignored a node entry that is not name=user@address#/key/path`); return []; }
    return [{ name: match[1], target: match[2], key: match[3], active: new Set<string>(), reserved: 0, healthy: false, checkedAt: 0, freeDiskKb: 0, freeMemoryKb: 0, remapId: 100000 }];
  });
}

let nodes: ComputeNode[] = parseNodes();
export const computeConfigured = () => nodes.length > 0;
export const computeNodes = () => nodes;
/** For tests: other nodes, and a transport instead of SSH. */
export function useComputeNodes(list: ComputeNode[]) { nodes = list; }

// ---- Transport: one multiplexed SSH connection per node ----

export type Remote = { child: ChildProcessWithoutNullStreams; done: Promise<{ code: number | null; stdout: Buffer; stderr: string }> };
export type Transport = (node: ComputeNode, args: string[], opts?: { input?: Buffer | string; onStdout?: (data: string) => void; onStderr?: (data: string) => void; collect?: boolean }) => Remote;

const controlDir = path.join(os.tmpdir(), `curialy-compute-${process.getuid?.() ?? "u"}`);
const sshOptions = (node: ComputeNode) => [
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "StrictHostKeyChecking=yes",
  "-o", "ControlMaster=auto", "-o", `ControlPath=${controlDir}/%C`, "-o", "ControlPersist=600", "-o", "LogLevel=ERROR", "-i", node.key,
];

const sshTransport: Transport = (node, args, opts = {}) => {
  fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  const child = spawn("ssh", [...sshOptions(node), node.target, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let stderr = "";
  const decodeOut = new TextDecoder();
  const decodeErr = new TextDecoder();
  child.stdout.on("data", (data: Buffer) => {
    if (opts.collect !== false) chunks.push(data);
    opts.onStdout?.(decodeOut.decode(data, { stream: true }));
  });
  child.stderr.on("data", (data: Buffer) => {
    if (stderr.length < 64_000) stderr += data.toString("utf8");
    opts.onStderr?.(decodeErr.decode(data, { stream: true }));
  });
  child.stdin.on("error", () => undefined);
  if (opts.input !== undefined) child.stdin.end(opts.input); else child.stdin.end();
  const done = new Promise<{ code: number | null; stdout: Buffer; stderr: string }>(resolve => {
    child.on("error", error => { stderr += String(error); resolve({ code: 255, stdout: Buffer.concat(chunks), stderr }); });
    child.on("close", code => resolve({ code, stdout: Buffer.concat(chunks), stderr }));
  });
  return { child, done };
};

let transport: Transport = sshTransport;
export function useComputeTransport(value: Transport) { transport = value; }

/** A node or its sandbox is gone (not a failed command): the caller replaces the sandbox. */
class ComputeGone extends Error { readonly gone = true; }
/** No node has room: the caller places the sandbox elsewhere. */
export class ComputeFull extends Error {}
/** Docker's and SSH's own words for a sandbox or node that is gone (never a command's output). */
const GONE_TEXT = /Error response from daemon: (No such container|Container \S+ is (not running|restarting))|^ssh: connect to host|Connection to \S+ closed by remote host|Could not resolve hostname|kex_exchange_identification|mux_client_request_session|Control socket connect/im;

async function run(node: ComputeNode, args: string[], opts: Parameters<Transport>[2] & { timeoutMs?: number } = {}) {
  const remote = transport(node, args, opts);
  const timer = opts.timeoutMs ? setTimeout(() => remote.child.kill("SIGKILL"), opts.timeoutMs) : undefined;
  const result = await remote.done.finally(() => clearTimeout(timer));
  if (result.code === 255 || (result.code !== 0 && GONE_TEXT.test(result.stderr))) {
    markUnhealthy(node);
    throw new ComputeGone(`The compute node did not answer (${scrub(result.stderr).slice(0, 200) || `exit ${result.code}`}).`);
  }
  return result;
}

/** Text from a node, as it may reach a user: no addresses, users or key paths. */
const scrub = (text: string) => text.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[node]").replace(/\b[\w.-]+@[\w.-]+\b/g, "[node]").replace(/\/\S*\.pem\b/g, "[key]").trim();

export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const container = (taskId: string) => `curialy-sbx-${taskId}`;
const isTaskId = (taskId: string) => /^[0-9a-f-]{36}$/i.test(taskId);

/** The script a command runs from (sent on stdin: values never appear in a process list). */
export function commandScript(command: string, envs: Record<string, string> = {}) {
  const exports = Object.entries({ ...BASE_ENV, ...envs }).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).map(([name, value]) => `export ${name}=${shellQuote(value)}`);
  return `${exports.join("\n")}\ncd -- ${REMOTE_ROOT} 2>/dev/null || cd /\nexec bash -c ${shellQuote(command)} </dev/null\n`;
}

// ---- A tar stream of files (uploads go through `tar -x` in the sandbox) ----

function tarHeader(name: string, size: number, type: "0" | "x" = "0") {
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, "utf8");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136);
  header.write("        ", 148);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}
const pad = (size: number) => Buffer.alloc((512 - (size % 512)) % 512, 0);

/** USTAR with PAX records for long or non-ASCII names: what GNU tar extracts. Paths are made relative to /. */
export function tarFiles(files: { path: string; data: Buffer }[]) {
  const parts: Buffer[] = [];
  for (const file of files) {
    const name = file.path.replace(/^\/+/, "");
    if (!name || name.split("/").includes("..")) continue;
    if (Buffer.byteLength(name) > 99 || /[^\x20-\x7e]/.test(name)) {
      const record = (body: string) => { let length = body.length + 3; for (;;) { const line = `${length} ${body}\n`; const bytes = Buffer.byteLength(line); if (bytes === length) return line; length = bytes; } };
      const pax = Buffer.from(record(`path=${name}`), "utf8");
      parts.push(tarHeader("PaxHeader", pax.length, "x"), pax, pad(pax.length));
    }
    parts.push(tarHeader(name.slice(-99).replace(/[^\x20-\x7e]/g, "_"), file.data.length), file.data, pad(file.data.length));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

// ---- Nodes: health, capacity, placement ----

function markUnhealthy(node: ComputeNode) {
  node.healthy = false;
  node.checkedAt = Date.now();
}

/** Free disk and memory, the remapped id, and which of this server's sandboxes are running there. */
async function checkNode(node: ComputeNode) {
  try {
    const { code, stdout } = await run(node, [`df --output=avail -k / | tail -1; awk '/MemAvailable/ {print $2}' /proc/meminfo; awk -F: '$1=="dockremap" {print $2}' /etc/subuid; docker ps --filter label=curialy.instance=${INSTANCE} --format '{{.Label "curialy.task"}}'`], { timeoutMs: 20_000 });
    if (code !== 0) throw new Error(`exit ${code}`);
    const [disk, memory, remap, ...tasks] = stdout.toString("utf8").trim().split("\n");
    node.freeDiskKb = Number(disk) || 0;
    node.freeMemoryKb = Number(memory) || 0;
    node.remapId = Number(remap) || node.remapId;
    // What really runs there (this server's sandboxes) wins over what it remembers.
    node.active = new Set(tasks.map(task => task.trim()).filter(isTaskId));
    node.healthy = true;
  } catch {
    node.healthy = false;
  }
  node.checkedAt = Date.now();
  return node.healthy;
}

const load = (node: ComputeNode) => node.active.size + node.reserved;
const hasRoom = (node: ComputeNode) => node.healthy && load(node) < MAX_PER_NODE && node.freeDiskKb >= MIN_FREE_DISK_KB
  && node.freeMemoryKb >= MIN_FREE_MEMORY_KB + (node.reserved * 1024 * 1024);
let turn = 0;

/** The node with the fewest sandboxes that still has room (ties go round robin); null when none has. */
export function pickNode(list = nodes): ComputeNode | null {
  const candidates = list.filter(hasRoom);
  if (!candidates.length) return null;
  const least = Math.min(...candidates.map(load));
  const tied = candidates.filter(node => load(node) === least);
  return tied[turn++ % tied.length];
}

/** Capacity for status pages: sandboxes in use and the most this server may run. */
export function computeStatus() {
  return {
    name: COMPUTE.name,
    description: COMPUTE.description,
    nodes: nodes.map(node => ({ name: node.name, healthy: node.healthy, active: node.active.size, max: MAX_PER_NODE, freeDiskMb: Math.round(node.freeDiskKb / 1024), freeMemoryMb: Math.round(node.freeMemoryKb / 1024) })),
    active: nodes.reduce((sum, node) => sum + node.active.size, 0),
    max: nodes.length * MAX_PER_NODE,
  };
}

// ---- Sandboxes ----

/** Task → node, for sandboxes this server opened. */
const opened = new Map<string, ComputeNode>();

/** Loopback ports for forwards to sandbox ports (previews of dev servers). */
const FORWARD_FIRST = 42000;
const FORWARD_COUNT = 2000;
const inUse = new Set<number>();
let nextForward = 0;
function forwardPort() {
  for (let tries = 0; tries < FORWARD_COUNT; tries++) {
    const port = FORWARD_FIRST + (nextForward++ % FORWARD_COUNT);
    if (!inUse.has(port)) { inUse.add(port); return port; }
  }
  throw new Error("No loopback port is free for a preview forward.");
}

/** Whether something here already listens on the port (another program took it). */
const listening = (port: number) => new Promise<boolean>(resolve => {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => { socket.destroy(); resolve(false); });
});

/** Open a sandbox for the task on the node with the most room. Throws ComputeFull when no node has any. */
export async function openComputeBox(taskId: string): Promise<RemoteBox> {
  if (!isTaskId(taskId)) throw new Error("Invalid task id.");
  for (const node of nodes) if (Date.now() - node.checkedAt > HEALTH_MS || !node.healthy) await checkNode(node);
  const node = pickNode();
  if (!node) throw new ComputeFull("Every dedicated compute sandbox is in use.");
  node.reserved++;
  const name = container(taskId);
  let address = "";
  try {
    const workspace = `${WORKSPACES}/${taskId}`;
    const start = [
      `docker rm -f ${name} >/dev/null 2>&1`,
      `sudo -n rm -rf ${workspace} && sudo -n install -d -o ${node.remapId} -g ${node.remapId} -m 0700 ${workspace}`,
      `docker run -d --name ${name} --label curialy.instance=${INSTANCE} --label curialy.task=${taskId} --network ${NETWORK} ${CONTAINER_LIMITS.join(" ")} -v ${workspace}:${REMOTE_ROOT} ${IMAGE} >/dev/null`,
      `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${name}`,
    ].join(" && ");
    const { code, stdout, stderr } = await run(node, [start], { timeoutMs: 120_000 });
    address = stdout.toString("utf8").trim().split("\n").pop() ?? "";
    if (code !== 0 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) throw new Error(`Could not start a dedicated compute sandbox (${scrub(stderr).slice(0, 300) || `exit ${code}`}).`);
    node.active.add(taskId);
    opened.set(taskId, node);
  } finally {
    node.reserved--;
  }
  return computeBox(node, taskId, address);
}

function computeBox(node: ComputeNode, taskId: string, address: string): RemoteBox {
  const name = container(taskId);
  const forwards = new Map<number, number>();
  const exec = async (command: string, timeoutMs = 60_000) => {
    const { code, stdout, stderr } = await run(node, [`docker exec -i ${name} bash -s`], { input: commandScript(command), timeoutMs });
    if (code !== 0) throw Object.assign(new Error(scrub(stderr).slice(0, 2000) || `exit ${code}`), { exitCode: code });
    return stdout.toString("utf8");
  };
  return {
    id: `${node.name}/${taskId.slice(0, 8)}`,
    // Sandboxes here have no time limit of their own: idle ones are closed by the caller.
    keepAlive: async () => undefined,
    start: async (command, opts) => {
      const remote = transport(node, [`docker exec -i ${name} bash -s`], { input: commandScript(command, opts.envs), onStdout: opts.onStdout, onStderr: opts.onStderr, collect: false });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; remote.child.kill("SIGKILL"); }, opts.timeoutMs);
      return {
        wait: async () => {
          const result = await remote.done.finally(() => clearTimeout(timer));
          if (timedOut) throw Object.assign(new Error(`The command reached its time limit (${Math.round(opts.timeoutMs / 1000)} s).`), { timedOut: true });
          if (result.code === 255 || (result.code !== 0 && /Error response from daemon: (No such container|Container .* is not running)/i.test(result.stderr))) {
            markUnhealthy(node);
            throw new ComputeGone("The dedicated compute sandbox stopped.");
          }
          return result.code ?? 137;
        },
        kill: async () => { clearTimeout(timer); remote.child.kill("SIGKILL"); },
      };
    },
    exec,
    write: async files => {
      if (!files.length) return;
      const { code, stderr } = await run(node, [`docker exec -i ${name} tar -x -C / -f - --no-same-owner`], { input: tarFiles(files), timeoutMs: 120_000 });
      if (code !== 0) throw new Error(`Upload to the sandbox failed (${scrub(stderr).slice(0, 300) || `exit ${code}`}).`);
    },
    read: async file => {
      const { code, stdout, stderr } = await run(node, [`docker exec ${name} cat -- ${shellQuote(file)}`], { timeoutMs: 60_000 });
      if (code !== 0) throw new Error(scrub(stderr).slice(0, 300) || `Could not read ${file}.`);
      return stdout;
    },
    host: port => {
      const known = forwards.get(port);
      if (known) return `http://127.0.0.1:${known}`;
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
      // The loopback port is known now; the forward opens on the node's connection right after (the
      // preview polls until it answers).
      let local = forwardPort();
      forwards.set(port, local);
      void (async () => {
        if (await listening(local)) { inUse.delete(local); local = forwardPort(); forwards.set(port, local); }
        await run(node, ["true"], { timeoutMs: 20_000 }).catch(() => undefined);
        spawn("ssh", [...sshOptions(node), "-O", "forward", "-L", `127.0.0.1:${local}:${address}:${port}`, node.target], { stdio: "ignore" }).on("error", () => undefined);
      })();
      return `http://127.0.0.1:${local}`;
    },
    kill: async () => {
      for (const [port, local] of forwards) {
        spawn("ssh", [...sshOptions(node), "-O", "cancel", "-L", `127.0.0.1:${local}:${address}:${port}`, node.target], { stdio: "ignore" }).on("error", () => undefined);
        inUse.delete(local);
      }
      forwards.clear();
      opened.delete(taskId);
      node.active.delete(taskId);
      // The platform keeps the task's sources; on the node the container and its workspace go.
      await run(node, [`docker rm -f ${name} >/dev/null 2>&1; sudo -n rm -rf ${WORKSPACES}/${taskId}; true`], { timeoutMs: 60_000 }).catch(() => undefined);
    },
  };
}

/** Where a task's sandbox runs, for previews of its ports (null when it isn't on the cluster). */
export const computeNodeOf = (taskId: string) => opened.get(taskId) ?? null;

let started = false;

/** Check the nodes, stop the sandboxes a previous run of this server left there, and keep checking. */
export function startCompute() {
  if (started || !nodes.length) return;
  started = true;
  void (async () => {
    for (const node of nodes) {
      try {
        const { stdout } = await run(node, [`docker ps -aq --filter label=curialy.instance=${INSTANCE} | xargs -r docker rm -f >/dev/null; docker ps -aq --filter label=curialy.instance=${INSTANCE} | wc -l`], { timeoutMs: 60_000 });
        if (stdout.toString().trim() === "0") console.log(`[compute] ${node.name}: ready`);
      } catch {
        console.error(`[compute] ${node.name}: not reachable`);
      }
      await checkNode(node);
    }
  })();
  const timer = setInterval(() => { for (const node of nodes) void checkNode(node); }, HEALTH_MS);
  timer.unref();
}
