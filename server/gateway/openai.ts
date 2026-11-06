import type { Usage } from "./upstream";

// OpenAI Chat Completions on the Anthropic Messages backend: requests are translated in, and
// responses, whole or streamed, are translated back. Thinking blocks have no Chat Completions
// equivalent and are left out.

export class TranslationError extends Error {}

type Part = { type?: string; text?: unknown; image_url?: unknown };
type ToolCall = { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
type ChatMessage = { role?: unknown; content?: unknown; tool_calls?: ToolCall[]; tool_call_id?: unknown };
type Block = Record<string, unknown>;

const DEFAULT_MAX_TOKENS = 4096;

function image(url: unknown): Block {
  const value = typeof url === "string" ? url : typeof url === "object" && url ? (url as { url?: unknown }).url : undefined;
  if (typeof value !== "string") throw new TranslationError("image_url needs a url.");
  const inline = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (inline) return { type: "image", source: { type: "base64", media_type: inline[1], data: inline[2] } };
  if (/^https?:\/\//i.test(value)) return { type: "image", source: { type: "url", url: value } };
  throw new TranslationError("image_url must be an http(s) URL or a base64 data URL.");
}

function blocks(content: unknown): Block[] {
  if (content === null || content === undefined) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) throw new TranslationError("Message content must be a string or an array of parts.");
  return (content as Part[]).flatMap((part): Block[] => {
    if (part?.type === "text" && typeof part.text === "string") return part.text ? [{ type: "text", text: part.text }] : [];
    if (part?.type === "image_url") return [image(part.image_url)];
    throw new TranslationError(`Unsupported content part: ${String(part?.type ?? "unknown")}.`);
  });
}

const plainText = (content: unknown) => blocks(content).map(block => (block.type === "text" ? block.text : "")).join("\n");

function toolInput(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") throw new TranslationError("Tool call arguments must be a JSON string.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TranslationError("Tool call arguments must be valid JSON.");
  }
}

/** A Chat Completions request as an Anthropic Messages request (model and stream included). */
export function toAnthropic(body: Record<string, unknown>) {
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) throw new TranslationError("messages must be a non-empty array.");
  if (typeof body.n === "number" && body.n > 1) throw new TranslationError("n greater than 1 is not supported.");
  const system: string[] = [];
  const turns: { role: "user" | "assistant"; content: Block[] }[] = [];
  // Consecutive messages of one side become one turn (tool results join the user turn after them).
  const add = (role: "user" | "assistant", content: Block[]) => {
    if (!content.length) return;
    const last = turns.at(-1);
    if (last?.role === role) last.content.push(...content);
    else turns.push({ role, content });
  };
  for (const message of messages as ChatMessage[]) {
    switch (message?.role) {
      case "system":
      case "developer":
        system.push(plainText(message.content));
        break;
      case "user":
        add("user", blocks(message.content));
        break;
      case "assistant": {
        const content = blocks(message.content);
        for (const call of message.tool_calls ?? []) {
          if (typeof call?.id !== "string" || typeof call.function?.name !== "string") throw new TranslationError("Each tool call needs an id and a function name.");
          content.push({ type: "tool_use", id: call.id, name: call.function.name, input: toolInput(call.function.arguments) });
        }
        add("assistant", content);
        break;
      }
      case "tool":
        if (typeof message.tool_call_id !== "string") throw new TranslationError("A tool message needs tool_call_id.");
        add("user", [{ type: "tool_result", tool_use_id: message.tool_call_id, content: typeof message.content === "string" ? message.content : blocks(message.content) }]);
        break;
      default:
        throw new TranslationError(`Unsupported message role: ${String(message?.role)}.`);
    }
  }
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const request: Record<string, unknown> = {
    model: body.model,
    messages: turns,
    max_tokens: number(body.max_completion_tokens) ?? number(body.max_tokens) ?? DEFAULT_MAX_TOKENS,
  };
  const instructions = system.filter(Boolean).join("\n\n");
  if (instructions) request.system = instructions;
  // Chat Completions temperatures run to 2; Messages temperatures to 1.
  if (number(body.temperature) !== undefined) request.temperature = Math.min(1, Math.max(0, number(body.temperature)!));
  if (number(body.top_p) !== undefined) request.top_p = number(body.top_p);
  const stop = typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? body.stop.filter((item): item is string => typeof item === "string") : [];
  if (stop.length) request.stop_sequences = stop;
  if (Array.isArray(body.tools) && body.tools.length) {
    request.tools = body.tools.map((tool: { type?: unknown; function?: { name?: unknown; description?: unknown; parameters?: unknown } }) => {
      if (tool?.type !== "function" || typeof tool.function?.name !== "string") throw new TranslationError("Only function tools are supported.");
      return { name: tool.function.name, ...(typeof tool.function.description === "string" ? { description: tool.function.description } : {}), input_schema: tool.function.parameters ?? { type: "object", properties: {} } };
    });
  }
  const choice = body.tool_choice as unknown;
  if (choice === "auto") request.tool_choice = { type: "auto" };
  else if (choice === "required") request.tool_choice = { type: "any" };
  else if (choice === "none") request.tool_choice = { type: "none" };
  else if (typeof choice === "object" && choice && typeof (choice as { function?: { name?: unknown } }).function?.name === "string") request.tool_choice = { type: "tool", name: (choice as { function: { name: string } }).function.name };
  if (body.stream === true) request.stream = true;
  return fitModel(request);
}

/**
 * What each model accepts, for settings OpenAI clients send by habit. Claude Opus 5.5 always thinks:
 * it takes no sampling settings and no forced tool choice (the requirement becomes an instruction).
 * Claude Sonnet 4.5 takes temperature or top_p, not both.
 */
function fitModel(request: Record<string, unknown>) {
  if (request.model === "claude-opus-5-5") {
    delete request.temperature;
    delete request.top_p;
    const choice = request.tool_choice as { type?: string; name?: string } | undefined;
    if (choice?.type === "any" || choice?.type === "tool") {
      const rule = choice.type === "tool" ? `Use the ${choice.name} tool in your reply.` : "Use one of the provided tools in your reply.";
      request.system = request.system ? `${request.system}\n\n${rule}` : rule;
      request.tool_choice = { type: "auto" };
    }
  } else if (request.temperature !== undefined && request.top_p !== undefined) {
    delete request.top_p;
  }
  return request;
}

const FINISH: Record<string, string> = { end_turn: "stop", stop_sequence: "stop", pause_turn: "stop", max_tokens: "length", tool_use: "tool_calls", refusal: "content_filter" };
const finishReason = (stop: unknown) => FINISH[String(stop)] ?? "stop";

export const chatUsage = (usage: Usage) => {
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return { prompt_tokens: prompt, completion_tokens: usage.outputTokens, total_tokens: prompt + usage.outputTokens };
};

/** A whole Anthropic message as a chat.completion. */
export function toChatCompletion(message: { id?: unknown; content?: Block[]; stop_reason?: unknown }, model: string, usage: Usage) {
  const content = Array.isArray(message.content) ? message.content : [];
  const text = content.filter(block => block.type === "text").map(block => String(block.text ?? "")).join("");
  const calls = content.filter(block => block.type === "tool_use").map(block => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));
  return {
    id: `chatcmpl-${String(message.id ?? "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: finishReason(message.stop_reason) }],
    usage: chatUsage(usage),
  };
}

/** Streamed Anthropic events as chat.completion.chunk objects. */
export function chatChunks(model: string) {
  let id = "chatcmpl-";
  const created = Math.floor(Date.now() / 1000);
  const toolOf = new Map<number, number>();
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] });
  return {
    translate(event: Record<string, any>): object[] {
      switch (event.type) {
        case "message_start":
          id = `chatcmpl-${String(event.message?.id ?? "")}`;
          return [chunk({ role: "assistant", content: "" })];
        case "content_block_start":
          if (event.content_block?.type !== "tool_use") return [];
          toolOf.set(event.index, toolOf.size);
          return [chunk({ tool_calls: [{ index: toolOf.get(event.index), id: event.content_block.id, type: "function", function: { name: event.content_block.name, arguments: "" } }] })];
        case "content_block_delta":
          if (event.delta?.type === "text_delta") return [chunk({ content: event.delta.text })];
          if (event.delta?.type === "input_json_delta" && toolOf.has(event.index)) return [chunk({ tool_calls: [{ index: toolOf.get(event.index), function: { arguments: event.delta.partial_json } }] })];
          return [];
        case "message_delta":
          return event.delta?.stop_reason ? [chunk({}, finishReason(event.delta.stop_reason))] : [];
        default:
          return [];
      }
    },
    usage: (usage: Usage) => ({ id, object: "chat.completion.chunk", created, model, choices: [], usage: chatUsage(usage) }),
  };
}
