import { randomBytes } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { creditsFor } from "@shared/credits";
import { GATEWAY_MODEL_IDS, GATEWAY_MODELS, gatewayModel } from "@shared/gateway";
import { accountOf, requireUser } from "../auth";
import { charge, getBalance, outOfCreditsMessage } from "../credits";
import { createKey, findActiveKey, KeyError, listKeys, revokeKey, touchKey, type GatewayKey } from "./keys";
import { chatChunks, toAnthropic, toChatCompletion, TranslationError } from "./openai";
import { addUsage, chatBuilder, cleanChunk, emptyUsage, errorBody, messageBuilder, scrub, sendUpstream, sseEvents, UNAVAILABLE, type Failure, type Usage } from "./upstream";

// The Developer API. /api/keys: an account's keys (signed in). /v1 (and /api/v1): Anthropic Messages
// and OpenAI Chat Completions for the gateway models, authenticated by key, charged to the key's
// account in credits like the agent's own model use (the operator's account is not charged).

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

/** Per request: its key, its admission (slot, bytes, balance) and its credit hold. */
type Admission = { key: GatewayKey; available: number; bytes: number; hold: number; release: () => void };
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
/** Free accounts: requests in flight per account, and the largest reply one request may ask for. */
const MAX_IN_FLIGHT_FREE = 3;
const MAX_TOKENS_FREE = 16_384;

let bytesInFlight = 0;
let requestsInFlight = 0;
const inFlight = new Map<string, number>();
/** Credits held for requests still running, per account: what they could cost at most. */
const held = new Map<string, number>();

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
 * Admission before the body is read: room on the host (bytes and requests in flight), a slot on a
 * free account (taken at once, so a burst cannot pass the cap together), and credits left. All of
 * it is given back when the response ends, however it ends.
 */
async function admit(req: Request, res: Response, next: NextFunction) {
  const key = KEYS.get(req)!;
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return send(res, 413, "invalid_request_error", "The request body is too large (8 MB at most).");
  const bytes = Number.isFinite(declared) && declared > 0 ? declared : MAX_BODY_BYTES;
  if (requestsInFlight >= MAX_REQUESTS_IN_FLIGHT || bytesInFlight + bytes > MAX_BYTES_IN_FLIGHT) return send(res, 429, "rate_limit_error", "The API is busy right now. Please retry shortly.");
  if (!key.operator && (inFlight.get(key.userId) ?? 0) >= MAX_IN_FLIGHT_FREE) return send(res, 429, "rate_limit_error", `At most ${MAX_IN_FLIGHT_FREE} requests at a time on this account.`);
  requestsInFlight++;
  bytesInFlight += bytes;
  inFlight.set(key.userId, (inFlight.get(key.userId) ?? 0) + 1);
  let released = false;
  const admission: Admission = {
    key, available: Infinity, bytes, hold: 0,
    release: () => {
      if (released) return;
      released = true;
      requestsInFlight--;
      bytesInFlight -= bytes;
      inFlight.set(key.userId, Math.max(0, (inFlight.get(key.userId) ?? 1) - 1));
      if (admission.hold) held.set(key.userId, Math.max(0, (held.get(key.userId) ?? 0) - admission.hold));
    },
  };
  res.once("close", admission.release);
  ADMITTED.set(req, admission);
  if (!key.operator) {
    try {
      const balance = await getBalance(key.userId);
      admission.available = balance.unlimited ? Infinity : balance.available;
      if (!(admission.available > 0)) {
        admission.release();
        return send(res, 402, "insufficient_credits", outOfCreditsMessage(balance));
      }
    } catch (error) {
      admission.release();
      console.error("[Curialy Gateway] balance lookup failed:", error instanceof Error ? scrub(error.message) : error);
      return send(res, 503, "curialy_api_error", UNAVAILABLE);
    }
  }
  next();
}

/** Input tokens a request will use, roughly: its text at about 4 characters a token, images and documents at about 1,600 each. */
function inputEstimate(value: unknown, depth = 0): number {
  if (depth > 32) return 0;
  if (typeof value === "string") return value.length / 4;
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + inputEstimate(item, depth + 1), 0);
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  if (record.type === "image" || record.type === "document" || record.type === "image_url" || record.type === "input_audio") return 1600;
  return Object.values(record).reduce((sum: number, item) => sum + inputEstimate(item, depth + 1), 0);
}

/** Why this request may not run (model, size), or null. Then, for a free account, hold what it could cost at most. */
function refusal(admission: Admission, model: unknown, maxTokens: unknown, request: Record<string, unknown>): { status: number; type: string; message: string } | null {
  const { key } = admission;
  if (typeof model !== "string" || !model) return { status: 400, type: "invalid_request_error", message: "model is required." };
  if (!GATEWAY_MODEL_IDS.includes(model) || !key.allowedModels.includes(model)) {
    const allowed = key.allowedModels.filter(id => GATEWAY_MODEL_IDS.includes(id));
    return { status: 403, type: "permission_error", message: `This key cannot use ${model}. It can use: ${allowed.join(", ") || "no models"}.` };
  }
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1) return { status: 400, type: "invalid_request_error", message: "max_tokens must be a positive integer." };
  if (key.operator) return null;
  if (maxTokens > MAX_TOKENS_FREE) return { status: 400, type: "invalid_request_error", message: `max_tokens can be at most ${MAX_TOKENS_FREE} on this account.` };
  // The most this request could cost: its input and every token it may write.
  const hold = creditsFor(model, { inputTokens: Math.ceil(inputEstimate(request.messages) + inputEstimate(request.system) + inputEstimate(request.tools)), outputTokens: maxTokens });
  const room = admission.available - (held.get(key.userId) ?? 0);
  if (hold > room) return { status: 402, type: "insufficient_credits", message: `This request could use up to ${hold} credits and ${Math.max(0, Math.floor(room * 100) / 100)} are available. Lower max_tokens or wait for your credits to refill.` };
  admission.hold = hold;
  held.set(key.userId, (held.get(key.userId) ?? 0) + hold);
  return null;
}

/** Charge the response to the key's account, at the agent's rates (cache reads a tenth, cache writes a quarter more). */
function chargeFor(key: GatewayKey, model: string, usage: Usage) {
  if (key.operator) return;
  const input = usage.inputTokens + Math.round(usage.cacheReadTokens / 10) + Math.round(usage.cacheWriteTokens * 1.25);
  const amount = creditsFor(model, { inputTokens: input, outputTokens: usage.outputTokens });
  if (amount > 0) charge(key.userId, amount, null, `API ${model}: ${usage.inputTokens} in, ${usage.outputTokens} out`).catch(error => console.error("[Curialy Gateway] charge failed:", error instanceof Error ? scrub(error.message) : error));
}

const MASKED_EVENT = { type: "error", error: { type: "api_error", message: UNAVAILABLE } };
const sse = (event: string | undefined, data: string) => `${event ? `event: ${event}\n` : ""}data: ${data}\n\n`;

/** Run one request on the model service and answer in the caller's format, whole or streamed. */
async function proxy(req: Request, res: Response, format: "anthropic" | "openai") {
  const admission = ADMITTED.get(req)!;
  const { key } = admission;
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
  const refused = refusal(admission, model, request.max_tokens, request);
  if (refused) return send(res, refused.status, refused.type, refused.message);
  const streamed = request.stream === true;
  const includeUsage = format === "openai" && (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true;
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  const usage = emptyUsage();
  let accepted = false;
  let finalUsage = false;
  let streamedChars = 0;
  try {
    const version = typeof req.headers["anthropic-version"] === "string" ? req.headers["anthropic-version"] : "2023-06-01";
    const beta = typeof req.headers["anthropic-beta"] === "string" ? req.headers["anthropic-beta"] : undefined;
    const result = await sendUpstream("messages", model, request, { version, beta, signal: controller.signal });
    if ("failure" in result) return sendFailure(res, result.failure);
    accepted = true;
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
        if (!streamed) return send(res, 503, "curialy_api_error", UNAVAILABLE);
        res.write(format === "openai" ? sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE }))) : sse("error", JSON.stringify(MASKED_EVENT)));
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
      if (whole) {
        if (data) whole.add(data);
      } else if (!chunks) res.write(sse(event.event, data ? JSON.stringify(data) : event.data));
      else if (data) for (const chunk of chunks.translate(data)) res.write(sse(undefined, JSON.stringify(chunk)));
    }
    if (whole) {
      const message = { ...whole.message(), model };
      return res.status(200).json(format === "openai" ? toChatCompletion(message, model, usage) : message);
    }
    if (chunks) {
      if (includeUsage) res.write(sse(undefined, JSON.stringify(chunks.usage(usage))));
      res.write(sse(undefined, "[DONE]"));
    }
    res.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    console.warn(`[Curialy Gateway] Upstream error: ${error instanceof Error ? scrub(error.message) : "request failed"}`);
    if (!res.headersSent) return send(res, 503, "curialy_api_error", UNAVAILABLE);
    res.write(format === "openai" ? sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE }))) : sse("error", JSON.stringify(MASKED_EVENT)));
    res.end();
  } finally {
    if (accepted) {
      // A reply cut short (the caller left, an error, a lost final count) is billed for what was
      // written so far (about 4 characters a token); one with no count at all for its input.
      if (!finalUsage) usage.outputTokens = Math.max(usage.outputTokens, Math.ceil(streamedChars / 4));
      if (!usage.inputTokens) usage.inputTokens = Math.ceil(inputEstimate(request.messages) + inputEstimate(request.system));
      chargeFor(key, model, usage);
    }
    admission.release();
  }
}

/** A reply limit for a chat request that names none (Anthropic-format requests must name one). */
const DEFAULT_CHAT_MAX_TOKENS = 4096;

/** An OpenAI-format model: the request goes to the bridge as it is; the answer comes back whole or streamed, fields cleaned. */
async function proxyChat(res: Response, admission: Admission, body: Record<string, unknown>, model: string) {
  const { key } = admission;
  if (typeof body.n === "number" && body.n > 1) return send(res, 400, "invalid_request_error", "n greater than 1 is not supported.");
  const limit = body.max_completion_tokens ?? body.max_tokens ?? DEFAULT_CHAT_MAX_TOKENS;
  const refused = refusal(admission, model, limit, { messages: body.messages, tools: body.tools });
  if (refused) return send(res, refused.status, refused.type, refused.message);
  const { max_completion_tokens: _limit, stream_options: _options, ...rest } = body;
  const request = { ...rest, max_tokens: limit };
  const streamed = body.stream === true;
  const includeUsage = (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true;
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  const usage = emptyUsage();
  let accepted = false;
  let finalUsage = false;
  let streamedChars = 0;
  const masked = sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE })));
  try {
    const result = await sendUpstream("chat", model, request, { version: "", signal: controller.signal });
    if ("failure" in result) return sendFailure(res, result.failure);
    accepted = true;
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
        if (!streamed) return send(res, 503, "curialy_api_error", UNAVAILABLE);
        res.write(masked);
        break;
      }
      if (chunk.usage) {
        // Cached prompt tokens are part of prompt_tokens: billed at a tenth, like cache reads elsewhere.
        const cached = Number(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0) || 0;
        usage.inputTokens = Math.max(0, (Number(chunk.usage.prompt_tokens) || 0) - cached);
        usage.cacheReadTokens = cached;
        usage.outputTokens = Number(chunk.usage.completion_tokens) || 0;
        finalUsage = true;
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? {};
        streamedChars += String(delta.content ?? "").length + String(delta.reasoning_content ?? "").length;
        for (const call of delta.tool_calls ?? []) streamedChars += String(call.function?.arguments ?? "").length;
      }
      if (whole) whole.add(chunk);
      // The usage-only chunk is the caller's only if they asked for it (it was asked for upstream to bill).
      else if (chunk.choices?.length || includeUsage) res.write(sse(undefined, JSON.stringify(cleanChunk(chunk, model))));
    }
    if (whole) return res.status(200).json(whole.completion());
    res.write(sse(undefined, "[DONE]"));
    res.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    console.warn(`[Curialy Gateway] Upstream error: ${error instanceof Error ? scrub(error.message) : "request failed"}`);
    if (!res.headersSent) return send(res, 503, "curialy_api_error", UNAVAILABLE);
    res.write(masked);
    res.end();
  } finally {
    if (accepted) {
      if (!finalUsage) usage.outputTokens = Math.max(usage.outputTokens, Math.ceil(streamedChars / 4));
      if (!usage.inputTokens && !usage.cacheReadTokens) usage.inputTokens = Math.ceil(inputEstimate(body.messages));
      chargeFor(key, model, usage);
    }
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
    const data = GATEWAY_MODELS.filter(model => key.allowedModels.includes(model.id)).map(modelInfo);
    res.json({ object: "list", data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
  });
  router.get("/models/:id", authenticate, (req, res) => {
    const model = GATEWAY_MODELS.find(entry => entry.id === req.params.id && KEYS.get(req)!.allowedModels.includes(entry.id));
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
