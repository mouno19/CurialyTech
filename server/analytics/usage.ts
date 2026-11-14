import { API_PRICES, apiCost } from "@shared/billing";
import { query } from "../db/pg";

// Every model turn the agent makes, in a ledger of its own (kept when its task is deleted): its
// tokens, the credits charged for it (none for the operator), an estimate of what it costs at the
// model's list price, and the account's plan at the time. The Analytics page reads it.

/** The priced model behind an id: a relay route ("r/claude-opus-4-6-thinking") is priced as its model. */
export function pricedModel(model: string): string | null {
  if (API_PRICES[model]) return model;
  const base = model.replace(/^r\//, "").replace(/-thinking$/, "");
  return API_PRICES[base] ? base : null;
}

export type TurnUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };

/** Micro-dollars at list price (null: the model has no list price). */
export function listMicros(model: string, usage: TurnUsage): number | null {
  const priced = pricedModel(model);
  if (!priced) return null;
  return apiCost(priced, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0 }, 0).listMicros;
}

/** Record one turn of a task's run, with its account and that account's plan now. */
export async function recordAgentUsage(taskId: string, model: string, usage: TurnUsage, credits: number, operator: boolean) {
  await query(
    `INSERT INTO curialy.agent_usage (user_id, task_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, credits, list_micros, plan_id, operator)
     SELECT s.user_id, s.id, $2, $3, $4, $5, $6, $7, $8, CASE WHEN u.plan_expires_at > now() THEN u.plan_id END, $9
     FROM curialy.chat_sessions s LEFT JOIN curialy.users u ON u.id = s.user_id WHERE s.id = $1`,
    [taskId, model.slice(0, 100), Math.max(0, Math.round(usage.inputTokens)), Math.max(0, Math.round(usage.outputTokens)), Math.max(0, Math.round(usage.cacheReadTokens ?? 0)),
      Math.max(0, Math.round(usage.cacheWriteTokens ?? 0)), operator ? 0 : Math.max(0, credits), listMicros(model, usage), operator],
  );
}
