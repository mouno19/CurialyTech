import { brandText } from "@shared/brand";
import { PROVIDER_ENV } from "../agent/providers";

// The model service behind the Developer API: the internal bridge first and, when it refuses, the
// same model on the relay. Nothing about either reaches the caller: errors are masked, headers
// are never copied, and logs name only "core" or "relay".

export const UNAVAILABLE = "The requested model service is currently unavailable. Please retry shortly.";

type Route = { name: "core" | "relay"; url: string; model: string; headers: Record<string, string> };

/** The relay's copies of the gateway models. */
const RELAY_COPIES: Record<string, string> = { "claude-opus-5-5": "r/claude-opus-5-5", "claude-sonnet-4-5": "r/claude-sonnet-4-5" };

/** After the bridge refuses a request, the next ones go straight to the relay for a while. */
const CORE_PAUSE_MS = 2 * 60_000;
let coreDownUntil = 0;
/** Tests: forget that the bridge refused. */
export const resetRouteHealth = () => { coreDownUntil = 0; };

function routesFor(model: string): Route[] {
  const core: Route = { name: "core", url: `${PROVIDER_ENV.cortexBridgeUrl}/v1/messages`, model, headers: {} };
  const relay: Route | null = PROVIDER_ENV.relayKey && RELAY_COPIES[model]
    ? { name: "relay", url: `${PROVIDER_ENV.relayUrl}/v1/messages`, model: RELAY_COPIES[model], headers: { authorization: `Bearer ${PROVIDER_ENV.relayKey}` } }
    : null;
  if (!relay) return [core];
  return Date.now() < coreDownUntil ? [relay, core] : [core, relay];
}

/** An upstream message made safe to log or show: Curialy names, no hosts, ids, tokens or relay model ids. */
export function scrub(text: string) {
  return brandText(text)
    .replace(/\br\/(claude-[\w.-]+)/g, "$1")
    .replace(/\b(?:request[_ ]?id|x-[\w-]+-request-id)["':= ]+[\w-]+/gi, "")
    .replace(/\b(?:Bearer|token)\s+[\w.~+/=-]{12,}/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** The message inside an upstream error body (Anthropic, OpenAI or plain shapes). */
function upstreamMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    return typeof message === "string" ? message : "";
  } catch {
    return body.slice(0, 300);
  }
}

export type Failure = { status: number; type: string; message: string; retryAfter?: string };

/** How an upstream failure reaches the caller: their own mistakes in their words, everything else masked. */
function failure(status: number, body: string, retryAfter: string | null): Failure {
  if (status === 400 || status === 413 || status === 422) return { status, type: "invalid_request_error", message: scrub(upstreamMessage(body)) || "The request was not accepted." };
  if (status === 429) return { status: 429, type: "rate_limit_error", message: "Too many requests right now. Please retry shortly.", ...(retryAfter && /^\d+$/.test(retryAfter) ? { retryAfter } : {}) };
  return { status: 503, type: "curialy_api_error", message: UNAVAILABLE };
}

export const errorBody = (failure: Pick<Failure, "status" | "type" | "message">) => ({ error: { message: failure.message, type: failure.type, code: failure.status } });

/**
 * Send an Anthropic Messages request for `model`. Resolves with the first successful response,
 * or with the failure to report once every route has refused (a malformed request is reported
 * at once: no other route would accept it either).
 */
export async function sendMessages(model: string, body: Record<string, unknown>, opts: { version: string; beta?: string; signal: AbortSignal }): Promise<{ response: Response } | { failure: Failure }> {
  let last: Failure = { status: 503, type: "curialy_api_error", message: UNAVAILABLE };
  for (const route of routesFor(model)) {
    let response: Response;
    try {
      response = await fetch(route.url, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": opts.version, ...(opts.beta ? { "anthropic-beta": opts.beta } : {}), ...route.headers },
        body: JSON.stringify({ ...body, model: route.model }),
        signal: opts.signal,
      });
    } catch (error) {
      if (opts.signal.aborted) throw error;
      console.warn(`[Curialy Gateway] Upstream error: ${route.name} unreachable (${scrub(error instanceof Error ? error.message : String(error))})`);
      continue;
    }
    if (response.ok) {
      if (route.name === "core") coreDownUntil = 0;
      return { response };
    }
    const text = await response.text().catch(() => "");
    console.warn(`[Curialy Gateway] Upstream error: ${route.name} ${response.status} ${scrub(upstreamMessage(text))}`);
    if (route.name === "core" && response.status !== 400 && response.status !== 413 && response.status !== 422) coreDownUntil = Date.now() + CORE_PAUSE_MS;
    last = failure(response.status, text, response.headers.get("retry-after"));
    if (last.type === "invalid_request_error") break;
  }
  return { failure: last };
}

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/** Fold an Anthropic usage object (a response's, or a stream event's) into `usage`. */
export function addUsage(usage: Usage, raw: unknown) {
  const value = (raw ?? {}) as Record<string, unknown>;
  const number = (key: string) => (typeof value[key] === "number" ? (value[key] as number) : undefined);
  usage.inputTokens = number("input_tokens") ?? usage.inputTokens;
  usage.outputTokens = number("output_tokens") ?? usage.outputTokens;
  usage.cacheReadTokens = number("cache_read_input_tokens") ?? usage.cacheReadTokens;
  usage.cacheWriteTokens = number("cache_creation_input_tokens") ?? usage.cacheWriteTokens;
}

export type SseEvent = { event?: string; data: string };

/** Split an SSE byte stream into events (blank-line separated, CRLF or LF). */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string): SseEvent | null => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    return event || data.length ? { event, data: data.join("\n") } : null;
  };
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const event = parse(block);
      if (event) yield event;
    }
  }
  const last = parse(buffer + decoder.decode());
  if (last) yield last;
}
