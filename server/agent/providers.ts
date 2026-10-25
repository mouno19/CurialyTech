import { brandText } from "@shared/brand";
import Anthropic from "@anthropic-ai/sdk";
import { aiComplete } from "../media/snowflake";
import type { ModelSpec, ProviderId, ThinkingLevel } from "@shared/agent";

// Secrets come only from the service environment (/etc/curialyai.env); nothing here reaches the browser.
export const PROVIDER_ENV = {
  get cortexBridgeUrl() { return (process.env.CORTEX_BRIDGE_URL || "http://127.0.0.1:8082").replace(/\/+$/, ""); },
  get relayUrl() { return (process.env.RELAY_API_URL || "https://relaystation.world").replace(/\/+$/, "").replace(/\/v1$/, ""); },
  get relayKey() { return process.env.RELAY_API_KEY || ""; },
  get manusUrl() { return (process.env.MANUS_AGENT_API_URL || "https://api.manus.ai").replace(/\/+$/, ""); },
  get manusKey() { return process.env.MANUS_AGENT_API_KEY || ""; },
  get manusProfile() { return process.env.MANUS_AGENT_PROFILE || "lite"; },
  get paperUrl() { return (process.env.PAPER_API_URL || "https://api.paperinstruments.com/v1").replace(/\/+$/, ""); },
  get paperKey() { return process.env.PAPER_API_KEY || ""; },
  get browserbaseKey() { return process.env.BROWSERBASE_API_KEY || ""; },
  get browserbaseProject() { return process.env.BROWSERBASE_PROJECT_ID || ""; },
  get renderKey() { return process.env.RENDER_API_KEY || ""; },
  get renderOwner() { return process.env.RENDER_OWNER_ID || ""; },
  get githubToken() { return process.env.GITHUB_TOKEN || ""; },
};

let cortexClient: Anthropic | null = null;
let relayClient: Anthropic | null = null;

/** Anthropic-compatible client for a provider. The Cortex bridge injects the Snowflake PAT itself. */
export function anthropicClient(provider: ProviderId) {
  if (provider === "core") {
    cortexClient ??= new Anthropic({ baseURL: PROVIDER_ENV.cortexBridgeUrl, apiKey: "cortex-bridge", maxRetries: 2, timeout: 15 * 60_000 });
    return cortexClient;
  }
  if (provider === "relay") {
    if (!PROVIDER_ENV.relayKey) throw new Error("RELAY_API_KEY is not configured.");
    relayClient ??= new Anthropic({ baseURL: PROVIDER_ENV.relayUrl, apiKey: PROVIDER_ENV.relayKey, maxRetries: 2, timeout: 15 * 60_000 });
    return relayClient;
  }
  throw new Error(`${provider} is not an Anthropic-compatible provider.`);
}

/** Thinking budgets for models without adaptive thinking (kept well under MAX_TOKENS). */
const THINKING_BUDGET: Record<ThinkingLevel, number> = { low: 2048, medium: 6144, high: 12_288 };

/** Thinking/effort parameters a given model accepts. */
export function reasoningParams(model: ModelSpec, level: ThinkingLevel): Pick<Anthropic.MessageCreateParams, "thinking" | "output_config"> {
  const params: Pick<Anthropic.MessageCreateParams, "thinking" | "output_config"> = {};
  if (model.thinking === "adaptive-summarized") params.thinking = { type: "adaptive", display: "summarized" };
  else if (model.thinking === "adaptive") params.thinking = { type: "adaptive" };
  else if (model.thinking === "budget") params.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET[level] };
  if (model.effort) params.output_config = { effort: level };
  return params;
}

/** Snowflake Cortex inference:complete (Llama / Mistral), streamed through the bridge. */
export async function* streamCortexInference(opts: { model: string; system: string; messages: { role: "user" | "assistant"; content: string }[]; maxTokens: number; signal: AbortSignal }) {
  const response = await fetch(`${PROVIDER_ENV.cortexBridgeUrl}/cortex/inference`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ model: opts.model, stream: true, max_tokens: opts.maxTokens, messages: [{ role: "system", content: opts.system }, ...opts.messages] }),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) throw new Error(`Cortex inference failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let data: any;
      try { data = JSON.parse(payload); } catch { continue; }
      if (data.usage) usage = { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 };
      const text = data.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text) yield { text };
    }
  }
  yield { usage };
}

// ---- OpenAI-compatible streaming: Cortex chat/completions (GPT, Grok, Kimi, GLM) and Paper Instruments (Ultramarine) ----

export type OpenAIChunk =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool_delta"; index: number; id?: string; name?: string; args: string }
  | { kind: "finish"; reason: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number; reasoningTokens: number; cachedTokens: number };

/** Endpoint and credentials for an OpenAI-format provider. The Cortex bridge adds the PAT and maps max_tokens itself. */
function chatEndpoint(provider: ProviderId) {
  if (provider === "core-chat") return { url: `${PROVIDER_ENV.cortexBridgeUrl}/v1/chat/completions`, headers: {} as Record<string, string> };
  if (provider === "fast") {
    if (!PROVIDER_ENV.paperKey) throw new Error("PAPER_API_KEY is not configured.");
    return { url: `${PROVIDER_ENV.paperUrl}/chat/completions`, headers: { authorization: `Bearer ${PROVIDER_ENV.paperKey}` } };
  }
  throw new Error(`${provider} is not an OpenAI-compatible provider.`);
}

export async function* streamOpenAIChat(opts: { provider: ProviderId; model: string; messages: Record<string, unknown>[]; tools?: Record<string, unknown>[]; maxTokens: number; reasoningEffort?: ThinkingLevel; signal: AbortSignal }): AsyncGenerator<OpenAIChunk> {
  const endpoint = chatEndpoint(opts.provider);
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { ...endpoint.headers, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      model: opts.model, stream: true, stream_options: { include_usage: true }, max_tokens: opts.maxTokens, messages: opts.messages,
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
    }),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) throw new Error(`Chat engine request failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let data: any;
      try { data = JSON.parse(payload); } catch { continue; }
      if (data.error) throw new Error(`Chat engine error: ${data.error.message ?? JSON.stringify(data.error)}`);
      if (data.usage) {
        yield {
          kind: "usage",
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
          reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }
      for (const choice of data.choices ?? []) {
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) yield { kind: "reasoning", text: delta.reasoning_content };
        if (typeof delta.content === "string" && delta.content) yield { kind: "text", text: delta.content };
        for (const call of delta.tool_calls ?? []) {
          yield { kind: "tool_delta", index: call.index ?? 0, id: call.id, name: call.function?.name, args: call.function?.arguments ?? "" };
        }
        if (choice.finish_reason) yield { kind: "finish", reason: choice.finish_reason };
      }
    }
  }
}

// ---- Manus (remote autonomous agent, v2 API) ----

async function manusRequest(method: "GET" | "POST", endpoint: string, body?: unknown, signal?: AbortSignal) {
  if (!PROVIDER_ENV.manusKey) throw new Error("MANUS_AGENT_API_KEY is not configured.");
  const response = await fetch(`${PROVIDER_ENV.manusUrl}/v2/${endpoint}`, {
    method,
    headers: { "x-manus-api-key": PROVIDER_ENV.manusKey, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(`Manus ${endpoint} failed (${response.status}): ${data?.error?.message ?? "unexpected response"}`);
  return data;
}

export type ManusMessage =
  | { id: string; timestamp: string; type: "status_update"; status_update: { agent_status: string; brief: string; description: string } }
  | { id: string; timestamp: string; type: "assistant_message"; assistant_message: { content: string } }
  | { id: string; timestamp: string; type: string; [key: string]: unknown };

export async function manusCreateTask(prompt: string, signal?: AbortSignal) {
  const data = await manusRequest("POST", "task.create", { message: { content: prompt.slice(0, 18_000) }, agent_profile: PROVIDER_ENV.manusProfile, hide_in_task_list: false }, signal);
  return { taskId: data.task_id as string, url: data.task_url as string };
}

export async function manusDetail(taskId: string, signal?: AbortSignal) {
  const data = await manusRequest("GET", `task.detail?task_id=${encodeURIComponent(taskId)}`, undefined, signal);
  return data.task as { status: string; title: string; task_url: string; credit_usage?: number };
}

export async function manusMessages(taskId: string, signal?: AbortSignal): Promise<ManusMessage[]> {
  const data = await manusRequest("GET", `task.listMessages?task_id=${encodeURIComponent(taskId)}`, undefined, signal);
  return [...(data.messages as ManusMessage[])].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled")); }, { once: true });
});

/** Run a Manus task to completion, reporting each new status/assistant message as it appears. */
export async function runManusTask(prompt: string, opts: { signal: AbortSignal; timeoutMs?: number; onProgress: (update: { status: string; detail: string; url?: string }) => void }) {
  const { taskId, url } = await manusCreateTask(prompt, opts.signal);
  opts.onProgress({ status: "created", detail: `Manus task ${taskId} created.`, url });
  const seen = new Set<string>();
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  let answer = "";
  let pollFailures = 0;
  while (Date.now() < deadline) {
    await sleep(5000, opts.signal);
    // Polling is idempotent: transient errors are retried on the same remote task (never re-created).
    let detail: Awaited<ReturnType<typeof manusDetail>>;
    let messages: ManusMessage[];
    try {
      [detail, messages] = await Promise.all([manusDetail(taskId, opts.signal), manusMessages(taskId, opts.signal)]);
      pollFailures = 0;
    } catch (error) {
      if (opts.signal.aborted) throw error;
      if (++pollFailures > 6) return { answer: answer || "The research task stopped responding.", url, status: "failed" as const };
      opts.onProgress({ status: "retrying", detail: "Lost contact with the research task; retrying…", url });
      await sleep(Math.min(30_000, 2000 * 2 ** pollFailures), opts.signal);
      continue;
    }
    for (const message of messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      if (message.type === "status_update" && "status_update" in message) {
        const update = message.status_update as { agent_status: string; brief: string; description: string };
        opts.onProgress({ status: update.agent_status, detail: `${update.brief}${update.description ? ` — ${update.description}` : ""}`, url });
      } else if (message.type === "assistant_message" && "assistant_message" in message) {
        const content = (message.assistant_message as { content: string }).content;
        answer = content;
        opts.onProgress({ status: "message", detail: content.slice(0, 600), url });
      }
    }
    if (["stopped", "completed", "finished"].includes(detail.status)) return { answer, url, status: "completed" as const };
    if (["error", "failed"].includes(detail.status)) return { answer, url, status: "failed" as const };
    if (detail.status === "waiting") return { answer: answer || "Manus is waiting for input. Continue the task on Manus.", url, status: "completed" as const };
  }
  return { answer: answer || "Manus did not finish within the time limit.", url, status: "failed" as const };
}

// ---- Health probes for the sidebar status pill and Integrations page ----

export type ProbeResult = { id: string; label: string; ok: boolean; latencyMs: number; detail: string; configured: boolean };

async function timed(label: string, id: string, configured: boolean, fn: () => Promise<string>): Promise<ProbeResult> {
  const started = Date.now();
  if (!configured) return { id, label, ok: false, latencyMs: 0, detail: "Not configured", configured };
  try {
    const detail = await fn();
    return { id, label, ok: true, latencyMs: Date.now() - started, detail, configured };
  } catch (error) {
    return { id, label, ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? brandText(error.message).slice(0, 200) : "Probe failed", configured };
  }
}

export async function probeProviders(deep = false): Promise<ProbeResult[]> {
  const signal = AbortSignal.timeout(deep ? 45_000 : 8000);
  return Promise.all([
    timed("Curialy Core", "core", true, async () => {
      if (!deep) {
        const response = await fetch(`${PROVIDER_ENV.cortexBridgeUrl}/health`, { signal });
        if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
        return "Reasoning engine reachable";
      }
      const message = await anthropicClient("core").messages.create({ model: "claude-haiku-5-5", max_tokens: 8, messages: [{ role: "user", content: "Reply OK" }] }, { signal });
      // Every Core route behind the listed models: chat completions (GPT, Grok, Kimi, GLM),
      // inference (Llama 3.1, Mistral) and SQL completion (Gemini 4 Argon, 3.7 Flash, Llama 3.3).
      const routes = await Promise.all([
        (async () => { for await (const chunk of streamOpenAIChat({ provider: "core-chat", model: "openai-gpt-5.4", messages: [{ role: "user", content: "Reply OK" }], maxTokens: 16, signal })) if (chunk.kind === "text") return true; return false; })(),
        (async () => { for await (const part of streamCortexInference({ model: "llama3.1-8b", system: "Be brief.", messages: [{ role: "user", content: "Reply OK" }], maxTokens: 8, signal })) if ("text" in part) return true; return false; })(),
        aiComplete({ model: "llama3.3-70b", prompt: "Reply OK", maxTokens: 8, signal, timeoutMs: 40_000 }).then(result => Boolean(result.text)),
      ].map(check => check.catch(() => false)));
      const failed = ["chat completions", "inference", "SQL completion"].filter((_, index) => !routes[index]);
      if (failed.length) throw new Error(`Messages route OK; failing: ${failed.join(", ")}`);
      return `Live completions OK on all 4 routes (${message.usage.output_tokens} tokens on Messages)`;
    }),
    timed("Curialy Relay", "relay", Boolean(PROVIDER_ENV.relayKey), async () => {
      const response = await fetch(`${PROVIDER_ENV.relayUrl}/v1/models`, { headers: { authorization: `Bearer ${PROVIDER_ENV.relayKey}` }, signal });
      if (!response.ok) throw new Error(`Models endpoint returned ${response.status}`);
      const data: any = await response.json();
      return `${data?.data?.length ?? 0} model routes available`;
    }),
    timed("Curialy Research Agent", "research", Boolean(PROVIDER_ENV.manusKey), async () => {
      const response = await fetch(`${PROVIDER_ENV.manusUrl}/v1/tasks?limit=1`, { headers: { API_KEY: PROVIDER_ENV.manusKey }, signal });
      if (!response.ok) throw new Error(`Task list returned ${response.status}`);
      return "Agent service reachable";
    }),
    timed("Curialy Fast Reasoning", "fast", Boolean(PROVIDER_ENV.paperKey), async () => {
      const response = await fetch(`${PROVIDER_ENV.paperUrl}/models`, { headers: { authorization: `Bearer ${PROVIDER_ENV.paperKey}` }, signal });
      if (!response.ok) throw new Error(`Models endpoint returned ${response.status}`);
      const data: any = await response.json();
      return `${(data?.data ?? []).length} model(s) ready`;
    }),
    timed("Curialy Live Browser", "browser", Boolean(PROVIDER_ENV.browserbaseKey && PROVIDER_ENV.browserbaseProject), async () => {
      const response = await fetch(`https://api.browserbase.com/v1/projects/${PROVIDER_ENV.browserbaseProject}`, { headers: { "X-BB-API-Key": PROVIDER_ENV.browserbaseKey }, signal });
      if (!response.ok) throw new Error(`Project lookup returned ${response.status}`);
      const data: any = await response.json();
      return `Ready · up to ${data.concurrency} concurrent sessions`;
    }),
    timed("Curialy Cloud Deploy", "deploy", Boolean(PROVIDER_ENV.renderKey && PROVIDER_ENV.renderOwner), async () => {
      const response = await fetch(`https://api.render.com/v1/owners/${PROVIDER_ENV.renderOwner}`, { headers: { authorization: `Bearer ${PROVIDER_ENV.renderKey}`, accept: "application/json" }, signal });
      if (!response.ok) throw new Error(`Owner lookup returned ${response.status}`);
      return "Ready (deploys need GitHub connected)";
    }),
    timed("Gemini engine", "gemini", Boolean(PROVIDER_ENV.relayKey), async () => {
      if (!deep) return "Routed (run the live check to verify)";
      // RelayStation always answers with SSE, so even a probe has to stream.
      const message = await anthropicClient("relay").messages.stream({ model: "r/gemini-3.8-flash-low", max_tokens: 8, messages: [{ role: "user", content: "Reply OK" }] }, { signal }).finalMessage();
      return `Live completion OK (${message.usage.output_tokens} tokens)`;
    }),
  ]);
}
