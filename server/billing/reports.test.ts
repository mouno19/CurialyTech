import { beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE_RANGES } from "@shared/billing";

// Usage reports without a database: the buckets each range asks for, the time zones let through to
// SQL (as a parameter, never in the text), and how the rows fold into buckets, models, keys and
// totals. reports.sql.test.ts runs the SQL itself.

const sql = vi.hoisted(() => ({ calls: [] as { text: string; values: unknown[] }[], respond: null as null | ((text: string, values: unknown[]) => unknown[]) }));
vi.mock("../db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    sql.calls.push({ text, values });
    return { rows: sql.respond ? sql.respond(text, values) : [] };
  }),
}));
const balance = vi.hoisted(() => ({ allowance: 6000, windowHours: 8 }));
vi.mock("../credits", () => ({ getBalance: vi.fn(async () => ({ unlimited: false, used: 0, remaining: 0, bonus: 0, available: 0, resetsAt: null, plan: null, ...balance })) }));

const { apiUsageReport, bucketPlan, creditUsageReport, reportTimeZone } = await import("./reports");

beforeEach(() => {
  sql.calls.length = 0;
  sql.respond = null;
});

const NOW = Date.parse("2026-11-09T14:20:00Z");
const hour = (h: number) => new Date(Date.UTC(2026, 10, 9, h));
const usageRow = (start: Date, model: string | null, keyId: string | null, counts: Partial<Record<"requests" | "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens" | "cost_micros" | "list_micros", number>> = {}, key: { name?: string; prefix?: string } = {}) => ({
  start, model, key_id: keyId, key_name: key.name ?? null, key_prefix: key.prefix ?? null,
  ...Object.fromEntries(["requests", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_micros", "list_micros"].map(name => [name, model === null ? null : String(counts[name as keyof typeof counts] ?? 0)])),
});

describe("the bucket plan", () => {
  it("is 24 hours for 24h and a day per bucket for the others, the current one last", () => {
    expect(bucketPlan("24h")).toEqual({ bucket: "hour", count: 24 });
    expect(bucketPlan("7d")).toEqual({ bucket: "day", count: 7 });
    expect(bucketPlan("30d")).toEqual({ bucket: "day", count: 30 });
    expect(bucketPlan("90d")).toEqual({ bucket: "day", count: 90 });
    for (const range of USAGE_RANGES) expect(bucketPlan(range).count).toBeGreaterThan(0);
    expect(() => bucketPlan("1y" as never)).toThrow(/Unknown usage range/);
  });

  it("lets through only time zone names Intl knows, never an offset the database would read backwards", () => {
    for (const zone of ["Europe/Paris", "America/Argentina/Buenos_Aires", "Asia/Kolkata", "Etc/GMT+5", "UTC", "America/Port-au-Prince"]) expect(reportTimeZone(zone)).toBe(zone);
    // Intl accepts "+05:30", but SQL's AT TIME ZONE reads it as UTC-5:30.
    for (const zone of ["+05:30", "-08:00", "Mars/Olympus", "", "Europe/Paris'; DROP TABLE x; --", "Europe/../Paris", "a".repeat(80), 42, null, undefined]) expect(reportTimeZone(zone)).toBe("UTC");
  });
});

describe("the API usage report", () => {
  it("lists every bucket, fills empty ones with zeros, and adds up models, keys and totals", async () => {
    sql.respond = () => [
      usageRow(hour(12), null, null),
      usageRow(hour(13), "claude-opus-5-5", "k1", { requests: 2, input_tokens: 30_000, output_tokens: 2_000, cache_read_tokens: 5_000, cost_micros: 16_100, list_micros: 161_000 }, { name: "CI", prefix: "cur_live_ab12" }),
      usageRow(hour(13), "grok-4.7", null, { requests: 1, input_tokens: 1_000, output_tokens: 500, cost_micros: 500, list_micros: 5_000 }),
      usageRow(hour(14), "claude-opus-5-5", "k2", { requests: 1, input_tokens: 100, output_tokens: 10, cache_write_tokens: 2_000, cost_micros: 1_060, list_micros: 10_600 }, { name: "Laptop", prefix: "cur_live_cd34" }),
      usageRow(hour(14), "grok-4.7", "k2", { requests: 3, input_tokens: 3_000, output_tokens: 300, cost_micros: 780, list_micros: 7_800 }, { name: "Laptop", prefix: "cur_live_cd34" }),
    ];
    const report = await apiUsageReport("u1", "24h", "Europe/Paris", NOW);
    const [{ text, values }] = sql.calls;
    expect(values).toEqual(["u1", "Europe/Paris", 24, new Date(NOW)]);
    expect(text).not.toContain("Europe/Paris");
    expect(text).toContain("FROM curialy.api_usage u, span");
    expect(text).toContain("LEFT JOIN curialy.api_keys k ON k.id = g.key_id AND k.user_id = $1");
    expect(report).toMatchObject({ range: "24h", bucket: "hour", timeZone: "Europe/Paris" });
    const none = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0, listMicros: 0 };
    expect(report.buckets).toEqual([
      { start: "2026-11-09T12:00:00.000Z", ...none },
      { start: "2026-11-09T13:00:00.000Z", requests: 3, inputTokens: 31_000, outputTokens: 2_500, cacheReadTokens: 5_000, cacheWriteTokens: 0, costMicros: 16_600, listMicros: 166_000 },
      { start: "2026-11-09T14:00:00.000Z", requests: 4, inputTokens: 3_100, outputTokens: 310, cacheReadTokens: 0, cacheWriteTokens: 2_000, costMicros: 1_840, listMicros: 18_400 },
    ]);
    // Most spent first.
    expect(report.byModel).toEqual([
      { model: "claude-opus-5-5", requests: 3, inputTokens: 30_100, outputTokens: 2_010, cacheReadTokens: 5_000, cacheWriteTokens: 2_000, costMicros: 17_160, listMicros: 171_600 },
      { model: "grok-4.7", requests: 4, inputTokens: 4_000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 1_280, listMicros: 12_800 },
    ]);
    // A key that was deleted keeps its usage, as no key.
    expect(report.byKey.map(entry => [entry.keyId, entry.name, entry.prefix, entry.requests, entry.costMicros])).toEqual([
      ["k1", "CI", "cur_live_ab12", 2, 16_100],
      ["k2", "Laptop", "cur_live_cd34", 4, 1_840],
      [null, null, null, 1, 500],
    ]);
    expect(report.totals).toEqual({ requests: 7, inputTokens: 34_100, outputTokens: 2_810, cacheReadTokens: 5_000, cacheWriteTokens: 2_000, costMicros: 18_440, listMicros: 184_400 });
  });

  it("orders the operator's models, who pays nothing, by their list price", async () => {
    sql.respond = () => [
      usageRow(hour(14), "claude-haiku-5-5", "k1", { requests: 9, list_micros: 900 }),
      usageRow(hour(14), "claude-opus-5-5", "k1", { requests: 1, list_micros: 105_000 }),
    ];
    const report = await apiUsageReport("op", "24h", "UTC", NOW);
    expect(report.byModel.map(entry => entry.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it("reports in UTC when the zone is not one the database can use", async () => {
    await apiUsageReport("u1", "7d", "+05:30", NOW);
    expect(sql.calls[0].values).toEqual(["u1", "UTC", 7, new Date(NOW)]);
    // A name Intl knows but the database doesn't: asked again in UTC.
    sql.calls.length = 0;
    sql.respond = (_text, values) => {
      if (values[1] !== "UTC") throw Object.assign(new Error('time zone "America/Ciudad_Juarez" not recognized'), { code: "22023" });
      return [usageRow(new Date("2026-11-09T00:00:00Z"), null, null)];
    };
    const report = await apiUsageReport("u1", "7d", "America/Ciudad_Juarez", NOW);
    expect(sql.calls.map(entry => entry.values[1])).toEqual(["America/Ciudad_Juarez", "UTC"]);
    expect(report).toMatchObject({ timeZone: "UTC", bucket: "day", buckets: [{ start: "2026-11-09T00:00:00.000Z", requests: 0 }] });
    // Any other failure is not hidden.
    sql.respond = () => { throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }); };
    await expect(apiUsageReport("u1", "7d", "Europe/Paris", NOW)).rejects.toThrow(/statement timeout/);
  });
});

describe("the credit usage report", () => {
  it("lists credits and runs per bucket, totals over the range, and the account's allowance", async () => {
    sql.respond = () => [
      { start: new Date("2026-11-07T23:00:00Z"), credits: "0", runs: "0", total_credits: "41.75", total_runs: "3" },
      { start: new Date("2026-11-08T23:00:00Z"), credits: "41.75", runs: "4", total_credits: "41.75", total_runs: "3" },
    ];
    const report = await creditUsageReport("u1", "7d", "Europe/Paris", NOW);
    const [{ text, values }] = sql.calls;
    expect(values).toEqual(["u1", "Europe/Paris", 7, new Date(NOW)]);
    expect(text).toContain("FROM curialy.credit_events e, span");
    expect(text).toContain("e.kind = 'usage'");
    expect(text).toContain("-e.amount AS credits");
    expect(report).toEqual({
      range: "7d", bucket: "day", timeZone: "Europe/Paris",
      buckets: [{ start: "2026-11-07T23:00:00.000Z", credits: 0, runs: 0 }, { start: "2026-11-08T23:00:00.000Z", credits: 41.75, runs: 4 }],
      // A run that spent in several buckets counts once in the totals.
      totals: { credits: 41.75, runs: 3 },
      allowance: 6000, windowHours: 8,
    });
  });
});
