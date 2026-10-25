import Anthropic from "@anthropic-ai/sdk";
import { getModel, type ModelSpec } from "@shared/agent";

// Self-healing for failures *around* a model turn (tool errors already flow back to the model as
// tool results, and failed verification has its own heal loop). Each failure is classified and
// answered with a targeted repair, then the turn is retried; nothing here bypasses a refusal.

export type FailureKind =
  | "cancelled"
  | "rate_limit"
  | "transient"
  | "context_overflow"
  | "thinking_history"
  | "tool_pairing"
  | "error_result_content"
  | "bad_image"
  | "unsupported_param"
  | "model_unavailable"
  | "auth"
  | "fatal";

export type Diagnosis = { kind: FailureKind; status?: number; detail: string; retryAfterMs?: number; param?: "eager_input_streaming" | "thinking" | "effort" };

const NETWORK = /(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|terminated|network|premature close|stream (ended|closed)|other side closed|timed? ?out)/i;

function statusOf(error: unknown): number | undefined {
  if (error instanceof Anthropic.APIError && typeof error.status === "number") return error.status;
  const match = String((error as Error)?.message ?? "").match(/\((\d{3})\)|\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function retryAfter(error: unknown) {
  const headers = (error as { headers?: Headers | Record<string, string> })?.headers;
  const raw = headers instanceof Headers ? headers.get("retry-after") : headers?.["retry-after"];
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(60_000, seconds * 1000) : undefined;
}

/** Classify a failure from any provider loop into something we know how to repair. */
export function diagnose(error: unknown, aborted: boolean): Diagnosis {
  if (aborted || error instanceof Anthropic.APIUserAbortError) return { kind: "cancelled", detail: "Cancelled" };
  const message = String((error as Error)?.message ?? error);
  const status = statusOf(error);
  const lower = message.toLowerCase();
  // Errors sent inside an SSE stream arrive with no HTTP status, only an error type.
  const anyError = error as { type?: string; error?: { type?: string; error?: { type?: string } } };
  const type = anyError?.type ?? anyError?.error?.error?.type ?? anyError?.error?.type ?? (lower.match(/"type":\s*"(\w+_error)"/)?.[1]);
  switch (type) {
    case "overloaded_error": return { kind: "transient", detail: "The engine is overloaded" };
    case "api_error":
    case "timeout_error": return { kind: "transient", detail: "The engine had a temporary error" };
    case "rate_limit_error": return { kind: "rate_limit", detail: "The engine is rate limiting requests", retryAfterMs: retryAfter(error) };
    case "request_too_large": return { kind: "context_overflow", status, detail: "The request is too large" };
    case "authentication_error":
    case "permission_error": return { kind: "auth", status, detail: "The engine rejected its credentials" };
    case "not_found_error": return { kind: "model_unavailable", status, detail: "The selected model is unavailable" };
  }
  if (error instanceof Anthropic.APIConnectionError || (!status && NETWORK.test(message))) return { kind: "transient", detail: "Connection to the engine dropped" };
  if (status === 401 || status === 403) return { kind: "auth", status, detail: "The engine rejected its credentials" };
  if (status === 429) return { kind: "rate_limit", status, detail: "The engine is rate limiting requests", retryAfterMs: retryAfter(error) };
  if (status === 413 || /prompt is too long|context (limit|window|length)|too many (input )?tokens|maximum context|exceeds? .*context|input length/.test(lower)) return { kind: "context_overflow", status, detail: "The conversation no longer fits in the context window" };
  if (/all content must be type .?text.? if .?is_error/.test(lower)) return { kind: "error_result_content", status, detail: "A failed tool result contained non-text content" };
  if (/tool_use.*tool_result|tool_result.*tool_use|tool_use_id|unexpected .?tool/.test(lower)) return { kind: "tool_pairing", status, detail: "Tool calls and results in the history are out of step" };
  if (/thinking|signature|redacted_thinking/.test(lower) && /block|signature|modif|invalid|expected|must/.test(lower)) return { kind: "thinking_history", status, detail: "Earlier reasoning blocks in the history were rejected" };
  if (/image/.test(lower) && /(exceed|invalid|could not|unsupported|not support|media.?type|too large|dimension|process)/.test(lower)) return { kind: "bad_image", status, detail: "An attached image was rejected" };
  if (/eager_input_streaming/.test(lower)) return { kind: "unsupported_param", status, param: "eager_input_streaming", detail: "Streaming tool input is not supported by this model" };
  if (/(output_config|effort)/.test(lower) && /(extra|not (permitted|supported|allowed)|unrecognized|unknown|invalid)/.test(lower)) return { kind: "unsupported_param", status, param: "effort", detail: "This model does not accept an effort level" };
  if (/thinking/.test(lower) && /(extra|not (permitted|supported|allowed)|unrecognized|unknown|invalid)/.test(lower)) return { kind: "unsupported_param", status, param: "thinking", detail: "This model does not accept the thinking setting" };
  if (status === 404 || (/model/.test(lower) && /(not found|does not exist|not available|unavailable|unknown model|invalid model)/.test(lower))) return { kind: "model_unavailable", status, detail: "The selected model is unavailable" };
  if (status && (status >= 500 || status === 408 || status === 409)) return { kind: "transient", status, detail: status === 529 ? "The engine is overloaded" : "The engine had a temporary error" };
  if (!status && /overloaded|internal server error|service unavailable|bad gateway|server error/.test(lower)) return { kind: "transient", detail: "The engine had a temporary error" };
  if (!status && /rate.?limit|too many requests|quota/.test(lower)) return { kind: "rate_limit", detail: "The engine is rate limiting requests" };
  return { kind: "fatal", status, detail: message.slice(0, 300) };
}

/** Exponential backoff with jitter, honouring retry-after; abortable. */
export function backoffMs(attempt: number, retryAfterMs?: number) {
  if (retryAfterMs !== undefined) return Math.max(1000, retryAfterMs);
  const base = Math.min(30_000, 1500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Cancelled"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled")); }, { once: true });
  });
}

// ---- History repairs (Anthropic-format conversations; mutate in place, return what changed) ----

type Message = Anthropic.MessageParam;
type Block = Record<string, any>;

const blocks = (message: Message): Block[] | null => (Array.isArray(message.content) ? (message.content as Block[]) : null);

/** Remove reasoning blocks. Required after any history edit, since edited turns invalidate them. */
export function stripThinking(conversation: Message[]) {
  let removed = 0;
  for (const message of conversation) {
    const content = blocks(message);
    if (message.role !== "assistant" || !content) continue;
    const kept = content.filter(block => block.type !== "thinking" && block.type !== "redacted_thinking");
    removed += content.length - kept.length;
    if (kept.length !== content.length) message.content = (kept.length ? kept : [{ type: "text", text: "(continuing)" }]) as Message["content"];
  }
  return removed;
}

/** Every tool_use must be answered by a tool_result in the next user turn; orphans are removed. */
export function repairToolPairing(conversation: Message[]) {
  let fixes = 0;
  for (let index = 0; index < conversation.length; index++) {
    const message = conversation[index];
    const content = blocks(message);
    if (message.role === "assistant" && content) {
      const uses = content.filter(block => block.type === "tool_use").map(block => block.id as string);
      if (!uses.length) continue;
      let next = conversation[index + 1];
      if (!next || next.role !== "user") {
        next = { role: "user", content: [] };
        conversation.splice(index + 1, 0, next);
        fixes++;
      }
      if (!Array.isArray(next.content)) next.content = [{ type: "text", text: next.content as string }] as Message["content"];
      const nextBlocks = next.content as Block[];
      const answered = new Set(nextBlocks.filter(block => block.type === "tool_result").map(block => block.tool_use_id));
      const missing = uses.filter(id => !answered.has(id));
      if (missing.length) {
        nextBlocks.unshift(...missing.map(id => ({ type: "tool_result", tool_use_id: id, is_error: true, content: "This tool call was interrupted before it returned a result." })));
        fixes += missing.length;
      }
      // tool_result blocks must come before any text in that user turn.
      const ordered = [...nextBlocks.filter(block => block.type === "tool_result"), ...nextBlocks.filter(block => block.type !== "tool_result")];
      if (ordered.some((block, i) => block !== nextBlocks[i])) { next.content = ordered as Message["content"]; fixes++; }
    } else if (message.role === "user" && content) {
      const previous = conversation[index - 1];
      const known = new Set(previous?.role === "assistant" ? (blocks(previous) ?? []).filter(block => block.type === "tool_use").map(block => block.id) : []);
      const kept = content.filter(block => block.type !== "tool_result" || known.has(block.tool_use_id));
      if (kept.length !== content.length) {
        fixes += content.length - kept.length;
        message.content = (kept.length ? kept : [{ type: "text", text: "(continue)" }]) as Message["content"];
      }
    }
  }
  return fixes;
}

/** Replace image blocks with a short note (keeps the turn valid). */
export function stripImages(conversation: Message[], keepLast = 0) {
  let removed = 0;
  conversation.forEach((message, index) => {
    if (index >= conversation.length - keepLast) return;
    const content = blocks(message);
    if (!content) return;
    const mapped = content.map(block => {
      if (block.type === "image" || block.type === "image_url") { removed++; return { type: "text", text: "[image removed to recover from an error]" }; }
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        const inner = block.content.filter((part: Block) => part.type !== "image");
        if (inner.length !== block.content.length) { removed += block.content.length - inner.length; return { ...block, content: inner.length ? inner : "[screenshot removed]" }; }
      }
      return block;
    });
    if (removed) message.content = mapped as Message["content"];
  });
  return removed;
}

const trimText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n… [trimmed ${text.length - max} characters to fit the context window]` : text);

/**
 * Shrink the history to fit the context window, in escalating levels:
 *  1. trim old tool outputs and drop old screenshots;
 *  2. trim harder and also shorten old assistant text;
 *  3. drop the oldest middle turns entirely (keeping the original request and the recent tail).
 * The most recent `keep` messages are never touched. Pairing is repaired and reasoning stripped.
 */
/** Prefix of the user turn that carries tool screenshots in the OpenAI format (tool messages are text-only). */
export const TOOL_SCREENSHOTS = "[Tool screenshots]";

/** Harness-injected user turns (continue prompts, verification feedback, tool screenshots) are not user requests. */
const INJECTED = /^(Your previous reply (was cut off|ran out of output)|Automated verification failed|\[Tool screenshots\])/;

/** Index of the most recent message the user actually wrote (not tool results or harness text). */
export function latestRequestIndex(conversation: { role: string; content: unknown }[]) {
  for (let index = conversation.length - 1; index >= 0; index--) {
    const message = conversation[index];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") { if (!INJECTED.test(message.content)) return index; continue; }
    if (Array.isArray(message.content)) {
      const parts = message.content as Block[];
      const text = parts.filter(part => part.type === "text").map(part => part.text).join(" ");
      if (parts.some(part => part.type !== "tool_result") && !INJECTED.test(text)) return index;
    }
  }
  return 0;
}

export function compactHistory(conversation: Message[], level: 1 | 2 | 3) {
  const keep = level === 1 ? 6 : 4;
  const limit = level === 1 ? 2000 : 400;
  const cutoff = Math.max(1, conversation.length - keep);
  const request = latestRequestIndex(conversation);
  let changed = 0;
  for (let index = 1; index < conversation.length; index++) {
    const inTail = index >= cutoff;
    const message = conversation[index];
    // The recent tail is trimmed too from level 2 (an overflow is usually the newest tool output),
    // but more gently, and the user's own requests (with their images) are never rewritten.
    if (inTail && level === 1) continue;
    const tailLimit = level === 2 ? 4000 : 400;
    if (typeof message.content === "string") {
      if (index !== request && message.role === "assistant" && message.content.length > 1200) { message.content = trimText(message.content, 1200); changed++; }
      continue;
    }
    const content = blocks(message);
    if (!content) continue;
    if (inTail) {
      conversation[index].content = content.map(block => {
        if (block.type !== "tool_result") return block;
        const text = typeof block.content === "string" ? block.content : (block.content ?? []).filter((part: Block) => part.type === "text").map((part: Block) => part.text).join("\n");
        const next = trimText(text, tailLimit);
        if (next === text && !Array.isArray(block.content)) return block;
        changed++;
        return { ...block, content: next };
      }) as Message["content"];
      continue;
    }
    if (index === request) continue;
    conversation[index].content = content.map(block => {
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : (block.content ?? []).filter((part: Block) => part.type === "text").map((part: Block) => part.text).join("\n");
        const next = trimText(text, limit);
        if (next !== text || Array.isArray(block.content)) changed++;
        return { ...block, content: next };
      }
      if (block.type === "image" && conversation[index].role === "assistant") { changed++; return { type: "text", text: "[earlier image removed to fit the context window]" }; }
      if (level >= 2 && block.type === "text" && conversation[index].role === "assistant" && block.text.length > 1200) { changed++; return { ...block, text: trimText(block.text, 1200) }; }
      if (level >= 2 && block.type === "tool_use") {
        const input = JSON.stringify(block.input ?? {});
        if (input.length > 1500) { changed++; return { ...block, input: { note: "input trimmed to fit the context window" } }; }
      }
      return block;
    }) as Message["content"];
  }
  if (level === 3 && conversation.length > keep + 2) {
    // Drop the oldest middle turns, but never the first message or the latest real request.
    const tailStart = conversation.length - keep;
    let dropped: Message[];
    if (request > 0 && request < tailStart) {
      dropped = [...conversation.splice(request + 1, tailStart - request - 1), ...conversation.splice(1, request - 1)];
    } else {
      dropped = conversation.splice(1, tailStart - 1);
    }
    changed += dropped.length;
    const first = conversation[0];
    const note = `\n\n[${dropped.length} earlier messages were removed to fit the context window; the workspace still contains all files produced so far.]`;
    if (typeof first.content === "string") first.content += note;
    else (first.content as Block[]).push({ type: "text", text: note.trim() });
    // The kept tail must start with an assistant turn after the first user message.
    if (conversation[1]?.role === "user") conversation.splice(1, 0, { role: "assistant", content: [{ type: "text", text: "(earlier work omitted)" }] });
  }
  changed += repairToolPairing(conversation);
  stripThinking(conversation);
  return changed;
}

// Failover tiers per conversation format, closest equivalents first. A history can only move to a
// model that speaks the same format; within it, the current tier is tried before the next one.
// The relay Claude routes are the second path to Claude when the primary route is down.
const FAILOVER_TIERS: Record<"anthropic" | "openai", string[][]> = {
  anthropic: [
    ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "r/claude-opus-4-6-thinking", "claude-opus-4-5"],
    ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "r/claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-5-5"],
    ["r/gemini-3.8-flash", "r/gemini-2.5-flash"],
  ],
  openai: [
    ["openai-gpt-5.5", "openai-gpt-5.4", "openai-gpt-5.2"],
    ["grok-4.7", "grok-4.6"],
    ["kimi-k3", "glm-5.3", "ultramarine-1-flash"],
  ],
};

/** Same-format models to fail over to: the current tier first, then the others in order. */
export function failoverModels(current: ModelSpec): ModelSpec[] {
  if (current.provider === "research" || current.provider === "core-inference") return [];
  const tiers = FAILOVER_TIERS[current.provider === "fast" || current.provider === "core-chat" ? "openai" : "anthropic"];
  const own = tiers.findIndex(tier => tier.includes(current.id));
  const ordered = own < 0 ? tiers.flat() : [...tiers[own], ...tiers.filter((_, index) => index !== own).flat()];
  return ordered.filter(id => id !== current.id).map(id => getModel(id)).filter((spec): spec is ModelSpec => Boolean(spec?.tools));
}

/** Tool-failure watchdog: the same tool failing the same way repeatedly gets a nudge to change course. */
export class ToolFailureWatch {
  private last: { key: string; count: number } | null = null;
  note(name: string, ok: boolean, summary: string) {
    if (ok) { this.last = null; return null; }
    const key = `${name}:${summary.replace(/\d+/g, "#").slice(0, 120)}`;
    this.last = this.last?.key === key ? { key, count: this.last.count + 1 } : { key, count: 1 };
    if (this.last.count >= 3) return `\n\n[Curialy: this is the ${this.last.count}th consecutive identical failure of ${name}. Stop repeating it: re-read the error, inspect the relevant files or state, and try a different approach.]`;
    return null;
  }
}

// ---- OpenAI-format history repairs (Fast Reasoning engine) ----

type OpenAIMessage = Record<string, any>;

/** Every assistant tool_calls entry needs a following role:"tool" reply; stray replies are dropped. */
export function repairOpenAIToolPairing(conversation: OpenAIMessage[]) {
  let fixes = 0;
  for (let index = 0; index < conversation.length; index++) {
    const message = conversation[index];
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls) || !message.tool_calls.length) continue;
    const ids: string[] = message.tool_calls.map((call: any) => call.id);
    let cursor = index + 1;
    const answered = new Set<string>();
    while (cursor < conversation.length && conversation[cursor].role === "tool") answered.add(conversation[cursor++].tool_call_id);
    const missing = ids.filter(id => !answered.has(id));
    if (missing.length) {
      conversation.splice(cursor, 0, ...missing.map(id => ({ role: "tool", tool_call_id: id, content: "This tool call was interrupted before it returned a result." })));
      fixes += missing.length;
    }
  }
  for (let index = conversation.length - 1; index >= 0; index--) {
    const message = conversation[index];
    if (message.role !== "tool") continue;
    let owner = index - 1;
    while (owner >= 0 && conversation[owner].role === "tool") owner--;
    const ids = owner >= 0 && Array.isArray(conversation[owner].tool_calls) ? conversation[owner].tool_calls.map((call: any) => call.id) : [];
    if (!ids.includes(message.tool_call_id)) { conversation.splice(index, 1); fixes++; }
  }
  return fixes;
}

/** Assistant turns need content unless they carry tool_calls (the chat-completions route rejects null). */
export function repairOpenAIContent(conversation: OpenAIMessage[]) {
  let fixes = 0;
  for (const message of conversation) {
    if (message.role !== "assistant") continue;
    const hasCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (message.content == null) { message.content = hasCalls ? "" : "(no reply)"; fixes++; }
    else if (!hasCalls && message.content === "") { message.content = "(no reply)"; fixes++; }
  }
  return fixes;
}

export function compactOpenAIHistory(conversation: OpenAIMessage[], level: 1 | 2 | 3) {
  const keep = level === 1 ? 6 : 4;
  const limit = level === 1 ? 2000 : 400;
  const cutoff = Math.max(1, conversation.length - keep);
  const request = latestRequestIndex(conversation as { role: string; content: unknown }[]);
  let changed = 0;
  for (let index = 1; index < conversation.length; index++) {
    const message = conversation[index];
    if (index === request) continue;
    if (index >= cutoff) {
      if (level >= 2 && message.role === "tool" && typeof message.content === "string") {
        const next = trimText(message.content, level === 2 ? 4000 : 400);
        if (next !== message.content) { message.content = next; changed++; }
      }
      continue;
    }
    if ((message.role === "tool" || (level >= 2 && message.role === "assistant")) && typeof message.content === "string") {
      const next = trimText(message.content, message.role === "tool" ? limit : 1200);
      if (next !== message.content) { message.content = next; changed++; }
    }
    if (level >= 2 && message.reasoning_content) { delete message.reasoning_content; changed++; }
    // Old screenshots and attachments outside the tail are the heaviest parts of the request.
    if (Array.isArray(message.content) && message.content.some((part: Block) => part.type === "image_url")) {
      message.content = message.content.map((part: Block) => (part.type === "image_url" ? { type: "text", text: "[earlier image removed to fit the context window]" } : part));
      changed++;
    }
  }
  if (level === 3 && conversation.length > keep + 2) {
    const tailStart = conversation.length - keep;
    const dropped = request > 0 && request < tailStart
      ? [...conversation.splice(request + 1, tailStart - request - 1), ...conversation.splice(1, request - 1)]
      : conversation.splice(1, tailStart - 1);
    changed += dropped.length;
    const note = `\n\n[${dropped.length} earlier messages were removed to fit the context window; the workspace still contains all files produced so far.]`;
    const first = conversation[0];
    if (Array.isArray(first.content)) first.content.push({ type: "text", text: note.trim() });
    else first.content = `${first.content ?? ""}${note}`;
  }
  return changed + repairOpenAIToolPairing(conversation) + repairOpenAIContent(conversation);
}

// ---- The engine: one instance per run ----

export type RecoveryFlags = { noEager: boolean; noThinking: boolean; noEffort: boolean };

export type RecoveryHost = {
  signal: AbortSignal;
  format: "anthropic" | "openai";
  conversation: Message[] | OpenAIMessage[];
  spec: ModelSpec;
  flags: RecoveryFlags;
  /** Switch the run to another model (same conversation format). */
  switchModel: (spec: ModelSpec, reason: string) => void;
  /** Persist the conversation after a repair. */
  persist: () => void;
  /** Clear cached image bytes after images were stripped. */
  dropImageCache?: () => void;
  emit: (event: { kind: FailureKind; action: string; detail: string; attempt: number; delayMs?: number; model?: string }) => void;
  /** Whether a model's route is configured at all (failover candidates). */
  available?: (spec: ModelSpec) => boolean;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const MAX_RUN_RECOVERIES = 12;
const MAX_TURN_ATTEMPTS = 6;
const MAX_TRANSIENT_RETRIES = 4;

export class RecoveryEngine {
  private total = 0;
  private turnAttempts = 0;
  private transientStreak = 0;
  private compactLevel = 0;
  private genericRepairTried = false;
  private readonly failedModels = new Set<string>(); // unavailable: never retried this run
  private readonly flakyModels = new Set<string>(); // transient failures: skipped for this turn only
  private readonly troubled = new Set<string>(); // any route failure this run (escalation avoids them)
  private failedOver = false;
  readonly log: { kind: FailureKind; action: string }[] = [];

  constructor(private host: RecoveryHost) {}

  get count() { return this.total; }

  /** Call when a turn succeeded: per-turn counters reset, the run budget does not. */
  succeeded() {
    this.turnAttempts = 0;
    this.transientStreak = 0;
    this.compactLevel = 0; // a later overflow (the history keeps growing) may need compacting again
    this.flakyModels.clear();
  }

  /**
   * Try to recover from a failed turn. Returns true when the caller should retry the turn,
   * false when the failure is not recoverable (the caller then fails the run as before).
   */
  async handle(error: unknown): Promise<boolean> {
    const host = this.host;
    const diagnosis = diagnose(error, host.signal.aborted);
    if (diagnosis.kind === "cancelled" || diagnosis.kind === "auth") return false;
    if (diagnosis.kind === "transient" || diagnosis.kind === "rate_limit" || diagnosis.kind === "model_unavailable") this.troubled.add(host.spec.id);
    if (this.total >= MAX_RUN_RECOVERIES || this.turnAttempts >= MAX_TURN_ATTEMPTS) return false;
    this.turnAttempts++;
    const attempt = this.turnAttempts;
    const done = (action: string, extra: { delayMs?: number; model?: string } = {}) => {
      this.total++;
      this.log.push({ kind: diagnosis.kind, action });
      host.emit({ kind: diagnosis.kind, action, detail: diagnosis.detail, attempt, ...extra });
      return true;
    };
    const anthropic = host.format === "anthropic";
    const conversation = host.conversation as any[];

    switch (diagnosis.kind) {
      case "rate_limit":
      case "transient": {
        this.transientStreak++;
        if (this.transientStreak > MAX_TRANSIENT_RETRIES) {
          return this.failover(diagnosis, done) ?? false;
        }
        const delayMs = backoffMs(this.transientStreak, diagnosis.retryAfterMs);
        await (host.sleep ?? sleep)(delayMs, host.signal);
        return done(`Retrying in ${Math.round(delayMs / 1000)}s (attempt ${this.transientStreak}/${MAX_TRANSIENT_RETRIES})`, { delayMs });
      }
      case "context_overflow": {
        if (this.compactLevel >= 3) return false;
        this.compactLevel++;
        const level = this.compactLevel as 1 | 2 | 3;
        const changed = anthropic ? compactHistory(conversation, level) : compactOpenAIHistory(conversation, level);
        if (!changed && level < 3) return this.handle(error); // nothing to trim at this level: escalate
        if (!changed) return false;
        host.dropImageCache?.();
        host.persist();
        return done(`Compacted the conversation (level ${level}, ${changed} change${changed === 1 ? "" : "s"}) and retried`);
      }
      case "thinking_history": {
        if (!anthropic) return false;
        const removed = stripThinking(conversation);
        if (!removed && host.flags.noThinking) return false;
        if (!removed) host.flags.noThinking = true;
        host.persist();
        return done(removed ? `Removed ${removed} rejected reasoning block(s) from the history and retried` : "Disabled extended thinking for this run and retried");
      }
      case "tool_pairing": {
        const fixes = anthropic ? repairToolPairing(conversation) : repairOpenAIToolPairing(conversation);
        if (!fixes) return false;
        if (anthropic) stripThinking(conversation);
        host.persist();
        return done(`Repaired ${fixes} tool call/result mismatch(es) in the history and retried`);
      }
      case "error_result_content": {
        let fixed = 0;
        for (const message of conversation) {
          if (message.role !== "user" || !Array.isArray(message.content)) continue;
          for (const block of message.content) {
            if (block.type === "tool_result" && block.is_error && Array.isArray(block.content) && block.content.some((part: Block) => part.type !== "text")) {
              block.content = block.content.filter((part: Block) => part.type === "text").map((part: Block) => part.text).join("\n") || "Tool failed.";
              fixed++;
            }
          }
        }
        if (!fixed) return false;
        stripThinking(conversation);
        host.persist();
        return done(`Converted ${fixed} failed tool result(s) to text and retried`);
      }
      case "bad_image": {
        const removed = stripImages(conversation);
        if (!removed) return false;
        if (anthropic) stripThinking(conversation);
        host.dropImageCache?.();
        host.persist();
        return done(`Removed ${removed} rejected image(s) from the conversation and retried`);
      }
      case "unsupported_param": {
        const flag = diagnosis.param === "eager_input_streaming" ? "noEager" : diagnosis.param === "thinking" ? "noThinking" : "noEffort";
        if (host.flags[flag]) return false;
        host.flags[flag] = true;
        return done(`Turned off ${diagnosis.param === "eager_input_streaming" ? "streamed tool input" : diagnosis.param === "thinking" ? "extended thinking" : "the effort setting"} for this model and retried`);
      }
      case "model_unavailable":
        return this.failover(diagnosis, done) ?? false;
      case "fatal": {
        // Unknown rejection: one generic history clean-up, which covers most malformed-history 400s.
        if (this.genericRepairTried || diagnosis.status === undefined || diagnosis.status >= 500) return false;
        this.genericRepairTried = true;
        const fixes = anthropic ? repairToolPairing(conversation) + stripThinking(conversation) : repairOpenAIToolPairing(conversation) + repairOpenAIContent(conversation);
        if (!fixes) return false;
        host.persist();
        return done(`Cleaned up the conversation history (${fixes} fix${fixes === 1 ? "" : "es"}) and retried`);
      }
      default:
        return false;
    }
  }

  /** Whether escalating to a model is safe: never back onto a route that failed, nor undoing a failover. */
  canEscalateTo(spec: ModelSpec) {
    return !this.failedOver && !this.failedModels.has(spec.id) && !this.troubled.has(spec.id);
  }

  /**
   * Move the run to another same-format model (failover, escalation). Reasoning blocks are signed
   * per model, so they are dropped; parameters disabled for the old model are re-enabled.
   */
  switchTo(spec: ModelSpec, reason: string) {
    const host = this.host;
    host.switchModel(spec, reason);
    host.flags.noEager = false;
    host.flags.noThinking = false;
    host.flags.noEffort = false;
    if (host.format === "anthropic") stripThinking(host.conversation as Message[]);
    host.persist();
  }

  private failover(diagnosis: Diagnosis, done: (action: string, extra?: { model?: string }) => boolean): boolean | null {
    const host = this.host;
    const transient = diagnosis.kind === "transient" || diagnosis.kind === "rate_limit";
    (transient ? this.flakyModels : this.failedModels).add(host.spec.id);
    let candidates = failoverModels(host.spec).filter(spec => !this.failedModels.has(spec.id) && !this.flakyModels.has(spec.id) && (host.available?.(spec) ?? true));
    // For outages, prefer a model reached through a different route first, as long as the switch
    // keeps what the run relies on (images); otherwise stay in tier order.
    if (transient) {
      const comparable = (spec: ModelSpec) => spec.provider !== host.spec.provider && (spec.vision || !host.spec.vision);
      candidates = [...candidates.filter(comparable), ...candidates.filter(spec => !comparable(spec))];
    }
    const next = candidates[0];
    if (!next) return null;
    const from = host.spec.label;
    this.switchTo(next, `Self-healing: ${from} ${diagnosis.kind === "model_unavailable" ? "is unavailable" : "kept failing"} → ${next.label}`);
    this.failedOver = true;
    this.transientStreak = 0;
    this.turnAttempts = 0; // the new model gets its own attempts for this turn
    return done(`Switched from ${from} to ${next.label} and retried`, { model: next.id });
  }
}
