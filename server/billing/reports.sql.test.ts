import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Opt-in: the Developer API's money SQL (a reply's charge) and the usage reports against a real
// PostgreSQL, on TEMPORARY tables only (pg_temp, one connection, dropped when it closes). Set
// CURIALY_PG_TEST_URL to a database you may write temporary tables to. Every statement sent is
// checked: none may touch the real schema.

const url = process.env.CURIALY_PG_TEST_URL;
const sql = vi.hoisted(() => ({ client: null as import("pg").Client | null, statements: [] as string[] }));

vi.mock("../db/pg", () => {
  const run = async (text: string, values?: unknown[]) => {
    if (/\bcurialy\./i.test(text)) throw new Error(`statement would touch the real schema: ${text.slice(0, 160)}`);
    if (!sql.client) throw new Error("no test database connection");
    sql.statements.push(text);
    return sql.client.query(text, values as unknown[]);
  };
  return { query: run };
});
vi.mock("../credits", () => ({ getBalance: async () => ({ allowance: 6000, windowHours: 8 }) }));
vi.mock("../gateway", () => ({ reservedFor: () => ({ reservedMicros: 0, reservedTokens: 0, requests: 0 }) }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KEY = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RUN = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite });

describe.skipIf(!url)("API usage SQL on temporary tables", () => {
  let wallet: typeof import("./wallet");
  let reports: typeof import("./reports");
  let client: pg.Client;

  const exec = (text: string, values: unknown[] = []) => {
    if (/\bcurialy\./i.test(text)) throw new Error("test setup must not touch the real schema");
    return client.query(text, values);
  };
  const used = (userId: string, keyId: string | null, model: string, at: string, counts: { requests?: number; cost?: number; list?: number; input?: number; output?: number } = {}) =>
    exec(
      "INSERT INTO pg_temp.api_usage (user_id, key_id, model, input_tokens, output_tokens, list_micros, cost_micros, discount_percent, created_at) SELECT $1, $2, $3, $4, $5, $6, $7, 90, $8 FROM generate_series(1, $9)",
      [userId, keyId, model, counts.input ?? 100, counts.output ?? 10, counts.list ?? 1_000, counts.cost ?? 100, at, counts.requests ?? 1],
    );
  const spent = (userId: string, kind: string, amount: number, sessionId: string | null, at: string) =>
    exec("INSERT INTO pg_temp.credit_events (user_id, kind, amount, session_id, created_at) VALUES ($1, $2, $3, $4, $5)", [userId, kind, amount, sessionId, at]);
  const balanceOf = async (userId: string) => Number((await exec("SELECT api_balance_micros FROM pg_temp.users WHERE id = $1", [userId])).rows[0].api_balance_micros);
  const hourIn = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  beforeAll(async () => {
    const parsed = new URL(url!);
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || parsed.searchParams.get("sslmode") === "disable";
    parsed.searchParams.delete("sslmode");
    client = new pg.Client({ connectionString: parsed.toString(), ssl: local ? false : { rejectUnauthorized: true, servername: parsed.hostname }, application_name: "curialy-reports-test" });
    await client.connect();
    sql.client = client;
    await exec("CREATE TEMP TABLE users (id uuid PRIMARY KEY, api_balance_micros bigint NOT NULL DEFAULT 0)");
    await exec("CREATE TEMP TABLE api_keys (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES pg_temp.users(id) ON DELETE CASCADE, name text NOT NULL, key_prefix text NOT NULL)");
    await exec(`CREATE TEMP TABLE api_usage (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES pg_temp.users(id) ON DELETE CASCADE,
      key_id uuid REFERENCES pg_temp.api_keys(id) ON DELETE SET NULL,
      model text NOT NULL,
      input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
      cache_read_tokens integer NOT NULL DEFAULT 0, cache_write_tokens integer NOT NULL DEFAULT 0,
      list_micros bigint NOT NULL DEFAULT 0, cost_micros bigint NOT NULL DEFAULT 0, discount_percent integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await exec(`CREATE TEMP TABLE credit_events (
      id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES pg_temp.users(id) ON DELETE CASCADE, kind text NOT NULL,
      amount numeric(12,2) NOT NULL, session_id uuid, detail text, created_at timestamptz NOT NULL DEFAULT now())`);
    wallet = await import("./wallet");
    reports = await import("./reports");
    wallet.useSchemaForTests("pg_temp");
    reports.useSchemaForTests("pg_temp");
  });

  afterAll(async () => {
    wallet?.useSchemaForTests("curialy");
    reports?.useSchemaForTests("curialy");
    await client?.end();
    sql.client = null;
  });

  beforeEach(async () => {
    await exec("TRUNCATE pg_temp.api_usage, pg_temp.credit_events, pg_temp.api_keys, pg_temp.users");
    await exec("INSERT INTO pg_temp.users (id, api_balance_micros) VALUES ($1, 50000), ($2, 0), ($3, 7000000)", [ID(1), ID(2), ID(3)]);
    await exec("INSERT INTO pg_temp.api_keys (id, user_id, name, key_prefix) VALUES ($1, $3, 'CI', 'cur_live_ab12'), ($2, $3, 'Laptop', 'cur_live_cd34'), ($4, $5, 'Theirs', 'cur_live_ef56')", [KEY(1), KEY(2), ID(1), KEY(3), ID(3)]);
  });

  it("takes a reply's cost from the balance in the statement that records it, and the operator's at no cost", async () => {
    await wallet.recordApiUsage({ userId: ID(1), keyId: KEY(1), model: "claude-opus-5-5", usage: usage(20_000, 1_250, 3_000, 500), listMicros: 108_100, costMicros: 10_810, discountPercent: 90 });
    expect(await balanceOf(ID(1))).toBe(50_000 - 10_810);
    const { rows: [row] } = await exec("SELECT user_id, key_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, list_micros, cost_micros, discount_percent FROM pg_temp.api_usage");
    expect(row).toEqual({ user_id: ID(1), key_id: KEY(1), model: "claude-opus-5-5", input_tokens: 20_000, output_tokens: 1_250, cache_read_tokens: 3_000, cache_write_tokens: 500, list_micros: "108100", cost_micros: "10810", discount_percent: 90 });
    // A reply that cost more than was left takes the balance below 0.
    await wallet.recordApiUsage({ userId: ID(1), keyId: KEY(1), model: "claude-opus-5-5", usage: usage(1_000, 50_000), listMicros: 1_004_000, costMicros: 100_400, discountPercent: 90 });
    expect(await wallet.apiBalanceMicros(ID(1))).toBe(50_000 - 10_810 - 100_400);
    expect(await wallet.getApiWallet(ID(1))).toMatchObject({ balanceMicros: -61_210, availableMicros: 0 });
    // The operator: recorded, nothing taken.
    await wallet.recordApiUsage({ userId: ID(2), keyId: null, model: "grok-4.7", usage: usage(10, 5), listMicros: 50, costMicros: 0, discountPercent: 0 });
    expect(await balanceOf(ID(2))).toBe(0);
    expect((await exec("SELECT count(*)::int AS n FROM pg_temp.api_usage WHERE user_id = $1", [ID(2)])).rows[0].n).toBe(1);
    expect(await wallet.apiBalanceMicros(ID(99))).toBe(0);
    // An account that is gone cannot be charged, and nothing is written for it.
    await expect(wallet.recordApiUsage({ userId: ID(99), keyId: null, model: "claude-opus-5-5", usage: usage(1, 1), listMicros: 24, costMicros: 3, discountPercent: 90 })).rejects.toThrow();
    expect((await exec("SELECT count(*)::int AS n FROM pg_temp.api_usage")).rows[0].n).toBe(3);
  });

  it("lists the last 24 hours, the current one last, with every model and key, empty hours as zeros", async () => {
    const now = Date.parse("2026-11-09T14:20:00Z");
    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-11-09T14:05:00Z", { requests: 2, cost: 500, list: 5_000, input: 1_000, output: 100 });
    await used(ID(1), KEY(2), "grok-4.7", "2026-11-09T13:59:59Z", { cost: 40, list: 400 });
    await used(ID(1), KEY(2), "claude-opus-5-5", "2026-11-08T15:00:00Z", { cost: 7, list: 70 }); // the first hour's first instant
    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-11-08T14:59:59Z", { cost: 1_000_000 }); // before the range
    await used(ID(3), KEY(3), "claude-opus-5-5", "2026-11-09T14:10:00Z", { cost: 9_999 }); // someone else's
    // A deleted key's usage stays, as no key.
    await exec("DELETE FROM pg_temp.api_keys WHERE id = $1", [KEY(2)]);
    const report = await reports.apiUsageReport(ID(1), "24h", "UTC", now);
    expect(report).toMatchObject({ range: "24h", bucket: "hour", timeZone: "UTC" });
    expect(report.buckets).toHaveLength(24);
    expect(report.buckets[0].start).toBe("2026-11-08T15:00:00.000Z");
    expect(report.buckets.at(-1)!.start).toBe("2026-11-09T14:00:00.000Z");
    expect(report.buckets.map(bucket => bucket.costMicros).filter(Boolean)).toEqual([7, 40, 1_000]);
    expect(report.buckets.at(-1)).toMatchObject({ requests: 2, inputTokens: 2_000, outputTokens: 200, costMicros: 1_000, listMicros: 10_000 });
    expect(report.byModel.map(entry => [entry.model, entry.requests, entry.costMicros])).toEqual([["claude-opus-5-5", 3, 1_007], ["grok-4.7", 1, 40]]);
    expect(report.byKey.map(entry => [entry.keyId, entry.name, entry.prefix, entry.requests, entry.costMicros])).toEqual([[KEY(1), "CI", "cur_live_ab12", 2, 1_000], [null, null, null, 2, 47]]);
    expect(report.totals).toMatchObject({ requests: 4, costMicros: 1_047, listMicros: 10_470 });
  });

  it("keeps every range's buckets in order, ending with the bucket that holds now", async () => {
    const now = Date.parse("2026-11-09T14:20:00Z");
    for (const [range, count] of [["24h", 24], ["7d", 7], ["30d", 30], ["90d", 90]] as const) {
      const report = await reports.apiUsageReport(ID(1), range, "Europe/Paris", now);
      const starts = report.buckets.map(bucket => Date.parse(bucket.start));
      expect(starts).toHaveLength(count);
      expect(starts.every((start, index) => index === 0 || start > starts[index - 1])).toBe(true);
      expect(starts.at(-1)!).toBeLessThanOrEqual(now);
      expect(now - starts.at(-1)!).toBeLessThan(range === "24h" ? 3_600_000 : 86_400_000);
      expect(report.totals.requests).toBe(0);
    }
  });

  it("follows the caller's clock through a daylight saving change: no doubled hour, and a 23-hour day", async () => {
    const zone = "America/New_York"; // clocks went from 2:00 EST to 3:00 EDT on 8 March 2026
    const hours = await reports.apiUsageReport(ID(1), "24h", zone, Date.parse("2026-03-08T12:30:00Z"));
    const starts = hours.buckets.map(bucket => bucket.start);
    expect(new Set(starts).size).toBe(24);
    expect(starts[0]).toBe("2026-03-07T13:00:00.000Z");
    expect(starts.at(-1)).toBe("2026-03-08T12:00:00.000Z");
    expect(starts.every((start, index) => index === 0 || Date.parse(start) - Date.parse(starts[index - 1]) === 3_600_000)).toBe(true);
    expect(starts.map(start => hourIn(start, zone)).slice(16, 20)).toEqual(["00", "01", "03", "04"]);

    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-03-09T03:30:00Z", { cost: 1 }); // 23:30 on 8 March, local
    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-03-09T04:30:00Z", { cost: 2 }); // 00:30 on 9 March, local
    const days = await reports.apiUsageReport(ID(1), "7d", zone, Date.parse("2026-03-10T15:00:00Z"));
    expect(days.buckets.map(bucket => [bucket.start, bucket.costMicros])).toEqual([
      ["2026-03-04T05:00:00.000Z", 0], ["2026-03-05T05:00:00.000Z", 0], ["2026-03-06T05:00:00.000Z", 0], ["2026-03-07T05:00:00.000Z", 0],
      ["2026-03-08T05:00:00.000Z", 1], ["2026-03-09T04:00:00.000Z", 2], ["2026-03-10T04:00:00.000Z", 0],
    ]);
  });

  it("starts hours where the caller's clock does, in a zone half an hour off UTC", async () => {
    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-03-08T11:45:00Z", { cost: 1 }); // 17:15 in Kolkata
    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-03-08T11:15:00Z", { cost: 2 }); // 16:45
    await used(ID(1), KEY(1), "claude-opus-5-5", "2026-03-07T12:29:59Z", { cost: 4 }); // just before the range
    const report = await reports.apiUsageReport(ID(1), "24h", "Asia/Kolkata", Date.parse("2026-03-08T12:00:00Z"));
    expect(report.buckets[0].start).toBe("2026-03-07T12:30:00.000Z");
    expect(report.buckets.slice(-2).map(bucket => [bucket.start, bucket.costMicros])).toEqual([["2026-03-08T10:30:00.000Z", 2], ["2026-03-08T11:30:00.000Z", 1]]);
    expect(report.totals.costMicros).toBe(3);
  });

  it("counts credits used by runs per local day: usage only, each run once in the totals", async () => {
    // Paris is UTC+1 in November: local days start at 23:00 UTC.
    await spent(ID(1), "usage", -2.5, RUN(1), "2026-11-08T22:30:00Z");
    await spent(ID(1), "usage", -1.25, RUN(1), "2026-11-08T23:30:00Z");
    await spent(ID(1), "usage", -4, RUN(2), "2026-11-09T10:00:00Z");
    await spent(ID(1), "usage", -3, null, "2026-11-09T11:00:00Z"); // no run (API use, before it moved to the API balance)
    await spent(ID(1), "promo", 50, null, "2026-11-09T12:00:00Z");
    await spent(ID(1), "grant", 20, null, "2026-11-09T12:00:00Z");
    await spent(ID(1), "usage", -9, RUN(3), "2026-11-02T22:59:59Z"); // the day before the range
    await spent(ID(3), "usage", -7, RUN(4), "2026-11-09T10:00:00Z"); // someone else's
    const report = await reports.creditUsageReport(ID(1), "7d", "Europe/Paris", Date.parse("2026-11-09T14:20:00Z"));
    expect(report).toMatchObject({ range: "7d", bucket: "day", timeZone: "Europe/Paris", allowance: 6000, windowHours: 8 });
    expect(report.buckets.map(bucket => [bucket.start, bucket.credits, bucket.runs])).toEqual([
      ["2026-11-02T23:00:00.000Z", 0, 0], ["2026-11-03T23:00:00.000Z", 0, 0], ["2026-11-04T23:00:00.000Z", 0, 0], ["2026-11-05T23:00:00.000Z", 0, 0],
      ["2026-11-06T23:00:00.000Z", 0, 0], ["2026-11-07T23:00:00.000Z", 2.5, 1], ["2026-11-08T23:00:00.000Z", 8.25, 2],
    ]);
    expect(report.totals).toEqual({ credits: 10.75, runs: 2 });
  });

  it("never sent a statement to the real schema", () => {
    expect(sql.statements.length).toBeGreaterThan(0);
    expect(sql.statements.some(text => /\bcurialy\./i.test(text))).toBe(false);
  });
});
