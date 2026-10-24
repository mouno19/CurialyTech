import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-test-"));
process.env.CURIALY_DATA_DIR = path.join(tmp, "data");
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "ws");
process.env.AGENT_SANDBOX = "none";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });

const sandbox = await import("./agent/sandbox");
const tools = await import("./agent/tools");
const { dispatchModel } = await import("./agent/runner");
const auth = await import("./auth");

const root = path.join(process.env.AGENT_WORKSPACE_ROOT, "task-under-test");
const outside = path.join(tmp, "secret.txt");

beforeAll(() => {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(outside, "top secret");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function ctx() {
  const events: any[] = [];
  return {
    events,
    value: { root, sessionId: "00000000-0000-4000-8000-000000000000", vision: false, callId: "call-1", signal: new AbortController().signal, emit: (event: any) => events.push(event), onPlan: vi.fn(), onFileChange: vi.fn(), onCommand: vi.fn() },
  };
}

describe("workspace confinement", () => {
  it("rejects traversal outside the workspace", () => {
    expect(() => sandbox.resolveInWorkspace(root, "../secret.txt")).toThrow(/escapes/);
    expect(() => sandbox.resolveInWorkspace(root, "a/../../../etc/passwd")).toThrow(/escapes/);
  });

  it("treats absolute paths as workspace-relative", () => {
    expect(sandbox.resolveInWorkspace(root, "/etc/passwd").relative).toBe(path.join("etc", "passwd"));
  });

  it("refuses to read or write through a symlink that points outside", () => {
    fs.symlinkSync(outside, path.join(root, "link.txt"));
    fs.symlinkSync(tmp, path.join(root, "linkdir"));
    expect(() => sandbox.readWorkspaceFile(root, "link.txt")).toThrow(/outside/);
    expect(() => sandbox.writeWorkspaceFile(root, "linkdir/secret.txt", "pwned")).toThrow(/outside/);
    expect(fs.readFileSync(outside, "utf8")).toBe("top secret");
  });

  it("validates task ids used as directory names", () => {
    expect(() => sandbox.workspacePath("../../etc")).toThrow();
    expect(sandbox.workspacePath("2b1c9f4e-1111-4222-8333-944455556666")).toContain("2b1c9f4e");
  });
});

describe("file tools", () => {
  it("creates, edits and reports diffs", async () => {
    const { value, events } = ctx();
    const created = await tools.executeTool("write_file", { path: "src/a.ts", content: "export const a = 1;\n" }, value);
    expect(created.ok).toBe(true);
    const edited = await tools.executeTool("edit_file", { path: "src/a.ts", old_string: "= 1", new_string: "= 2" }, value);
    expect(edited.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe("export const a = 2;\n");
    const changes = events.filter(event => event.type === "file_change");
    expect(changes.map(change => change.kind)).toEqual(["create", "modify"]);
    expect(changes[1]).toMatchObject({ added: 1, removed: 1, path: "src/a.ts" });
  });

  it("refuses ambiguous edits and invalid input", async () => {
    const { value } = ctx();
    await tools.executeTool("write_file", { path: "dup.txt", content: "x\nx\n" }, value);
    expect((await tools.executeTool("edit_file", { path: "dup.txt", old_string: "x", new_string: "y" }, value)).content).toMatch(/matches 2 places/);
    expect((await tools.executeTool("write_file", { path: "z.txt" }, value)).content).toMatch(/INVALID_INPUT/);
  });

  it("does not treat $ patterns in replacements specially", async () => {
    const { value } = ctx();
    await tools.executeTool("write_file", { path: "d.txt", content: "price\n" }, value);
    await tools.executeTool("edit_file", { path: "d.txt", old_string: "price", new_string: "$& $1 $$" }, value);
    expect(fs.readFileSync(path.join(root, "d.txt"), "utf8")).toBe("$& $1 $$\n");
  });

  it("runs commands in the workspace and streams output", async () => {
    const { value, events } = ctx();
    const result = await tools.executeTool("run_command", { command: "pwd; echo err >&2; exit 3" }, value);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.content).toContain(fs.realpathSync(root));
    expect(events.some(event => event.type === "tool_output" && event.stream === "stderr")).toBe(true);
  });

  it("recognises verification commands", () => {
    expect(tools.isVerificationCommand("npx tsc --noEmit")).toBe(true);
    expect(tools.isVerificationCommand("npm run test")).toBe(true);
    expect(tools.isVerificationCommand("python3 -m pytest -q")).toBe(true);
    expect(tools.isVerificationCommand("npm install zod")).toBe(false);
  });
});

describe("model dispatch", () => {
  const base = { model: "auto", mode: "agent" as const, effort: "medium" as const, webSearch: false };
  it("routes complex debugging to Opus 5.5 and routine edits to Sonnet 4.5", () => {
    expect(dispatchModel({ ...base, prompt: "Debug the race condition in the job queue" }).spec.id).toBe("claude-opus-5-5");
    expect(dispatchModel({ ...base, prompt: "Rename the button label to Save" }).spec.id).toBe("claude-sonnet-4-5");
    expect(dispatchModel({ ...base, effort: "high", prompt: "Rename a variable" }).spec.id).toBe("claude-opus-5-5");
  });

  it("rejects tool-less models in agent mode", () => {
    expect(() => dispatchModel({ ...base, model: "llama3.1-70b", prompt: "Build a CLI" })).toThrow(/cannot call tools/);
    expect(dispatchModel({ ...base, mode: "chat", model: "llama3.1-70b", prompt: "Hi" }).spec.provider).toBe("cortex-inference");
  });
});

describe("admin auth", () => {
  it("verifies scrypt hashes", () => {
    const stored = auth.hashPassword("correct horse battery");
    expect(auth.verifyPassword("correct horse battery", stored)).toBe(true);
    expect(auth.verifyPassword("wrong", stored)).toBe(false);
    expect(auth.verifyPassword("x", "plain:text")).toBe(false);
  });
});

describe("github helpers", () => {
  it("encrypts tokens at rest and detects tampering", async () => {
    process.env.GITHUB_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
    const github = await import("./services/github");
    const sealed = github.encryptToken("gho_example_token");
    expect(sealed.ciphertext.toString("utf8")).not.toContain("gho_");
    expect(github.decryptToken(sealed)).toBe("gho_example_token");
    sealed.ciphertext[0] ^= 1;
    expect(() => github.decryptToken(sealed)).toThrow();
  });

  it("validates repository names", async () => {
    const github = await import("./services/github");
    expect(github.isValidRepoName("curialy-slugify_1.0")).toBe(true);
    expect(github.isValidRepoName("../evil")).toBe(false);
    expect(github.isValidRepoName("..")).toBe(false);
    expect(github.isValidRepoName("a b")).toBe(false);
  });
});

describe("linked repo change detection", () => {
  it("lists modified, added and deleted files, respecting .gitignore and never .git/", async () => {
    const { computeChanges } = await import("./agent/repos");
    const { execFileSync } = await import("node:child_process");
    const repoRoot = path.join(process.env.AGENT_WORKSPACE_ROOT!, "repo-under-test");
    fs.mkdirSync(repoRoot, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repoRoot, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repoRoot, "keep.txt"), "a\n");
    fs.writeFileSync(path.join(repoRoot, "remove.txt"), "b\n");
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "secret.env\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const baseSha = git("rev-parse", "HEAD").trim();
    fs.writeFileSync(path.join(repoRoot, "keep.txt"), "changed\n");
    fs.unlinkSync(path.join(repoRoot, "remove.txt"));
    fs.mkdirSync(path.join(repoRoot, "src"));
    fs.writeFileSync(path.join(repoRoot, "src", "new file.ts"), "export {};\n");
    fs.writeFileSync(path.join(repoRoot, "secret.env"), "TOKEN=x\n");
    const changes = await computeChanges(repoRoot, { fullName: "o/r", url: "", branch: "main", baseSha, repoPath: ".", pushed: {}, deleted: [] });
    expect(changes.changed.sort()).toEqual(["keep.txt", "src/new file.ts"]);
    expect(changes.deleted).toEqual(["remove.txt"]);
    await expect(computeChanges(repoRoot, { fullName: "o/r", url: "", branch: "main", baseSha: "not-a-sha; rm -rf /", repoPath: ".", pushed: {}, deleted: [] })).rejects.toThrow(/Invalid base sha/);
  });
});

describe("workspace previews", () => {
  it("signs task-scoped, expiring tokens", async () => {
    process.env.SESSION_SECRET = "x".repeat(40);
    const preview = await import("./agent/preview");
    const id = "2b1c9f4e-1111-4222-8333-944455556666";
    const token = preview.previewToken(id);
    expect(preview.verifyPreviewToken(id, token)).toBe(true);
    expect(preview.verifyPreviewToken("3b1c9f4e-1111-4222-8333-944455556666", token)).toBe(false);
    expect(preview.verifyPreviewToken(id, preview.previewToken(id, -10))).toBe(false);
    expect(preview.verifyPreviewToken(id, "abc.def")).toBe(false);
  });

  it("flags absolute asset paths that would escape the preview", async () => {
    const { absoluteAssetWarnings } = await import("./agent/preview");
    expect(absoluteAssetWarnings('<script src="/assets/index.js"></script><link href="./a.css"><a href="//cdn.x/y">')).toEqual(["/assets/index.js"]);
  });
});
