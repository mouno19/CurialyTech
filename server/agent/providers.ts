import Anthropic from "@anthropic-ai/sdk";
import type { ModelSpec, ProviderId, ThinkingLevel } from "@shared/agent";

// Secrets come only from the service environment (/etc/curialyai.env); nothing here reaches the browser.
export const PROVIDER_ENV = {
  get cortexBridgeUrl() { return (process.env.CORTEX_BRIDGE_URL || "http://127.0.0.1:8082").replace(/\/+$/, ""); },
  get relayUrl() { return (process.env.RELAY_API_URL || "https://relaystation.world").replace(/\/+$/, "").replace(/\/v1$/, ""); },
  get relayKey() { return process.env.RELAY_API_KEY || ""; },
  get manusUrl() { return (process.env.MANUS_AGENT_API_URL || "https://api.manus.ai").replace(/\/+$/, ""); },
  get manusKey() { return process.env.MANUS_AGENT_API_KEY || ""; },
  get manusProfile() { return process.env.MANUS_AGENT_PROFILE || "lite"; },
};

let cortexClient: Anthropic | null = null;
let relayClient: Anthropic | null = null;

/** Anthropic-compatible client for a provider. The Cortex bridge injects the Snowflake PAT itself. */
export function anthropicClient(provider: ProviderId) {
  if (provider === "cortex") {
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

/** Thinking/effort parameters a given model accepts. */
export function reasoningParams(model: ModelSpec, level: ThinkingLevel): Pick<Anthropic.MessageCreateParams, "thinking" | "output_config"> {
  const params: Pick<Anthropic.MessageCreateParams, "thinking" | "output_config"> = {};
  if (model.thinking === "adaptive-summarized") params.thinking = { type: "adaptive", display: "summarized" };
  else if (model.thinking === "adaptive") params.thinking = { type: "adaptive" };
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
  while (Date.now() < deadline) {
    await sleep(5000, opts.signal);
    const [detail, messages] = await Promise.all([manusDetail(taskId, opts.signal), manusMessages(taskId, opts.signal)]);
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
    return { id, label, ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message.slice(0, 200) : "Probe failed", configured };
  }
}

export async function probeProviders(deep = false): Promise<ProbeResult[]> {
  const signal = AbortSignal.timeout(deep ? 45_000 : 8000);
  return Promise.all([
    timed("Snowflake Cortex", "cortex", true, async () => {
      if (!deep) {
        const response = await fetch(`${PROVIDER_ENV.cortexBridgeUrl}/health`, { signal });
        if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
        return "Bridge reachable";
      }
      const message = await anthropicClient("cortex").messages.create({ model: "claude-sonnet-4-5", max_tokens: 8, messages: [{ role: "user", content: "Reply OK" }] }, { signal });
      return `claude-sonnet-4-5 answered (${message.usage.output_tokens} tokens)`;
    }),
    timed("RelayStation", "relay", Boolean(PROVIDER_ENV.relayKey), async () => {
      const response = await fetch(`${PROVIDER_ENV.relayUrl}/v1/models`, { headers: { authorization: `Bearer ${PROVIDER_ENV.relayKey}` }, signal });
      if (!response.ok) throw new Error(`Models endpoint returned ${response.status}`);
      const data: any = await response.json();
      return `${data?.data?.length ?? 0} models available`;
    }),
    timed("Manus", "manus", Boolean(PROVIDER_ENV.manusKey), async () => {
      const response = await fetch(`${PROVIDER_ENV.manusUrl}/v1/tasks?limit=1`, { headers: { API_KEY: PROVIDER_ENV.manusKey }, signal });
      if (!response.ok) throw new Error(`Task list returned ${response.status}`);
      return "API key accepted";
    }),
    timed("Google Gemini (via RelayStation)", "gemini", Boolean(PROVIDER_ENV.relayKey), async () => {
      if (!deep) return "Routed through RelayStation (run a deep check to verify)";
      // RelayStation always answers with SSE, so even a probe has to stream.
      const message = await anthropicClient("relay").messages.stream({ model: "r/gemini-3.7-flash-high", max_tokens: 8, messages: [{ role: "user", content: "Reply OK" }] }, { signal }).finalMessage();
      return `Answered (${message.usage.output_tokens} tokens)`;
    }),
  ]);
}
