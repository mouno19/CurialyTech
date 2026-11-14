import type { UsageRange } from "@shared/billing";
import type { CountRow, PlanBucket, TrafficReport, UsageAnalytics } from "@shared/analytics";
import { query } from "../db/pg";
import { knownPlans } from "../billing/settings";
import { bucketPlan, bucketSql, inZone } from "../billing/reports";
import { countryName } from "./geo";

// The operator's Analytics page: page views (who visits, when, from where, what they open) and use
// (tokens, credits and an estimate at list prices, for the agent and the Developer API, by model,
// account and plan). Buckets are hours or days in the viewer's time zone, the range ending now. The
// operator's own browsing is left out of the traffic; its model use is in the usage (never charged).

const TOP = 12;
const num = (value: unknown) => Number(value ?? 0) || 0;

type DimRow = { dim: string; key: string | null; n: string; visitors: string };

const LABELS: Record<string, (key: string) => string> = {
  country: key => (key === "?" ? "Unknown" : countryName(key)),
  source: key => (key === "direct" ? "Direct (no referrer)" : key.startsWith("ref:") ? `Referral code ${key.slice(4)}` : key),
  language: key => (key === "?" ? "Unknown" : key),
};

export async function trafficReport(range: UsageRange, tz: string, now = Date.now()): Promise<TrafficReport> {
  const plan = bucketPlan(range);
  const sql = bucketSql(plan.bucket, "v.at");
  const params = (zone: string) => [false, zone, plan.count, new Date(now)];
  const scope = `FROM curialy.page_views v, span WHERE v.at >= span.first AND v.at < span.last AND (NOT v.operator OR $1::boolean)`;
  const [timeZone, [buckets, totals, dims, recent]] = await inZone(tz, zone => Promise.all([
    query<{ start: Date; signed_in: string; anonymous: string; visitors: string }>(
      `WITH ${sql.series}, v AS (SELECT ${sql.of} AS bucket, v.user_id, v.visitor ${scope})
       SELECT s.start, count(v.bucket) FILTER (WHERE v.user_id IS NOT NULL) AS signed_in, count(v.bucket) FILTER (WHERE v.user_id IS NULL) AS anonymous, count(DISTINCT v.visitor) AS visitors
       FROM series s LEFT JOIN v ON v.bucket = s.start GROUP BY s.start ORDER BY s.start`, params(zone)),
    query<{ views: string; visits: string; visitors: string; new_visitors: string; accounts: string; avg_ms: string | null; signups: string }>(
      `WITH ${sql.series}
       SELECT count(*) AS views, count(*) FILTER (WHERE v.entry) AS visits, count(DISTINCT v.visitor) AS visitors,
              count(*) FILTER (WHERE v.entry AND NOT v.repeat_visitor) AS new_visitors, count(DISTINCT v.user_id) AS accounts,
              avg(v.duration_ms) FILTER (WHERE v.duration_ms BETWEEN 1000 AND 1800000) AS avg_ms,
              (SELECT count(*) FROM curialy.users u, span WHERE u.created_at >= span.first AND u.created_at < span.last) AS signups
       ${scope}`, params(zone)),
    query<DimRow>(
      `WITH ${sql.series}, v AS (SELECT v.* ${scope})
       SELECT 'page' AS dim, page AS key, count(*) AS n, count(DISTINCT visitor) AS visitors FROM v GROUP BY page
       UNION ALL SELECT 'source', coalesce(source, 'direct'), count(*), count(DISTINCT visitor) FROM v WHERE entry GROUP BY 2
       UNION ALL SELECT 'country', coalesce(country, '?'), count(*), count(DISTINCT visitor) FROM v WHERE entry GROUP BY 2
       UNION ALL SELECT 'device', coalesce(device, 'Other'), count(*), count(DISTINCT visitor) FROM v WHERE entry GROUP BY 2
       UNION ALL SELECT 'browser', coalesce(browser, 'Other'), count(*), count(DISTINCT visitor) FROM v WHERE entry GROUP BY 2
       UNION ALL SELECT 'os', coalesce(os, 'Other'), count(*), count(DISTINCT visitor) FROM v WHERE entry GROUP BY 2
       UNION ALL SELECT 'language', coalesce(lower(split_part(language, '-', 1)), '?'), count(*), count(DISTINCT visitor) FROM v WHERE entry GROUP BY 2`, params(zone)),
    query<{ at: Date; page: string; source: string | null; country: string | null; device: string | null; browser: string | null; account: string | null; duration_ms: number | null; entry: boolean }>(
      `WITH ${sql.series}
       SELECT v.at, v.page, v.source, v.country, v.device, v.browser, coalesce(u.display_name, u.login, u.handle) AS account, v.duration_ms, v.entry
       FROM curialy.page_views v LEFT JOIN curialy.users u ON u.id = v.user_id, span
       WHERE v.at >= span.first AND v.at < span.last AND (NOT v.operator OR $1::boolean) ORDER BY v.at DESC LIMIT 40`, params(zone)),
  ]));
  const top = (dim: string): CountRow[] => dims.rows.filter(row => row.dim === dim)
    .map(row => ({ key: row.key ?? "?", label: (LABELS[dim] ?? (key => key))(row.key ?? "?"), views: num(row.n), visitors: num(row.visitors) }))
    .sort((a, b) => b.views - a.views || a.label.localeCompare(b.label)).slice(0, TOP);
  const total = totals.rows[0];
  return {
    range, timeZone, bucket: plan.bucket,
    totals: {
      visits: num(total?.visits), visitors: num(total?.visitors), newVisitors: num(total?.new_visitors), views: num(total?.views),
      accounts: num(total?.accounts), signups: num(total?.signups), avgDurationMs: total?.avg_ms === null || total?.avg_ms === undefined ? null : Math.round(num(total.avg_ms)),
    },
    buckets: buckets.rows.map(row => ({ start: row.start.toISOString(), signedIn: num(row.signed_in), anonymous: num(row.anonymous), visitors: num(row.visitors) })),
    pages: top("page"), sources: top("source"), countries: top("country"), devices: top("device"), browsers: top("browser"), systems: top("os"), languages: top("language"),
    recent: recent.rows.map(row => ({
      at: row.at.toISOString(), page: row.page, source: row.source ? (LABELS.source(row.source)) : null, country: row.country ? countryName(row.country) : null,
      device: row.device, browser: row.browser, account: row.account, durationMs: row.duration_ms, entry: row.entry,
    })),
  };
}

/** The usage of a plan bucket by name: a plan's own name, "Free", or the operator's own use. */
function planName(plan: PlanBucket) {
  if (plan === "free") return "Free (no plan)";
  if (plan === "operator") return "Operator (not charged)";
  return knownPlans()[plan as keyof ReturnType<typeof knownPlans>]?.name ?? plan;
}

export async function usageAnalytics(range: UsageRange, tz: string, now = Date.now()): Promise<UsageAnalytics> {
  const plan = bucketPlan(range);
  const agent = bucketSql(plan.bucket, "a.at");
  const api = bucketSql(plan.bucket, "u.created_at");
  const params = (zone: string) => [0, zone, plan.count, new Date(now)];
  // $1 is unused by the queries but typed, so every statement takes the same four parameters.
  const tokens = (alias: string) => `(${alias}.input_tokens + ${alias}.output_tokens + ${alias}.cache_read_tokens + ${alias}.cache_write_tokens)`;
  const agentRows = `SELECT ${agent.of} AS bucket, a.*, ${tokens("a")} AS tokens FROM curialy.agent_usage a, span WHERE a.at >= span.first AND a.at < span.last AND $1::int = 0`;
  const apiRows = `SELECT ${api.of} AS bucket, u.*, ${tokens("u")} AS tokens, (us.role = 'admin') AS operator FROM curialy.api_usage u JOIN curialy.users us ON us.id = u.user_id, span WHERE u.created_at >= span.first AND u.created_at < span.last AND $1::int = 0`;
  const [timeZone, [buckets, totals, models, accounts, plans, revenue]] = await inZone(tz, zone => Promise.all([
    query<{ start: Date; agent_tokens: string | null; api_tokens: string | null; credits: string | null; list: string | null; active: string | null }>(
      `WITH ${agent.series}, a AS (${agentRows}), p AS (${apiRows}),
         ag AS (SELECT bucket, sum(tokens) AS tokens, sum(credits) AS credits, sum(coalesce(list_micros, 0)) AS list FROM a GROUP BY 1),
         pg AS (SELECT bucket, sum(tokens) AS tokens, sum(list_micros) AS list FROM p GROUP BY 1),
         act AS (SELECT bucket, count(DISTINCT user_id) AS n FROM (SELECT bucket, user_id FROM a WHERE NOT operator UNION SELECT bucket, user_id FROM p WHERE NOT operator) x GROUP BY 1)
       SELECT s.start, ag.tokens AS agent_tokens, pg.tokens AS api_tokens, ag.credits, coalesce(ag.list, 0) + coalesce(pg.list, 0) AS list, act.n AS active
       FROM series s LEFT JOIN ag ON ag.bucket = s.start LEFT JOIN pg ON pg.bucket = s.start LEFT JOIN act ON act.bucket = s.start ORDER BY s.start`, params(zone)),
    query<Record<string, string | null>>(
      `WITH ${agent.series}, a AS (${agentRows}), p AS (${apiRows})
       SELECT (SELECT count(*) FROM a) AS turns, (SELECT sum(input_tokens) FROM a) AS input, (SELECT sum(output_tokens) FROM a) AS output,
              (SELECT sum(cache_read_tokens) FROM a) AS cache_read, (SELECT sum(cache_write_tokens) FROM a) AS cache_write,
              (SELECT sum(credits) FROM a) AS credits, (SELECT sum(list_micros) FROM a) AS list, (SELECT sum(tokens) FROM a WHERE list_micros IS NULL) AS unpriced,
              (SELECT count(*) FROM p) AS api_requests, (SELECT sum(input_tokens) FROM p) AS api_input, (SELECT sum(output_tokens) FROM p) AS api_output,
              (SELECT sum(cache_read_tokens) FROM p) AS api_cache_read, (SELECT sum(cache_write_tokens) FROM p) AS api_cache_write,
              (SELECT sum(list_micros) FROM p) AS api_list, (SELECT sum(cost_micros) FROM p) AS api_charged,
              (SELECT count(DISTINCT user_id) FROM (SELECT user_id FROM a WHERE NOT operator UNION SELECT user_id FROM p WHERE NOT operator) x) AS active`, params(zone)),
    query<{ source: "agent" | "api"; model: string; turns: string; tokens: string; list: string | null }>(
      `WITH ${agent.series}, a AS (${agentRows}), p AS (${apiRows})
       SELECT 'agent' AS source, model, count(*) AS turns, sum(tokens) AS tokens, sum(list_micros) AS list FROM a GROUP BY model
       UNION ALL SELECT 'api', model, count(*), sum(tokens), sum(list_micros) FROM p GROUP BY model`, params(zone)),
    query<{ user_id: string; name: string | null; role: string; plan_id: string | null; plan_expires_at: Date | null; turns: string; tokens: string; credits: string; list: string }>(
      `WITH ${agent.series}, a AS (${agentRows}), p AS (${apiRows}),
         x AS (SELECT user_id, count(*) AS turns, sum(tokens) AS tokens, sum(credits) AS credits, sum(coalesce(list_micros, 0)) AS list FROM a WHERE user_id IS NOT NULL GROUP BY 1
               UNION ALL SELECT user_id, count(*), sum(tokens), 0, sum(list_micros) FROM p GROUP BY 1)
       SELECT x.user_id, coalesce(us.display_name, us.login, us.handle) AS name, us.role, us.plan_id, us.plan_expires_at,
              sum(x.turns) AS turns, sum(x.tokens) AS tokens, sum(x.credits) AS credits, sum(x.list) AS list
       FROM x JOIN curialy.users us ON us.id = x.user_id GROUP BY 1, 2, 3, 4, 5 ORDER BY sum(x.list) DESC, sum(x.tokens) DESC LIMIT 25`, params(zone)),
    query<{ plan: string; accounts: string; turns: string; tokens: string; credits: string; list: string }>(
      `WITH ${agent.series}, a AS (${agentRows})
       SELECT CASE WHEN operator THEN 'operator' WHEN plan_id IS NULL THEN 'free' ELSE plan_id END AS plan,
              count(DISTINCT user_id) AS accounts, count(*) AS turns, sum(tokens) AS tokens, sum(credits) AS credits, sum(coalesce(list_micros, 0)) AS list
       FROM a GROUP BY 1`, params(zone)),
    query<{ plan_id: string; usd: string }>(
      `WITH ${agent.series}
       SELECT o.plan_id, sum(o.price_usd) AS usd FROM curialy.payment_orders o, span
       WHERE o.kind = 'plan' AND o.status = 'completed' AND o.completed_at >= span.first AND o.completed_at < span.last AND $1::int = 0 GROUP BY 1`, params(zone)),
  ]));
  const t = totals.rows[0] ?? {};
  const revenueBy = new Map(revenue.rows.map(row => [row.plan_id, num(row.usd)]));
  const planRows = new Map(plans.rows.map(row => [row.plan, row]));
  // Every plan that had use or revenue, then free and the operator.
  const order = [...new Set([...Object.keys(knownPlans()), ...planRows.keys(), ...revenueBy.keys()])].filter(key => key !== "free" && key !== "operator");
  return {
    range, timeZone, bucket: plan.bucket,
    totals: {
      activeAccounts: num(t.active), turns: num(t.turns), inputTokens: num(t.input), outputTokens: num(t.output), cacheReadTokens: num(t.cache_read), cacheWriteTokens: num(t.cache_write),
      credits: Math.round(num(t.credits) * 100) / 100, listMicros: num(t.list), unpricedTokens: num(t.unpriced),
      api: { requests: num(t.api_requests), inputTokens: num(t.api_input), outputTokens: num(t.api_output), cacheReadTokens: num(t.api_cache_read), cacheWriteTokens: num(t.api_cache_write), listMicros: num(t.api_list), chargedMicros: num(t.api_charged) },
      planRevenueUsd: [...revenueBy.values()].reduce((sum, value) => sum + value, 0),
    },
    buckets: buckets.rows.map(row => ({ start: row.start.toISOString(), agentTokens: num(row.agent_tokens), apiTokens: num(row.api_tokens), credits: Math.round(num(row.credits) * 100) / 100, listMicros: num(row.list), activeAccounts: num(row.active) })),
    models: models.rows.map(row => ({ model: row.model, source: row.source, turns: num(row.turns), tokens: num(row.tokens), listMicros: row.list === null ? null : num(row.list) }))
      .sort((a, b) => (b.listMicros ?? -1) - (a.listMicros ?? -1) || b.tokens - a.tokens),
    accounts: accounts.rows.map(row => ({
      userId: row.user_id, name: row.name ?? "(no name)",
      plan: row.role === "admin" ? "operator" : row.plan_id && row.plan_expires_at && row.plan_expires_at.getTime() > now ? row.plan_id : "free",
      turns: num(row.turns), tokens: num(row.tokens), credits: Math.round(num(row.credits) * 100) / 100, listMicros: num(row.list),
    })),
    plans: [...order, "free", "operator"].filter(key => planRows.has(key) || revenueBy.has(key)).map(key => {
      const row = planRows.get(key);
      return { plan: key, name: planName(key), accounts: num(row?.accounts), turns: num(row?.turns), tokens: num(row?.tokens), credits: Math.round(num(row?.credits) * 100) / 100, listMicros: num(row?.list), revenueUsd: revenueBy.get(key) ?? 0 };
    }),
  };
}
