import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  commandScript, COMPUTE, computeStatus, openComputeBox, parseNodes, pickNode, tarFiles, useComputeNodes, useComputeTransport,
  type ComputeNode, type Transport,
} from "./agent/cluster-sandbox";

// Curialy Dedicated Isolated Compute without the nodes: the transport is faked, so what the server
// sends to a node (docker commands, scripts on stdin) is checked as text.

const node = (name: string, extra: Partial<ComputeNode> = {}): ComputeNode => ({ name, target: `ubuntu@${name}.internal`, key: "/home/ubuntu/.ssh/k.pem", active: new Set(), reserved: 0, healthy: true, checkedAt: Date.now(), freeDiskKb: 5 * 1024 * 1024, freeMemoryKb: 7 * 1024 * 1024, remapId: 100000, ...extra });
const TASK = "11111111-2222-4333-8444-555555555555";

type Call = { node: string; args: string[]; input: string };
let calls: Call[] = [];
let answer: (call: Call) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0 });

const fakeTransport: Transport = (target, args, opts = {}) => {
  const call = { node: target.name, args, input: opts.input === undefined ? "" : Buffer.isBuffer(opts.input) ? opts.input.toString("latin1") : opts.input };
  calls.push(call);
  const reply = answer(call);
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true }) as never;
  if (reply.stdout) opts.onStdout?.(reply.stdout);
  if (reply.stderr) opts.onStderr?.(reply.stderr);
  return { child, done: Promise.resolve({ code: reply.code, stdout: Buffer.from(reply.stdout ?? ""), stderr: reply.stderr ?? "" }) };
};

beforeEach(() => {
  calls = [];
  answer = call => (call.args[0].includes("docker inspect") ? { code: 0, stdout: "172.30.0.7\n" } : { code: 0 });
  useComputeTransport(fakeTransport);
});

describe("nodes", () => {
  it("are read from CURIALY_COMPUTE_NODES and malformed entries are skipped", () => {
    const list = parseNodes("node-1=ubuntu@10.0.0.1#/home/ubuntu/.ssh/a.pem; node-2=ubuntu@10.0.0.2#/home/ubuntu/.ssh/b.pem;bad entry");
    expect(list.map(item => [item.name, item.target, item.key])).toEqual([["node-1", "ubuntu@10.0.0.1", "/home/ubuntu/.ssh/a.pem"], ["node-2", "ubuntu@10.0.0.2", "/home/ubuntu/.ssh/b.pem"]]);
  });

  it("place a sandbox on the least-loaded node with room, round robin on ties", () => {
    const a = node("a");
    const b = node("b");
    expect(new Set([pickNode([a, b])!.name, pickNode([a, b])!.name])).toEqual(new Set(["a", "b"]));
    a.active = new Set(["t1", "t2"]);
    b.active = new Set(["t3"]);
    expect(pickNode([a, b])!.name).toBe("b");
    b.active = new Set(["t3", "t4", "t5", "t6", "t7", "t8"]);
    expect(pickNode([a, b])!.name).toBe("a");
  });

  it("refuse full, unhealthy, disk-starved or memory-starved nodes", () => {
    expect(pickNode([node("full", { active: new Set(["1", "2", "3", "4", "5", "6"]) })])).toBeNull();
    expect(pickNode([node("down", { healthy: false })])).toBeNull();
    expect(pickNode([node("disk", { freeDiskKb: 300 * 1024 })])).toBeNull();
    expect(pickNode([node("memory", { freeMemoryKb: 512 * 1024 })])).toBeNull();
  });
});

describe("a dedicated sandbox", () => {
  it("starts with 1 GB, 1 GB of swap, one CPU, a process limit and its own workspace, on the sandbox network", async () => {
    useComputeNodes([node("a")]);
    const box = await openComputeBox(TASK);
    const start = calls.find(call => call.args[0].includes("docker run"))!.args[0];
    for (const flag of ["--memory=1024m", "--memory-swap=2048m", "--cpus=1.0", "--pids-limit=512", "--network curialy-sbx", "no-new-privileges", `-v /srv/curialy-workspaces/${TASK}:/home/user/workspace`, `install -d -o 100000 -g 100000 -m 0700 /srv/curialy-workspaces/${TASK}`, `--name curialy-sbx-${TASK}`]) {
      expect(start, flag).toContain(flag);
    }
    expect(computeStatus().active).toBe(1);
    await box.kill();
    expect(calls.at(-1)!.args[0]).toContain(`docker rm -f curialy-sbx-${TASK}`);
    expect(calls.at(-1)!.args[0]).toContain(`rm -rf /srv/curialy-workspaces/${TASK}`);
    expect(computeStatus().active).toBe(0);
  });

  it("sends commands and the task's secrets on stdin, never in a process list", async () => {
    useComputeNodes([node("a")]);
    const box = await openComputeBox(TASK);
    let out = "";
    const running = await box.start("npm run build", { timeoutMs: 10_000, onStdout: data => { out += data; }, onStderr: () => undefined, envs: { API_TOKEN: "s3cr'et" } });
    const call = calls.at(-1)!;
    expect(call.args.join(" ")).not.toContain("s3cr");
    expect(call.args.join(" ")).not.toContain("npm run build");
    expect(call.input).toContain("export API_TOKEN='s3cr'\\''et'");
    expect(call.input).toContain("exec bash -c 'npm run build' </dev/null");
    expect(await running.wait()).toBe(0);
    void out;
  });

  it("is gone when the node stops answering or the container disappeared, and a failed command is only a failure", async () => {
    useComputeNodes([node("a")]);
    const box = await openComputeBox(TASK);
    answer = () => ({ code: 255, stderr: "ssh: connect to host 10.0.0.1 port 22: Connection timed out" });
    await expect((await box.start("true", { timeoutMs: 5000, onStdout: () => undefined, onStderr: () => undefined })).wait()).rejects.toMatchObject({ gone: true });
    answer = () => ({ code: 1, stderr: "Error response from daemon: No such container: curialy-sbx-x" });
    await expect(box.exec("ls")).rejects.toMatchObject({ gone: true });
    answer = () => ({ code: 7, stderr: "curl: (7) Failed to connect: Connection refused" });
    await expect(box.exec("curl localhost")).rejects.toMatchObject({ exitCode: 7 });
    await expect(box.exec("curl localhost")).rejects.not.toMatchObject({ gone: true });
  });

  it("refuses an id that isn't a task id", async () => {
    useComputeNodes([node("a")]);
    await expect(openComputeBox("x; rm -rf /")).rejects.toThrow(/Invalid task id/);
  });

  it("speaks only of Curialy's compute", () => {
    expect(COMPUTE.name).toBe("Curialy Dedicated Isolated Compute");
    const source = fs.readFileSync(path.join(__dirname, "agent/cluster-sandbox.ts"), "utf8");
    expect(source).not.toMatch(/\b(aws|amazon|ec2|e2b)\b/i);
    expect(commandScript("echo hi")).not.toMatch(/\b(aws|amazon|e2b)\b/i);
  });
});

describe("uploads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compute-tar-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("are a tar stream GNU tar extracts, long and non-ASCII names included", () => {
    const long = `home/user/workspace/${"deep/".repeat(30)}file.ts`;
    const files = [{ path: "/home/user/workspace/src/a.ts", data: Buffer.from("export const a = 1;\n") }, { path: `/${long}`, data: Buffer.from("long\n") }, { path: "/home/user/workspace/données/é.txt", data: Buffer.from("accent\n") }, { path: "/home/user/workspace/../etc/passwd", data: Buffer.from("no") }];
    const archive = path.join(dir, "upload.tar");
    fs.writeFileSync(archive, tarFiles(files));
    execFileSync("tar", ["-x", "-f", archive, "-C", dir]);
    expect(fs.readFileSync(path.join(dir, "home/user/workspace/src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(fs.readFileSync(path.join(dir, long), "utf8")).toBe("long\n");
    expect(fs.readFileSync(path.join(dir, "home/user/workspace/données/é.txt"), "utf8")).toBe("accent\n");
    expect(fs.existsSync(path.join(dir, "home/user/etc/passwd"))).toBe(false);
  });
});
