import { randomBytes } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { getModel, outputLimit } from "@shared/agent";
import { API_PRICES, apiCost, formatUsd, microsToUsd, modelLimits, NON_STREAMING_MAX_TOKENS, ratesFor } from "@shared/billing";
import { GATEWAY_MODEL_IDS, GATEWAY_MODELS, gatewayModel } from "@shared/gateway";
import { accountOf, requireUser } from "../auth";
import { apiBalanceMicros, recordApiUsage } from "../billing/wallet";
import { createKey, findActiveKey, KeyError, listKeys, revokeKey, touchKey, type GatewayKey } from "./keys";
import { chatChunks, toAnthropic, toChatCompletion, TranslationError } from "./openai";
import { addUsage, chatBuilder, cleanChunk, emptyUsage, errorBody, messageBuilder, scrub, sendUpstream, sseEvents, UNAVAILABLE, type Failure, type Usage } from "./upstream";

// The Developer API. /api/keys: an account's keys (signed in). /v1 (and /api/v1): Anthropic Messages
// and OpenAI Chat Completions for the gateway models, authenticated by key, paid from the key's
// account's API balance: each reply at the model's listed price. A top-up adds more balance than it
// costs. The operator's account is not charged (its usage is still recorded, at no cost).

const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => void handler(req, res).catch(error => {
  if (error instanceof KeyError) return res.status(error.status).json({ error: error.message });
  console.error("[Curialy Gateway] keys:", error instanceof Error ? scrub(error.message) : error);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong on our side. Try again in a moment." });
});

const createSchema = z.object({ name: z.string().trim().min(1, "Name the key.").max(60, "Keep the name under 60 characters."), models: z.array(z.string()).max(20).optional() });

export function keysRouter() {
  const router = Router();
  router.use(requireUser);
  router.get("/", asyncRoute(async (req, res) => res.json({ keys: await listKeys(accountOf(req).id) })));
  router.post("/", asyncRoute(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    const created = await createKey(accountOf(req).id, parsed.data.name, parsed.data.models ?? GATEWAY_MODEL_IDS);
    // The secret is in this response only; it is not stored and cannot be shown again.
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(created);
  }));
  router.delete("/:id", asyncRoute(async (req, res) => res.json({ key: await revokeKey(accountOf(req).id, req.params.id) })));
  return router;
}

// ---- Gateway ----

/**
 * Per request: its key, its slot and bytes, the account's API balance when it was admitted (and what
 * this process had charged the account by then), the API discount then, and its hold: what it could
 * cost at most (micro-dollars) and the tokens it may use. billable: the model service took the
 * request, so its reply is charged, and its hold stays until that charge is written.
 */
type Admission = {
  key: GatewayKey; bytes: number; balance: number; chargedBefore: number; percentOff: number;
  hold: number; tokens: number; billable: boolean; release: () => void; unhold: () => void;
};
const ADMITTED = new WeakMap<Request, Admission>();
const KEYS = new WeakMap<Request, GatewayKey>();

const send = (res: Response, status: number, type: string, message: string) => res.status(status).json(errorBody({ status, type, message }));
const sendFailure = (res: Response, failure: Failure) => {
  if (failure.retryAfter) res.setHeader("Retry-After", failure.retryAfter);
  return send(res, failure.status, failure.type, failure.message);
};

/** The host is small: bodies up to 8 MB, at most 24 MB of them and 12 requests in flight at once. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_BYTES_IN_FLIGHT = 24 * 1024 * 1024;
const MAX_REQUESTS_IN_FLIGHT = 12;
/** Requests in flight per account (the operator's are not capped). */
const MAX_IN_FLIGHT_PER_ACCOUNT = 3;

const DEVELOPER_PAGE = "https://curialy.tech/developer";
const EMPTY_BALANCE = `Your API balance is empty. Add balance on the Developer API page: ${DEVELOPER_PAGE}`;

let bytesInFlight = 0;
let requestsInFlight = 0;

/**
 * Per account: requests in flight, what its requests not charged yet could cost at most and the
 * tokens they may use, and what this process has charged it since it started (a charge written after
 * a request read the balance is not in that balance).
 */
type Reserved = { requests: number; micros: number; tokens: number; charged: number };
const reserved = new Map<string, Reserved>();
function reservedOf(userId: string) {
  let entry = reserved.get(userId);
  if (!entry) reserved.set(userId, (entry = { requests: 0, micros: 0, tokens: 0, charged: 0 }));
  return entry;
}

/** What an account's requests hold right now (its API wallet shows it). */
export function reservedFor(userId: string) {
  const entry = reserved.get(userId);
  return { reservedMicros: entry?.micros ?? 0, reservedTokens: entry?.tokens ?? 0, requests: entry?.requests ?? 0 };
}

/** What the account can still spend: its balance when admitted, less what was charged since and what its requests hold. */
function available(admission: Admission) {
  const entry = reservedOf(admission.key.userId);
  return admission.balance - (entry.charged - admission.chargedBefore) - entry.micros;
}

function secretOf(req: Request) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const header = req.headers["x-api-key"];
  return typeof header === "string" ? header.trim() : "";
}

/**
 * Key lookups that missed the cache, per address in ten minutes (counted before the lookup, given
 * back when the key is valid), and at most a few such lookups at once: random keys cannot queue up
 * on the shared database pool.
 */
const lookups = new Map<string, { count: number; resetAt: number }>();
const MAX_LOOKUP_FAILURES = 60;
const MAX_LOOKUPS_AT_ONCE = 8;
let lookupsAtOnce = 0;
/** Tests: forget earlier failed lookups. */
export const resetLookupLimits = () => lookups.clear();

async function authenticate(req: Request, res: Response, next: NextFunction) {
  const secret = secretOf(req);
  if (!secret) return send(res, 401, "authentication_error", "Missing API key: send it in the x-api-key header or as Authorization: Bearer.");
  const address = req.ip ?? "unknown";
  const now = Date.now();
  let entry = lookups.get(address);
  if (!entry || entry.resetAt <= now) {
    if (lookups.size > 20_000) lookups.clear();
    entry = { count: 0, resetAt: now + 10 * 60_000 };
    lookups.set(address, entry);
  }
  if (entry.count >= MAX_LOOKUP_FAILURES) return send(res, 429, "rate_limit_error", "Too many requests with invalid keys. Wait a few minutes.");
  if (lookupsAtOnce >= MAX_LOOKUPS_AT_ONCE) return send(res, 429, "rate_limit_error", "Too many requests right now. Please retry shortly.");
  entry.count++;
  lookupsAtOnce++;
  let key: GatewayKey | null;
  try {
    key = await findActiveKey(secret);
  } catch (error) {
    console.error("[Curialy Gateway] key lookup failed:", error instanceof Error ? scrub(error.message) : error);
    return send(res, 503, "curialy_api_error", UNAVAILABLE);
  } finally {
    lookupsAtOnce--;
  }
  if (!key) return send(res, 401, "authentication_error", "Invalid or revoked API key.");
  entry.count = Math.max(0, entry.count - 1);
  KEYS.set(req, key);
  touchKey(key.id);
  next();
}

/**
 * Admission before the body is read: room on the host (bytes and requests in flight), a slot on the
 * account (taken at once, so a burst cannot pass the cap together), and API balance left. The slot
 * is given back when the response ends, however it ends; the hold with it, or once the reply's
 * charge is written (so a request that starts meanwhile cannot spend the same balance).
 */
async function admit(req: Request, res: Response, next: NextFunction) {
  const key = KEYS.get(req)!;
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return send(res, 413, "invalid_request_error", "The request body is too large (8 MB at most).");
  const bytes = Number.isFinite(declared) && declared > 0 ? declared : MAX_BODY_BYTES;
  if (requestsInFlight >= MAX_REQUESTS_IN_FLIGHT || bytesInFlight + bytes > MAX_BYTES_IN_FLIGHT) return send(res, 429, "rate_limit_error", "The API is busy right now. Please retry shortly.");
  const account = reservedOf(key.userId);
  if (!key.operator && account.requests >= MAX_IN_FLIGHT_PER_ACCOUNT) return send(res, 429, "rate_limit_error", `At most ${MAX_IN_FLIGHT_PER_ACCOUNT} requests at a time on this account.`);
  requestsInFlight++;
  bytesInFlight += bytes;
  account.requests++;
  let released = false;
  const admission: Admission = {
    key, bytes, balance: Infinity, chargedBefore: account.charged, percentOff: 0, hold: 0, tokens: 0, billable: false,
    release: () => {
      if (released) return;
      released = true;
      requestsInFlight--;
      bytesInFlight -= bytes;
      account.requests = Math.max(0, account.requests - 1);
      if (!admission.billable) admission.unhold();
    },
    // Gives back whatever the request holds now (safe to call again).
    unhold: () => {
      account.micros = Math.max(0, account.micros - admission.hold);
      account.tokens = Math.max(0, account.tokens - admission.tokens);
      admission.hold = 0;
      admission.tokens = 0;
    },
  };
  // A request the model service took keeps its slot until its reply has been read to the end (proxy's finally).
  res.once("close", () => { if (!admission.billable) admission.release(); });
  ADMITTED.set(req, admission);
  if (!key.operator) {
    try {
      // A charge that settles while the balance is read may already be in it, and would then count
      // twice (balance and charged-since): read again until none settled meanwhile (three tries; a
      // count left twice only refuses early).
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = account.charged;
        admission.balance = await apiBalanceMicros(key.userId);
        admission.chargedBefore = before;
        if (account.charged === before) break;
      }
      // Usage is charged at the prices on the Developer API page. The offer is the top-up multiple, not a cut on each token.
      admission.percentOff = 0;
      if (!(available(admission) > 0)) {
        admission.release();
        return send(res, 402, "insufficient_balance", EMPTY_BALANCE);
      }
    } catch (error) {
      admission.release();
      console.error("[Curialy Gateway] balance lookup failed:", error instanceof Error ? scrub(error.message) : error);
      return send(res, 503, "curialy_api_error", UNAVAILABLE);
    }
  }
  next();
}

/** An image costs the model about this many tokens, however large its encoding. */
const IMAGE_TOKENS = 1600;

/**
 * The input tokens a request may use, generously (it sizes the request's hold): everything it sends
 * the model counts, keys, numbers and nesting included, at about 4 ASCII characters a token and a
 * token for every other character; only an image block counts as an image. Documents and audio count
 * by their encoded size: far more than they cost, but holdFor caps the total at what the model can
 * read, and a request must never hold much less than it can cost.
 */
function inputEstimate(value: unknown): number {
  let tokens = 0;
  const text = (value: string) => {
    let wide = 0;
    for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) > 0x7f) wide++;
    tokens += (value.length - wide) / 4 + wide;
  };
  const walk = (node: unknown, depth: number) => {
    if (typeof node === "string") return text(node);
    if (typeof node === "number" || typeof node === "boolean") return text(String(node));
    if (!node || typeof node !== "object") return;
    if (depth > 64) return text(JSON.stringify(node) ?? "");
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.type === "image" || record.type === "image_url") {
      tokens += IMAGE_TOKENS;
      return;
    }
    for (const [key, item] of Object.entries(record)) {
      text(key);
      walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return tokens;
}

/** No request reads more input than the model's context window (1.05M when the list has none). */
const contextCap = (model: string) => modelLimits(model)?.contextWindow ?? 1_050_000;

/** A model this key may call: offered, on the key's list, and priced (only the operator's keys, never charged, may call one without a price). */
const callable = (key: GatewayKey, id: string) => GATEWAY_MODEL_IDS.includes(id) && key.allowedModels.includes(id) && (key.operator || Object.hasOwn(API_PRICES, id));

/** The largest max_tokens one request may ask for: the model's verified reply limit when it streams, less when it doesn't (longer replies must stream). */
function maxTokensFor(model: string) {
  const spec = getModel(model);
  const streaming = spec ? outputLimit(spec) : NON_STREAMING_MAX_TOKENS;
  return { streaming, nonStreaming: Math.min(NON_STREAMING_MAX_TOKENS, streaming) };
}

/**
 * The most a request can cost, in micro-dollars at the listed prices: its input (the estimate and a
 * quarter more, as it is rough) at the higher of the input and cache-write rates, long-context rates
 * past the model's threshold, and every token it may write.
 */
function holdFor(model: string, estimate: number, maxTokens: number, percentOff: number) {
  const input = Math.min(Math.ceil(estimate * 1.25), contextCap(model));
  const rates = ratesFor(API_PRICES[model], input);
  const written = rates.cacheWrite > rates.input;
  return apiCost(model, { inputTokens: written ? 0 : input, outputTokens: maxTokens, cacheReadTokens: 0, cacheWriteTokens: written ? input : 0 }, percentOff).costMicros;
}

const usd = (micros: number) => formatUsd(microsToUsd(micros));

/**
 * Why this request may not run (model, size, balance), or null. Then, for a paying account, hold
 * what it could cost at most. estimate: the input tokens it will use, roughly.
 */
function refusal(admission: Admission, model: unknown, maxTokens: unknown, streamed: boolean, estimate: number): { status: number; type: string; message: string } | null {
  const { key } = admission;
  if (typeof model !== "string" || !model) return { status: 400, type: "invalid_request_error", message: "model is required." };
  if (!callable(key, model)) {
    const allowed = key.allowedModels.filter(id => callable(key, id));
    return { status: 403, type: "permission_error", message: `This key cannot use ${model}. It can use: ${allowed.join(", ") || "no models"}.` };
  }
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1) return { status: 400, type: "invalid_request_error", message: "max_tokens must be a positive integer." };
  if (key.operator) return null;
  const limits = maxTokensFor(model);
  if (streamed && maxTokens > limits.streaming) return { status: 400, type: "invalid_request_error", message: `max_tokens can be at most ${limits.streaming} on ${model} (${limits.nonStreaming} without streaming).` };
  if (!streamed && maxTokens > limits.nonStreaming) return { status: 400, type: "invalid_request_error", message: `max_tokens can be at most ${limits.nonStreaming} on ${model} without streaming; stream the reply (stream: true) for up to ${limits.streaming}.` };
  const hold = holdFor(model, estimate, maxTokens, admission.percentOff);
  const room = available(admission);
  if (hold > room) return { status: 402, type: "insufficient_balance", message: `This request could cost up to ${usd(hold)} and ${usd(Math.max(0, room))} is available. Lower max_tokens or add balance on the Developer API page: ${DEVELOPER_PAGE}` };
  const account = reservedOf(key.userId);
  admission.hold += hold;
  const tokens = Math.min(estimate, contextCap(model)) + maxTokens;
  admission.tokens += tokens;
  account.micros += hold;
  account.tokens += tokens;
  return null;
}

/** Token counts as the usage table keeps them: whole numbers, never negative. */
const tokenCount = (value: number) => (Number.isFinite(value) ? Math.min(2_147_483_647, Math.max(0, Math.round(value))) : 0);

/**
 * Charge a reply to the key's account: its list price less the discount the request was admitted
 * at, taken from the API balance by the statement that records its usage (the operator's usage is
 * recorded at no cost). It never holds up or fails the response; the hold is given back once the
 * charge is written, or has failed (logged: the account was not charged).
 */
function chargeFor(admission: Admission, model: string, raw: Usage) {
  const { key } = admission;
  const usage = { inputTokens: tokenCount(raw.inputTokens), outputTokens: tokenCount(raw.outputTokens), cacheReadTokens: tokenCount(raw.cacheReadTokens), cacheWriteTokens: tokenCount(raw.cacheWriteTokens) };
  let cost = 0;
  const settle = (charged: number) => {
    reservedOf(key.userId).charged += charged;
    admission.unhold();
  };
  const failed = (error: unknown) => {
    console.error(`[Curialy Gateway] charge failed (account ${key.userId}, ${model}, ${cost} micro-dollars):`, error instanceof Error ? scrub(error.message) : error);
    settle(0);
  };
  try {
    const price = key.operator
      ? { listMicros: Object.hasOwn(API_PRICES, model) ? apiCost(model, usage, 0).listMicros : 0, costMicros: 0 }
      : apiCost(model, usage, admission.percentOff);
    cost = price.costMicros;
    const percentOff = key.operator ? 0 : admission.percentOff;
    recordApiUsage({ userId: key.userId, keyId: key.id, model, usage, listMicros: price.listMicros, costMicros: cost, discountPercent: percentOff }).then(() => settle(cost), failed);
  } catch (error) {
    failed(error);
  }
}

const MASKED_EVENT = { type: "error", error: { type: "api_error", message: UNAVAILABLE } };
const sse = (event: string | undefined, data: string) => `${event ? `event: ${event}\n` : ""}data: ${data}\n\n`;

/** Run one request on the model service and answer in the caller's format, whole or streamed. */
async function proxy(req: Request, res: Response, format: "anthropic" | "openai") {
  const admission = ADMITTED.get(req)!;
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, "invalid_request_error", "The request body must be a JSON object.");
  // GPT, Grok, Kimi and GLM speak the OpenAI format: served as they are, on /v1/chat/completions.
  const named = typeof body.model === "string" ? gatewayModel(body.model) : undefined;
  if (named?.format === "openai") {
    if (format === "anthropic") return send(res, 400, "invalid_request_error", `${named.id} is available on /v1/chat/completions (the OpenAI format), not on /v1/messages.`);
    return proxyChat(res, admission, body, named.id);
  }
  let request: Record<string, unknown>;
  try {
    request = format === "openai" ? toAnthropic(body) : { ...body };
  } catch (error) {
    if (error instanceof TranslationError) return send(res, 400, "invalid_request_error", error.message);
    throw error;
  }
  const model = request.model as string;
  const streamed = request.stream === true;
  const estimate = Math.ceil(inputEstimate([request.messages, request.system, request.tools]));
  const refused = refusal(admission, model, request.max_tokens, streamed, estimate);
  if (refused) return send(res, refused.status, refused.type, refused.message);
  const includeUsage = format === "openai" && (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true;
  const controller = new AbortController();
  // Before the model service takes it, a caller that leaves stops the request; after, the reply is
  // read to its end so its real count is billed (hidden reasoning included), then nothing more.
  res.on("close", () => { if (!res.writableFinished && !admission.billable) controller.abort(); });
  // A caller that left while it was being admitted is not run (nor charged).
  if (res.destroyed) controller.abort();
  const usage = emptyUsage();
  let finalUsage = false;
  let streamedChars = 0;
  const write = (chunk: string) => { if (!res.destroyed) res.write(chunk); };
  try {
    const version = typeof req.headers["anthropic-version"] === "string" ? req.headers["anthropic-version"] : "2023-06-01";
    const beta = typeof req.headers["anthropic-beta"] === "string" ? req.headers["anthropic-beta"] : undefined;
    const result = await sendUpstream("messages", model, request, { version, beta, signal: controller.signal, deadlineMs: streamed ? undefined : WHOLE_REPLY_DEADLINE_MS });
    if ("failure" in result) return sendFailure(res, result.failure);
    admission.billable = true;
    const chunks = streamed && format === "openai" ? chatChunks(model) : null;
    const whole = streamed ? null : messageBuilder();
    if (streamed) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    }
    for await (const event of sseEvents(result.response.body!)) {
      let data: Record<string, any> | null = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Not JSON (keep-alives): passed on as they are.
      }
      if (data?.type === "error") {
        console.warn(`[Curialy Gateway] Upstream error: stream ${scrub(String(data.error?.message ?? ""))}`);
        if (!streamed) return res.destroyed ? undefined : send(res, 503, "curialy_api_error", UNAVAILABLE);
        write(format === "openai" ? sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE }))) : sse("error", JSON.stringify(MASKED_EVENT)));
        break;
      }
      if (data?.type === "message_start" && data.message) {
        data.message.model = model;
        addUsage(usage, data.message.usage);
      }
      if (data?.type === "message_delta" && data.usage) {
        addUsage(usage, data.usage);
        finalUsage = true;
      }
      if (data?.type === "content_block_delta") streamedChars += String(data.delta?.text ?? data.delta?.partial_json ?? data.delta?.thinking ?? "").length;
      // The caller left and the final count is in: nothing more to read or bill.
      if (res.destroyed && finalUsage) break;
      if (whole) {
        if (data) whole.add(data);
      } else if (!chunks) write(sse(event.event, data ? JSON.stringify(data) : event.data));
      else if (data) for (const chunk of chunks.translate(data)) write(sse(undefined, JSON.stringify(chunk)));
    }
    if (res.destroyed) return;
    if (whole) {
      const message = { ...whole.message(), model };
      return res.status(200).json(format === "openai" ? toChatCompletion(message, model, usage) : message);
    }
    if (chunks) {
      if (includeUsage) write(sse(undefined, JSON.stringify(chunks.usage(usage))));
      write(sse(undefined, "[DONE]"));
    }
    res.end();
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    console.warn(`[Curialy Gateway] Upstream error: ${error instanceof Error ? scrub(error.message) : "request failed"}`);
    if (!res.headersSent) return send(res, 503, "curialy_api_error", UNAVAILABLE);
    write(format === "openai" ? sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE }))) : sse("error", JSON.stringify(MASKED_EVENT)));
    res.end();
  } finally {
    // A whole (non-streamed) reply that ended in an error delivered nothing: it is not charged.
    if (admission.billable && (streamed || res.statusCode < 500)) {
      // A reply cut short (the caller left, an error, a lost final count) is billed for what was
      // written so far (about 4 characters a token); one with no count at all for its input.
      if (!finalUsage) usage.outputTokens = Math.max(usage.outputTokens, Math.ceil(streamedChars / 4));
      if (!usage.inputTokens && !usage.cacheReadTokens && !usage.cacheWriteTokens) usage.inputTokens = estimate;
      chargeFor(admission, model, usage);
    } else admission.unhold();
    admission.release();
  }
}

/**
 * A whole (non-streamed) reply gives up before nginx's 600 s read timeout: the caller then gets an
 * uncharged 503 from here, not a gateway timeout for a reply it was billed for.
 */
const WHOLE_REPLY_DEADLINE_MS = 570_000;

/** A reply limit for a chat request that names none (Anthropic-format requests must name one). */
const DEFAULT_CHAT_MAX_TOKENS = 4096;

/** An OpenAI-format model: the request goes to the bridge as it is; the answer comes back whole or streamed, fields cleaned. */
async function proxyChat(res: Response, admission: Admission, body: Record<string, unknown>, model: string) {
  if (typeof body.n === "number" && body.n > 1) return send(res, 400, "invalid_request_error", "n greater than 1 is not supported.");
  const limit = body.max_completion_tokens ?? body.max_tokens ?? DEFAULT_CHAT_MAX_TOKENS;
  const streamed = body.stream === true;
  // Input the model reads: messages, tools and legacy functions, and a response format's schema.
  const estimate = Math.ceil(inputEstimate([body.messages, body.tools, body.functions, body.response_format]));
  const refused = refusal(admission, model, limit, streamed, estimate);
  if (refused) return send(res, refused.status, refused.type, refused.message);
  const { max_completion_tokens: _limit, stream_options: _options, ...rest } = body;
  const request = { ...rest, max_tokens: limit };
  const includeUsage = (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true;
  const controller = new AbortController();
  // Before the model service takes it, a caller that leaves stops the request; after, the reply is
  // read to its end so its real count is billed (hidden reasoning included), then nothing more.
  res.on("close", () => { if (!res.writableFinished && !admission.billable) controller.abort(); });
  if (res.destroyed) controller.abort();
  const usage = emptyUsage();
  let finalUsage = false;
  let streamedChars = 0;
  const masked = sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE })));
  const write = (chunk: string) => { if (!res.destroyed) res.write(chunk); };
  try {
    const result = await sendUpstream("chat", model, request, { version: "", signal: controller.signal, deadlineMs: streamed ? undefined : WHOLE_REPLY_DEADLINE_MS });
    if ("failure" in result) return sendFailure(res, result.failure);
    admission.billable = true;
    const whole = streamed ? null : chatBuilder(model);
    if (streamed) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    }
    for await (const event of sseEvents(result.response.body!)) {
      if (event.data.trim() === "[DONE]") break;
      let chunk: Record<string, any>;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (chunk.error) {
        console.warn(`[Curialy Gateway] Upstream error: stream ${scrub(String(chunk.error?.message ?? ""))}`);
        if (!streamed) return res.destroyed ? undefined : send(res, 503, "curialy_api_error", UNAVAILABLE);
        write(masked);
        break;
      }
      if (chunk.usage) {
        // Cached prompt tokens are part of prompt_tokens: billed at a tenth, like cache reads elsewhere.
        const cached = Number(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0) || 0;
        usage.inputTokens = Math.max(0, (Number(chunk.usage.prompt_tokens) || 0) - cached);
        usage.cacheReadTokens = cached;
        // Reasoning is inside completion_tokens (OpenAI) or only in the total (some providers): bill the larger.
        usage.outputTokens = Math.max(Number(chunk.usage.completion_tokens) || 0, (Number(chunk.usage.total_tokens) || 0) - (Number(chunk.usage.prompt_tokens) || 0));
        finalUsage = true;
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? {};
        streamedChars += String(delta.content ?? "").length + String(delta.reasoning_content ?? "").length;
        for (const call of delta.tool_calls ?? []) streamedChars += String(call.function?.arguments ?? "").length;
      }
      // The caller left and the final count is in: nothing more to read or bill.
      if (res.destroyed && finalUsage) break;
      if (whole) whole.add(chunk);
      // The usage-only chunk is the caller's only if they asked for it (it was asked for upstream to bill).
      else if (chunk.choices?.length || includeUsage) write(sse(undefined, JSON.stringify(cleanChunk(chunk, model))));
    }
    if (res.destroyed) return;
    if (whole) return res.status(200).json(whole.completion());
    write(sse(undefined, "[DONE]"));
    res.end();
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    console.warn(`[Curialy Gateway] Upstream error: ${error instanceof Error ? scrub(error.message) : "request failed"}`);
    if (!res.headersSent) return send(res, 503, "curialy_api_error", UNAVAILABLE);
    write(masked);
    res.end();
  } finally {
    if (admission.billable && (streamed || res.statusCode < 500)) {
      if (!finalUsage) usage.outputTokens = Math.max(usage.outputTokens, Math.ceil(streamedChars / 4));
      if (!usage.inputTokens && !usage.cacheReadTokens) usage.inputTokens = estimate;
      chargeFor(admission, model, usage);
    } else admission.unhold();
    admission.release();
  }
}

const MODELS_CREATED = 1_793_836_800; // 2026-11-05: when these models opened on the Developer API

function modelInfo(model: (typeof GATEWAY_MODELS)[number]) {
  return { id: model.id, object: "model", type: "model", display_name: model.label, created: MODELS_CREATED, created_at: new Date(MODELS_CREATED * 1000).toISOString(), owned_by: "curialy" };
}

/** /v1 and /api/v1: mounted before the app's body parsers and same-origin check (API clients are cross-origin by design). */
export function gatewayRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("x-curialy-request-id", `req_${randomBytes(12).toString("hex")}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "x-curialy-request-id, retry-after");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "OPTIONS") return next();
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    const asked = req.headers["access-control-request-headers"];
    res.setHeader("Access-Control-Allow-Headers", typeof asked === "string" && /^[\w\-, ]{1,600}$/.test(asked) ? asked : "authorization, x-api-key, content-type, anthropic-version, anthropic-beta");
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
  });
  const json = express.json({ limit: MAX_BODY_BYTES });
  router.get("/models", authenticate, (req, res) => {
    const key = KEYS.get(req)!;
    const data = GATEWAY_MODELS.filter(model => callable(key, model.id)).map(modelInfo);
    res.json({ object: "list", data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
  });
  router.get("/models/:id", authenticate, (req, res) => {
    const model = GATEWAY_MODELS.find(entry => entry.id === req.params.id && callable(KEYS.get(req)!, entry.id));
    return model ? res.json(modelInfo(model)) : send(res, 404, "not_found_error", `Model ${req.params.id} is not available to this key.`);
  });
  const run = (format: "anthropic" | "openai") => (req: Request, res: Response) => void proxy(req, res, format).catch(error => {
    console.error("[Curialy Gateway] request failed:", error instanceof Error ? scrub(error.message) : error);
    if (!res.headersSent) send(res, 503, "curialy_api_error", UNAVAILABLE);
    else res.end();
  });
  router.post("/messages", authenticate, admit, json, run("anthropic"));
  router.post("/chat/completions", authenticate, admit, json, run("openai"));
  router.use((_req, res) => send(res, 404, "not_found_error", "Unknown endpoint. Use /v1/messages, /v1/chat/completions or /v1/models."));
  // Body parser failures (malformed JSON, oversized bodies) in the same error format.
  router.use((error: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (error?.type === "entity.too.large") return send(res, 413, "invalid_request_error", "The request body is too large (8 MB at most).");
    return send(res, error?.status && error.status < 500 ? error.status : 400, "invalid_request_error", "The request body must be valid JSON.");
  });
  return router;
}
