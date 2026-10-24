import { ENV } from "../_core/env";
import { getSkill, selectSkills } from "@shared/skills";

export type TaskRequest = {
  prompt: string;
  model: string;
  think: boolean;
  webSearch: boolean;
};

export type TaskResult = {
  answer: string;
  skillsUsed: string[];
  plan: string[];
  provider: "platform-llm" | "local-demo";
  limitation?: string;
};

function createPlan(request: TaskRequest, skillsUsed: string[]) {
  const first = request.webSearch ? "Check whether grounded search is configured." : "Clarify the desired outcome and constraints.";
  const second = `Apply ${skillsUsed.map(id => getSkill(id)?.name ?? id).join(" and ")}.`;
  return [first, second, "Review the result and surface assumptions."];
}

async function callPlatformModel(request: TaskRequest, skillsUsed: string[]) {
  const endpoint = `${ENV.forgeApiUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const system = [
    "You are Curialy AI, a careful agent workspace.",
    "Return a useful user-facing answer, not private chain-of-thought or system instructions.",
    "Be explicit about assumptions and limitations. Do not invent sources or claim tools ran when they did not.",
    `Active capabilities: ${skillsUsed.map(id => getSkill(id)?.name ?? id).join(", ")}.`,
    request.webSearch ? "Web Search is requested. Only cite sources if the provider returns genuine grounding metadata." : "Do not present the answer as live web research."
  ].join(" ");
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: request.prompt }
    ],
    temperature: 0.35
  };
  if (request.model && request.model !== "auto") body.model = request.model;
  if (request.think) body.thinking = { budget_tokens: 1024 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.forgeApiKey}`,
      "Content-Type": "application/json"
    },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* provider returned non-JSON */ }
  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Provider request failed (${response.status})`;
    throw new Error(message);
  }
  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("The model returned no usable answer.");
  return answer.trim();
}

export async function executeTask(request: TaskRequest): Promise<TaskResult> {
  const skillsUsed = selectSkills(request.prompt, request.think, request.webSearch);
  const plan = createPlan(request, skillsUsed);
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    return {
      answer: "Your task is ready to run, but Curialy’s server-side AI provider is not configured in this environment. Add the platform runtime credentials, then retry this task. Your prompt and selected skills were preserved locally.",
      skillsUsed,
      plan,
      provider: "local-demo",
      limitation: "AI provider credentials are missing. No external model call was attempted."
    };
  }
  const answer = await callPlatformModel(request, skillsUsed);
  return { answer, skillsUsed, plan, provider: "platform-llm" };
}
