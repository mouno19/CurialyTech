// Standalone zero-dependency remote bridge script (agent.mjs), 1-line bash installer (connect.sh),
// and 1-click Google Colab notebook (.ipynb) generator.

export function renderAgentMjs(): string {
  return `#!/usr/bin/env node
// Curialy Remote Compute Bridge — zero-dependency Node.js agent for Google Colab & Linux VPS.
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

const WS_URL = process.env.CURIALY_WS_URL || "";
const TOKEN = process.env.CURIALY_TOKEN || "";
if (!WS_URL || !TOKEN) {
  console.error("[curialy] CURIALY_WS_URL and CURIALY_TOKEN are required.");
  process.exit(1);
}

const MAX_PAYLOAD = 32 * 1024 * 1024;
const BASE_ENV = {
  CI: "1",
  TERM: "dumb",
  NO_COLOR: "1",
  LANG: "C.UTF-8",
  npm_config_update_notifier: "false",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.directory",
  GIT_CONFIG_VALUE_0: "*",
  DANGEROUSLY_DISABLE_HOST_CHECK: "true",
};

function defaultWorkBase() {
  try {
    if (fs.existsSync("/content") && fs.statSync("/content").isDirectory()) {
      return "/content/curialy-workspaces";
    }
  } catch {}
  return path.join(os.homedir() || "/tmp", "curialy-workspaces");
}

function detectOs() {
  try {
    const raw = fs.readFileSync("/etc/os-release", "utf8");
    const m = /^PRETTY_NAME="?([^"\\n]+)"?/m.exec(raw);
    if (m) return m[1].trim();
  } catch {}
  return \`\${os.type()} \${os.release()}\`;
}

function detectRamAvailMb() {
  try {
    const mem = fs.readFileSync("/proc/meminfo", "utf8");
    const m = /^MemAvailable:\\s+(\\d+)\\s+kB/m.exec(mem);
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch {}
  return Math.round(os.freemem() / 1048576);
}

function detectDiskFreeGb(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const out = spawnSync("df", ["-Pk", dir], { encoding: "utf8", timeout: 3000 });
    if (out.status === 0 && out.stdout) {
      const lines = out.stdout.trim().split(/\\r?\\n/);
      const cols = lines[lines.length - 1].trim().split(/\\s+/);
      const availKb = Number(cols[3]);
      if (Number.isFinite(availKb)) return Math.round((availKb / 1048576) * 10) / 10;
    }
  } catch {}
  return 0;
}

let cachedGpu;
function detectGpu() {
  if (cachedGpu !== undefined) return cachedGpu;
  try {
    const out = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { encoding: "utf8", timeout: 4000 });
    if (out.status === 0 && out.stdout && out.stdout.trim()) {
      cachedGpu = out.stdout.trim().split(/\\r?\\n/)[0].replace(/,\\s*/, " · ").trim();
      return cachedGpu;
    }
  } catch {}
  cachedGpu = null;
  return null;
}

let cachedSudo;
function detectSudo() {
  if (cachedSudo !== undefined) return cachedSudo;
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    cachedSudo = true;
    return true;
  }
  try {
    const out = spawnSync("sudo", ["-n", "true"], { timeout: 2000, stdio: "ignore" });
    cachedSudo = out.status === 0;
  } catch {
    cachedSudo = false;
  }
  return cachedSudo;
}

function collectSpecs() {
  const workBase = defaultWorkBase();
  return {
    os: detectOs(),
    arch: os.arch(),
    cpus: Math.max(1, os.cpus()?.length || 1),
    ramMb: Math.round(os.totalmem() / 1048576),
    ramAvailMb: detectRamAvailMb(),
    diskFreeGb: detectDiskFreeGb(workBase),
    gpu: detectGpu(),
    hostname: os.hostname(),
    sudo: detectSudo(),
    workBase,
  };
}

function encodeClientFrame(opcode, payload) {
  const len = payload.length;
  const headerLen = 2 + (len < 126 ? 0 : len < 65536 ? 2 : 8) + 4;
  const frame = Buffer.allocUnsafe(headerLen + len);
  frame[0] = 0x80 | (opcode & 0x0f);
  let offset = 2;
  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }
  const mask = crypto.randomBytes(4);
  mask.copy(frame, offset);
  offset += 4;
  for (let i = 0; i < len; i++) frame[offset + i] = payload[i] ^ mask[i & 3];
  return frame;
}

function dialWebSocket(urlStr, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const secure = u.protocol === "wss:" || u.protocol === "https:";
    const port = Number(u.port) || (secure ? 443 : 80);
    const key = crypto.randomBytes(16).toString("base64");
    const expectedAccept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");

    const socket = secure
      ? tls.connect({ host: u.hostname, port, servername: u.hostname })
      : net.connect({ host: u.hostname, port });

    let settled = false;
    let headerBuf = Buffer.alloc(0);

    const fail = err => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      reject(err);
    };

    const connectTimer = setTimeout(() => fail(new Error("Connection handshake timed out")), 15000);

    const onConnect = () => {
      socket.setNoDelay(true);
      const reqPath = (u.pathname || "/") + (u.search || "");
      const req = [
        \`GET \${reqPath} HTTP/1.1\`,
        \`Host: \${u.host}\`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        \`Sec-WebSocket-Key: \${key}\`,
        "Sec-WebSocket-Version: 13",
        \`Authorization: Bearer \${token}\`,
        "User-Agent: curialy-runner/1.0",
        "\\r\\n",
      ].join("\\r\\n");
      socket.write(req);
    };

    socket.once(secure ? "secureConnect" : "connect", onConnect);
    socket.once("error", fail);

    const onHandshakeData = chunk => {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const idx = headerBuf.indexOf("\\r\\n\\r\\n");
      if (idx < 0) {
        if (headerBuf.length > 16384) fail(new Error("Oversized HTTP response header"));
        return;
      }
      clearTimeout(connectTimer);
      socket.removeListener("data", onHandshakeData);
      socket.removeListener("error", fail);

      const headText = headerBuf.subarray(0, idx).toString("utf8");
      const rest = headerBuf.subarray(idx + 4);
      const statusLine = headText.split("\\r\\n")[0] || "";
      const codeMatch = /^HTTP\\/1\\.[01]\\s+(\\d+)/.exec(statusLine);
      const status = codeMatch ? Number(codeMatch[1]) : 0;
      if (status !== 101) {
        const err = new Error(\`Upgrade rejected with HTTP \${status}\`);
        err.httpStatus = status;
        return fail(err);
      }
      const acceptMatch = /^sec-websocket-accept:\\s*(.+)$/im.exec(headText);
      if (!acceptMatch || acceptMatch[1].trim() !== expectedAccept) {
        return fail(new Error("Invalid Sec-WebSocket-Accept"));
      }

      settled = true;
      const ws = createWsSession(socket);
      if (rest.length > 0) socket.unshift(rest);
      resolve(ws);
    };

    socket.on("data", onHandshakeData);
  });
}

function createWsSession(socket) {
  const emitter = new EventEmitter();
  let open = true;
  let buf = Buffer.alloc(0);
  let fragChunks = [];
  let fragBytes = 0;
  let fragActive = false;

  const finish = (code, reason) => {
    if (!open) return;
    open = false;
    try { socket.end(); } catch {}
    setTimeout(() => { try { socket.destroy(); } catch {} }, 500).unref();
    emitter.emit("close", code, reason);
  };

  socket.on("data", chunk => {
    if (!open) return;
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    while (open && buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return finish(1009, "Payload too large");
        len = Number(big);
        offset = 10;
      }
      const total = offset + (masked ? 4 : 0) + len;
      if (buf.length < total) return;

      let payload;
      if (masked) {
        payload = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) payload[i] = buf[offset + 4 + i] ^ buf[offset + (i & 3)];
      } else {
        payload = Buffer.from(buf.subarray(offset, offset + len));
      }
      buf = buf.subarray(total);

      if (opcode >= 0x08) {
        if (opcode === 0x08) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
          const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
          try { socket.write(encodeClientFrame(0x08, payload.subarray(0, 2))); } catch {}
          return finish(code, reason);
        }
        if (opcode === 0x09) {
          try { socket.write(encodeClientFrame(0x0a, payload)); } catch {}
          continue;
        }
        continue;
      }

      if (opcode === 0x00) {
        if (!fragActive) return finish(1002, "Unexpected continuation");
        fragBytes += payload.length;
        if (fragBytes > MAX_PAYLOAD) return finish(1009, "Payload too large");
        fragChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(fragChunks, fragBytes);
          fragChunks = [];
          fragBytes = 0;
          fragActive = false;
          emitter.emit("message", full.toString("utf8"));
        }
      } else if (opcode === 0x01 || opcode === 0x02) {
        if (fin) {
          emitter.emit("message", payload.toString("utf8"));
        } else {
          fragActive = true;
          fragChunks = [payload];
          fragBytes = payload.length;
        }
      }
    }
  });

  socket.on("end", () => finish(1006, "ended"));
  socket.on("close", () => finish(1006, "closed"));
  socket.on("error", () => finish(1006, "socket error"));

  emitter.sendJson = obj => {
    if (!open) return false;
    try {
      return socket.write(encodeClientFrame(0x01, Buffer.from(JSON.stringify(obj), "utf8")));
    } catch {
      return false;
    }
  };
  emitter.ping = () => {
    if (!open) return;
    try { socket.write(encodeClientFrame(0x09, Buffer.alloc(0))); } catch {}
  };
  emitter.close = () => finish(1000, "closing");
  return emitter;
}

const runningCommands = new Map();

function resolveRemotePath(p) {
  if (typeof p !== "string" || !p) throw new Error("Invalid path");
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function killProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => {
    if (child.exitCode !== null) return;
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch {}
    }
  }, 400).unref();
}

async function handleRpc(ws, msg) {
  const { type, reqId } = msg;
  const reply = payload => ws.sendJson({ type: "res", reqId, ...payload });

  try {
    if (type === "exec") {
      const timeoutMs = Math.max(1000, Math.min(600_000, Number(msg.timeoutMs) || 60_000));
      const child = spawn("/bin/bash", ["-c", String(msg.command || "")], {
        detached: true,
        env: { ...process.env, ...BASE_ENV },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child);
      }, timeoutMs);
      child.stdout.on("data", d => { if (stdout.length < 4 * 1024 * 1024) stdout += d.toString("utf8"); });
      child.stderr.on("data", d => { if (stderr.length < 256 * 1024) stderr += d.toString("utf8"); });
      child.on("error", err => {
        clearTimeout(timer);
        reply({ ok: false, error: err.message });
      });
      child.on("close", code => {
        clearTimeout(timer);
        if (timedOut) return reply({ ok: false, error: "Command timed out", timedOut: true });
        if (code !== 0 && code !== null) {
          // Note: scan/helper commands in Curialy check markers inside stdout and end with '; true', so 0 is standard.
          return reply({ ok: true, stdout });
        }
        reply({ ok: true, stdout });
      });
      return;
    }

    if (type === "start") {
      const cmdId = String(msg.cmdId);
      const timeoutMs = Math.max(2000, Math.min(3600_000, Number(msg.timeoutMs) || 600_000));
      const extraEnv = msg.envs && typeof msg.envs === "object" ? msg.envs : {};
      const child = spawn("/bin/bash", ["-c", String(msg.command || "")], {
        detached: true,
        env: { ...process.env, ...BASE_ENV, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
      runningCommands.set(cmdId, child);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child);
      }, timeoutMs);

      child.stdout.on("data", chunk => ws.sendJson({ type: "stdout", cmdId, data: chunk.toString("utf8") }));
      child.stderr.on("data", chunk => ws.sendJson({ type: "stderr", cmdId, data: chunk.toString("utf8") }));
      child.on("error", err => {
        clearTimeout(timer);
        runningCommands.delete(cmdId);
        ws.sendJson({ type: "stderr", cmdId, data: \`Failed to start process: \${err.message}\\n\` });
        ws.sendJson({ type: "exit", cmdId, code: 127, timedOut: false });
      });
      child.on("close", code => {
        clearTimeout(timer);
        runningCommands.delete(cmdId);
        ws.sendJson({ type: "exit", cmdId, code: timedOut ? 124 : (code ?? 1), timedOut });
      });

      reply({ ok: true });
      return;
    }

    if (type === "kill") {
      const child = runningCommands.get(String(msg.cmdId));
      if (child) killProcessGroup(child);
      reply({ ok: true });
      return;
    }

    if (type === "write") {
      const files = Array.isArray(msg.files) ? msg.files : [];
      for (const item of files) {
        const target = resolveRemotePath(item.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(String(item.data || ""), "base64"));
      }
      reply({ ok: true });
      return;
    }

    if (type === "read") {
      const target = resolveRemotePath(msg.path);
      const buf = fs.readFileSync(target);
      reply({ ok: true, data: buf.toString("base64") });
      return;
    }

    if (type === "mkdir") {
      const target = resolveRemotePath(msg.path);
      fs.mkdirSync(target, { recursive: true });
      reply({ ok: true, path: target });
      return;
    }

    if (type === "http_req") {
      const port = Number(msg.port);
      const reqHeaders = msg.headers && typeof msg.headers === "object" ? { ...msg.headers } : {};
      reqHeaders.host = \`127.0.0.1:\${port}\`;
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port,
          method: String(msg.method || "GET"),
          path: String(msg.path || "/"),
          headers: reqHeaders,
          timeout: 25_000,
        },
        res => {
          const chunks = [];
          let total = 0;
          res.on("data", c => {
            total += c.length;
            if (total <= 20 * 1024 * 1024) chunks.push(c);
          });
          res.on("end", () => {
            reply({
              ok: true,
              status: res.statusCode || 502,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("base64"),
            });
          });
        },
      );
      upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
      upstream.on("error", err => reply({ ok: false, error: err.message }));
      if (msg.body) upstream.write(Buffer.from(String(msg.body), "base64"));
      upstream.end();
      return;
    }

    if (type === "ping_specs") {
      reply({ ok: true, specs: collectSpecs() });
      return;
    }

    reply({ ok: false, error: \`Unknown RPC type: \${type}\` });
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

let backoffMs = 1000;

async function connectLoop() {
  for (;;) {
    try {
      const ws = await dialWebSocket(WS_URL, TOKEN);
      backoffMs = 1000;
      const specs = collectSpecs();
      fs.mkdirSync(specs.workBase, { recursive: true });
      ws.sendJson({ type: "hello", specs });
      console.log(\`[curialy] connected (\${specs.os}, \${specs.cpus} CPUs, \${specs.ramMb} MB RAM\${specs.gpu ? ", " + specs.gpu : ""})\`);

      const pingTimer = setInterval(() => ws.ping(), 20_000);
      const specsTimer = setInterval(() => ws.sendJson({ type: "specs", specs: collectSpecs() }), 45_000);

      ws.on("message", raw => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.reqId) void handleRpc(ws, parsed);
        } catch {}
      });

      const closeCode = await new Promise(resolve => ws.once("close", code => resolve(code)));
      clearInterval(pingTimer);
      clearInterval(specsTimer);

      if (closeCode === 4001 || closeCode === 4002) {
        console.error(\`[curialy] connection closed permanently (code \${closeCode}). Exiting.\`);
        for (const child of runningCommands.values()) killProcessGroup(child);
        process.exit(0);
      }
      console.warn(\`[curialy] disconnected (code \${closeCode}), reconnecting in \${backoffMs}ms...\`);
    } catch (err) {
      if (err && err.httpStatus === 401) {
        console.error("[curialy] invalid or revoked environment token (HTTP 401). Exiting.");
        process.exit(1);
      }
      console.warn(\`[curialy] connection failed (\${err instanceof Error ? err.message : String(err)}), retrying in \${backoffMs}ms...\`);
    }
    await new Promise(r => setTimeout(r, backoffMs));
    backoffMs = Math.min(15_000, backoffMs * 2);
  }
}

process.on("SIGTERM", () => {
  for (const child of runningCommands.values()) killProcessGroup(child);
  process.exit(0);
});
process.on("SIGINT", () => {
  for (const child of runningCommands.values()) killProcessGroup(child);
  process.exit(0);
});

void connectLoop();
`;
}

export function renderConnectSh(baseOrigin: string): string {
  const cleanOrigin = baseOrigin.replace(/\/+$/, "");
  const wsOrigin = cleanOrigin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `#!/usr/bin/env bash
set -euo pipefail

ORIGIN="${cleanOrigin}"
WS_URL="${wsOrigin}/api/compute/ws"
MODE="auto"
TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service) MODE="service"; shift ;;
    --colab|--background) MODE="background"; shift ;;
    --foreground) MODE="foreground"; shift ;;
    --token) TOKEN="\${2:-}"; shift 2 ;;
    cur_env_*) TOKEN="$1"; shift ;;
    *) if [[ -z "$TOKEN" ]]; then TOKEN="$1"; fi; shift ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Error: missing Curialy environment token (cur_env_...)." >&2
  exit 1
fi

INSTALL_DIR="\${HOME:-/root}/.curialy"
mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"

# Ensure Node.js 16+ is available (pre-installed on Google Colab and most dev servers; auto-downloaded otherwise).
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$NODE_MAJOR" -ge 16 ]]; then
    NODE_BIN="$(command -v node)"
  fi
fi

if [[ -z "$NODE_BIN" && -x "$INSTALL_DIR/node/bin/node" ]]; then
  NODE_BIN="$INSTALL_DIR/node/bin/node"
fi

if [[ -z "$NODE_BIN" ]]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    *) echo "Unsupported CPU architecture: $ARCH. Please install Node.js 18+ first." >&2; exit 1 ;;
  esac
  echo "→ Installing portable Node.js 20 LTS ($NODE_ARCH)..."
  TMP_TAR="$(mktemp)"
  curl -fsSL "https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-\${NODE_ARCH}.tar.xz" -o "$TMP_TAR"
  rm -rf "$INSTALL_DIR/node" && mkdir -p "$INSTALL_DIR/node"
  if command -v xz >/dev/null 2>&1; then
    tar -xJf "$TMP_TAR" -C "$INSTALL_DIR/node" --strip-components=1
  else
    rm -f "$TMP_TAR"
    TMP_GZ="$(mktemp)"
    curl -fsSL "https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-\${NODE_ARCH}.tar.gz" -o "$TMP_GZ"
    tar -xzf "$TMP_GZ" -C "$INSTALL_DIR/node" --strip-components=1
    rm -f "$TMP_GZ"
  fi
  rm -f "$TMP_TAR"
  NODE_BIN="$INSTALL_DIR/node/bin/node"
fi

curl -fsSL "$ORIGIN/api/compute/agent.mjs" -o "$INSTALL_DIR/agent.mjs"
chmod 700 "$INSTALL_DIR/agent.mjs"

cat > "$INSTALL_DIR/runner.env" <<EOF
CURIALY_WS_URL=$WS_URL
CURIALY_TOKEN=$TOKEN
EOF
chmod 600 "$INSTALL_DIR/runner.env"

cat > "$INSTALL_DIR/start.sh" <<EOF
#!/usr/bin/env bash
set -a
source "$INSTALL_DIR/runner.env"
set +a
exec "$NODE_BIN" "$INSTALL_DIR/agent.mjs"
EOF
chmod 700 "$INSTALL_DIR/start.sh"

# Auto-detect Google Colab vs systemd Linux VPS
if [[ "$MODE" == "auto" ]]; then
  if [[ -n "\${COLAB_RELEASE_TAG:-}" || -d "/content" ]]; then
    MODE="background"
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
    MODE="service"
  else
    MODE="background"
  fi
fi

if [[ "$MODE" == "foreground" ]]; then
  exec "$INSTALL_DIR/start.sh"
fi

if [[ "$MODE" == "service" ]]; then
  RUN_USER="$(id -un)"
  SERVICE_UNIT="[Unit]
Description=Curialy Remote Compute Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
EnvironmentFile=$INSTALL_DIR/runner.env
ExecStart=$NODE_BIN $INSTALL_DIR/agent.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"
  if [[ "$(id -u)" -eq 0 ]]; then
    printf "%s" "$SERVICE_UNIT" > /etc/systemd/system/curialy-runner.service
    systemctl daemon-reload
    systemctl enable --now curialy-runner.service >/dev/null 2>&1
    systemctl restart curialy-runner.service
    sleep 2
    if systemctl is-active --quiet curialy-runner.service; then
      echo "✓ Curialy compute bridge is connected and active 24/7 (systemd: curialy-runner.service)."
      exit 0
    fi
  elif sudo -n true 2>/dev/null; then
    printf "%s" "$SERVICE_UNIT" | sudo tee /etc/systemd/system/curialy-runner.service >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now curialy-runner.service >/dev/null 2>&1
    sudo systemctl restart curialy-runner.service
    sleep 2
    if sudo systemctl is-active --quiet curialy-runner.service; then
      echo "✓ Curialy compute bridge is connected and active 24/7 (systemd: curialy-runner.service)."
      exit 0
    fi
  fi
  # Fall through to background daemon if systemd wasn't writable.
fi

# Stop any previous background runner from this install directory
if [[ -f "$INSTALL_DIR/runner.pid" ]]; then
  OLD_PID="$(cat "$INSTALL_DIR/runner.pid" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.4
  fi
fi

: > "$INSTALL_DIR/runner.log"
nohup "$INSTALL_DIR/start.sh" > "$INSTALL_DIR/runner.log" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$INSTALL_DIR/runner.pid"

for _ in {1..20}; do
  if grep -q "\\[curialy\\] connected" "$INSTALL_DIR/runner.log" 2>/dev/null; then
    grep -m1 "\\[curialy\\] connected" "$INSTALL_DIR/runner.log" | sed 's/\\[curialy\\] connected/✓ Connected to Curialy!/'
    echo "  Your Curialy agent now runs code directly on this environment."
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "✗ Curialy bridge exited early:" >&2
    cat "$INSTALL_DIR/runner.log" >&2
    exit 1
  fi
  sleep 0.4
done

echo "→ Curialy bridge started in background (PID $NEW_PID). Log: $INSTALL_DIR/runner.log"
`;
}

export function renderColabNotebook(baseOrigin: string, token: string, envName: string): string {
  const cleanOrigin = baseOrigin.replace(/\/+$/, "");
  const cmd = `!curl -fsSL ${cleanOrigin}/api/compute/connect.sh | bash -s -- --colab ${token}`;
  const notebook = {
    nbformat: 4,
    nbformat_minor: 0,
    metadata: {
      colab: {
        provenance: [],
        name: `Curialy — ${envName}.ipynb`,
      },
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
      },
      accelerator: "GPU",
    },
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          `# Connect **${envName}** to Curialy AI\n`,
          "\n",
          "1. *(Optional)* For a free GPU, click **Runtime → Change runtime type → T4 GPU**.\n",
          "2. Click the **Play (▶)** button on the cell below.\n",
          "3. Once it prints `✓ Connected to Curialy!`, return to **Curialy** — your tasks will run directly on this Colab runtime while this tab stays open.",
        ],
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [cmd],
      },
    ],
  };
  return JSON.stringify(notebook, null, 2);
}
