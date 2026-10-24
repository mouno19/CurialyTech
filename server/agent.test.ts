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
    expect(dispatchModel({ ...base, mode: "chat", model: "llama3.1-70b", prompt: "Hi" }).spec.provider).toBe("core-inference");
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

describe("tool_result error content", () => {
  it("strips non-text blocks from is_error results in saved history", async () => {
    const { sanitizeErrorToolResults } = await import("./agent/runner");
    const history: any[] = [
      { role: "user", content: "hi" },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "a", is_error: true, content: [{ type: "text", text: "HTTP 404" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "xx" } }] },
        { type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "ok" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "yy" } }] },
        { type: "tool_result", tool_use_id: "c", is_error: true, content: "plain" },
      ] },
    ];
    expect(sanitizeErrorToolResults(history)).toBe(1);
    expect(history[1].content[0].content).toBe("HTTP 404");
    expect(history[1].content[1].content).toHaveLength(2); // successful results keep their screenshot
    expect(history[1].content[2].content).toBe("plain");
  });
});

describe("white-label scrubbing", () => {
  it("replaces vendor names, endpoints and credential names in platform messages", async () => {
    const { brandText } = await import("../shared/brand");
    expect(brandText("Snowflake Cortex returned 500 via https://kxjnkhs-lk29580.snowflakecomputing.com/api/v2/cortex/v1/messages"))
      .toBe("Curialy Core returned 500 via [internal endpoint]");
    expect(brandText("Browserbase session failed; set BROWSERBASE_API_KEY")).toBe("Curialy Live Browser session failed; set engine credential");
    expect(brandText("Render POST /services failed")).toBe("Curialy Cloud Deploy POST /services failed");
    expect(brandText("Manus task stopped")).toBe("Curialy Research Agent task stopped");
  });
});

describe("artifacts", () => {
  it("finds files created or changed during a run, including by commands, deliverables first", async () => {
    const { workspaceManifest, changedSince, classify } = await import("./agent/artifacts");
    const ws = path.join(process.env.AGENT_WORKSPACE_ROOT!, "artifact-run");
    fs.mkdirSync(path.join(ws, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(ws, "keep.txt"), "same");
    fs.writeFileSync(path.join(ws, "edit.ts"), "a");
    const before = workspaceManifest(ws);
    await new Promise(resolve => setTimeout(resolve, 15));
    fs.writeFileSync(path.join(ws, "edit.ts"), "ab");
    fs.writeFileSync(path.join(ws, "report.pdf"), "%PDF");
    fs.writeFileSync(path.join(ws, "bundle.zip"), "PK");
    fs.writeFileSync(path.join(ws, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(ws, "node_modules", "x", "index.js"), "");
    const changed = changedSince(before, workspaceManifest(ws));
    expect(changed).toEqual(["bundle.zip", "report.pdf", "edit.ts"]);
    expect(classify("notes.MD").kind).toBe("document");
    expect(classify("src/app.tsx").kind).toBe("code");
    expect(classify("data.csv").mimeType).toBe("text/csv");
  });
});

describe("user attachments", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

  it("detects real image types from bytes, not names", async () => {
    const { sniffImage } = await import("./agent/attachments");
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull();
  });

  it("stages files without overwriting earlier attachments and caps vision images", async () => {
    const { stageAttachments, userContent } = await import("./agent/attachments");
    const ws = path.join(process.env.AGENT_WORKSPACE_ROOT!, "attach-run");
    fs.mkdirSync(ws, { recursive: true });
    const load = async (stage: string) => (stage.endsWith(".png") ? png : Buffer.from("hello"));
    const ref = (id: string, filename: string) => ({ id, filename, stagePath: `s/${filename}`, mimeType: filename.endsWith(".png") ? "image/png" : "text/plain", sizeBytes: 1 });
    const first = await stageAttachments(ws, [ref("11111111-1111-4111-8111-111111111111", "shot.png"), ref("22222222-2222-4222-8222-222222222222", "notes.txt")], { vision: true, load });
    const second = await stageAttachments(ws, [ref("33333333-3333-4333-8333-333333333333", "shot.png")], { vision: false, load });
    expect(first.display.map(file => file.path)).toEqual(["attachments/shot-111111.png", "attachments/notes-222222.txt"]);
    expect(second.display[0].path).toBe("attachments/shot-333333.png"); // same name, distinct stable path
    expect(first.images).toEqual([{ mediaType: "image/png", mediaId: "11111111-1111-4111-8111-111111111111" }]);
    expect(second.images).toEqual([]);
    expect(second.note).toMatch(/cannot view images/);
    const content = userContent("look", first.images, "anthropic") as any[];
    expect(content[0]).toMatchObject({ type: "image", source: { type: "curialy_vault" } });
    expect(JSON.stringify(content)).not.toContain(png.toString("base64")); // stored as a reference, not bytes
    expect(userContent("look", first.images, "openai")).toBe("look");
  });

  it("hydrates vault image references into base64 blocks, once per run", async () => {
    const { hydrateImages } = await import("./agent/attachments");
    let loads = 0;
    const cache = new Map<string, string>();
    const convo = [
      { role: "user", content: [{ type: "image", source: { type: "curialy_vault", media_id: "m1", media_type: "image/png" } }, { type: "text", text: "hi" }] },
      { role: "user", content: [{ type: "image", source: { type: "curialy_vault", media_id: "gone", media_type: "image/png" } }] },
    ];
    const load = async (id: string) => { loads++; return id === "m1" ? png : null; };
    const out = await hydrateImages(convo, cache, load) as any[];
    await hydrateImages(convo, cache, load);
    expect(out[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    expect(out[1].content[0]).toEqual({ type: "text", text: "[An attached image is no longer available.]" });
    expect(convo[0].content[0].source.type).toBe("curialy_vault"); // stored history untouched
    expect(loads).toBe(2);
  });
});

describe("attachment limits (review fixes)", () => {
  const pngOf = (width: number, height: number) => {
    const header = Buffer.alloc(33);
    Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
    header.writeUInt32BE(13, 8); header.write("IHDR", 12, "latin1"); header.writeUInt32BE(width, 16); header.writeUInt32BE(height, 20);
    return header;
  };

  it("reads image dimensions and keeps oversized images out of the model input", async () => {
    const { imageSize, stageAttachments } = await import("./agent/attachments");
    expect(imageSize(pngOf(1440, 12000))).toEqual({ width: 1440, height: 12000 });
    const ws = path.join(process.env.AGENT_WORKSPACE_ROOT!, "attach-dims");
    fs.mkdirSync(ws, { recursive: true });
    const result = await stageAttachments(ws, [{ id: "44444444-4444-4444-8444-444444444444", filename: "tall.png", stagePath: "s", mimeType: "image/png", sizeBytes: 33 }], { vision: true, load: async () => pngOf(1440, 12000) });
    expect(result.images).toEqual([]);
    expect(result.note).toMatch(/dimensions too large/);
  });

  it("caps images per request newest-first and does not cache transient load failures", async () => {
    const { hydrateImages } = await import("./agent/attachments");
    const ref = (id: string) => ({ type: "image", source: { type: "curialy_vault", media_id: id, media_type: "image/png" } });
    const convo = Array.from({ length: 22 }, (_, i) => ({ role: "user", content: [ref(`m${i}`), { type: "text", text: `t${i}` }] }));
    const cache = new Map<string, string>();
    const out = await hydrateImages(convo, cache, async () => pngOf(10, 10)) as any[];
    const sent = out.flatMap(message => message.content).filter((block: any) => block.type === "image");
    expect(sent).toHaveLength(20);
    expect(out[0].content[0].type).toBe("text"); // oldest two replaced by a note
    expect(out[21].content[0].type).toBe("image");
    let calls = 0;
    const flaky = new Map<string, string>();
    const once = await hydrateImages([{ role: "user", content: [ref("x")] }], flaky, async () => { calls++; throw new Error("vault down"); }) as any[];
    expect(once[0].content[0].type).toBe("text");
    expect(flaky.has("x")).toBe(false); // retried next turn
    expect(calls).toBe(2); // one immediate retry
  });
});

describe("self-healing recovery", () => {
  const apiError = async (status: number, message: string, headers: Record<string, string> = {}) => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    return Anthropic.APIError.generate(status, { error: { message } }, message, new Headers(headers));
  };

  it("classifies failures into repairable kinds", async () => {
    const { diagnose } = await import("./agent/recovery");
    expect(diagnose(await apiError(429, "rate limited", { "retry-after": "7" }), false)).toMatchObject({ kind: "rate_limit", retryAfterMs: 7000 });
    expect(diagnose(await apiError(529, "Overloaded"), false).kind).toBe("transient");
    expect(diagnose(await apiError(400, "prompt is too long: 250000 tokens > 200000 maximum"), false).kind).toBe("context_overflow");
    expect(diagnose(await apiError(400, "messages.3: `tool_use` ids were found without `tool_result` blocks immediately after"), false).kind).toBe("tool_pairing");
    expect(diagnose(await apiError(400, "messages.1.content.0: Invalid `signature` in `thinking` block"), false).kind).toBe("thinking_history");
    expect(diagnose(await apiError(400, "tools.0.custom.eager_input_streaming: Extra inputs are not permitted"), false)).toMatchObject({ kind: "unsupported_param", param: "eager_input_streaming" });
    expect(diagnose(await apiError(400, "messages.2.content.0.image.source.base64: image exceeds 5 MB maximum"), false).kind).toBe("bad_image");
    expect(diagnose(await apiError(400, "messages.40.content.0.tool_result: all content must be type `text` if `is_error` is true"), false).kind).toBe("error_result_content");
    expect(diagnose(await apiError(404, "model: claude-x not found"), false).kind).toBe("model_unavailable");
    expect(diagnose(await apiError(401, "invalid x-api-key"), false).kind).toBe("auth");
    expect(diagnose(new Error("fetch failed"), false).kind).toBe("transient");
    expect(diagnose(new Error("Fast engine request failed (503): busy"), false).kind).toBe("transient");
    expect(diagnose(new Error("anything"), true).kind).toBe("cancelled");
  });

  it("repairs broken histories: unpaired tool calls, thinking blocks, oversized context", async () => {
    const { repairToolPairing, stripThinking, compactHistory } = await import("./agent/recovery");
    const convo: any[] = [
      { role: "user", content: "build it" },
      { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "tool_use", id: "a", name: "run_command", input: {} }, { type: "tool_use", id: "b", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "text", text: "note" }, { type: "tool_result", tool_use_id: "a", content: "ok" }, { type: "tool_result", tool_use_id: "zzz", content: "orphan" }] },
    ];
    expect(repairToolPairing(convo)).toBeGreaterThan(0);
    expect(convo[2].content.map((block: any) => block.tool_use_id ?? block.type)).toEqual(["b", "a", "text"]);
    expect(stripThinking(convo)).toBe(1);
    const long: any[] = [{ role: "user", content: "start" }];
    for (let i = 0; i < 12; i++) {
      long.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read_file", input: {} }] });
      long.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "x".repeat(10_000) }] });
    }
    compactHistory(long, 1);
    expect(long[2].content[0].content.length).toBeLessThan(2200);
    expect(long[long.length - 1].content[0].content.length).toBe(10_000); // recent tail untouched
    compactHistory(long, 3);
    expect(long.length).toBeLessThan(10);
    expect(long[0].content).toMatch(/earlier messages were removed/);
    expect(repairToolPairing(long)).toBe(0); // still valid after dropping turns
  });

  it("drives retries, repairs and failover through the engine, within budget", async () => {
    const { RecoveryEngine } = await import("./agent/recovery");
    const { getModel } = await import("../shared/agent");
    const events: any[] = [];
    let spec = getModel("claude-sonnet-4-5")!;
    const conversation: any[] = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_use", id: "q", name: "x", input: {} }] }];
    const engine = new RecoveryEngine({
      signal: new AbortController().signal, format: "anthropic", conversation, get spec() { return spec; }, flags: { noEager: false, noThinking: false, noEffort: false },
      switchModel: next => { spec = next; }, persist: () => undefined, emit: event => events.push(event), sleep: async () => undefined,
    });
    expect(await engine.handle(await apiError(429, "slow down"))).toBe(true);
    expect(await engine.handle(await apiError(400, "`tool_use` ids were found without `tool_result` blocks"))).toBe(true);
    expect(conversation).toHaveLength(3); // missing tool_result inserted
    expect(await engine.handle(await apiError(400, "tools.0.custom.eager_input_streaming: Extra inputs are not permitted"))).toBe(true);
    expect(await engine.handle(await apiError(400, "tools.0.custom.eager_input_streaming: Extra inputs are not permitted"))).toBe(false); // already disabled
    engine.succeeded();
    expect(await engine.handle(await apiError(404, "model not found"))).toBe(true);
    expect(spec.id).not.toBe("claude-sonnet-4-5");
    expect(await engine.handle(await apiError(401, "bad key"))).toBe(false);
    expect(events.map(event => event.kind)).toEqual(["rate_limit", "tool_pairing", "unsupported_param", "model_unavailable"]);
    // transient retries are bounded, then fail over
    engine.succeeded();
    for (let i = 0; i < 4; i++) expect(await engine.handle(await apiError(529, "Overloaded"))).toBe(true);
    const before = spec.id;
    expect(await engine.handle(await apiError(529, "Overloaded"))).toBe(true);
    expect(spec.id).not.toBe(before);
  });

  it("nudges the agent after repeated identical tool failures", async () => {
    const { ToolFailureWatch } = await import("./agent/recovery");
    const watch = new ToolFailureWatch();
    expect(watch.note("run_command", false, "exit code 1")).toBeNull();
    expect(watch.note("run_command", false, "exit code 1")).toBeNull();
    expect(watch.note("run_command", false, "exit code 1")).toMatch(/different approach/);
    expect(watch.note("run_command", true, "exit code 0")).toBeNull();
  });
});

describe("self-healing regressions (review findings)", () => {
  it("treats overload errors sent inside the stream (no HTTP status) as transient", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { diagnose } = await import("./agent/recovery");
    const sse = new Anthropic.APIError(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers());
    expect(diagnose(sse, false).kind).toBe("transient");
    expect(diagnose(new Error("Fast engine error: Internal server error"), false).kind).toBe("transient");
    expect(diagnose(new Error("Too many requests, slow down"), false).kind).toBe("rate_limit");
  });

  it("level-3 compaction keeps the user's latest request and trims the recent tail", async () => {
    const { compactHistory } = await import("./agent/recovery");
    const convo: any[] = [{ role: "user", content: "original task" }];
    for (let i = 0; i < 6; i++) {
      convo.push({ role: "assistant", content: [{ type: "tool_use", id: `a${i}`, name: "read_file", input: {} }] });
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `a${i}`, content: "y".repeat(500) }] });
    }
    convo.push({ role: "assistant", content: [{ type: "text", text: "done with part one" }] });
    convo.push({ role: "user", content: [{ type: "image", source: { type: "curialy_vault", media_id: "m", media_type: "image/png" } }, { type: "text", text: "NOW FIX THE HEADER" }] });
    for (let i = 0; i < 3; i++) {
      convo.push({ role: "assistant", content: [{ type: "tool_use", id: `b${i}`, name: "run_command", input: {} }] });
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `b${i}`, content: "z".repeat(50_000) }] });
    }
    compactHistory(convo, 2);
    expect(convo[convo.length - 1].content[0].content.length).toBeLessThan(4200); // tail trimmed at level 2
    compactHistory(convo, 3);
    const texts = JSON.stringify(convo);
    expect(texts).toContain("NOW FIX THE HEADER");
    expect(texts).toContain("curialy_vault"); // the request's screenshot survives
    expect(convo[0].content).toMatch(/^original task/);
  });

  it("fails over to a different route on outages and gives the new model its own attempts", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { RecoveryEngine } = await import("./agent/recovery");
    const { getModel } = await import("../shared/agent");
    let spec = getModel("claude-opus-5-5")!;
    const engine = new RecoveryEngine({
      signal: new AbortController().signal, format: "anthropic", conversation: [{ role: "user", content: "x" }], get spec() { return spec; },
      flags: { noEager: false, noThinking: false, noEffort: false }, switchModel: next => { spec = next; }, persist: () => undefined, emit: () => undefined, sleep: async () => undefined,
    });
    const overload = () => Anthropic.APIError.generate(529, { error: { message: "Overloaded" } }, "Overloaded", new Headers());
    for (let i = 0; i < 4; i++) await engine.handle(overload());
    expect(await engine.handle(overload())).toBe(true);
    expect(spec.provider).not.toBe("core"); // escaped the failing route
    expect(await engine.handle(overload())).toBe(true); // new model retries rather than ending the run
  });
});
