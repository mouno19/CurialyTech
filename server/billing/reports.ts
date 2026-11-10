import type { ApiUsageReport, ApiUsageTotals, CreditUsageReport, UsageRange } from "@shared/billing";
import { getBalance } from "../credits";
import { query } from "../db/pg";

// Usage over time: the Developer API page (requests, tokens and spend, by model and by key) and
// Plans & Billing (credits used by runs). Buckets are hours or days in the caller's time zone, every
// bucket of the range listed (empty ones as zeros), oldest first.

let schema = "curialy";
/** Tests point the report SQL at temporary tables; production never calls this. */
export function useSchemaForTests(name: string) {
  schema = name;
}
const t = (table: string) => `${schema}.${table}`;

export type BucketPlan = { bucket: "hour" | "day"; count: number };

/** 24h: the last 24 hours, the current one last. 7d, 30d, 90d: that many days, today last. */
export function bucketPlan(range: UsageRange): BucketPlan {
  switch (range) {
    case "24h": return { bucket: "hour", count: 24 };
    case "7d": return { bucket: "day", count: 7 };
    case "30d": return { bucket: "day", count: 30 };
    case "90d": return { bucket: "day", count: 90 };
  }
  throw new Error(`Unknown usage range: ${String(range)}`);
}

/**
 * The zone a report is made in: an IANA name that Intl knows ("Europe/Paris"), else UTC. Raw
 * offsets such as "+05:30" are refused: the database reads those POSIX-style, east and west swapped.
 */
export function reportTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z][\w+-]*(?:\/[\w+-]+)*$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * The range's buckets (start, stop) as SQL, and the bucket a row's `column` falls in. Parameters:
 * $2 the time zone, $3 how many buckets, $4 now. Days are local calendar days (23 or 25 hours when
 * the clock changes). Hours step in absolute time from the start of the current local hour, so a
 * day the clock changes has no doubled or missing hour.
 */
function bucketSql(bucket: "hour" | "day", column: string) {
  const clock = "clock AS (SELECT $4::timestamptz AS now, $4::timestamptz AT TIME ZONE $2 AS local)";
  if (bucket === "hour") {
    const current = "clock.now - (clock.local - date_trunc('hour', clock.local))";
    return {
      series: `${clock}, series AS (
        SELECT h AS start, h + interval '1 hour' AS stop
        FROM clock, generate_series(${current} - ($3::int - 1) * interval '1 hour', ${current}, interval '1 hour') AS h
      ), span AS (SELECT min(start) AS first, max(stop) AS last FROM series)`,
      of: `date_bin(interval '1 hour', ${column}, span.first)`,
    };
  }
  return {
    series: `${clock}, series AS (
      SELECT d AT TIME ZONE $2 AS start, (d + interval '1 day') AT TIME ZONE $2 AS stop
      FROM clock, generate_series(date_trunc('day', clock.local) - ($3::int - 1) * interval '1 day', date_trunc('day', clock.local), interval '1 day') AS d
    ), span AS (SELECT min(start) AS first, max(stop) AS last FROM series)`,
    of: `date_trunc('day', ${column} AT TIME ZONE $2) AT TIME ZONE $2`,
  };
}

/** The database's zone list can lag the browser's: a zone it doesn't know is reported in UTC instead. */
const unknownZone = (error: unknown) => (error as { code?: string })?.code === "22023" && /time zone/i.test(String((error as Error)?.message));

async function inZone<T>(tz: string, run: (zone: string) => Promise<T>): Promise<[string, T]> {
  const zone = reportTimeZone(tz);
  try {
    return [zone, await run(zone)];
  } catch (error) {
    if (zone === "UTC" || !unknownZone(error)) throw error;
    return ["UTC", await run("UTC")];
  }
}

type UsageRow = {
  start: Date; model: string | null; key_id: string | null; key_name: string | null; key_prefix: string | null; requests: string | null;
  input_tokens: string | null; output_tokens: string | null; cache_read_tokens: string | null; cache_write_tokens: string | null;
  cost_micros: string | null; list_micros: string | null;
};

const zero = (): ApiUsageTotals => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0, listMicros: 0 });

function add(into: ApiUsageTotals, row: UsageRow) {
  into.requests += Number(row.requests);
  into.inputTokens += Number(row.input_tokens);
  into.outputTokens += Number(row.output_tokens);
  into.cacheReadTokens += Number(row.cache_read_tokens);
  into.cacheWriteTokens += Number(row.cache_write_tokens);
  into.costMicros += Number(row.cost_micros);
  into.listMicros += Number(row.list_micros);
}

/** Most spent first (at list price for the operator, who pays nothing), then most used. */
const bySpend = (a: ApiUsageTotals, b: ApiUsageTotals) => b.costMicros - a.costMicros || b.listMicros - a.listMicros || b.requests - a.requests;

/** API requests, tokens and spend per bucket, by model and by key, for the range ending now. */
export async function apiUsageReport(userId: string, range: UsageRange, tz: string, now = Date.now()): Promise<ApiUsageReport> {
  const plan = bucketPlan(range);
  const sql = bucketSql(plan.bucket, "u.created_at");
  const [timeZone, rows] = await inZone(tz, async zone => (await query<UsageRow>(
    `WITH ${sql.series},
     usage AS (
       SELECT ${sql.of} AS bucket, u.model, u.key_id, count(*) AS requests,
              sum(u.input_tokens) AS input_tokens, sum(u.output_tokens) AS output_tokens,
              sum(u.cache_read_tokens) AS cache_read_tokens, sum(u.cache_write_tokens) AS cache_write_tokens,
              sum(u.cost_micros) AS cost_micros, sum(u.list_micros) AS list_micros
       FROM ${t("api_usage")} u, span
       WHERE u.user_id = $1 AND u.created_at >= span.first AND u.created_at < span.last
       GROUP BY 1, 2, 3
     )
     SELECT s.start, g.model, g.key_id, k.name AS key_name, k.key_prefix, g.requests, g.input_tokens, g.output_tokens,
            g.cache_read_tokens, g.cache_write_tokens, g.cost_micros, g.list_micros
     FROM series s
     LEFT JOIN usage g ON g.bucket = s.start
     LEFT JOIN ${t("api_keys")} k ON k.id = g.key_id AND k.user_id = $1
     ORDER BY s.start, g.model, g.key_id`,
    [userId, zone, plan.count, new Date(now)],
  )).rows);
  const buckets = new Map<string, ApiUsageReport["buckets"][number]>();
  const models = new Map<string, ApiUsageReport["byModel"][number]>();
  const keys = new Map<string | null, ApiUsageReport["byKey"][number]>();
  const totals = zero();
  for (const row of rows) {
    const start = row.start.toISOString();
    let bucket = buckets.get(start);
    if (!bucket) buckets.set(start, (bucket = { start, ...zero() }));
    // A bucket without usage comes back once, with no counts.
    if (row.requests === null || row.model === null) continue;
    let model = models.get(row.model);
    if (!model) models.set(row.model, (model = { model: row.model, ...zero() }));
    let key = keys.get(row.key_id);
    if (!key) keys.set(row.key_id, (key = { keyId: row.key_id, name: row.key_name, prefix: row.key_prefix, ...zero() }));
    for (const into of [bucket, model, key, totals]) add(into, row);
  }
  return {
    range, bucket: plan.bucket, timeZone,
    buckets: [...buckets.values()],
    byModel: [...models.values()].sort((a, b) => bySpend(a, b) || a.model.localeCompare(b.model)),
    byKey: [...keys.values()].sort((a, b) => bySpend(a, b) || String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    totals,
  };
}

type CreditRow = { start: Date; credits: string; runs: string; total_credits: string; total_runs: string };

/** Credits spent per bucket and the runs that spent them (a run spanning buckets counts in each, once in the totals). */
export async function creditUsageReport(userId: string, range: UsageRange, tz: string, now = Date.now()): Promise<CreditUsageReport> {
  const plan = bucketPlan(range);
  const sql = bucketSql(plan.bucket, "e.created_at");
  const [[timeZone, rows], balance] = await Promise.all([
    inZone(tz, async zone => (await query<CreditRow>(
      `WITH ${sql.series},
       used AS (
         SELECT ${sql.of} AS bucket, -e.amount AS credits, e.session_id
         FROM ${t("credit_events")} e, span
         WHERE e.user_id = $1 AND e.kind = 'usage' AND e.created_at >= span.first AND e.created_at < span.last
       ),
       per AS (SELECT bucket, sum(credits) AS credits, count(DISTINCT session_id) AS runs FROM used GROUP BY bucket)
       SELECT s.start, COALESCE(p.credits, 0) AS credits, COALESCE(p.runs, 0) AS runs,
              (SELECT COALESCE(sum(credits), 0) FROM used) AS total_credits, (SELECT count(DISTINCT session_id) FROM used) AS total_runs
       FROM series s
       LEFT JOIN per p ON p.bucket = s.start
       ORDER BY s.start`,
      [userId, zone, plan.count, new Date(now)],
    )).rows),
    getBalance(userId),
  ]);
  return {
    range, bucket: plan.bucket, timeZone,
    buckets: rows.map(row => ({ start: row.start.toISOString(), credits: Number(row.credits), runs: Number(row.runs) })),
    totals: { credits: Number(rows[0]?.total_credits ?? 0), runs: Number(rows[0]?.total_runs ?? 0) },
    allowance: balance.allowance,
    windowHours: balance.windowHours,
  };
}
