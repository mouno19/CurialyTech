import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Developer API end to end over HTTP: keys (create once, list, revoke), key authentication,
// the model allowlist, failover from the internal bridge to the relay's copy of the model, what
// never reaches a caller or the log (upstream names, hosts, headers and error texts), and what a
// request costs: held against the account's API balance while it runs, then charged at the listed
// price (the operator's usage recorded at no cost). A top-up credits 100 times the dollars paid.

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

// The API wallet: balances per account ($10 unless a test sets one) and every usage row written.
const wallet = vi.hoisted(() => ({
  balances: new Map<string, number>(),
  records: [] as any[],
  /** Replaces the balance lookup (a slow or failing database). */
  lookup: null as null | ((userId: string) => Promise<number>),
  /** Charges wait for this before they are written (a slow database). */
  writing: null as null | Promise<void>,
  failCharges: false,
}));
vi.mock("./billing/wallet", () => ({
  apiBalanceMicros: vi.fn(async (userId: string) => (wallet.lookup ? wallet.lookup(userId) : wallet.balances.get(userId) ?? 10_000_000)),
  recordApiUsage: vi.fn(async (record: any) => {
    await wallet.writing;
    if (wallet.failCharges) throw new Error("Connection terminated unexpectedly (db.example.com:5432)");
    wallet.records.push(record);
    wallet.balances.set(record.userId, (wallet.balances.get(record.userId) ?? 10_000_000) - record.costMicros);
  }),
}));
const billing = vi.hoisted(() => ({ discount: { percent: 90, plans: true, api: true, endsAt: null as string | null } }));
vi.mock("./billing/settings", async () => {
  const { DEFAULT_BILLING_SETTINGS } = await import("../shared/billing");
  return { getBillingSettings: vi.fn(async () => ({ ...DEFAULT_BILLING_SETTINGS, discount: billing.discount })) };
});
// Credits no longer pay for the API: nothing here may touch them.
const credits = vi.hoisted(() => ({ getBalance: vi.fn(), charge: vi.fn(), outOfCreditsMessage: vi.fn() }));
vi.mock("./credits", () => credits);
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
const sseOf = (events: object[]) => events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const stream = (events: object[]) => new Response(sseOf(events), { status: 200, headers: { "content-type": "text/event-stream", "x-snowflake-fe-instance": "fe-9" } });
/** A whole message as the stream of events the model service sends for it. */
const streamOf = (whole: { id: string; model: string; content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }) => stream([
  { type: "message_start", message: { id: whole.id, type: "message", role: "assistant", model: whole.model, content: [], stop_reason: null, usage: { input_tokens: whole.usage.input_tokens, output_tokens: 1 } } },
  ...whole.content.flatMap((block, index) => block.type === "text"
    ? [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }, { type: "content_block_stop", index }]
    : [{ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }, { type: "content_block_stop", index }]),
  { type: "message_delta", delta: { stop_reason: whole.stop_reason, stop_sequence: null }, usage: { output_tokens: whole.usage.output_tokens } },
  { type: "message_stop" },
]);
/** A reply's events with the usage the model service reports for it (`start`: the counts message_start carries). */
const counted = (start: Record<string, number>, output: number) => [
  { type: "message_start", message: { id: "msg_u", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: { output_tokens: 1, ...start } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: output } },
  { type: "message_stop" },
];
/** A streamed reply that sends `events` only once opened. */
function gated(events: object[]) {
  let open = () => undefined as void;
  const response = new Response(new ReadableStream({ start: controller => { open = () => { controller.enqueue(new TextEncoder().encode(sseOf(events))); controller.close(); }; } }), { status: 200, headers: { "content-type": "text/event-stream" } });
  return { response, open: () => open() };
}

const { gatewayRouter, keysRouter, reservedFor, resetLookupLimits } = await import("./gateway");
const { resetRouteHealth } = await import("./gateway/upstream");
const { apiBalanceMicros } = await import("./billing/wallet");
let server: Server;
let base = "";
beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    // Like undici: a request whose signal is already aborted is never sent.
    if (init.signal?.aborted) throw init.signal.reason ?? new Error("aborted");
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
  resetLookupLimits();
  upstream.calls.length = 0;
  upstream.bridge = call => streamOf(message(call.body.model));
  upstream.relay = call => streamOf(message(call.body.model.replace(/^r\//, "")));
  wallet.balances.clear();
  wallet.records.length = 0;
  wallet.lookup = null;
  wallet.writing = null;
  wallet.failCharges = false;
  billing.discount = { percent: 90, plans: true, api: true, endsAt: null };
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  // Nothing about the upstream ever reaches the log.
  for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toMatch(/snowflake|bridge\.test|relay\.test|relay-secret-key/i);
  warn.mockRestore();
  expect(credits.charge).not.toHaveBeenCalled();
  expect(credits.getBalance).not.toHaveBeenCalled();
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
/** The usage row the gateway writes for a reply. */
const row = (userId: string, keyId: string, model: string, usage: [number, number, number?, number?], listMicros: number, costMicros: number, discountPercent: number) => ({
  userId, keyId, model, usage: { inputTokens: usage[0], outputTokens: usage[1], cacheReadTokens: usage[2] ?? 0, cacheWriteTokens: usage[3] ?? 0 }, listMicros, costMicros, discountPercent,
});
/** Every hold of the account given back. */
const settled = (user: string) => vi.waitFor(() => expect(reservedFor(user)).toEqual({ reservedMicros: 0, reservedTokens: 0, requests: 0 }));
const EMPTY = "Your API balance is empty. Add balance on the Developer API page: https://curialy.tech/developer";

describe("API keys", () => {
  it("shows a new key's secret once, then lists only its prefix, and revoking stops it at once", async () => {
    const { key, secret } = await newKey("keys-user");
    expect(secret).toMatch(/^cur_live_[0-9a-f]{32}$/);
    expect(key.prefix).toBe(secret.slice(0, 13));
    const { GATEWAY_MODEL_IDS } = await import("../shared/gateway");
    expect(key.allowedModels).toEqual(GATEWAY_MODEL_IDS); // every model unless the key is limited
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
    const { key, secret } = await newKey("bridge-user");
    const response = await call("/v1/messages", secret, ask);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "claude-opus-5-5", content: [{ type: "text", text: "Hello!" }] });
    expect(response.headers.get("x-curialy-request-id")).toMatch(/^req_[0-9a-f]{24}$/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    for (const name of response.headers.keys()) expect(name).not.toMatch(/snowflake|envoy|^server$/);
    expect(upstream.calls).toEqual([expect.objectContaining({ url: "http://bridge.test/v1/messages", body: expect.objectContaining({ model: "claude-opus-5-5", stream: true }) })]);
    // 20k in at $4 and 1,250 out at $20 per million: $0.105 at the listed prices.
    await vi.waitFor(() => expect(wallet.records).toEqual([row("bridge-user", key.id, "claude-opus-5-5", [20_000, 1_250], 105_000, 105_000, 0)]));
    expect(wallet.balances.get("bridge-user")).toBe(10_000_000 - 105_000);
    await settled("bridge-user");
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
    // A request the model service never took costs nothing, and holds nothing afterwards.
    expect(wallet.records).toEqual([]);
    await settled("mask-user");
  });

  it("streams Anthropic events through, counts their usage, and masks an error event", async () => {
    const { key, secret } = await newKey("stream-user");
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
    // 10k in, 2,500 out: $0.04 + $0.05 at list.
    await vi.waitFor(() => expect(wallet.records).toEqual([row("stream-user", key.id, "claude-opus-5-5", [10_000, 2_500], 90_000, 90_000, 0)]));

    upstream.bridge = () => stream([{ type: "message_start", message: { id: "m", model: "claude-opus-5-5", usage: { input_tokens: 5 } } }, { type: "error", error: { type: "overloaded_error", message: "Snowflake region us-west-2 overloaded" } }]);
    const failed = await (await call("/v1/messages", secret, { ...ask, stream: true })).text();
    expect(failed).toContain('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"The requested model service is currently unavailable. Please retry shortly."}}');
    expect(failed).not.toMatch(/snowflake|us-west-2/i);
    // What it read before the error is billed: 5 input tokens.
    await vi.waitFor(() => expect(wallet.records.at(-1)).toEqual(row("stream-user", key.id, "claude-opus-5-5", [5, 0], 20, 20, 0)));
    await settled("stream-user");
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

  it("lets at most three requests of an account run at once, even when they arrive together, holding each one's cost", async () => {
    const { secret } = await newKey("burst-user");
    const gates: (() => void)[] = [];
    upstream.bridge = () => new Response(new ReadableStream({ start: controller => { gates.push(() => { controller.enqueue(new TextEncoder().encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`)); controller.close(); }); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const pending = Array.from({ length: 10 }, () => call("/v1/messages", secret, { ...ask, max_tokens: 64, stream: true }));
    await vi.waitFor(() => expect(upstream.calls.length).toBe(3));
    const statuses: number[] = [];
    for (const response of pending) {
      const status = await Promise.race([response.then(answer => answer.status), new Promise<number>(resolve => setTimeout(() => resolve(0), 300))]);
      statuses.push(status);
    }
    // Each holds 4 input tokens at the cache-write rate and 64 out, at the listed prices; 3 + 64 tokens.
    expect(reservedFor("burst-user")).toEqual({ reservedMicros: 3 * 1_320, reservedTokens: 3 * 70, requests: 3 });
    gates.forEach(open => open());
    const final = (await Promise.all(pending)).map(answer => answer.status);
    expect(final.filter(status => status === 200)).toHaveLength(3);
    expect(final.filter(status => status === 429)).toHaveLength(7);
    expect(upstream.calls).toHaveLength(3);
    await settled("burst-user");
  });

  it("charges nothing for a whole reply that ended in an error: the caller got no content", async () => {
    const { secret } = await newKey("whole-failure");
    upstream.bridge = () => stream([{ type: "message_start", message: { id: "m", model: "claude-opus-5-5", usage: { input_tokens: 5 } } }, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }]);
    const whole = await call("/v1/messages", secret, ask);
    expect(whole.status).toBe(503);
    await settled("whole-failure");
    expect(wallet.records).toEqual([]);
  });

  it("bills a stream the caller cut short for what the model really wrote, hidden reasoning included, and assembles unstreamed replies", async () => {
    const { key, secret } = await newKey("cut-user");
    const long = "x".repeat(40_000);
    let left!: () => void;
    const callerLeft = new Promise<void>(resolve => { left = resolve; });
    upstream.bridge = () => new Response(new ReadableStream({
      start: async controller => {
        const send = (event: object) => controller.enqueue(new TextEncoder().encode(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`));
        send({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], usage: { input_tokens: 1000, output_tokens: 1 } } });
        send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: long } });
        // The caller leaves; the model finishes anyway, and its count (25,000 out: most of it
        // reasoning the caller never saw) is what the reply cost.
        await callerLeft;
        send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 25_000 } });
        send({ type: "message_stop" });
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const response = await call("/v1/messages", secret, { ...ask, stream: true });
    const reader = response.body!.getReader();
    let received = "";
    while (!received.includes(long)) received += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    left();
    // 1000 in, 25000 out on Opus 5.5: $0.504 at list (not the 10,000 its visible text would suggest).
    await vi.waitFor(() => expect(wallet.records).toEqual([row("cut-user", key.id, "claude-opus-5-5", [1_000, 25_000], 504_000, 504_000, 0)]));
    await settled("cut-user");

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
    expect(scrubbed).not.toMatch(/antigravity|snowflake|7f2e|req_99|3fa85f64|https?:|\.com/i);
    expect(scrubbed).toContain("HTTP 403 (reset after 23s)");
    expect(scrubbed).toContain("claude-opus-5-5");
  });

  it("serves GPT, Grok, Kimi and GLM as they are on /v1/chat/completions, with standard fields only", async () => {
    const { key, secret } = await newKey("chat-user");
    const chunk = (fields: object) => ({ id: "chatcmpl-abc", object: "chat.completion.chunk", created: 1_793_900_000, model: "grok-4.7", system_fingerprint: "fp_upstream", service_tier: "default", obfuscation: "xyz", ...fields });
    const chatReply = () => new Response([
      chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { reasoning_content: "Thinking. " }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":' } }] }, finish_reason: null }] }),
      chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Lyon"}' } }] }, finish_reason: "tool_calls" }] }),
      chunk({ choices: [], usage: { prompt_tokens: 20_000, completion_tokens: 1_250, total_tokens: 21_250 } }),
    ].map(entry => `data: ${JSON.stringify(entry)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream", "x-snowflake-request-id": "sf-1" } });
    upstream.bridge = call => (call.url.endsWith("/v1/chat/completions") ? chatReply() : streamOf(message(call.body.model)));

    // Whole: assembled from the stream (asked for upstream, with its usage), the model as named.
    const whole = await call("/v1/chat/completions", secret, { model: "grok-4.7", messages: [{ role: "user", content: "Hi" }] });
    expect(whole.status).toBe(200);
    const completion = await whole.json();
    expect(completion).toEqual({
      id: "chatcmpl-abc", object: "chat.completion", created: 1_793_900_000, model: "grok-4.7",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello", reasoning_content: "Thinking. ", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"Lyon"}' } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 20_000, completion_tokens: 1_250, total_tokens: 21_250 },
    });
    expect(upstream.calls[0]).toMatchObject({ url: "http://bridge.test/v1/chat/completions", body: { model: "grok-4.7", stream: true, stream_options: { include_usage: true }, max_tokens: 4096 } });
    // 20k in at $2 and 1,250 out at $6 per million.
    await vi.waitFor(() => expect(wallet.records).toEqual([row("chat-user", key.id, "grok-4.7", [20_000, 1_250], 47_500, 47_500, 0)]));

    // Streamed without include_usage: cleaned chunks, no usage chunk, [DONE]; the caller's limit is passed on.
    upstream.calls.length = 0;
    const streamed = await (await call("/v1/chat/completions", secret, { model: "grok-4.7", stream: true, max_completion_tokens: 900, messages: [{ role: "user", content: "Hi" }] })).text();
    expect(upstream.calls[0].body.max_tokens).toBe(900);
    expect(upstream.calls[0].body.max_completion_tokens).toBeUndefined();
    const chunks = streamed.trim().split("\n\n").map(line => line.replace(/^data: /, ""));
    expect(chunks.at(-1)).toBe("[DONE]");
    const parsed = chunks.slice(0, -1).map(entry => JSON.parse(entry));
    expect(parsed.every(entry => Object.keys(entry).sort().join() === "choices,created,id,model,object" && entry.model === "grok-4.7")).toBe(true);
    expect(streamed).not.toMatch(/fp_upstream|obfuscation|service_tier|snowflake/i);
    // With include_usage, the usage chunk is the caller's too.
    const withUsage = await (await call("/v1/chat/completions", secret, { model: "grok-4.7", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "Hi" }] })).text();
    expect(withUsage).toContain('"usage":{"prompt_tokens":20000,"completion_tokens":1250,"total_tokens":21250}');

    // On /v1/messages these models are pointed to the right endpoint.
    const wrong = await call("/v1/messages", secret, { ...ask, model: "kimi-k3" });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.message).toBe("kimi-k3 is available on /v1/chat/completions (the OpenAI format), not on /v1/messages.");
  });

  it("fits OpenAI-format requests to what each Claude model accepts, and fails over to every verified relay copy", async () => {
    const { secret } = await newKey("fit-user");
    const sent = async (model: string, extra: object) => {
      upstream.calls.length = 0;
      expect((await call("/v1/chat/completions", secret, { model, messages: [{ role: "user", content: "Hi" }], ...extra })).status).toBe(200);
      return upstream.calls[0].body;
    };
    expect(await sent("claude-opus-4-6", { temperature: 0.5, top_p: 0.9 })).toMatchObject({ temperature: 0.5 });
    expect((await sent("claude-opus-4-6", { temperature: 0.5, top_p: 0.9 })).top_p).toBeUndefined();
    const haiku = await sent("claude-haiku-5-5", { temperature: 0.5, top_p: 0.9 });
    expect([haiku.temperature, haiku.top_p]).toEqual([undefined, undefined]);
    const tool = { type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } };
    expect((await sent("claude-opus-5", { tools: [tool], tool_choice: "required" })).tool_choice).toEqual({ type: "any" });
    expect(await sent("claude-sonnet-5-5", { tools: [tool], tool_choice: "required" })).toMatchObject({ tool_choice: { type: "auto" }, system: "Use one of the provided tools in your reply." });

    // The bridge refuses: models with a relay copy keep answering, the others report the outage.
    upstream.bridge = () => reply(403, { message: "Not authorized for this endpoint." });
    upstream.calls.length = 0;
    expect((await call("/v1/messages", secret, { ...ask, model: "claude-sonnet-5-5" })).status).toBe(200);
    expect(upstream.calls.map(entry => entry.body.model)).toEqual(["claude-sonnet-5-5", "r/claude-sonnet-5-5"]);
    resetRouteHealth();
    upstream.calls.length = 0;
    expect((await call("/v1/messages", secret, { ...ask, model: "claude-opus-4-8" })).status).toBe(503);
    expect(upstream.calls.map(entry => entry.url)).toEqual(["http://bridge.test/v1/messages"]);
  });

  it("keeps chat-model failures out of Claude's routing, standard usage only, and holds and bills every input and output", async () => {
    const { key, secret } = await newKey("review3-user");
    // A chat model's rate limit says nothing about the Claude endpoint: Claude still goes to the bridge first.
    upstream.bridge = call => (call.url.endsWith("/v1/chat/completions") ? reply(429, { error: { message: "rate limited" } }) : streamOf(message(call.body.model)));
    expect((await call("/v1/chat/completions", secret, { model: "kimi-k3", messages: [{ role: "user", content: "Hi" }] })).status).toBe(429);
    upstream.calls.length = 0;
    expect((await call("/v1/messages", secret, ask)).status).toBe(200);
    expect(upstream.calls.map(entry => entry.url)).toEqual(["http://bridge.test/v1/messages"]);
    await vi.waitFor(() => expect(wallet.records).toHaveLength(1));

    // Usage leaves with the standard fields only; reasoning reported only in the total is billed too.
    const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 4200, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 3000, accepted_prediction_tokens: 0 } };
    upstream.bridge = () => new Response([
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "glm-5.3", choices: [{ index: 0, delta: { function_call: { name: "lookup", arguments: '{"q":' } }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "glm-5.3", choices: [{ index: 0, delta: { function_call: { arguments: '"Lyon"}' } }, finish_reason: "function_call" }] },
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "glm-5.3", choices: [], usage },
    ].map(entry => `data: ${JSON.stringify(entry)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    wallet.records.length = 0;
    const whole = await (await call("/v1/chat/completions", secret, { model: "glm-5.3", messages: [{ role: "user", content: "Hi" }] })).json();
    expect(whole.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 4200, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 3000 } });
    expect(whole.choices[0].message).toEqual({ role: "assistant", content: null, function_call: { name: "lookup", arguments: '{"q":"Lyon"}' } });
    // 1000 in, 3200 out (4200 - 1000): 1,000 x $1.40 + 3,200 x $4.40 per million.
    await vi.waitFor(() => expect(wallet.records).toEqual([row("review3-user", key.id, "glm-5.3", [1_000, 3_200], 15_480, 15_480, 0)]));

    // A huge response format counts toward what the request could cost.
    wallet.balances.set("review3-user", 10_000);
    upstream.calls.length = 0;
    const schema = { type: "json_schema", json_schema: { name: "big", schema: { type: "object", description: "x".repeat(400_000) } } };
    const held = await call("/v1/chat/completions", secret, { model: "kimi-k3", max_tokens: 100, response_format: schema, messages: [{ role: "user", content: "Hi" }] });
    expect(held.status).toBe(402);
    expect((await held.json()).error).toMatchObject({ type: "insufficient_balance", message: expect.stringMatching(/^This request could cost up to \$0\.\d+ and \$0\.01 is available\./) });
    expect(upstream.calls).toEqual([]);
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

describe("paying for the API", () => {
  it("refuses an account whose API balance is empty before reading the body, and a balance it cannot read", async () => {
    const { secret } = await newKey("empty-user");
    for (const balance of [0, -500]) {
      wallet.balances.set("empty-user", balance);
      const refused = await call("/v1/messages", secret, ask);
      expect(refused.status).toBe(402);
      expect(await refused.json()).toEqual({ error: { message: EMPTY, type: "insufficient_balance", code: 402 } });
    }
    // Refused at admission: a body it never needed is not parsed (this one is not JSON).
    const unread = await realFetch(`${base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": secret }, body: "{not json" });
    expect(unread.status).toBe(402);
    expect(upstream.calls).toEqual([]);
    await settled("empty-user");

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      wallet.lookup = async () => { throw new Error("connect ECONNREFUSED db.example.com:5432"); };
      const down = await call("/v1/messages", secret, ask);
      expect(down.status).toBe(503);
      expect((await down.json()).error.message).toBe("The requested model service is currently unavailable. Please retry shortly.");
      expect(JSON.stringify(error.mock.calls)).toContain("[Curialy Gateway] balance lookup failed");
      expect(JSON.stringify(error.mock.calls)).not.toContain("example.com");
    } finally {
      error.mockRestore();
    }
    expect(upstream.calls).toEqual([]);
    await settled("empty-user");
  });

  it("caps max_tokens at the model's limit when streaming and lower without, naming both", async () => {
    const { secret } = await newKey("limit-user");
    const streamedTooLong = await call("/v1/messages", secret, { ...ask, max_tokens: 64_001, stream: true });
    expect(streamedTooLong.status).toBe(400);
    expect((await streamedTooLong.json()).error).toEqual({ type: "invalid_request_error", code: 400, message: "max_tokens can be at most 64000 on claude-opus-5-5 (16384 without streaming)." });
    const wholeTooLong = await call("/v1/messages", secret, { ...ask, max_tokens: 16_385 });
    expect((await wholeTooLong.json()).error.message).toBe("max_tokens can be at most 16384 on claude-opus-5-5 without streaming; stream the reply (stream: true) for up to 64000.");
    // The same limits on Chat Completions, for Claude and the OpenAI-format models.
    expect((await call("/v1/chat/completions", secret, { model: "claude-opus-5-5", max_completion_tokens: 20_000, messages: [{ role: "user", content: "Hi" }] })).status).toBe(400);
    expect((await call("/v1/chat/completions", secret, { model: "openai-gpt-5.4", max_tokens: 64_001, stream: true, messages: [{ role: "user", content: "Hi" }] })).status).toBe(400);
    expect(upstream.calls).toEqual([]);
    expect((await call("/v1/messages", secret, { ...ask, max_tokens: 64_000, stream: true })).status).toBe(200);
    expect((await call("/v1/messages", secret, { ...ask, max_tokens: 16_384 })).status).toBe(200);
    // The operator's keys keep no limit beyond the model's own.
    const { secret: operator } = await newKey("limit-operator", undefined, "admin");
    expect((await call("/v1/messages", operator, { ...ask, max_tokens: 100_000 })).status).toBe(200);
  });

  it("holds the most a request can cost at the listed prices, and refuses one the balance cannot cover", async () => {
    const { secret } = await newKey("hold-user");
    wallet.balances.set("hold-user", 10_000);
    // Opus 5.5 non-streaming at 16,384 tokens is about $0.33 at the listed prices.
    const big = await call("/v1/messages", secret, { ...ask, max_tokens: 16_384 });
    expect(big.status).toBe(402);
    expect((await big.json()).error.message).toMatch(/^This request could cost up to \$0\.33 and \$0\.01 is available\./);
    // A short request the balance covers goes through. 1,024 tokens is about $0.02.
    wallet.balances.set("hold-user", 30_000);
    expect((await call("/v1/messages", secret, ask)).status).toBe(200);
    expect(upstream.calls.length).toBeGreaterThan(0);
    await settled("hold-user");
  });

  it("holds what a request can really cost however its input is shaped, and never more than the model can read", async () => {
    const { secret } = await newKey("shape-user");
    // 40,000 characters of tool input buried 50 levels deep, beside keys and numbers: all of it counts.
    let nested: unknown = { note: "y".repeat(40_000) };
    for (let level = 0; level < 50; level++) nested = { level, inner: nested };
    const deep = gated(counted({ input_tokens: 10 }, 5));
    upstream.bridge = () => deep.response;
    const first = call("/v1/messages", secret, { ...ask, max_tokens: 1000, stream: true, messages: [
      { role: "user", content: "Look it up." },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: nested }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
    ] });
    // The slot is taken before the body is read; the hold once it is.
    await vi.waitFor(() => expect(reservedFor("shape-user").reservedTokens).toBeGreaterThan(10_000 + 1000));
    deep.open();
    await (await first).text();
    await settled("shape-user");

    // An image counts as an image, not as the length of its encoding.
    const picture = gated(counted({ input_tokens: 10 }, 5));
    upstream.bridge = () => picture.response;
    const second = call("/v1/messages", secret, { ...ask, max_tokens: 1000, stream: true, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(2_000_000) } }, { type: "text", text: "What is this?" }] }] });
    await vi.waitFor(() => expect(reservedFor("shape-user").reservedTokens).toBeGreaterThan(0));
    expect(reservedFor("shape-user").reservedTokens).toBeLessThan(1600 + 1000 + 100);
    picture.open();
    await (await second).text();
    await settled("shape-user");

    // Six million characters can't be read whole by a model with a 1M-token window: the hold stops there.
    const huge = gated(counted({ input_tokens: 10 }, 5));
    upstream.bridge = () => huge.response;
    const third = call("/v1/messages", secret, { ...ask, max_tokens: 1000, stream: true, messages: [{ role: "user", content: "z".repeat(6_000_000) }] });
    await vi.waitFor(() => expect(reservedFor("shape-user").reservedTokens).toBe(1_000_000 + 1000));
    huge.open();
    await (await third).text();
    await settled("shape-user");
  });

  it("holds past the long-context threshold at the long-context rates", async () => {
    const { secret } = await newKey("long-user");
    // About 100K input tokens, plus a quarter: past Haiku 5.5's 100K threshold, so its long-context
    // cache-write rate holds about $0.08 (the standard rates would hold about $0.016).
    const long = { model: "claude-haiku-5-5", max_tokens: 1000, messages: [{ role: "user", content: "x".repeat(400_000) }] };
    wallet.balances.set("long-user", 5_000);
    const refused = await call("/v1/messages", secret, long);
    expect(refused.status).toBe(402);
    expect((await refused.json()).error.message).toMatch(/^This request could cost up to \$0\.08 and \$0\.005 is available\./);
    wallet.balances.set("long-user", 100_000);
    expect((await call("/v1/messages", secret, long)).status).toBe(200);
  });

  it("shows a running request's hold in reservedFor and gives it back after success, failure and a cut-short stream", async () => {
    const { secret } = await newKey("reserve-user");
    const gate = gated(counted({ input_tokens: 1_000 }, 200));
    upstream.bridge = () => gate.response;
    const running = call("/v1/messages", secret, { ...ask, stream: true });
    await vi.waitFor(() => expect(upstream.calls).toHaveLength(1));
    // 3 input tokens (estimated) and 1,024 out; about $0.0205 at the listed prices.
    expect(reservedFor("reserve-user")).toEqual({ reservedMicros: 20_520, reservedTokens: 1_030, requests: 1 });
    gate.open();
    expect((await running).status).toBe(200);
    await (await running).text();
    await settled("reserve-user");

    // Refused by the model service: nothing charged, nothing held.
    upstream.bridge = () => reply(500, { message: "unavailable" });
    upstream.relay = () => reply(500, { message: "unavailable" });
    expect((await call("/v1/messages", secret, ask)).status).toBe(503);
    await settled("reserve-user");
    expect(wallet.records).toHaveLength(1);
  });

  it("never lets two requests spend the same balance, even when one was charged after the other read it", async () => {
    const { key, secret } = await newKey("race-user");
    wallet.balances.set("race-user", 300_000);
    // A holds about $0.20 (10,000 tokens out) and costs $0.184 when it ends.
    const first = gated(counted({ input_tokens: 1_000 }, 9_000));
    upstream.bridge = () => first.response;
    const a = call("/v1/messages", secret, { ...ask, max_tokens: 10_000, stream: true });
    await vi.waitFor(() => expect(upstream.calls).toHaveLength(1));
    // While A runs, what is left cannot hold B.
    const blocked = await call("/v1/messages", secret, { ...ask, max_tokens: 10_000, stream: true });
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).error.message).toMatch(/^This request could cost up to \$0\.20 and \$0\.10 is available\./);

    // B reads the balance before A is charged, and decides after: A's charge still counts.
    let release = () => undefined as void;
    const read = new Promise<void>(resolve => { release = resolve; });
    let asked = false;
    wallet.lookup = async userId => {
      const balance = wallet.balances.get(userId)!;
      asked = true;
      await read;
      return balance;
    };
    const b = call("/v1/messages", secret, { ...ask, max_tokens: 10_000, stream: true });
    await vi.waitFor(() => expect(asked).toBe(true));
    first.open();
    expect((await a).status).toBe(200);
    await (await a).text();
    await vi.waitFor(() => expect(wallet.records).toEqual([row("race-user", key.id, "claude-opus-5-5", [1_000, 9_000], 184_000, 184_000, 0)]));
    await vi.waitFor(() => expect(reservedFor("race-user").reservedMicros).toBe(0));
    release();
    const late = await b;
    expect(late.status).toBe(402);
    expect((await late.json()).error.message).toMatch(/^This request could cost up to \$0\.20 and \$0\.1[0-9] is available\./);
    expect(upstream.calls).toHaveLength(1);
    await settled("race-user");
  });

  it("never runs, nor charges, a request whose caller left while it was being admitted", async () => {
    const { secret } = await newKey("gone-user");
    let release = () => undefined as void;
    const read = new Promise<void>(resolve => { release = resolve; });
    let asked = false;
    wallet.lookup = async () => {
      asked = true;
      await read;
      return 10_000_000;
    };
    const { connect } = await import("node:net");
    const body = JSON.stringify(ask);
    const socket = connect(Number(new URL(base).port), "127.0.0.1");
    await new Promise(resolve => socket.once("connect", resolve));
    socket.write(`POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-api-key: ${secret}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    await vi.waitFor(() => expect(asked).toBe(true));
    socket.destroy();
    // Its slot is given back as soon as the caller is gone.
    await vi.waitFor(() => expect(reservedFor("gone-user").requests).toBe(0));
    release();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(upstream.calls).toEqual([]);
    expect(wallet.records).toEqual([]);
    await settled("gone-user");
  });

  it("keeps a finished request's hold until its charge is written", async () => {
    const { secret } = await newKey("slow-charge-user");
    wallet.balances.set("slow-charge-user", 300_000);
    let written = () => undefined as void;
    wallet.writing = new Promise<void>(resolve => { written = resolve; });
    upstream.bridge = () => stream(counted({ input_tokens: 1_000 }, 9_000));
    await (await call("/v1/messages", secret, { ...ask, max_tokens: 10_000, stream: true })).text();
    // The reply is done and its slot free; its charge is not written yet, so its hold stays.
    await vi.waitFor(() => expect(reservedFor("slow-charge-user")).toEqual({ reservedMicros: 200_040, reservedTokens: 10_006, requests: 0 }));
    const next = await call("/v1/messages", secret, { ...ask, max_tokens: 10_000, stream: true });
    expect(next.status).toBe(402);
    expect(upstream.calls).toHaveLength(1);
    written();
    await settled("slow-charge-user");
    expect(wallet.balances.get("slow-charge-user")).toBe(300_000 - 184_000);
  });

  it("charges Anthropic replies with their cache tokens, whole and streamed, at the listed prices", async () => {
    const { key, secret } = await newKey("cache-user");
    upstream.bridge = () => stream(counted({ input_tokens: 100, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000 }, 500));
    // 100 x $4 + 50,000 x $0.20 + 2,000 x $5 + 500 x $20 per million = $0.0304 at list.
    expect((await call("/v1/messages", secret, ask)).status).toBe(200);
    await vi.waitFor(() => expect(wallet.records).toEqual([row("cache-user", key.id, "claude-opus-5-5", [100, 500, 50_000, 2_000], 30_400, 30_400, 0)]));
    await (await call("/v1/messages", secret, { ...ask, stream: true })).text();
    await vi.waitFor(() => expect(wallet.records.at(-1)).toEqual(row("cache-user", key.id, "claude-opus-5-5", [100, 500, 50_000, 2_000], 30_400, 30_400, 0)));
    expect(wallet.balances.get("cache-user")).toBe(10_000_000 - 30_400 - 30_400);
    // A fully cached prompt (no uncached input) is billed as it was counted, not as an estimate.
    upstream.bridge = () => stream(counted({ input_tokens: 0, cache_read_input_tokens: 8_000 }, 10));
    await (await call("/v1/messages", secret, ask)).text();
    await vi.waitFor(() => expect(wallet.records.at(-1)).toMatchObject({ usage: { inputTokens: 0, outputTokens: 10, cacheReadTokens: 8_000, cacheWriteTokens: 0 }, listMicros: 1_800 }));
  });

  it("charges an OpenAI-format reply's cached prompt tokens at the cache-read rate", async () => {
    const { key, secret } = await newKey("cached-chat-user");
    upstream.bridge = () => new Response([
      { id: "c2", object: "chat.completion.chunk", created: 1, model: "gpt-5.4", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] },
      { id: "c2", object: "chat.completion.chunk", created: 1, model: "gpt-5.4", choices: [], usage: { prompt_tokens: 20_000, completion_tokens: 1_250, total_tokens: 21_250, prompt_tokens_details: { cached_tokens: 12_000 } } },
    ].map(entry => `data: ${JSON.stringify(entry)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    expect((await call("/v1/chat/completions", secret, { model: "openai-gpt-5.4", messages: [{ role: "user", content: "Hi" }] })).status).toBe(200);
    // 8,000 x $2.50 + 12,000 x $0.25 + 1,250 x $15 per million = $0.04175 at list.
    await vi.waitFor(() => expect(wallet.records).toEqual([row("cached-chat-user", key.id, "openai-gpt-5.4", [8_000, 1_250, 12_000, 0], 41_750, 41_750, 0)]));
  });

  it("never charges the operator, nor checks its balance, but records its usage at list price for its charts", async () => {
    const { key, secret } = await newKey("operator", undefined, "admin");
    expect((await call("/v1/messages", secret, ask)).status).toBe(200);
    await vi.waitFor(() => expect(wallet.records).toEqual([row("operator", key.id, "claude-opus-5-5", [20_000, 1_250], 105_000, 0, 0)]));
    expect(apiBalanceMicros).not.toHaveBeenCalledWith("operator");
    expect(wallet.balances.get("operator")).toBe(10_000_000);
    await settled("operator");
  });

  it("never runs a model without a price for a paying key; the operator's key runs it at no cost", async () => {
    const { API_PRICES } = await import("../shared/billing");
    const price = API_PRICES["glm-5.3"];
    delete API_PRICES["glm-5.3"];
    try {
      const { secret } = await newKey("unpriced-user");
      const refused = await call("/v1/chat/completions", secret, { model: "glm-5.3", messages: [{ role: "user", content: "Hi" }] });
      expect(refused.status).toBe(403);
      const reason = (await refused.json()).error.message as string;
      expect(reason).toMatch(/^This key cannot use glm-5\.3\. It can use: claude-opus-5-5, /);
      expect(reason.split("It can use:")[1]).not.toContain("glm-5.3");
      const listed = await (await realFetch(`${base}/v1/models`, { headers: { "x-api-key": secret } })).json();
      expect(listed.data.map((model: { id: string }) => model.id)).not.toContain("glm-5.3");
      expect((await realFetch(`${base}/v1/models/glm-5.3`, { headers: { "x-api-key": secret } })).status).toBe(404);
      expect(upstream.calls).toEqual([]);

      const { key, secret: operator } = await newKey("unpriced-operator", undefined, "admin");
      upstream.bridge = () => new Response(`data: ${JSON.stringify({ id: "c3", object: "chat.completion.chunk", created: 1, model: "glm-5.3", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
      expect((await call("/v1/chat/completions", operator, { model: "glm-5.3", messages: [{ role: "user", content: "Hi" }] })).status).toBe(200);
      await vi.waitFor(() => expect(wallet.records).toEqual([row("unpriced-operator", key.id, "glm-5.3", [10, 5], 0, 0, 0)]));
    } finally {
      API_PRICES["glm-5.3"] = price;
    }
  });

  it("logs a charge that fails without failing the reply, and gives the hold back", async () => {
    const { secret } = await newKey("failing-user");
    wallet.failCharges = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await call("/v1/messages", secret, ask);
      expect(response.status).toBe(200);
      expect((await response.json()).content).toEqual([{ type: "text", text: "Hello!" }]);
      await vi.waitFor(() => expect(JSON.stringify(error.mock.calls)).toContain("[Curialy Gateway] charge failed (account failing-user, claude-opus-5-5, 105000 micro-dollars)"));
      expect(JSON.stringify(error.mock.calls)).not.toContain("example.com");
      await settled("failing-user");
    } finally {
      error.mockRestore();
    }
  });
});
