import { beforeEach, describe, expect, it, vi } from "vitest";

// The API wallet: the balance in the database less what requests in flight hold (never shown below
// 0), and the one statement that takes a reply's cost from the balance and records its usage.

const sql = vi.hoisted(() => ({ statements: [] as { text: string; values: unknown[] }[], balance: null as string | null }));
vi.mock("../db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    sql.statements.push({ text, values });
    if (text.startsWith("SELECT api_balance_micros FROM curialy.users")) return { rows: sql.balance === null ? [] : [{ api_balance_micros: sql.balance }] };
    if (text.includes("INSERT INTO curialy.api_usage")) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }),
}));
const held = vi.hoisted(() => ({ reservedMicros: 0, reservedTokens: 0, requests: 0 }));
vi.mock("../gateway", () => ({ reservedFor: vi.fn(() => ({ ...held })) }));

const { apiBalanceMicros, getApiWallet, recordApiUsage } = await import("./wallet");
const { reservedFor } = await import("../gateway");

beforeEach(() => {
  sql.statements.length = 0;
  sql.balance = null;
  Object.assign(held, { reservedMicros: 0, reservedTokens: 0, requests: 0 });
});

describe("the API wallet", () => {
  it("shows the balance less what requests in flight hold", async () => {
    sql.balance = "5000000"; // bigint columns arrive as strings
    Object.assign(held, { reservedMicros: 1_250_000, reservedTokens: 70_000, requests: 2 });
    expect(await getApiWallet("u1")).toEqual({ balanceMicros: 5_000_000, reservedMicros: 1_250_000, reservedTokens: 70_000, requestsInFlight: 2, availableMicros: 3_750_000 });
    expect(reservedFor).toHaveBeenCalledWith("u1");
    expect(sql.statements[0].values).toEqual(["u1"]);
  });

  it("never shows less than nothing available: holds past the balance, or a balance a long reply took below 0", async () => {
    sql.balance = "1000";
    Object.assign(held, { reservedMicros: 4_000, reservedTokens: 20_000, requests: 1 });
    expect(await getApiWallet("u1")).toMatchObject({ balanceMicros: 1_000, availableMicros: 0 });
    sql.balance = "-2500";
    Object.assign(held, { reservedMicros: 0, reservedTokens: 0, requests: 0 });
    expect(await getApiWallet("u1")).toEqual({ balanceMicros: -2_500, reservedMicros: 0, reservedTokens: 0, requestsInFlight: 0, availableMicros: 0 });
  });

  it("reads 0 for an account that doesn't exist", async () => {
    expect(await apiBalanceMicros("missing")).toBe(0);
    expect(await getApiWallet("missing")).toMatchObject({ balanceMicros: 0, availableMicros: 0 });
  });
});

describe("recording a reply's usage", () => {
  const usage = { inputTokens: 20_000, outputTokens: 1_250, cacheReadTokens: 3_000, cacheWriteTokens: 500 };

  it("takes the cost from the balance and writes the usage row in one statement", async () => {
    await recordApiUsage({ userId: "u1", keyId: "k1", model: "claude-opus-5-5", usage, listMicros: 108_100, costMicros: 10_810, discountPercent: 90 });
    expect(sql.statements).toHaveLength(1);
    const [{ text, values }] = sql.statements;
    expect(text).toMatch(/^WITH spent AS \(\s*UPDATE curialy\.users SET api_balance_micros = api_balance_micros - \$9::bigint WHERE id = \$1 AND \$9::bigint > 0/);
    expect(text).toContain("INSERT INTO curialy.api_usage (user_id, key_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, list_micros, cost_micros, discount_percent)");
    expect(values).toEqual(["u1", "k1", "claude-opus-5-5", 20_000, 1_250, 3_000, 500, 108_100, 10_810, 90]);
  });

  it("records the operator's usage at no cost, and a key that is gone as none", async () => {
    await recordApiUsage({ userId: "op", keyId: null, model: "grok-4.7", usage, listMicros: 47_500, costMicros: 0, discountPercent: 0 });
    expect(sql.statements[0].values).toEqual(["op", null, "grok-4.7", 20_000, 1_250, 3_000, 500, 47_500, 0, 0]);
  });

  it("refuses an amount that could add money or isn't whole, before anything is written", async () => {
    for (const costMicros of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(recordApiUsage({ userId: "u1", keyId: "k1", model: "claude-opus-5-5", usage, listMicros: 100, costMicros, discountPercent: 90 })).rejects.toThrow(/Invalid API usage amount/);
    }
    await expect(recordApiUsage({ userId: "u1", keyId: "k1", model: "claude-opus-5-5", usage, listMicros: -100, costMicros: 0, discountPercent: 90 })).rejects.toThrow();
    expect(sql.statements).toEqual([]);
  });
});
