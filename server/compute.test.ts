import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderAgentMjs, renderColabNotebook, renderConnectSh } from "./compute/agent-script";
import {
  attachComputeHub,
  disconnectEnvironment,
  EnvironmentOfflineError,
  hasOnlineUserEnvironment,
  liveEnvironmentState,
  openConnectedEnvironmentBox,
} from "./compute/hub";
import {
  ComputeConfigError,
  generateEnvironmentToken,
  hashEnvironmentToken,
  normalizeWorkDir,
  sanitizeSpecs,
  type StoredEnvironmentRow,
} from "./compute/store";

describe("compute store helpers", () => {
  it("generates cur_env_ tokens and deterministic sha256 hashes", () => {
    const { token, tokenHash } = generateEnvironmentToken();
    expect(token.startsWith("cur_env_")).toBe(true);
    expect(token.length).toBeGreaterThan(30);
    expect(hashEnvironmentToken(token)).toBe(tokenHash);
  });

  it("validates custom working directories and rejects traversal", () => {
    expect(normalizeWorkDir("")).toBeNull();
    expect(normalizeWorkDir(null)).toBeNull();
    expect(normalizeWorkDir("/content/my-app/")).toBe("/content/my-app");
    expect(normalizeWorkDir("~/projects/api")).toBe("~/projects/api");
    expect(() => normalizeWorkDir("relative/path")).toThrow(ComputeConfigError);
    expect(() => normalizeWorkDir("/srv/../etc/passwd")).toThrow(ComputeConfigError);
  });

  it("sanitizes reported hardware specs safely", () => {
    const specs = sanitizeSpecs({
      os: "Ubuntu 22.04.5 LTS",
      arch: "x64",
      cpus: 2,
      ramMb: 13004,
      ramAvailMb: 11800,
      diskFreeGb: 107.68,
      gpu: "Tesla T4 · 15360 MiB",
      hostname: "colab-vm",
      sudo: true,
      workBase: "/content/curialy-workspaces",
    });
    expect(specs).toMatchObject({
      os: "Ubuntu 22.04.5 LTS",
      cpus: 2,
      ramMb: 13004,
      diskFreeGb: 107.7,
      gpu: "Tesla T4 · 15360 MiB",
      sudo: true,
    });
  });

  it("renders valid connect.sh script and Colab .ipynb JSON", () => {
    const sh = renderConnectSh("https://curialy.tech");
    expect(sh).toContain('WS_URL="wss://curialy.tech/api/compute/ws"');
    expect(sh).toContain("curialy-runner.service");

    const nb = JSON.parse(renderColabNotebook("https://curialy.tech", "cur_env_abc12345678901234567890", "Colab T4"));
    expect(nb.nbformat).toBe(4);
    expect(nb.cells[1].source[0]).toContain("https://curialy.tech/api/compute/connect.sh");
    expect(nb.cells[1].source[0]).toContain("cur_env_abc12345678901234567890");
  });
});

describe.skipIf(process.platform === "win32")("compute WebSocket tunnel hub + standalone agent.mjs", () => {
  let server: http.Server;
  let port = 0;
  let tmpDir: string;
  let agentProc: ChildProcess | null = null;

  const VALID_TOKEN = "cur_env_live_test_token_1234567890abcdef";
  const ENV_ID = "11111111-2222-4333-8444-555555555555";
  const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  let envRow: StoredEnvironmentRow;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-compute-test-"));
    envRow = {
      id: ENV_ID,
      user_id: USER_ID,
      name: "Test Colab Runtime",
      kind: "colab",
      work_dir: path.join(tmpDir, "workspaces"),
      specs: null,
      is_default: true,
      last_seen_at: null,
      created_at: new Date(),
    };

    server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    attachComputeHub(server, {
      auth: async token => (token === VALID_TOKEN ? envRow : null),
      persistSpecs: async (_id, specs) => {
        envRow.specs = specs;
      },
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.address() as { port: number }).port;

    const agentScriptPath = path.join(tmpDir, "agent.mjs");
    fs.writeFileSync(agentScriptPath, renderAgentMjs(), "utf8");

    agentProc = spawn(process.execPath, [agentScriptPath], {
      env: {
        ...process.env,
        CURIALY_WS_URL: `ws://127.0.0.1:${port}/api/compute/ws`,
        CURIALY_TOKEN: VALID_TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for agent handshake
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const state = liveEnvironmentState(ENV_ID);
      if (state.online && state.specs) break;
      await new Promise(r => setTimeout(r, 60));
    }
  });

  afterAll(async () => {
    disconnectEnvironment(ENV_ID);
    if (agentProc && agentProc.exitCode === null) {
      agentProc.kill("SIGTERM");
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("connects outbound and reports live hardware telemetry", () => {
    const state = liveEnvironmentState(ENV_ID);
    expect(state.online).toBe(true);
    expect(hasOnlineUserEnvironment(USER_ID)).toBe(true);
    expect(state.specs?.cpus).toBeGreaterThanOrEqual(1);
    expect(state.specs?.ramMb).toBeGreaterThan(64);
  });

  it("executes commands, streams stdout/stderr with secret envs, syncs files, and tunnels HTTP previews", async () => {
    const taskId = "task-compute-e2e-01";
    const box = await openConnectedEnvironmentBox(taskId, {
      ...envRow,
      work_dir: path.join(tmpDir, "workspaces", taskId),
    });

    try {
      expect(box.persistent).toBe(true);
      expect(box.root).toBe(path.join(tmpDir, "workspaces", taskId));

      // 1. Batched write + read
      const payload = Buffer.from("export const greeting = 'hello from colab';\n", "utf8");
      await box.write([{ path: `${box.root}/src/hello.ts`, data: payload }]);
      const readBack = await box.read(`${box.root}/src/hello.ts`);
      expect(readBack.toString("utf8")).toBe(payload.toString("utf8"));

      // 2. Streaming start with secret env injection
      let out = "";
      let err = "";
      const handle = await box.start(`cd ${box.root} && printf "%s" "$MY_SECRET_KEY" && echo "err-line" >&2`, {
        timeoutMs: 10_000,
        envs: { MY_SECRET_KEY: "s3cr3t_val" },
        onStdout: d => { out += d; },
        onStderr: d => { err += d; },
      });
      const code = await handle.wait();
      expect(code).toBe(0);
      expect(out).toBe("s3cr3t_val");
      expect(err).toContain("err-line");

      // 3. HTTP preview tunneling over the WebSocket bridge
      const srvPort = 39871;
      const webServer = await box.start(
        `node -e "const http=require('http'); http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({url:req.url,ok:true}));}).listen(${srvPort},'127.0.0.1');"`,
        {
          timeoutMs: 15_000,
          onStdout: () => undefined,
          onStderr: () => undefined,
        },
      );

      const tunnelBase = box.host(srvPort);
      expect(tunnelBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      let respJson: { url?: string; ok?: boolean } | null = null;
      for (let i = 0; i < 20; i++) {
        try {
          const r = await fetch(`${tunnelBase}/health?x=1`);
          if (r.ok) {
            respJson = (await r.json()) as { url: string; ok: boolean };
            break;
          }
        } catch {
          /* wait for remote server listen */
        }
        await new Promise(r => setTimeout(r, 80));
      }
      expect(respJson).toEqual({ url: "/health?x=1", ok: true });
      await webServer.kill();
    } finally {
      await box.kill();
    }
  });

  it("throws EnvironmentOfflineError cleanly when offline so e2b.ts falls back automatically", async () => {
    const offlineRow: StoredEnvironmentRow = {
      ...envRow,
      id: "99999999-9999-4999-8999-999999999999",
      name: "Disconnected VPS",
    };
    await expect(openConnectedEnvironmentBox("task-offline", offlineRow)).rejects.toThrow(EnvironmentOfflineError);
  });
});
