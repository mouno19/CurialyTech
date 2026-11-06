import { brandText } from "@shared/brand";
import { PROVIDER_ENV } from "../agent/providers";

// The model service behind the Developer API: the internal bridge first and, when it refuses, the
// same model on the relay. Nothing about either reaches the caller: errors are masked, headers
// are never copied, and logs name only "core" or "relay". Every upstream call is streamed (the
// relay answers with a stream even when asked not to, and a stream sends its headers at once);
// a caller that did not ask for one gets the assembled message.

export const UNAVAILABLE = "The requested model service is currently unavailable. Please retry shortly.";

type Route = { name: "core" | "relay"; url: string; model: string; headers: Record<string, string> };

/**
 * The relay's copies of the gateway models, each checked live (the relay answers them as the same
 * model). Models without one, and every OpenAI-format model, are served by the bridge alone.
 */
const RELAY_COPIES: Record<string, string> = {
  "claude-opus-5-5": "r/claude-opus-5-5", "claude-opus-5": "r/claude-opus-5", "claude-sonnet-5-5": "r/claude-sonnet-5-5",
  "claude-sonnet-5": "r/claude-sonnet-5", "claude-sonnet-4-6": "r/claude-sonnet-4-6", "claude-sonnet-4-5": "r/claude-sonnet-4-5",
};

/** The two APIs the bridge speaks: Anthropic Messages (Claude) and OpenAI Chat Completions (the others). */
export type UpstreamApi = "messages" | "chat";

/** After the bridge refuses a request, the next ones go straight to the relay for a while. */
const CORE_PAUSE_MS = 2 * 60_000;
let coreDownUntil = 0;
/** Tests: forget that the bridge refused. */
export const resetRouteHealth = () => { coreDownUntil = 0; };

/** The longest a request may run upstream (nginx gives /v1 ten minutes). */
const UPSTREAM_DEADLINE_MS = 10 * 60_000;

function routesFor(api: UpstreamApi, model: string): Route[] {
  if (api === "chat") return [{ name: "core", url: `${PROVIDER_ENV.cortexBridgeUrl}/v1/chat/completions`, model, headers: {} }];
  const core: Route = { name: "core", url: `${PROVIDER_ENV.cortexBridgeUrl}/v1/messages`, model, headers: {} };
  const relay: Route | null = PROVIDER_ENV.relayKey && RELAY_COPIES[model]
    ? { name: "relay", url: `${PROVIDER_ENV.relayUrl}/v1/messages`, model: RELAY_COPIES[model], headers: { authorization: `Bearer ${PROVIDER_ENV.relayKey}` } }
    : null;
  if (!relay) return [core];
  return Date.now() < coreDownUntil ? [relay, core] : [core, relay];
}

/**
 * An upstream message made safe to log or show. Route wrappers ("[upstream/model] [400]:"),
 * request ids, UUIDs, URLs, host names and tokens go first, then vendor names (brandText), then
 * relay model ids; it is cut to length last, so nothing is half-removed.
 */
export function scrub(text: string) {
  const stripped = text
    .replace(/\[[\w.-]+\/[\w.:-]+\]\s*(?:\[\d{3}\]:?\s*)?/g, "")
    .replace(/\b(?:x-[\w-]*?-)?request[-_ ]?id\b["':= ]*[\w.-]*/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, "")
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|app|dev|cloud|world|tech|sh|im)\b/gi, "")
    .replace(/\b(?:Bearer|token)\s+[\w.~+/=-]{12,}/gi, "[redacted]");
  return brandText(stripped).replace(/\br\/(claude-[\w.-]+)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** The message inside an upstream error body (Anthropic, OpenAI or plain shapes). */
function upstreamMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    return typeof message === "string" ? message : "";
  } catch {
    return body.slice(0, 2000);
  }
}

export type Failure = { status: number; type: string; message: string; retryAfter?: string };

/**
 * How an upstream failure reaches the caller: a request the bridge could not accept as written
 * keeps its (scrubbed) reason; the relay's reasons never pass on; everything else is masked.
 */
function failure(route: Route, status: number, body: string, retryAfter: string | null): Failure {
  if (status === 400 || status === 413 || status === 422) {
    const reason = route.name === "core" ? scrub(upstreamMessage(body)) : "";
    return { status, type: "invalid_request_error", message: reason || "The request was not accepted. Check its parameters and try again." };
  }
  if (status === 429) return { status: 429, type: "rate_limit_error", message: "Too many requests right now. Please retry shortly.", ...(retryAfter && /^\d+$/.test(retryAfter) ? { retryAfter } : {}) };
  return { status: 503, type: "curialy_api_error", message: UNAVAILABLE };
}

export const errorBody = (failure: Pick<Failure, "status" | "type" | "message">) => ({ error: { message: failure.message, type: failure.type, code: failure.status } });

/**
 * Send a request for `model` in the bridge's `api`, always streamed (a chat stream also asks for its
 * usage). Resolves with the first successful response, or with the failure to report once every
 * route has refused (a malformed request is reported at once: no other route would accept it
 * either). Only a refusal or a connection that never got an answer moves on to the next route.
 */
export async function sendUpstream(api: UpstreamApi, model: string, body: Record<string, unknown>, opts: { version: string; beta?: string; signal: AbortSignal }): Promise<{ response: Response } | { failure: Failure }> {
  // Serialized once: each route only swaps the model id in front.
  const rest = JSON.stringify({ ...body, model: undefined, stream: true, ...(api === "chat" ? { stream_options: { include_usage: true } } : {}) });
  const payload = (id: string) => `{"model":${JSON.stringify(id)},${rest.slice(1)}`;
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(UPSTREAM_DEADLINE_MS)]);
  let last: Failure = { status: 503, type: "curialy_api_error", message: UNAVAILABLE };
  for (const route of routesFor(api, model)) {
    let response: Response;
    try {
      response = await fetch(route.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...(api === "messages" ? { "anthropic-version": opts.version, ...(opts.beta ? { "anthropic-beta": opts.beta } : {}) } : {}), ...route.headers },
        body: payload(route.model),
        signal,
      });
    } catch (error) {
      if (opts.signal.aborted) throw error;
      console.warn(`[Curialy Gateway] Upstream error: ${route.name} unreachable (${scrub(error instanceof Error ? error.message : String(error))})`);
      if (signal.aborted) break; // out of time: another route would only run it again
      continue;
    }
    if (response.ok) {
      if (route.name === "core") coreDownUntil = 0;
      return { response };
    }
    const text = await response.text().catch(() => "");
    console.warn(`[Curialy Gateway] Upstream error: ${route.name} ${response.status} ${scrub(upstreamMessage(text))}`);
    if (route.name === "core" && response.status !== 400 && response.status !== 413 && response.status !== 422) coreDownUntil = Date.now() + CORE_PAUSE_MS;
    last = failure(route, response.status, text, response.headers.get("retry-after"));
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

type Block = Record<string, unknown> & { type?: string };

/** A streamed Anthropic reply assembled into the message an unstreamed call returns. */
export function messageBuilder() {
  let message: Record<string, unknown> & { content: Block[] } = { content: [] };
  const json = new Map<number, string>();
  return {
    add(event: Record<string, any>) {
      switch (event.type) {
        case "message_start":
          message = { ...event.message, content: [] };
          break;
        case "content_block_start":
          message.content[event.index] = { ...event.content_block };
          if (event.content_block?.type === "tool_use" || event.content_block?.type === "server_tool_use") json.set(event.index, "");
          break;
        case "content_block_delta": {
          const block = message.content[event.index];
          const delta = event.delta ?? {};
          if (!block) break;
          if (delta.type === "text_delta") block.text = `${block.text ?? ""}${delta.text ?? ""}`;
          else if (delta.type === "thinking_delta") block.thinking = `${block.thinking ?? ""}${delta.thinking ?? ""}`;
          else if (delta.type === "signature_delta") block.signature = delta.signature;
          else if (delta.type === "input_json_delta") json.set(event.index, `${json.get(event.index) ?? ""}${delta.partial_json ?? ""}`);
          else if (delta.type === "citations_delta") block.citations = [...((block.citations as unknown[]) ?? []), delta.citation];
          break;
        }
        case "content_block_stop":
          if (json.has(event.index) && message.content[event.index]) {
            const raw = json.get(event.index) || "{}";
            try {
              message.content[event.index].input = JSON.parse(raw);
            } catch {
              message.content[event.index].input = {};
            }
            json.delete(event.index);
          }
          break;
        case "message_delta":
          Object.assign(message, { stop_reason: event.delta?.stop_reason ?? message.stop_reason ?? null, stop_sequence: event.delta?.stop_sequence ?? message.stop_sequence ?? null });
          message.usage = { ...((message.usage as object) ?? {}), ...(event.usage ?? {}) };
          break;
      }
    },
    message: () => ({ ...message, content: message.content.filter(Boolean) }),
  };
}

/** A chat stream chunk as callers get it: standard fields only (no fingerprints or padding), the model as they named it. */
export function cleanChunk(chunk: Record<string, any>, model: string) {
  const choices = Array.isArray(chunk.choices)
    ? chunk.choices.map((choice: Record<string, any>) => ({
        index: choice.index ?? 0,
        delta: Object.fromEntries(Object.entries(choice.delta ?? {}).filter(([key]) => ["role", "content", "reasoning_content", "tool_calls", "refusal"].includes(key))),
        finish_reason: choice.finish_reason ?? null,
        ...(choice.logprobs !== undefined ? { logprobs: choice.logprobs } : {}),
      }))
    : [];
  return { id: chunk.id, object: "chat.completion.chunk", created: chunk.created, model, choices, ...(chunk.usage ? { usage: chunk.usage } : {}) };
}

/** A chat stream assembled into the chat.completion an unstreamed call returns. */
export function chatBuilder(model: string) {
  let id = "";
  let created = Math.floor(Date.now() / 1000);
  let content = "";
  let reasoning = "";
  let refusal = "";
  let finish: string | null = null;
  let usage: unknown;
  const calls = new Map<number, { id?: string; type: string; function: { name: string; arguments: string } }>();
  return {
    add(chunk: Record<string, any>) {
      id ||= chunk.id ?? "";
      if (typeof chunk.created === "number") created = chunk.created;
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") content += delta.content;
      if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
      if (typeof delta.refusal === "string") refusal += delta.refusal;
      for (const call of delta.tool_calls ?? []) {
        const entry = calls.get(call.index ?? 0) ?? { type: "function", function: { name: "", arguments: "" } };
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.function.name += call.function.name;
        if (call.function?.arguments) entry.function.arguments += call.function.arguments;
        calls.set(call.index ?? 0, entry);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    },
    completion: () => ({
      id, object: "chat.completion", created, model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: content || (calls.size ? null : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(refusal ? { refusal } : {}),
          ...(calls.size ? { tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } : {}),
        },
        finish_reason: finish ?? "stop",
      }],
      ...(usage ? { usage } : {}),
    }),
  };
}
