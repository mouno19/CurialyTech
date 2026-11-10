import type { ApiWallet, TokenUsageDetail } from "@shared/billing";
import { query } from "../db/pg";
import { reservedFor } from "../gateway";

// The Developer API balance: micro-dollars on the account. Payments add to it (orders.ts) and the
// gateway takes each reply's cost from it, in the statement that records the reply's usage. What
// requests still running could cost is held in the gateway's memory (reservedFor), not here.

let schema = "curialy";
/** Tests point the wallet SQL at temporary tables; production never calls this. */
export function useSchemaForTests(name: string) {
  schema = name;
}
const t = (table: string) => `${schema}.${table}`;

/** The account's API balance in micro-dollars (0 for an account that doesn't exist). */
export async function apiBalanceMicros(userId: string): Promise<number> {
  const { rows } = await query<{ api_balance_micros: string }>(`SELECT api_balance_micros FROM ${t("users")} WHERE id = $1`, [userId]);
  return rows[0] ? Number(rows[0].api_balance_micros) : 0;
}

/** The balance, what requests in flight hold, and what can be spent now (never below 0). */
export async function getApiWallet(userId: string): Promise<ApiWallet> {
  const balanceMicros = await apiBalanceMicros(userId);
  const { reservedMicros, reservedTokens, requests } = reservedFor(userId);
  return { balanceMicros, reservedMicros, reservedTokens, requestsInFlight: requests, availableMicros: Math.max(0, balanceMicros - reservedMicros) };
}

/** One reply, priced: what it cost at list price and after the discount it was charged at. keyId: null when the key is gone. */
export type ApiUsageRecord = {
  userId: string; keyId: string | null; model: string; usage: TokenUsageDetail; listMicros: number; costMicros: number; discountPercent: number;
};

const amount = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Takes a reply's cost from the API balance and writes its usage row in one statement, so the
 * balance never moves without its record. A reply can cost more than was held for it (its input
 * is estimated) and leave the balance below 0: the account's next request is refused until a top-up
 * covers it. A cost of 0 (the operator) takes nothing; the row is still written.
 */
export async function recordApiUsage(record: ApiUsageRecord) {
  const { usage } = record;
  // A usage row only ever takes money: never a negative or fractional amount.
  if (!amount(record.costMicros) || !amount(record.listMicros)) throw new Error(`Invalid API usage amount for ${record.model}.`);
  await query(
    `WITH spent AS (
       UPDATE ${t("users")} SET api_balance_micros = api_balance_micros - $9::bigint WHERE id = $1 AND $9::bigint > 0 RETURNING id
     )
     INSERT INTO ${t("api_usage")} (user_id, key_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, list_micros, cost_micros, discount_percent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [record.userId, record.keyId, record.model, usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, record.listMicros, record.costMicros, record.discountPercent],
  );
}
