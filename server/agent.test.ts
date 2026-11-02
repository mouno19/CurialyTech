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
const { dispatchModel, formatFor } = await import("./agent/runner");
const { getModel, PICKER_MODELS, wireModel } = await import("../shared/agent");
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

describe("operator-only tools", () => {
  it("are never offered to a free account's run, and refused if one asks for them anyway", async () => {
    const offered = (operator: boolean) => tools.toolsFor({ coding: true, web: true, eager: false, github: true, operator }).map(tool => tool.name);
    for (const name of tools.OPERATOR_TOOLS) expect(offered(false)).not.toContain(name);
    expect(offered(false)).toContain("run_command");
    const { value } = ctx();
    for (const name of ["deploy_preview", "delegate_research", "browser_click", "browser_type"]) {
      const outcome = await tools.executeTool(name, {}, { ...value, operator: false });
      expect(outcome, name).toMatchObject({ ok: false, summary: "Not available" });
    }
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
  it("routes by need: Opus 5.5 for complex or high effort, Sonnet 5.5 for routine work, Haiku 5.5 for quick asks", () => {
    expect(dispatchModel({ ...base, prompt: "Debug the race condition in the job queue" }).spec.id).toBe("claude-opus-5-5");
    expect(dispatchModel({ ...base, prompt: "Rename the button label to Save" }).spec.id).toBe("claude-sonnet-5-5");
    expect(dispatchModel({ ...base, effort: "high", prompt: "Rename a variable" }).spec.id).toBe("claude-opus-5-5");
    expect(dispatchModel({ ...base, mode: "chat", prompt: "What does HTTP 418 mean?" }).spec.id).toBe("claude-haiku-5-5");
    expect(dispatchModel({ ...base, mode: "chat", prompt: "Explain this:\n```\nconst a = 1\n```" }).spec.id).toBe("claude-sonnet-5-5");
    expect(dispatchModel({ ...base, effort: "low", prompt: "Fix the typo in README" }).spec.id).toBe("claude-haiku-5-5");
    // A Dev Team never gets the fastest tier as its Engineer.
    expect(dispatchModel({ ...base, effort: "low", team: true, prompt: "Fix the typo in README" }).spec.id).toBe("claude-sonnet-5-5");
  });

  it("accepts every picker model and old aliases, rejects hidden and tool-less ones", () => {
    vi.stubEnv("RELAY_API_KEY", "test");
    vi.stubEnv("PAPER_API_KEY", "test");
    for (const model of PICKER_MODELS) expect(dispatchModel({ ...base, mode: model.tools ? "agent" : "chat", model: model.id, prompt: "Build a CLI" }).spec.id).toBe(model.id);
    for (const id of ["gemini-4-argon", "llama3.3-70b", "mistral-7b"]) expect(() => dispatchModel({ ...base, model: id, prompt: "Build a CLI" })).toThrow(/cannot call tools/);
    expect(dispatchModel({ ...base, model: "r/gemini-3.8-flash-high", prompt: "Hi" }).spec.id).toBe("r/gemini-3.8-flash");
    expect(dispatchModel({ ...base, model: "gemini-2.5-flash", prompt: "Hi" }).spec.id).toBe("r/gemini-2.5-flash"); // briefly-used SQL id
    expect(() => dispatchModel({ ...base, model: "research-agent", prompt: "Build a CLI" })).toThrow(/Unknown model/);
    expect(dispatchModel({ ...base, model: "r/claude-sonnet-4-6", prompt: "Hi" }).spec.id).toBe("claude-sonnet-4-6"); // retired entry → its replacement
    expect(() => dispatchModel({ ...base, model: "r/claude-opus-4-6", prompt: "Hi" })).toThrow(/Unknown model/);
    // Dev Team: a model that cannot join is replaced up front, so the recorded model is the one that runs.
    const team = dispatchModel({ ...base, team: true, model: "openai-gpt-5.5", prompt: "Build a CLI" });
    expect(team.spec.id).toBe("claude-sonnet-5-5");
    expect(team.reason).toMatch(/cannot join a Dev Team/);
    expect(dispatchModel({ ...base, team: true, model: "claude-opus-5", prompt: "Build a CLI" }).spec.id).toBe("claude-opus-5");
    expect(() => dispatchModel({ ...base, model: "nope", prompt: "Hi" })).toThrow(/Unknown model/);
    vi.unstubAllEnvs();
    expect(() => dispatchModel({ ...base, mode: "chat", model: "ultramarine-1-flash", prompt: "Hi" })).toThrow(/not configured/);
  });
});

describe("model catalog and routing", () => {
  it("lists exactly the verified models, plainly, in order", () => {
    expect(PICKER_MODELS.map(model => model.label)).toEqual([
      "Claude Opus 5.5", "Claude Opus 5", "Claude Opus 4.8", "Claude Opus 4.7", "Claude Opus 4.6", "Claude Opus 4.5",
      "Claude Sonnet 5.5", "Claude Sonnet 5", "Claude Sonnet 4.6", "Claude Sonnet 4.5", "Claude Haiku 5.5",
      "OpenAI GPT 5.5", "OpenAI GPT 5.4", "OpenAI GPT 5.2", "OpenAI GPT 5",
      "Gemini 3.8 Flash", "Gemini 4 Argon", "Gemini 3.7 Flash", "Gemini 2.5 Flash",
      "Grok 4.7", "Grok 4.6", "Kimi K3", "GLM 5.3",
      "Llama 3.3 70B", "Llama 3.1 70B", "Llama 3.1 8B", "Mistral 7B", "Ultramarine 1.0 Flash",
    ]);
    // No vendor names in anything the picker can show.
    for (const model of PICKER_MODELS) expect(model.label).not.toMatch(/cortex|snowflake|relay|paper/i);
  });

  it("routes each model to its API format and wire id", () => {
    const format = (id: string) => formatFor(getModel(id)!);
    for (const id of ["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-4-5", "r/gemini-3.8-flash", "r/gemini-2.5-flash"]) expect(format(id)).toBe("anthropic");
    for (const id of ["openai-gpt-5.5", "openai-gpt-5", "grok-4.7", "kimi-k3", "glm-5.3", "ultramarine-1-flash"]) expect(format(id)).toBe("openai");
    // Chat-only engines keep plain-message (Anthropic-shaped) histories.
    for (const id of ["gemini-4-argon", "gemini-3.7-flash", "llama3.3-70b", "llama3.1-70b", "mistral-7b"]) expect(format(id)).toBe("anthropic");
    for (const id of ["gemini-4-argon", "gemini-3.7-flash", "llama3.3-70b"]) expect(getModel(id)).toMatchObject({ provider: "core-sql", tools: false, vision: false });
    for (const id of ["r/gemini-3.8-flash", "r/gemini-2.5-flash"]) {
      expect(getModel(id)).toMatchObject({ provider: "relay", tools: true, vision: true });
      expect(getModel(id)!.hidden).toBeFalsy(); // back in the picker
    }
    expect(getModel("llama3.1-8b")!.provider).toBe("core-inference");
    const gemini = getModel("r/gemini-3.8-flash")!;
    expect(["low", "medium", "high"].map(level => wireModel(gemini, level as "low"))).toEqual(["r/gemini-3.8-flash-low", "r/gemini-3.8-flash-medium", "r/gemini-3.8-flash-high"]);
    expect(wireModel(getModel("openai-gpt-5.5")!, "high")).toBe("openai-gpt-5.5");
  });

  it("asks each model for the reasoning it supports", async () => {
    const { reasoningParams } = await import("./agent/providers");
    expect(reasoningParams(getModel("claude-opus-5-5")!, "medium")).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" } });
    expect(reasoningParams(getModel("claude-sonnet-4-5")!, "high")).toEqual({ thinking: { type: "enabled", budget_tokens: 12_288 } });
    expect(reasoningParams(getModel("claude-opus-4-5")!, "low")).toEqual({ thinking: { type: "enabled", budget_tokens: 2048 } });
    expect(reasoningParams(getModel("r/gemini-2.5-flash")!, "high")).toEqual({});
  });

  it("fails over within the conversation format, closest tier first", async () => {
    const { failoverModels } = await import("./agent/recovery");
    const ids = (id: string) => failoverModels(getModel(id)!).map(spec => spec.id);
    expect(ids("claude-opus-5-5").slice(0, 2)).toEqual(["claude-opus-5", "claude-opus-4-8"]);
    expect(ids("claude-sonnet-5-5")[0]).toBe("claude-sonnet-5");
    expect(ids("r/gemini-3.8-flash")[0]).toBe("r/gemini-2.5-flash");
    expect(ids("openai-gpt-5.5").slice(0, 2)).toEqual(["openai-gpt-5.4", "openai-gpt-5.2"]);
    for (const id of ids("grok-4.7")) expect(formatFor(getModel(id)!)).toBe("openai"); // never crosses formats
    for (const id of ids("claude-haiku-5-5")) expect(formatFor(getModel(id)!)).toBe("anthropic");
    expect(ids("research-agent")).toEqual([]);
    expect(ids("gemini-4-argon")).toEqual([]); // chat-only engines are retried, not switched
    expect(ids("openai-gpt-5.4")).toContain("openai-gpt-5");
  });

  it("streams OpenAI-format models through the bridge with reasoning effort", async () => {
    const http = await import("node:http");
    const seen: { url?: string; body?: any } = {};
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", chunk => (raw += chunk));
      req.on("end", () => {
        seen.url = req.url;
        seen.body = JSON.parse(raw);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n');
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const previous = process.env.CORTEX_BRIDGE_URL;
    process.env.CORTEX_BRIDGE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const { streamOpenAIChat } = await import("./agent/providers");
      const chunks: any[] = [];
      for await (const chunk of streamOpenAIChat({ provider: "core-chat", model: "kimi-k3", messages: [{ role: "user", content: "hi" }], maxTokens: 100, reasoningEffort: "low", signal: new AbortController().signal })) chunks.push(chunk);
      expect(seen.url).toBe("/v1/chat/completions");
      expect(seen.body).toMatchObject({ model: "kimi-k3", max_tokens: 100, reasoning_effort: "low", stream: true });
      expect(chunks.map(chunk => chunk.kind)).toEqual(["reasoning", "usage", "text", "finish"]);
    } finally {
      process.env.CORTEX_BRIDGE_URL = previous;
      server.close();
    }
  });

  it("sends Vault images to OpenAI-format models as data URLs, and a note to models without vision", async () => {
    const { hydrateOpenAIImages, userContent } = await import("./agent/attachments");
    const conversation = [{ role: "user", content: userContent("look", [{ mediaType: "image/png", mediaId: "m1" }], "openai") }];
    const load = async () => Buffer.from("png-bytes");
    const sent: any = await hydrateOpenAIImages(conversation as any, new Map(), load, true);
    expect(sent[0].content[0]).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}` } });
    expect((conversation[0].content as any)[0].image_url.url).toBe("curialy-vault:m1"); // stored copy keeps the reference
    const blind: any = await hydrateOpenAIImages(conversation as any, new Map(), load, false);
    expect(blind[0].content[0].type).toBe("text");
  });
});

describe("model routing regressions", () => {
  it("heals SQL-completion failures sensibly and keeps their text neutral", async () => {
    const { diagnose } = await import("./agent/recovery");
    const { completionError } = await import("./media/snowflake");
    const { brandText } = await import("../shared/brand");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mapped = (message: string) => completionError(new Error(message)).message;
    // Context overflow (both the raw wording and the mapped one) leads to compaction, not a dead chat.
    expect(diagnose(new Error("Cortex inference failed (400): {\"message\":\"max tokens of 32768 exceeded\"}"), false).kind).toBe("context_overflow");
    expect(diagnose(new Error(mapped("remote service error: 400 'max tokens of 128000 exceeded, try a shorter prompt'")), false).kind).toBe("context_overflow");
    expect(diagnose(new Error(mapped("Request throttled: too many requests")), false).kind).toBe("rate_limit");
    expect(diagnose(new Error(mapped("Network error: ECONNRESET")), false).kind).toBe("transient");
    // Our own deadline is not a transient blip: an identical retry would only time out again.
    expect(diagnose(new Error("The engine took too long to answer. Ask for a shorter reply, or try another model."), false).kind).toBe("fatal");
    // Raw SQL / driver text never reaches the user.
    const leaked = mapped("SQL access control error: Insufficient privileges to operate on function 'AI_COMPLETE'. Grant database role SNOWFLAKE.CORTEX_USER");
    expect(leaked).not.toMatch(/AI_COMPLETE|SNOWFLAKE|CORTEX|SQL/);
    expect(brandText("Set CORTEX_ENABLED_CROSS_REGION or grant SNOWFLAKE.CORTEX_USER")).not.toMatch(/CORTEX|SNOWFLAKE/i);
    quiet.mockRestore();
  });

  it("sends single-prompt engines the whole conversation as a transcript", async () => {
    const { transcriptPrompt } = await import("./agent/runner");
    const prompt = transcriptPrompt("Be brief.", [{ role: "user", content: "My name is Ada." }, { role: "assistant", content: "Hi Ada." }, { role: "user", content: "What is my name?" }]);
    expect(prompt.startsWith("Be brief.")).toBe(true);
    expect(prompt).toContain("User: My name is Ada.\n\nAssistant: Hi Ada.\n\nUser: What is my name?");
    expect(prompt.endsWith("Assistant:")).toBe(true);
  });

  it("never saves or replays null assistant content in OpenAI-format histories", async () => {
    const { repairOpenAIContent } = await import("./agent/recovery");
    const history: any[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: null },
      { role: "user", content: "again" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "assistant", content: "" },
    ];
    expect(repairOpenAIContent(history)).toBe(3);
    expect(history.map(message => message.content)).toEqual(["hi", "(no reply)", "again", "", "ok", "(no reply)"]);
    expect(repairOpenAIContent(history)).toBe(0);
  });

  it("compacts OpenAI histories with array content and screenshots without losing the request", async () => {
    const { compactOpenAIHistory, latestRequestIndex, TOOL_SCREENSHOTS } = await import("./agent/recovery");
    const shot = (n: number) => ({ role: "user", content: [{ type: "text", text: `${TOOL_SCREENSHOTS} Screenshot returned by browse:` }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(50)}${n}` } }] });
    const history: any[] = [{ role: "user", content: [{ type: "image_url", image_url: { url: "curialy-vault:m1" } }, { type: "text", text: "Build the page in the mockup." }] }];
    for (let i = 0; i < 6; i++) {
      history.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "browse", arguments: "{}" } }] });
      history.push({ role: "tool", tool_call_id: `c${i}`, content: "x".repeat(5000) });
      history.push(shot(i));
    }
    history.push({ role: "user", content: "Now make the header blue." }); // the real follow-up request
    for (let i = 6; i < 9; i++) {
      history.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "browse", arguments: "{}" } }] });
      history.push({ role: "tool", tool_call_id: `c${i}`, content: "y" });
      history.push(shot(i));
    }
    const request = latestRequestIndex(history);
    expect(history[request].content).toBe("Now make the header blue."); // screenshot turns are not requests
    compactOpenAIHistory(history, 1);
    expect(history.slice(1, 10).some(message => Array.isArray(message.content) && message.content.some((part: any) => part.type === "image_url"))).toBe(false); // old screenshots dropped
    compactOpenAIHistory(history, 3);
    expect(history.some(message => message.content === "Now make the header blue.")).toBe(true);
    expect(JSON.stringify(history[0].content)).not.toContain("[object Object]");
    expect(history[0].content.at(-1).text).toMatch(/earlier messages were removed/);
  });

  it("escalates only onto healthy routes and never undoes a failover", async () => {
    const { RecoveryEngine } = await import("./agent/recovery");
    const make = () => {
      let spec = getModel("claude-sonnet-5-5")!;
      const engine = new RecoveryEngine({
        signal: new AbortController().signal, format: "anthropic", conversation: [{ role: "user", content: "hi" }], get spec() { return spec; }, flags: { noEager: false, noThinking: false, noEffort: false },
        switchModel: next => { spec = next; }, persist: () => undefined, emit: () => undefined, sleep: async () => undefined,
      });
      return { engine, current: () => spec };
    };
    const opus = getModel("claude-opus-5-5")!;
    const healthy = make();
    expect(healthy.engine.canEscalateTo(opus)).toBe(true);
    const failed = make();
    for (let i = 0; i < 6; i++) await failed.engine.handle(Object.assign(new Error("Chat engine request failed (503): unavailable"), {}));
    expect(failed.current().id).not.toBe("claude-sonnet-5-5"); // failed over
    expect(failed.engine.canEscalateTo(opus)).toBe(false);
  });

  it("prefers another route on outages only when the switch keeps vision", async () => {
    const { RecoveryEngine } = await import("./agent/recovery");
    const firstFailover = async (id: string) => {
      let spec = getModel(id)!;
      const engine = new RecoveryEngine({
        signal: new AbortController().signal, format: "openai", conversation: [{ role: "user", content: "hi" }] as any, get spec() { return spec; }, flags: { noEager: false, noThinking: false, noEffort: false },
        switchModel: next => { spec = next; }, persist: () => undefined, emit: () => undefined, sleep: async () => undefined,
        available: () => true,
      });
      for (let i = 0; i < 8 && spec.id === id; i++) await engine.handle(new Error("Chat engine request failed (503): unavailable"));
      return spec.id;
    };
    expect(await firstFailover("openai-gpt-5.5")).toBe("openai-gpt-5.4"); // not the no-vision engine
    expect(await firstFailover("glm-5.3")).toBe("ultramarine-1-flash"); // no vision to lose: other route first
  });

  it("reads error types from pretty-printed stream errors and keeps old Gemini levels", async () => {
    const { diagnose } = await import("./agent/recovery");
    expect(diagnose(new Error('Chat engine error: {"error": {"type": "overloaded_error"}}'), false).kind).toBe("transient");
    expect(diagnose(new Error("Chat engine request failed (400): Model does not support image modality"), false).kind).toBe("bad_image");
    const { aliasEffort } = await import("../shared/agent");
    expect(aliasEffort("r/gemini-3.8-flash-high")).toBe("high");
    expect(aliasEffort("claude-opus-5-5")).toBeUndefined();
    expect(getModel("r/claude-opus-4-6-thinking")!.label).not.toBe(getModel("claude-opus-4-6")!.label);
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

  it("writes nothing to a branch whose head isn't the workspace's last push", async () => {
    const github = await import("./services/github");
    const calls: { method: string; url: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url });
      if (url.endsWith("/repos/octo/site")) return Response.json({ default_branch: "main", html_url: "https://github.com/octo/site" });
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "b".repeat(40) } });
      return Response.json({ sha: "c".repeat(40), html_url: "" }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const files = [{ path: "index.html", content: Buffer.from("<h1>Hi</h1>") }];
      await expect(github.pushProjectToRepo("t", "octo/site", files, "Update", { onlyOver: { main: "a".repeat(40) } })).rejects.toBeInstanceOf(github.RemoteChangedError);
      await expect(github.pushProjectToRepo("t", "octo/site", files, "Update", { onlyOver: {} })).rejects.toMatchObject({ branch: "main", status: 409 });
      expect(calls.filter(call => call.method !== "GET")).toEqual([]);
      // Over its own last push it goes ahead (blobs, tree, commit, a non-forced ref update).
      const pushed = await github.pushProjectToRepo("t", "octo/site", files, "Update", { onlyOver: { main: "b".repeat(40) } });
      expect(pushed.branch).toBe("main");
      const update = calls.find(call => call.method === "PATCH");
      expect(update?.url).toContain("/git/refs/heads/main");
      expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body))).toMatchObject({ force: false });
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("keeps file names with tabs, quotes, leading spaces and unicode intact (NUL-separated git output)", async () => {
    const { computeChanges } = await import("./agent/repos");
    const { execFileSync } = await import("node:child_process");
    const repoRoot = path.join(process.env.AGENT_WORKSPACE_ROOT!, "repo-odd-names");
    fs.mkdirSync(repoRoot, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repoRoot, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repoRoot, "base.txt"), "a\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const baseSha = git("rev-parse", "HEAD").trim();
    const odd = ["tab\tname.txt", "\"quoted\".md", " leading space.txt", "ünïcode — dash.txt"];
    for (const name of odd) fs.writeFileSync(path.join(repoRoot, name), "x\n");
    const changes = await computeChanges(repoRoot, { fullName: "o/r", url: "", branch: "main", baseSha, repoPath: ".", pushed: {}, deleted: [] });
    expect(changes.changed.sort()).toEqual([...odd].sort());
    expect(changes.deleted).toEqual([]);
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
    expect(userContent("look", first.images, "openai")).toEqual([{ type: "image_url", image_url: { url: `curialy-vault:${first.images[0].mediaId}`, media_type: first.images[0].mediaType } }, { type: "text", text: "look" }]);
    expect(userContent("look", [], "openai")).toBe("look");
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
    // An account that lost access answers every request this way: a route problem, not a bad key.
    expect(diagnose(await apiError(403, "Not authorized for this endpoint."), false).kind).toBe("route_down");
    expect(diagnose(new Error("Engine Notice (403): Not authorized for this endpoint."), false).kind).toBe("route_down");
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

  it("switches straight to another route when the engine route refuses every request, for this run only", async () => {
    const { RecoveryEngine, failoverModels } = await import("./agent/recovery");
    const { getModel } = await import("../shared/agent");
    // The relay's Claude Opus 4.6 is the backup path to Claude; the relay no longer serves Sonnet 4.6.
    expect(failoverModels(getModel("claude-sonnet-5-5")!).map(spec => spec.id)).not.toContain("r/claude-sonnet-4-6");
    const events: any[] = [];
    const switches: { id: string; forRun?: boolean }[] = [];
    let spec = getModel("claude-opus-5-5")!;
    const engine = new RecoveryEngine({
      signal: new AbortController().signal, format: "anthropic", conversation: [{ role: "user", content: "hi" }], get spec() { return spec; }, flags: { noEager: false, noThinking: false, noEffort: false },
      switchModel: (next, _reason, forRun) => { spec = next; switches.push({ id: next.id, forRun }); }, persist: () => undefined, emit: event => events.push(event), sleep: async () => undefined, available: () => true,
    });
    expect(spec.provider).toBe("core");
    expect(await engine.handle(await apiError(403, "Not authorized for this endpoint."))).toBe(true);
    // No retry on the refusing route and no other model on it: the closest model on another route,
    // as a stand-in for this run (the task keeps its own model for the next one).
    expect(switches).toEqual([{ id: "r/claude-opus-4-6-thinking", forRun: true }]);
    expect(events.map(event => event.kind)).toEqual(["route_down"]);
    // An outage on the stand-in's route later never moves the run back onto the refusing one.
    engine.succeeded();
    for (let i = 0; i < 5; i++) expect(await engine.handle(await apiError(529, "Overloaded"))).toBe(true);
    expect(switches).toEqual([{ id: "r/claude-opus-4-6-thinking", forRun: true }, { id: "r/gemini-3.8-flash", forRun: true }]);
    // With no other route configured, the run fails as before.
    let solo = getModel("claude-sonnet-5-5")!;
    const stuck = new RecoveryEngine({
      signal: new AbortController().signal, format: "anthropic", conversation: [{ role: "user", content: "hi" }], get spec() { return solo; }, flags: { noEager: false, noThinking: false, noEffort: false },
      switchModel: next => { solo = next; }, persist: () => undefined, emit: () => undefined, sleep: async () => undefined, available: candidate => candidate.provider === "core",
    });
    expect(await stuck.handle(await apiError(403, "Not authorized for this endpoint."))).toBe(false);
  });

  it("keeps an overload's switch to another route for this run, and moves a retired model's task to its replacement's tier", async () => {
    const { RecoveryEngine, failoverModels } = await import("./agent/recovery");
    const { getModel } = await import("../shared/agent");
    const engine = (start: string, available?: (spec: any) => boolean) => {
      const switches: { id: string; forRun?: boolean }[] = [];
      let spec = getModel(start)!;
      const recovery = new RecoveryEngine({
        signal: new AbortController().signal, format: "anthropic", conversation: [{ role: "user", content: "hi" }], get spec() { return spec; }, flags: { noEager: false, noThinking: false, noEffort: false },
        switchModel: (next, _reason, forRun) => { spec = next; switches.push({ id: next.id, forRun }); }, persist: () => undefined, emit: () => undefined, sleep: async () => undefined, available,
      });
      return { recovery, switches };
    };
    // Five overloads on the primary route: another route for this run only, the task keeps Sonnet.
    const overloaded = engine("claude-sonnet-5-5", () => true);
    for (let i = 0; i < 5; i++) expect(await overloaded.recovery.handle(await apiError(529, "Overloaded"))).toBe(true);
    expect(overloaded.switches).toEqual([{ id: "r/claude-opus-4-6-thinking", forRun: true }]);
    // A saved pick the relay no longer serves: its replacement's tier, and that switch sticks.
    expect(failoverModels(getModel("r/claude-sonnet-4-6")!)[0].id).toBe("claude-sonnet-5-5");
    const retired = engine("r/claude-sonnet-4-6", () => true);
    expect(await retired.recovery.handle(await apiError(404, "Unknown model: r/claude-sonnet-4-6"))).toBe(true);
    expect(retired.switches).toEqual([{ id: "claude-sonnet-5-5", forRun: false }]);
  });

  it("never fails a free account's run over onto a model that costs more credits", async () => {
    const { getModel } = await import("../shared/agent");
    const runner = await import("./agent/team").then(() => import("./agent/runner"));
    const sonnet = getModel("claude-sonnet-5-5")!;
    const backupOpus = getModel("r/claude-opus-4-6-thinking")!;
    const flash = getModel("r/gemini-3.8-flash")!;
    vi.stubEnv("RELAY_API_KEY", "test-relay-key");
    try {
      expect(runner.failoverTargets(false, sonnet)(backupOpus)).toBe(false);
      expect(runner.failoverTargets(false, sonnet)(flash)).toBe(true);
      expect(runner.failoverTargets(false, getModel("claude-opus-5-5")!)(backupOpus)).toBe(true);
      expect(runner.failoverTargets(true, sonnet)(backupOpus)).toBe(true); // the operator pays no credits
    } finally {
      vi.unstubAllEnvs();
    }
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
