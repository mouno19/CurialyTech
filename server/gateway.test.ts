import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Developer API end to end over HTTP: keys (create once, list, revoke), key authentication,
// the model allowlist, failover from the internal bridge to the relay's copy of the model, and what
// never reaches a caller or the log: upstream names, hosts, headers and error texts.

process.env.CORTEX_BRIDGE_URL = "http://bridge.test";
process.env.RELAY_API_URL = "https://relay.test";
process.env.RELAY_API_KEY = "relay-secret-key";

type KeyRow = { id: string; user_id: string; name: string; key_hash: string; key_prefix: string; allowed_models: string[]; status: "active" | "revoked"; created_at: Date; last_used_at: Date | null };
const store = vi.hoisted(() => ({ keys: [] as any[], users: new Map<string, { role: string; banned_at: Date | null }>(), counter: 0 }));
vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: any[] = []) => {
    const pick = (row: KeyRow) => ({ id: row.id, name: row.name, key_prefix: row.key_prefix, allowed_models: row.allowed_models, status: row.status, created_at: row.created_at, last_used_at: row.last_used_at });
    if (text.includes("INSERT INTO curialy.api_keys")) {
      const [userId, name, hash, prefix, models, max] = values;
      if (store.keys.filter(row => row.user_id === userId && row.status === "active").length >= max) return { rows: [] };
      const row: KeyRow = { id: `00000000-0000-4000-8000-${String(++store.counter).padStart(12, "0")}`, user_id: userId, name, key_hash: hash, key_prefix: prefix, allowed_models: JSON.parse(models), status: "active", created_at: new Date(), last_used_at: null };
      store.keys.push(row);
      return { rows: [pick(row)] };
    }
    if (text.includes("FROM curialy.api_keys WHERE user_id = $1")) return { rows: store.keys.filter(row => row.user_id === values[0]).map(pick) };
    if (text.includes("SET status = 'revoked'")) {
      const row = store.keys.find(entry => entry.id === values[0] && entry.user_id === values[1]);
      if (!row) return { rows: [] };
      row.status = "revoked";
      return { rows: [{ ...pick(row), key_hash: row.key_hash }] };
    }
    if (text.includes("WHERE k.key_hash = $1 AND k.status = 'active'")) {
      const row = store.keys.find(entry => entry.key_hash === values[0] && entry.status === "active");
      const user = row && store.users.get(row.user_id);
      return { rows: row && user ? [{ id: row.id, user_id: row.user_id, allowed_models: row.allowed_models, role: user.role, banned_at: user.banned_at }] : [] };
    }
    if (text.includes("SET last_used_at")) return { rows: [] };
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }),
  db: () => { throw new Error("no pool in tests"); },
  adminUserId: async () => "admin",
}));
const credits = vi.hoisted(() => ({ available: 50, charges: [] as { userId: string; amount: number; detail: string }[] }));
vi.mock("./credits", () => ({
  getBalance: async () => ({ unlimited: false, allowance: 60, used: 10, remaining: credits.available, bonus: 0, available: credits.available, resetsAt: new Date(Date.now() + 3600_000).toISOString() }),
  charge: vi.fn(async (userId: string, amount: number, _session: unknown, detail: string) => { credits.charges.push({ userId, amount, detail }); }),
  outOfCreditsMessage: () => "You've used this window's credits.",
}));
vi.mock("./auth", async importOriginal => ({
  ...(await importOriginal<typeof import("./auth")>()),
  requireUser: (req: any, res: any, next: any) => (req.headers["x-test-user"] ? next() : res.status(401).json({ error: "Sign in required." })),
  accountOf: (req: any) => ({ id: req.headers["x-test-user"], role: "user" }),
}));

// The model service: the bridge and the relay, scripted per test.
type Upstream = { url: string; headers: Record<string, string>; body: any };
const upstream = vi.hoisted(() => ({ calls: [] as Upstream[], bridge: null as null | ((call: Upstream) => Response), relay: null as null | ((call: Upstream) => Response) }));
const realFetch = globalThis.fetch;
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-snowflake-request-id": "sf-123", server: "envoy", ...headers } });
const message = (model: string, text = "Hello!") => ({ id: "msg_1", type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 20_000, output_tokens: 1_250 } });
const stream = (events: object[]) => new Response(events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream", "x-snowflake-fe-instance": "fe-9" } });
/** A whole message as the stream of events the model service sends for it. */
const streamOf = (whole: { id: string; model: string; content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }) => stream([
  { type: "message_start", message: { id: whole.id, type: "message", role: "assistant", model: whole.model, content: [], stop_reason: null, usage: { input_tokens: whole.usage.input_tokens, output_tokens: 1 } } },
  ...whole.content.flatMap((block, index) => block.type === "text"
    ? [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }, { type: "content_block_stop", index }]
    : [{ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }, { type: "content_block_stop", index }]),
  { type: "message_delta", delta: { stop_reason: whole.stop_reason, stop_sequence: null }, usage: { output_tokens: whole.usage.output_tokens } },
  { type: "message_stop" },
]);

const { gatewayRouter, keysRouter, resetLookupLimits } = await import("./gateway");
const { resetRouteHealth } = await import("./gateway/upstream");
let server: Server;
let base = "";
beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    const call: Upstream = { url, headers: Object.fromEntries(Object.entries(init.headers ?? {})), body: init.body ? JSON.parse(String(init.body)) : null };
    upstream.calls.push(call);
    const handler = url.startsWith("http://bridge.test") ? upstream.bridge : url.startsWith("https://relay.test") ? upstream.relay : null;
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    const response = handler(call);
    const signal = init.signal;
    if (!signal || !response.body) return response;
    // Like undici: aborting the request errors its response body.
    const source = response.body.getReader();
    const body = new ReadableStream({
      start(controller) { signal.addEventListener("abort", () => { controller.error(signal.reason ?? new Error("aborted")); void source.cancel().catch(() => undefined); }, { once: true }); },
      async pull(controller) { const { done, value } = await source.read(); if (done) controller.close(); else controller.enqueue(value); },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  });
  const app = express();
  app.use("/v1", gatewayRouter());
  app.use(express.json());
  app.use("/api/keys", keysRouter());
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetRouteHealth();
  upstream.calls.length = 0;
  upstream.bridge = call => streamOf(message(call.body.model));
  upstream.relay = call => streamOf(message(call.body.model.replace(/^r\//, "")));
  credits.available = 50;
  credits.charges.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  // Nothing about the upstream ever reaches the log.
  for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toMatch(/snowflake|bridge\.test|relay\.test|relay-secret-key/i);
  warn.mockRestore();
});

const api = (path: string, init: RequestInit & { user?: string } = {}) => realFetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.user ? { "x-test-user": init.user } : {}), ...(init.headers ?? {}) } });
async function newKey(user = "user-1", models?: string[], role = "user") {
  store.users.set(user, { role, banned_at: null });
  const response = await api("/api/keys", { method: "POST", user, body: JSON.stringify({ name: "Development Key", ...(models ? { models } : {}) }) });
  expect(response.status).toBe(201);
  return (await response.json()) as { key: { id: string; prefix: string; allowedModels: string[] }; secret: string };
}
const call = (path: string, secret: string, body: unknown, headers: Record<string, string> = {}) => realFetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": secret, ...headers }, body: JSON.stringify(body) });
const ask = { model: "claude-opus-5-5", max_tokens: 1024, messages: [{ role: "user", content: "Hello!" }] };

describe("API keys", () => {
  it("shows a new key's secret once, then lists only its prefix, and revoking stops it at once", async () => {
    const { key, secret } = await newKey("keys-user");
    expect(secret).toMatch(/^cur_live_[0-9a-f]{32}$/);
    expect(key.prefix).toBe(secret.slice(0, 13));
    expect(key.allowedModels).toEqual(["claude-opus-5-5", "claude-sonnet-4-5"]);
    expect(store.keys.find(row => row.id === key.id).key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.keys)).not.toContain(secret);
    const listed = await (await api("/api/keys", { user: "keys-user" })).json();
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(listed.keys).toEqual([expect.objectContaining({ id: key.id, name: "Development Key", prefix: key.prefix, status: "active" })]);
    expect((await call("/v1/messages", secret, ask)).status).toBe(200);
    expect((await api(`/api/keys/${key.id}`, { method: "DELETE", user: "keys-user" })).status).toBe(200);
    const after = await call("/v1/messages", secret, ask);
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: { message: "Invalid or revoked API key.", type: "authentication_error", code: 401 } });
    // Someone else's key is not found.
    expect((await api(`/api/keys/${key.id}`, { method: "DELETE", user: "someone-else" })).status).toBe(404);
  });

  it("keeps only models the gateway offers, and caps active keys", async () => {
    const { key } = await newKey("cap-user", ["claude-sonnet-4-5", "gpt-4o"]);
    expect(key.allowedModels).toEqual(["claude-sonnet-4-5"]);
    expect((await api("/api/keys", { method: "POST", user: "cap-user", body: JSON.stringify({ name: "x", models: ["gpt-4o"] }) })).status).toBe(400);
    for (let index = 1; index < 10; index++) await newKey("cap-user");
    expect((await api("/api/keys", { method: "POST", user: "cap-user", body: JSON.stringify({ name: "eleventh" }) })).status).toBe(409);
    expect((await api("/api/keys", { method: "POST", body: JSON.stringify({ name: "anonymous" }) })).status).toBe(401);
  });
});

describe("the gateway", () => {
  it("authenticates by x-api-key or Bearer, and refuses models the key may not use", async () => {
    const { secret } = await newKey("auth-user", ["claude-sonnet-4-5"]);
    expect((await call("/v1/messages", "", ask)).status).toBe(401);
    expect((await call("/v1/messages", "cur_live_00000000000000000000000000000000", ask)).status).toBe(401);
    const forbidden = await call("/v1/messages", secret, ask);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toMatchObject({ type: "permission_error", code: 403 });
    const bearer = await realFetch(`${base}/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ ...ask, model: "claude-sonnet-4-5" }) });
    expect(bearer.status).toBe(200);
    const models = await (await realFetch(`${base}/v1/models`, { headers: { "x-api-key": secret } })).json();
    expect(models.data.map((model: { id: string }) => model.id)).toEqual(["claude-sonnet-4-5"]);
  });

  it("answers from the bridge with no upstream header, and charges the key's account", async () => {
    const { secret } = await newKey("bridge-user");
    const response = await call("/v1/messages", secret, ask);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "claude-opus-5-5", content: [{ type: "text", text: "Hello!" }] });
    expect(response.headers.get("x-curialy-request-id")).toMatch(/^req_[0-9a-f]{24}$/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    for (const name of response.headers.keys()) expect(name).not.toMatch(/snowflake|envoy|^server$/);
    expect(upstream.calls).toEqual([expect.objectContaining({ url: "http://bridge.test/v1/messages", body: expect.objectContaining({ model: "claude-opus-5-5", stream: true }) })]);
    // 20k in + 1250 out on Opus (weight 5): 5 credits, as for the agent.
    await vi.waitFor(() => expect(credits.charges).toEqual([{ userId: "bridge-user", amount: 5, detail: "API claude-opus-5-5: 20000 in, 1250 out" }]));
    // The operator's account is not charged.
    const { secret: operator } = await newKey("operator", undefined, "admin");
    credits.charges.length = 0;
    expect((await call("/v1/messages", operator, ask)).status).toBe(200);
    expect(credits.charges).toEqual([]);
  });

  it("moves to the relay's copy of the model when the bridge refuses, and stays there for a while", async () => {
    const { secret } = await newKey("relay-user");
    upstream.bridge = () => reply(403, { code: "390144", message: "Not authorized for this endpoint. Snowflake account xy123.snowflakecomputing.com" });
    const response = await call("/v1/messages", secret, ask);
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe("claude-opus-5-5");
    expect(upstream.calls.map(entry => [entry.url, entry.body.model, entry.headers.authorization])).toEqual([
      ["http://bridge.test/v1/messages", "claude-opus-5-5", undefined],
      ["https://relay.test/v1/messages", "r/claude-opus-5-5", "Bearer relay-secret-key"],
    ]);
    upstream.calls.length = 0;
    expect((await call("/v1/messages", secret, ask)).status).toBe(200);
    expect(upstream.calls.map(entry => entry.url)).toEqual(["https://relay.test/v1/messages"]);
  });

  it("masks every upstream failure, and passes a malformed request's message on scrubbed", async () => {
    const { secret } = await newKey("mask-user");
    upstream.bridge = () => reply(500, { message: "Snowflake warehouse COMPUTE_WH at ab12.snowflakecomputing.com failed, request_id: 7f2e" });
    upstream.relay = () => reply(403, { error: { message: "[antigravity/claude-opus-4-6-thinking] [403]: HTTP 403 (reset after 23s)" } });
    const masked = await call("/v1/messages", secret, ask);
    expect(masked.status).toBe(503);
    const text = await masked.text();
    expect(JSON.parse(text)).toEqual({ error: { message: "The requested model service is currently unavailable. Please retry shortly.", type: "curialy_api_error", code: 503 } });
    for (const name of masked.headers.keys()) expect(name).not.toMatch(/snowflake|envoy/);
    resetRouteHealth();
    upstream.calls.length = 0;
    upstream.bridge = () => reply(400, { type: "error", error: { type: "invalid_request_error", message: "messages.0.role: Input should be 'user' or 'assistant' (Snowflake Cortex, x-snowflake-request-id: 7f2e-11ab, see https://docs.snowflake.com/x at ab12.snowflakecomputing.com)" } });
    const invalid = await call("/v1/messages", secret, { ...ask, messages: [{ role: "robot", content: "Hi" }] });
    expect(invalid.status).toBe(400);
    const error = (await invalid.json()).error;
    expect(error).toMatchObject({ type: "invalid_request_error", code: 400 });
    expect(error.message).toContain("messages.0.role: Input should be 'user' or 'assistant'");
    expect(error.message).not.toMatch(/snowflake|cortex|7f2e|https?:|\.com/i);
    expect(upstream.calls.map(entry => entry.url)).toEqual(["http://bridge.test/v1/messages"]); // a malformed request is not retried elsewhere
    // The relay's reasons never pass on (they name its own backends).
    resetRouteHealth();
    upstream.calls.length = 0;
    upstream.bridge = () => reply(403, { message: "Not authorized for this endpoint." });
    upstream.relay = () => reply(400, { error: { message: "[antigravity/claude-opus-4-6-thinking] [400]: invalid base64 at messages.0" } });
    const relayed = await (await call("/v1/messages", secret, ask)).json();
    expect(relayed.error).toEqual({ message: "The request was not accepted. Check its parameters and try again.", type: "invalid_request_error", code: 400 });
  });

  it("refuses free accounts that are out of credits or ask for more than they may", async () => {
    const { secret } = await newKey("broke-user");
    credits.available = 0;
    const broke = await call("/v1/messages", secret, ask);
    expect(broke.status).toBe(402);
    expect((await broke.json()).error.type).toBe("insufficient_credits");
    credits.available = 50;
    expect((await call("/v1/messages", secret, { ...ask, max_tokens: 64_000 })).status).toBe(400);
    expect(upstream.calls).toEqual([]);
  });

  it("streams Anthropic events through, counts their usage, and masks an error event", async () => {
    const { secret } = await newKey("stream-user");
    upstream.bridge = () => stream([
      { type: "message_start", message: { id: "msg_s", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: { input_tokens: 10_000, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2_500 } },
      { type: "message_stop" },
    ]);
    const response = await call("/v1/messages", secret, { ...ask, stream: true });
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(response.headers.get("x-snowflake-fe-instance")).toBeNull();
    const body = await response.text();
    expect(body).toContain('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}');
    expect(body).toContain("event: message_stop");
    await vi.waitFor(() => expect(credits.charges).toEqual([{ userId: "stream-user", amount: 4, detail: "API claude-opus-5-5: 10000 in, 2500 out" }]));

    upstream.bridge = () => stream([{ type: "message_start", message: { id: "m", model: "claude-opus-5-5", usage: { input_tokens: 5 } } }, { type: "error", error: { type: "overloaded_error", message: "Snowflake region us-west-2 overloaded" } }]);
    const failed = await (await call("/v1/messages", secret, { ...ask, stream: true })).text();
    expect(failed).toContain('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"The requested model service is currently unavailable. Please retry shortly."}}');
    expect(failed).not.toMatch(/snowflake|us-west-2/i);
  });

  it("serves OpenAI Chat Completions from the same models, whole and streamed", async () => {
    const { secret } = await newKey("openai-user");
    upstream.bridge = call => streamOf({ ...message(call.body.model, "Paris."), content: [{ type: "text", text: "Paris." }, { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "France" } }], stop_reason: "tool_use" });
    const response = await call("/v1/chat/completions", secret, {
      model: "claude-opus-5-5", max_completion_tokens: 200, temperature: 1.5, stop: "END",
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: [{ type: "text", text: "Capital?" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] }],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } } }], tool_choice: "required",
    });
    expect(response.status).toBe(200);
    const sent = upstream.calls[0].body;
    // Opus 5.5 always thinks: no sampling settings, and a required tool becomes an instruction.
    expect(sent).toMatchObject({ model: "claude-opus-5-5", system: "Be brief.\n\nUse one of the provided tools in your reply.", max_tokens: 200, stop_sequences: ["END"], tool_choice: { type: "auto" }, stream: true });
    expect(sent.temperature).toBeUndefined();
    expect(sent.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Capital?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] }]);
    expect(sent.tools).toEqual([{ name: "lookup", input_schema: { type: "object", properties: { q: { type: "string" } } } }]);
    const completion = await response.json();
    expect(completion).toMatchObject({ object: "chat.completion", model: "claude-opus-5-5", usage: { prompt_tokens: 20_000, completion_tokens: 1_250, total_tokens: 21_250 } });
    expect(completion.choices[0]).toEqual({ index: 0, message: { role: "assistant", content: "Paris.", tool_calls: [{ id: "toolu_1", type: "function", function: { name: "lookup", arguments: '{"q":"France"}' } }] }, finish_reason: "tool_calls" });

    upstream.bridge = () => stream([
      { type: "message_start", message: { id: "msg_c", model: "claude-opus-5-5", usage: { input_tokens: 12 } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]);
    const streamed = await (await call("/v1/chat/completions", secret, { model: "claude-opus-5-5", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "Hi" }] })).text();
    const chunks = streamed.trim().split("\n\n").map(line => line.replace(/^data: /, ""));
    expect(chunks.at(-1)).toBe("[DONE]");
    const parsed = chunks.slice(0, -1).map(chunk => JSON.parse(chunk));
    expect(parsed.map(chunk => chunk.choices[0]?.delta?.content ?? null).filter(Boolean)).toEqual(["Hel", "lo"]);
    expect(parsed.find(chunk => chunk.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe("stop");
    expect(parsed.at(-1).usage).toEqual({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
    expect(new Set(parsed.map(chunk => chunk.id))).toEqual(new Set(["chatcmpl-msg_c"]));
  });

  it("lets at most three requests of a free account run at once, even when they arrive together", async () => {
    const { secret } = await newKey("burst-user");
    const gates: (() => void)[] = [];
    upstream.bridge = () => new Response(new ReadableStream({ start: controller => { gates.push(() => { controller.enqueue(new TextEncoder().encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`)); controller.close(); }); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const pending = Array.from({ length: 10 }, () => call("/v1/messages", secret, { ...ask, max_tokens: 64, stream: true }));
    await vi.waitFor(() => expect(upstream.calls.length).toBe(3));
    const statuses: number[] = [];
    for (const response of pending) {
      const settled = await Promise.race([response.then(answer => answer.status), new Promise<number>(resolve => setTimeout(() => resolve(0), 300))]);
      statuses.push(settled);
    }
    gates.forEach(open => open());
    const final = (await Promise.all(pending)).map(answer => answer.status);
    expect(final.filter(status => status === 200)).toHaveLength(3);
    expect(final.filter(status => status === 429)).toHaveLength(7);
    expect(upstream.calls).toHaveLength(3);
  });

  it("holds what a request could cost: a free account cannot ask for more than its credits cover", async () => {
    const { secret } = await newKey("hold-user");
    credits.available = 1;
    // Opus, 16384 tokens out: up to about 13 credits.
    const big = await call("/v1/messages", secret, { ...ask, max_tokens: 16_384 });
    expect(big.status).toBe(402);
    expect((await big.json()).error.message).toMatch(/could use up to 13\.\d+ credits and 1 are available/);
    expect(upstream.calls).toEqual([]);
    expect((await call("/v1/messages", secret, { ...ask, max_tokens: 1024 })).status).toBe(200);
  });

  it("bills a stream the caller cut short for what it was sent, and assembles unstreamed replies", async () => {
    const { secret } = await newKey("cut-user");
    const long = "x".repeat(40_000);
    upstream.bridge = () => new Response(new ReadableStream({
      start: controller => {
        const send = (event: object) => controller.enqueue(new TextEncoder().encode(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`));
        send({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: { input_tokens: 1000, output_tokens: 1 } } });
        send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: long } });
        // ...and the final count never comes: the caller leaves first.
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const response = await call("/v1/messages", secret, { ...ask, stream: true });
    const reader = response.body!.getReader();
    let received = "";
    while (!received.includes(long)) received += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    // 1000 in, 10000 out (40000 characters at about 4 a token) on Opus: (1000 + 4 × 10000) × 5 / 25000 = 8.2 credits.
    await vi.waitFor(() => expect(credits.charges).toEqual([{ userId: "cut-user", amount: 8.2, detail: "API claude-opus-5-5: 1000 in, 10000 out" }]));

    // Unstreamed: the stream is assembled into one message, tool input included.
    upstream.bridge = call => streamOf({ ...message(call.body.model, "Checking."), content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_9", name: "lookup", input: { q: "Lyon", n: 2 } }], stop_reason: "tool_use" });
    const whole = await (await call("/v1/messages", secret, ask)).json();
    expect(whole).toMatchObject({ id: "msg_1", model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_9", name: "lookup", input: { q: "Lyon", n: 2 } }], usage: { input_tokens: 20_000, output_tokens: 1_250 } });
  });

  it("refuses bodies over 8 MB and keys that keep guessing, and scrubs upstream text", async () => {
    const { secret } = await newKey("limits-user");
    resetLookupLimits();
    const huge = await call("/v1/messages", secret, { ...ask, messages: [{ role: "user", content: "x".repeat(9 * 1024 * 1024) }] });
    expect(huge.status).toBe(413);
    for (let attempt = 0; attempt < 60; attempt++) expect((await call("/v1/messages", `cur_live_${attempt.toString(16).padStart(32, "0")}`, ask)).status).toBe(401);
    expect((await call("/v1/messages", "cur_live_ffffffffffffffffffffffffffffffff", ask)).status).toBe(429);
    const { scrub } = await import("./gateway/upstream");
    const scrubbed = scrub("[antigravity/claude-opus-4-6-thinking] [403]: HTTP 403 (reset after 23s), x-snowflake-request-id: 7f2e-11ab, request-id: req_99, id 3fa85f64-5717-4562-b3fc-2c963f66afa6, https://ab12.snowflakecomputing.com/api/v2 Snowflake r/claude-opus-5-5");
    expect(scrubbed).not.toMatch(/antigravity|snowflake|7f2e|req_99|3fa85f64|https?:|\.com|r\/claude/i);
    expect(scrubbed).toContain("HTTP 403 (reset after 23s)");
    expect(scrubbed).toContain("claude-opus-5-5");
  });

  it("answers preflights for browser clients and unknown paths in the same error format", async () => {
    const preflight = await realFetch(`${base}/v1/messages`, { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST", "access-control-request-headers": "x-api-key, content-type, anthropic-version" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("x-api-key, content-type, anthropic-version");
    const missing = await realFetch(`${base}/v1/embeddings`, { method: "POST" });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.type).toBe("not_found_error");
  });
});
