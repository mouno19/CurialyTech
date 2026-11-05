import { randomBytes } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { creditsFor } from "@shared/credits";
import { GATEWAY_MODEL_IDS, GATEWAY_MODELS } from "@shared/gateway";
import { accountOf, requireUser } from "../auth";
import { charge, getBalance, outOfCreditsMessage } from "../credits";
import { createKey, findActiveKey, KeyError, listKeys, revokeKey, touchKey, type GatewayKey } from "./keys";
import { chatChunks, toAnthropic, toChatCompletion, TranslationError } from "./openai";
import { addUsage, emptyUsage, errorBody, scrub, sendMessages, sseEvents, UNAVAILABLE, type Failure, type Usage } from "./upstream";

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

const KEYS = new WeakMap<Request, GatewayKey>();
const send = (res: Response, status: number, type: string, message: string) => res.status(status).json(errorBody({ status, type, message }));
const sendFailure = (res: Response, failure: Failure) => {
  if (failure.retryAfter) res.setHeader("Retry-After", failure.retryAfter);
  return send(res, failure.status, failure.type, failure.message);
};

/** Free accounts: requests in flight per account, and the largest reply one request may ask for. */
const MAX_IN_FLIGHT = 3;
const MAX_TOKENS_FREE = 16_384;
const inFlight = new Map<string, number>();

function secretOf(req: Request) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const header = req.headers["x-api-key"];
  return typeof header === "string" ? header.trim() : "";
}

/** Failed key attempts per address in ten minutes; past the limit, requests are refused before any lookup. */
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_ATTEMPTS = 60;

async function authenticate(req: Request, res: Response, next: NextFunction) {
  const secret = secretOf(req);
  if (!secret) return send(res, 401, "authentication_error", "Missing API key: send it in the x-api-key header or as Authorization: Bearer.");
  const address = req.ip ?? "unknown";
  const failed = failedAttempts.get(address);
  if (failed && failed.resetAt > Date.now() && failed.count >= MAX_FAILED_ATTEMPTS) return send(res, 429, "rate_limit_error", "Too many requests with invalid keys. Wait a few minutes.");
  let key: GatewayKey | null;
  try {
    key = await findActiveKey(secret);
  } catch (error) {
    console.error("[Curialy Gateway] key lookup failed:", error instanceof Error ? scrub(error.message) : error);
    return send(res, 503, "curialy_api_error", UNAVAILABLE);
  }
  if (!key) {
    if (!failed || failed.resetAt <= Date.now()) {
      if (failedAttempts.size > 20_000) failedAttempts.clear();
      failedAttempts.set(address, { count: 1, resetAt: Date.now() + 10 * 60_000 });
    } else failed.count++;
    return send(res, 401, "authentication_error", "Invalid or revoked API key.");
  }
  KEYS.set(req, key);
  touchKey(key.id);
  next();
}

/** Why the key may not run this request now (its model, its size, credits, requests in flight), or null. */
async function refusal(key: GatewayKey, model: unknown, maxTokens: unknown): Promise<{ status: number; type: string; message: string } | null> {
  if (typeof model !== "string" || !model) return { status: 400, type: "invalid_request_error", message: "model is required." };
  if (!GATEWAY_MODEL_IDS.includes(model) || !key.allowedModels.includes(model)) {
    const allowed = key.allowedModels.filter(id => GATEWAY_MODEL_IDS.includes(id));
    return { status: 403, type: "permission_error", message: `This key cannot use ${model}. It can use: ${allowed.join(", ") || "no models"}.` };
  }
  if (key.operator) return null;
  if (typeof maxTokens === "number" && maxTokens > MAX_TOKENS_FREE) return { status: 400, type: "invalid_request_error", message: `max_tokens can be at most ${MAX_TOKENS_FREE} on this account.` };
  if ((inFlight.get(key.userId) ?? 0) >= MAX_IN_FLIGHT) return { status: 429, type: "rate_limit_error", message: `At most ${MAX_IN_FLIGHT} requests at a time on this account.` };
  const balance = await getBalance(key.userId);
  if (!balance.unlimited && !(balance.available > 0)) return { status: 402, type: "insufficient_credits", message: outOfCreditsMessage(balance) };
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
  const key = KEYS.get(req)!;
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, "invalid_request_error", "The request body must be a JSON object.");
  let request: Record<string, unknown>;
  try {
    request = format === "openai" ? toAnthropic(body) : { ...body };
  } catch (error) {
    if (error instanceof TranslationError) return send(res, 400, "invalid_request_error", error.message);
    throw error;
  }
  const model = request.model as string;
  const refused = await refusal(key, model, request.max_tokens);
  if (refused) return send(res, refused.status, refused.type, refused.message);
  const streamed = request.stream === true;
  const includeUsage = format === "openai" && (body.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true;
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  inFlight.set(key.userId, (inFlight.get(key.userId) ?? 0) + 1);
  const usage = emptyUsage();
  let streamedChars = 0;
  try {
    const version = typeof req.headers["anthropic-version"] === "string" ? req.headers["anthropic-version"] : "2023-06-01";
    const beta = typeof req.headers["anthropic-beta"] === "string" ? req.headers["anthropic-beta"] : undefined;
    const result = await sendMessages(model, request, { version, beta, signal: controller.signal });
    if ("failure" in result) return sendFailure(res, result.failure);
    const upstream = result.response;
    if (!streamed) {
      const message = (await upstream.json()) as Record<string, unknown>;
      addUsage(usage, message.usage);
      message.model = model;
      return res.status(200).json(format === "openai" ? toChatCompletion(message, model, usage) : message);
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const chunks = format === "openai" ? chatChunks(model) : null;
    for await (const event of sseEvents(upstream.body!)) {
      let data: Record<string, any> | null = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Not JSON (keep-alives): passed on as they are.
      }
      if (data?.type === "error") {
        console.warn(`[Curialy Gateway] Upstream error: stream ${scrub(String(data.error?.message ?? ""))}`);
        res.write(chunks ? sse(undefined, JSON.stringify(errorBody({ status: 503, type: "curialy_api_error", message: UNAVAILABLE }))) : sse("error", JSON.stringify(MASKED_EVENT)));
        break;
      }
      if (data?.type === "message_start" && data.message) {
        data.message.model = model;
        addUsage(usage, data.message.usage);
      }
      if (data?.type === "message_delta") addUsage(usage, data.usage);
      if (data?.type === "content_block_delta") streamedChars += String(data.delta?.text ?? data.delta?.partial_json ?? data.delta?.thinking ?? "").length;
      if (!chunks) res.write(sse(event.event, data ? JSON.stringify(data) : event.data));
      else if (data) for (const chunk of chunks.translate(data)) res.write(sse(undefined, JSON.stringify(chunk)));
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
    inFlight.set(key.userId, Math.max(0, (inFlight.get(key.userId) ?? 1) - 1));
    // A stream cut short has no final count: estimate the reply from what was sent (about 4 characters a token).
    if (usage.outputTokens === 0 && streamedChars > 0) usage.outputTokens = Math.ceil(streamedChars / 4);
    chargeFor(key, model, usage);
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
  const json = express.json({ limit: "16mb" });
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
  router.post("/messages", authenticate, json, run("anthropic"));
  router.post("/chat/completions", authenticate, json, run("openai"));
  router.use((_req, res) => send(res, 404, "not_found_error", "Unknown endpoint. Use /v1/messages, /v1/chat/completions or /v1/models."));
  // Body parser failures (malformed JSON, oversized bodies) in the same error format.
  router.use((error: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (error?.type === "entity.too.large") return send(res, 413, "invalid_request_error", "The request body is too large (16 MB at most).");
    return send(res, error?.status && error.status < 500 ? error.status : 400, "invalid_request_error", "The request body must be valid JSON.");
  });
  return router;
}
