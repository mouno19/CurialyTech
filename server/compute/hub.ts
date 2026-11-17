import http, { type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ComputeSpecs } from "@shared/compute";
import type { RemoteBox } from "../agent/sandbox";
import { authenticateEnvironmentToken, recordEnvironmentSpecs, sanitizeSpecs, type StoredEnvironmentRow } from "./store";
import { rejectUpgrade, upgradeToWebSocket, type WsSocket } from "./ws";

export class EnvironmentOfflineError extends Error {
  readonly gone = true;
  constructor(readonly environmentName: string) {
    super(`Compute environment "${environmentName}" is currently offline.`);
  }
}

type PendingRpc = {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type RunningStream = {
  taskId: string;
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  onExit: (code: number, timedOut: boolean) => void;
  onGone: (err: Error) => void;
};

type LiveConnection = {
  envId: string;
  userId: string;
  name: string;
  ws: WsSocket;
  specs: ComputeSpecs | null;
  readyResolvers: (() => void)[];
  pending: Map<string, PendingRpc>;
  streams: Map<string, RunningStream>;
  activeTasks: Set<string>;
  lastPongAt: number;
  pingTimer: NodeJS.Timeout;
};

const connections = new Map<string, LiveConnection>();
let reqSeq = 0;
let cmdSeq = 0;

// Ephemeral loopback ports for preview tunneling (127.0.0.1:45000..46999)
const PORT_MIN = 45000;
const PORT_MAX = 46999;
let nextForwardPort = PORT_MIN;
const allocatedPorts = new Set<number>();

function takeForwardPort(): number {
  for (let i = 0; i <= PORT_MAX - PORT_MIN; i++) {
    const candidate = nextForwardPort;
    nextForwardPort = candidate >= PORT_MAX ? PORT_MIN : candidate + 1;
    if (!allocatedPorts.has(candidate)) {
      allocatedPorts.add(candidate);
      return candidate;
    }
  }
  return 0;
}

function goneError(message: string): Error & { gone: boolean } {
  return Object.assign(new Error(message), { gone: true });
}

function sendRpc(conn: LiveConnection, type: string, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  if (!conn.ws.open) return Promise.reject(goneError(`Compute environment "${conn.name}" disconnected.`));
  const reqId = `r_${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(reqId);
      const err = Object.assign(new Error(`Remote compute RPC "${type}" timed out.`), { timedOut: true });
      reject(err);
    }, timeoutMs);
    timer.unref?.();
    conn.pending.set(reqId, { resolve, reject, timer });
    const sent = conn.ws.send(JSON.stringify({ ...payload, type, reqId }));
    if (!sent && !conn.ws.open) {
      clearTimeout(timer);
      conn.pending.delete(reqId);
      reject(goneError(`Compute environment "${conn.name}" disconnected.`));
    }
  });
}

function extractToken(req: IncomingMessage, url: URL): string {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  return (url.searchParams.get("token") ?? "").trim();
}

export type HubHooks = {
  auth?: (token: string) => Promise<StoredEnvironmentRow | null>;
  persistSpecs?: (id: string, specs: ComputeSpecs) => Promise<void>;
};

export function attachComputeHub(server: http.Server, hooks: HubHooks = {}) {
  const authFn = hooks.auth ?? authenticateEnvironmentToken;
  const persistFn = hooks.persistSpecs ?? recordEnvironmentSpecs;

  server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      return;
    }
    if (url.pathname !== "/api/compute/ws") return;

    void (async () => {
      const token = extractToken(req, url);
      if (!token) return rejectUpgrade(socket, 401, "Missing environment token.");
      let envRow: StoredEnvironmentRow | null = null;
      try {
        envRow = await authFn(token);
      } catch (err) {
        console.error("[compute] token verification failed:", err instanceof Error ? err.message : err);
        return rejectUpgrade(socket, 503, "Authentication unavailable.");
      }
      if (!envRow) return rejectUpgrade(socket, 401, "Invalid or revoked environment token.");

      const ws = upgradeToWebSocket(req, socket, head);
      if (!ws) return;

      const previous = connections.get(envRow.id);
      if (previous && previous.ws !== ws) {
        connections.delete(envRow.id);
        previous.ws.close(4002, "Replaced by newer connection");
      }

      const conn: LiveConnection = {
        envId: envRow.id,
        userId: envRow.user_id,
        name: envRow.name,
        ws,
        specs: envRow.specs ?? null,
        readyResolvers: [],
        pending: new Map(),
        streams: new Map(),
        activeTasks: new Set(),
        lastPongAt: Date.now(),
        pingTimer: setInterval(() => {
          if (!ws.open) return;
          if (Date.now() - conn.lastPongAt > 75_000) {
            ws.close(1001, "Heartbeat timeout");
            return;
          }
          ws.ping();
        }, 20_000),
      };
      conn.pingTimer.unref?.();
      connections.set(envRow.id, conn);

      ws.on("pong", () => {
        conn.lastPongAt = Date.now();
      });

      ws.on("message", raw => {
        conn.lastPongAt = Date.now();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = msg.type;
        if (type === "hello" || type === "specs") {
          const parsed = sanitizeSpecs(msg.specs);
          if (parsed) {
            conn.specs = parsed;
            void persistFn(conn.envId, parsed);
          }
          if (conn.readyResolvers.length) {
            for (const resolve of conn.readyResolvers.splice(0)) resolve();
          }
          return;
        }
        if (type === "res" && typeof msg.reqId === "string") {
          const waiter = conn.pending.get(msg.reqId);
          if (waiter) {
            clearTimeout(waiter.timer);
            conn.pending.delete(msg.reqId);
            if (msg.ok === false) {
              const err = Object.assign(new Error(typeof msg.error === "string" ? msg.error : "Remote command failed"), {
                timedOut: Boolean(msg.timedOut),
              });
              waiter.reject(err);
            } else {
              waiter.resolve(msg);
            }
          }
          return;
        }
        if ((type === "stdout" || type === "stderr") && typeof msg.cmdId === "string") {
          const stream = conn.streams.get(msg.cmdId);
          if (stream && typeof msg.data === "string") {
            if (type === "stdout") stream.onStdout(msg.data);
            else stream.onStderr(msg.data);
          }
          return;
        }
        if (type === "exit" && typeof msg.cmdId === "string") {
          const stream = conn.streams.get(msg.cmdId);
          if (stream) {
            conn.streams.delete(msg.cmdId);
            stream.onExit(typeof msg.code === "number" ? msg.code : 1, Boolean(msg.timedOut));
          }
        }
      });

      ws.on("close", () => {
        clearInterval(conn.pingTimer);
        if (connections.get(conn.envId) === conn) connections.delete(conn.envId);
        const disconnected = goneError(`Compute environment "${conn.name}" disconnected.`);
        for (const waiter of conn.pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(disconnected);
        }
        conn.pending.clear();
        for (const stream of conn.streams.values()) {
          stream.onGone(disconnected);
        }
        conn.streams.clear();
        conn.activeTasks.clear();
        for (const resolve of conn.readyResolvers.splice(0)) resolve();
      });
    })().catch(err => {
      console.error("[compute] upgrade error:", err instanceof Error ? err.message : err);
      try { socket.destroy(); } catch { /* ignore */ }
    });
  });
}

export function liveEnvironmentState(envId: string): { online: boolean; activeTasks: number; specs: ComputeSpecs | null } {
  const conn = connections.get(envId);
  if (!conn || !conn.ws.open) return { online: false, activeTasks: 0, specs: null };
  return { online: true, activeTasks: conn.activeTasks.size, specs: conn.specs };
}

export function hasOnlineUserEnvironment(userId: string): boolean {
  for (const conn of connections.values()) {
    if (conn.userId === userId && conn.ws.open) return true;
  }
  return false;
}

export function disconnectEnvironment(envId: string, code = 4001, reason = "Disconnected") {
  const conn = connections.get(envId);
  if (!conn) return;
  connections.delete(envId);
  conn.ws.close(code, reason);
}

export async function refreshLiveSpecs(envId: string): Promise<ComputeSpecs | null> {
  const conn = connections.get(envId);
  if (!conn || !conn.ws.open) return null;
  const res = await sendRpc(conn, "ping_specs", {}, 10_000);
  const parsed = sanitizeSpecs(res.specs);
  if (parsed) {
    conn.specs = parsed;
    void recordEnvironmentSpecs(envId, parsed);
  }
  return parsed ?? conn.specs;
}

const WRITE_CHUNK_BYTES = 6 * 1024 * 1024;
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export async function openConnectedEnvironmentBox(taskId: string, envRow: StoredEnvironmentRow): Promise<RemoteBox> {
  const conn = connections.get(envRow.id);
  if (!conn || !conn.ws.open) throw new EnvironmentOfflineError(envRow.name);

  if (!conn.specs) {
    await Promise.race([
      new Promise<void>(resolve => conn.readyResolvers.push(resolve)),
      new Promise<void>(resolve => setTimeout(resolve, 2000)),
    ]);
    if (!conn.ws.open) throw new EnvironmentOfflineError(envRow.name);
  }

  const baseDir = envRow.work_dir
    ? envRow.work_dir
    : `${(conn.specs?.workBase ?? "~/curialy-workspaces").replace(/\/+$/, "")}/${taskId}`;

  const mkdirRes = await sendRpc(conn, "mkdir", { path: baseDir }, 15_000);
  const remoteRoot = typeof mkdirRes.path === "string" && mkdirRes.path.startsWith("/") ? mkdirRes.path : baseDir;

  conn.activeTasks.add(taskId);
  const taskCommands = new Set<string>();
  const forwards = new Map<number, { localPort: number; server: http.Server }>();

  return {
    id: `user-env:${envRow.id}:${taskId}`,
    root: remoteRoot,
    persistent: true,
    keepAlive: async () => {
      if (!conn.ws.open) throw goneError(`Compute environment "${conn.name}" disconnected.`);
    },
    exec: async (command: string, timeoutMs = 60_000) => {
      const res = await sendRpc(conn, "exec", { command, timeoutMs }, timeoutMs + 10_000);
      return typeof res.stdout === "string" ? res.stdout : "";
    },
    start: async (command, opts) => {
      const cmdId = `c_${++cmdSeq}`;
      taskCommands.add(cmdId);
      let exitPromiseResolve!: (code: number) => void;
      let exitPromiseReject!: (err: Error) => void;
      const waitPromise = new Promise<number>((resolve, reject) => {
        exitPromiseResolve = resolve;
        exitPromiseReject = reject;
      });
      // Prevent unhandled rejection when a background command (e.g. a dev server) is killed or disconnects without wait() being awaited.
      waitPromise.catch(() => undefined);

      conn.streams.set(cmdId, {
        taskId,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
        onExit: (code, timedOut) => {
          taskCommands.delete(cmdId);
          if (timedOut) {
            exitPromiseReject(Object.assign(new Error("Command timed out"), { timedOut: true }));
          } else {
            exitPromiseResolve(code);
          }
        },
        onGone: err => {
          taskCommands.delete(cmdId);
          exitPromiseReject(err);
        },
      });

      try {
        await sendRpc(
          conn,
          "start",
          { cmdId, command, timeoutMs: opts.timeoutMs, ...(opts.envs ? { envs: opts.envs } : {}) },
          20_000,
        );
      } catch (err) {
        conn.streams.delete(cmdId);
        taskCommands.delete(cmdId);
        throw err;
      }

      return {
        wait: () => waitPromise,
        kill: async () => {
          taskCommands.delete(cmdId);
          conn.streams.delete(cmdId);
          exitPromiseResolve(143);
          await sendRpc(conn, "kill", { cmdId }, 8000).catch(() => undefined);
        },
      };
    },
    write: async files => {
      let batch: { path: string; data: string }[] = [];
      let bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await sendRpc(conn, "write", { files: batch }, 90_000);
        batch = [];
        bytes = 0;
      };
      for (const file of files) {
        if (batch.length >= 80 || bytes + file.data.length > WRITE_CHUNK_BYTES) await flush();
        batch.push({ path: file.path, data: file.data.toString("base64") });
        bytes += file.data.length;
      }
      await flush();
    },
    read: async file => {
      const res = await sendRpc(conn, "read", { path: file }, 60_000);
      return Buffer.from(typeof res.data === "string" ? res.data : "", "base64");
    },
    host: (port: number) => {
      const existing = forwards.get(port);
      if (existing) return `http://127.0.0.1:${existing.localPort}`;

      const localPort = takeForwardPort();
      const proxyServer = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on("data", (c: Buffer) => {
          total += c.length;
          if (total <= 10 * 1024 * 1024) chunks.push(c);
        });
        req.on("end", () => {
          const cleanHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (!HOP_HEADERS.has(k.toLowerCase()) && typeof v === "string") cleanHeaders[k] = v;
          }
          sendRpc(
            conn,
            "http_req",
            {
              port,
              method: req.method || "GET",
              path: req.url || "/",
              headers: cleanHeaders,
              ...(chunks.length ? { body: Buffer.concat(chunks).toString("base64") } : {}),
            },
            30_000,
          )
            .then(reply => {
              const status = typeof reply.status === "number" ? reply.status : 502;
              const respHeaders: Record<string, string | string[]> = {};
              if (reply.headers && typeof reply.headers === "object") {
                for (const [k, v] of Object.entries(reply.headers as Record<string, unknown>)) {
                  if (HOP_HEADERS.has(k.toLowerCase())) continue;
                  if (typeof v === "string" || Array.isArray(v)) respHeaders[k] = v as string | string[];
                }
              }
              const bodyBuf = Buffer.from(typeof reply.body === "string" ? reply.body : "", "base64");
              respHeaders["content-length"] = String(bodyBuf.length);
              res.writeHead(status, respHeaders);
              res.end(bodyBuf);
            })
            .catch(err => {
              if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
              res.end(`Preview tunnel error: ${err instanceof Error ? err.message : String(err)}`);
            });
        });
      });

      proxyServer.on("error", () => {
        allocatedPorts.delete(localPort);
        forwards.delete(port);
      });
      proxyServer.listen(localPort, "127.0.0.1");
      proxyServer.unref();
      forwards.set(port, { localPort, server: proxyServer });
      return `http://127.0.0.1:${localPort}`;
    },
    kill: async () => {
      conn.activeTasks.delete(taskId);
      for (const cmdId of [...taskCommands]) {
        taskCommands.delete(cmdId);
        conn.streams.delete(cmdId);
        await sendRpc(conn, "kill", { cmdId }, 5000).catch(() => undefined);
      }
      for (const [, fwd] of forwards) {
        allocatedPorts.delete(fwd.localPort);
        try { fwd.server.close(); } catch { /* ignore */ }
      }
      forwards.clear();
    },
  };
}
