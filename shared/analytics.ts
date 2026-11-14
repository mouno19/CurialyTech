import type { UsageRange } from "./billing";

// The operator's Analytics page: who visits the site (when, from where, what they open) and how
// much the agent and the Developer API use (tokens, credits, an estimate of the cost at list prices).

/** A page view as the browser reports it (POST /api/analytics/hit). */
export type PageHit = {
  /** Random, made by the browser for this view: its time on the page is reported against it. */
  viewId: string;
  path: string;
  /** The first page of a page load (a visit): only then do referrer and campaign count. */
  entry: boolean;
  referrer?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** A referral code (?ref=). */
  ref?: string | null;
  /** The browser's time zone (the country is read from it; no IP address is kept). */
  timeZone?: string;
  language?: string;
  /** This browser has visited before (remembered in its own storage). */
  returning?: boolean;
  width?: number;
};

/** One row of a "top" list. */
export type CountRow = { key: string; label: string; views: number; visitors: number };

export type TrafficReport = {
  range: UsageRange;
  timeZone: string;
  bucket: "hour" | "day";
  totals: {
    /** Page loads (the first page of each). */
    visits: number;
    /** Unique visitors per day, added up (a visitor is unknown from one day to the next). */
    visitors: number;
    /** Visits from a browser that hadn't been here before. */
    newVisitors: number;
    views: number;
    /** Signed-in accounts that visited. */
    accounts: number;
    /** Accounts created in the range. */
    signups: number;
    avgDurationMs: number | null;
  };
  buckets: { start: string; signedIn: number; anonymous: number; visitors: number }[];
  pages: CountRow[];
  sources: CountRow[];
  countries: CountRow[];
  devices: CountRow[];
  browsers: CountRow[];
  systems: CountRow[];
  languages: CountRow[];
  recent: { at: string; page: string; source: string | null; country: string | null; device: string | null; browser: string | null; account: string | null; durationMs: number | null; entry: boolean }[];
};

export type UsageTotals = { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; credits: number; listMicros: number };

/** free: no plan; operator: the operator's own use (never charged). */
export type PlanBucket = "free" | "operator" | string;

export type UsageAnalytics = {
  range: UsageRange;
  timeZone: string;
  bucket: "hour" | "day";
  totals: UsageTotals & {
    /** Accounts that used the agent or the API in the range. */
    activeAccounts: number;
    /** Tokens of models without a list price (not in the estimate). */
    unpricedTokens: number;
    api: { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; listMicros: number; chargedMicros: number };
    /** Plan orders completed in the range. */
    planRevenueUsd: number;
  };
  buckets: { start: string; agentTokens: number; apiTokens: number; credits: number; listMicros: number; activeAccounts: number }[];
  models: { model: string; source: "agent" | "api"; turns: number; tokens: number; listMicros: number | null }[];
  accounts: { userId: string; name: string; plan: PlanBucket; turns: number; tokens: number; credits: number; listMicros: number }[];
  plans: { plan: PlanBucket; name: string; accounts: number; turns: number; tokens: number; credits: number; listMicros: number; revenueUsd: number }[];
};
