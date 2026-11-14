import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Tabs from "@radix-ui/react-tabs";
import { RotateCcw } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { RankBars, TimeBars, type ChartSeries } from "@/components/charts";
import { usableTimeZone, viewerTimeZone } from "@/components/charts/scale";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { adminApi, errorMessage } from "@/lib/api";
import { formatTokenCount, formatUsd, microsToUsd, USAGE_RANGES, type UsageRange } from "@shared/billing";
import { getModel } from "@shared/agent";
import type { CountRow, TrafficReport, UsageAnalytics } from "@shared/analytics";

// The operator's Analytics: who visits the site (when, from where, what they open) and how much
// the agent and the Developer API are used, with what that costs at the models' list prices, by
// model, account and plan. Charts are the app's own (validated series tones, a tooltip per bar,
// a table behind each), one measure per chart.

const RANGE_LABEL: Record<UsageRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "90d": "90 days" };
const count = (value: number) => Math.round(value).toLocaleString("en-US");
const usd = (micros: number) => formatUsd(microsToUsd(micros));
const usdValue = (value: number) => formatUsd(value);
const tokens = (value: number) => formatTokenCount(Math.round(value));
const credits = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const duration = (ms: number | null) => {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};
const modelLabel = (id: string) => getModel(id)?.label ?? id;

// Accent on slate: the part that matters (signed in) and the rest. Ink with accent: two sources.
const VIEW_SERIES: ChartSeries[] = [{ key: "signedIn", label: "Signed in", tone: "accent" }, { key: "anonymous", label: "Not signed in", tone: "slate" }];
const VISITOR_SERIES: ChartSeries[] = [{ key: "visitors", label: "Visitors", tone: "ink" }];
const TOKEN_SERIES: ChartSeries[] = [{ key: "agent", label: "Agent", tone: "ink" }, { key: "api", label: "Developer API", tone: "accent" }];
const COST_SERIES: ChartSeries[] = [{ key: "cost", label: "Estimated cost", tone: "ink" }];
const CREDIT_SERIES: ChartSeries[] = [{ key: "credits", label: "Credits deducted", tone: "ink" }];
const ACTIVE_SERIES: ChartSeries[] = [{ key: "active", label: "Active accounts", tone: "ink" }];

type Tile = { id: string; label: string; value: string; hint?: string };

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="api-kpis">
      {tiles.map(tile => (
        <div key={tile.id} className="api-kpi">
          <dt>{tile.label}</dt>
          <dd className="api-kpi-value">{tile.value}</dd>
          {tile.hint && <dd className="api-kpi-hint">{tile.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function ChartCard({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section className="card api-chart" data-wide={wide || undefined} aria-labelledby={id}>
      <div className="card-head"><h3 id={id}>{title}</h3>{note && <span className="card-sub">{note}</span>}</div>
      <div className="api-chart-body">{children}</div>
    </section>
  );
}

/** A "top" list as ranked bars, or a note when the range has none. */
function TopList({ title, rows, unit, span }: { title: string; rows: CountRow[]; unit: "views" | "visits"; span: string }) {
  return (
    <ChartCard title={title}>
      {rows.length ? (
        <RankBars items={rows.map(row => ({ key: row.key, label: row.label, value: row.views, detail: `${count(row.visitors)} visitor${row.visitors === 1 ? "" : "s"}` }))} format={value => `${count(value)} ${unit}`} ariaLabel={`${title}, ${span}`} />
      ) : <p className="field-hint">Nothing in the {span}.</p>}
    </ChartCard>
  );
}

function useReport<T>(load: (range: UsageRange, tz: string) => Promise<T>, range: UsageRange, active: boolean) {
  const [state, setState] = useState<{ range: UsageRange; data: T | null; error: string | null; loading: boolean }>({ range, data: null, error: null, loading: false });
  const run = useCallback(() => {
    setState(current => ({ ...current, loading: true, error: null }));
    load(range, viewerTimeZone() ?? "UTC").then(
      data => setState({ range, data, error: null, loading: false }),
      error => setState(current => ({ ...current, loading: false, error: errorMessage(error, "Couldn't load the analytics.") })),
    );
  }, [load, range]);
  useEffect(() => {
    if (active) run();
  }, [active, run]);
  return { ...state, retry: run };
}

function Traffic({ report }: { report: TrafficReport }) {
  const span = `last ${RANGE_LABEL[report.range]}`;
  const unit = report.bucket === "hour" ? "hour" : "day";
  const { totals } = report;
  const tiles: Tile[] = [
    { id: "visits", label: "Visits", value: count(totals.visits), hint: "Page loads" },
    { id: "visitors", label: "Visitors", value: count(totals.visitors), hint: "Unique per day, added up" },
    { id: "new", label: "New visitors", value: count(totals.newVisitors), hint: "First visit from that browser" },
    { id: "views", label: "Page views", value: count(totals.views), hint: totals.visits ? `${(totals.views / totals.visits).toFixed(1)} per visit` : undefined },
    { id: "time", label: "Time on a page", value: duration(totals.avgDurationMs), hint: "Average while visible" },
    { id: "signups", label: "Sign-ups", value: count(totals.signups), hint: `${count(totals.accounts)} signed-in account${totals.accounts === 1 ? "" : "s"} visited` },
  ];
  if (totals.views === 0) {
    return (
      <>
        <Tiles tiles={tiles} />
        <div className="card"><StateNotice variant="empty" title={`No visits in the ${span}`}>Page views show up here as people open the site (your own browsing isn't counted).</StateNotice></div>
      </>
    );
  }
  return (
    <>
      <Tiles tiles={tiles} />
      <div className="api-charts">
        <ChartCard wide title={`Page views per ${unit}`}>
          <TimeBars data={report.buckets.map(bucket => ({ start: bucket.start, values: { signedIn: bucket.signedIn, anonymous: bucket.anonymous } }))} series={VIEW_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={count} ariaLabel={`Page views per ${unit}, ${span}`} height={200} />
        </ChartCard>
        <ChartCard title={`Visitors per ${unit}`}>
          <TimeBars data={report.buckets.map(bucket => ({ start: bucket.start, values: { visitors: bucket.visitors } }))} series={VISITOR_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={count} ariaLabel={`Visitors per ${unit}, ${span}`} />
        </ChartCard>
        <TopList title="Pages" rows={report.pages} unit="views" span={span} />
        <TopList title="Where visits come from" rows={report.sources} unit="visits" span={span} />
        <TopList title="Countries" rows={report.countries} unit="visits" span={span} />
        <TopList title="Devices" rows={report.devices} unit="visits" span={span} />
        <TopList title="Browsers" rows={report.browsers} unit="visits" span={span} />
        <TopList title="Systems" rows={report.systems} unit="visits" span={span} />
        <TopList title="Languages" rows={report.languages} unit="visits" span={span} />
      </div>
      <section className="card analytics-table-card" aria-labelledby="analytics-recent">
        <div className="card-head"><h3 id="analytics-recent">Latest page views</h3><span className="card-sub">Countries come from the browser's time zone</span></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="analytics-recent">
          <table className="data-table">
            <thead><tr><th scope="col">When</th><th scope="col">Page</th><th scope="col">From</th><th scope="col">Country</th><th scope="col">Device</th><th scope="col">Account</th><th scope="col" className="api-num">Time</th></tr></thead>
            <tbody>
              {report.recent.map((row, index) => (
                <tr key={`${row.at}-${index}`}>
                  <td className="mono">{new Date(row.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="mono">{row.page}</td>
                  <td>{row.entry ? row.source ?? "Direct" : <span className="field-hint">same visit</span>}</td>
                  <td>{row.country ?? "—"}</td>
                  <td>{[row.device, row.browser].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{row.account ?? "—"}</td>
                  <td className="api-num mono">{duration(row.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Usage({ report }: { report: UsageAnalytics }) {
  const span = `last ${RANGE_LABEL[report.range]}`;
  const unit = report.bucket === "hour" ? "hour" : "day";
  const { totals } = report;
  const agentTokens = totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const apiTokens = totals.api.inputTokens + totals.api.outputTokens + totals.api.cacheReadTokens + totals.api.cacheWriteTokens;
  const cost = totals.listMicros + totals.api.listMicros;
  const tiles: Tile[] = [
    { id: "active", label: "Active accounts", value: count(totals.activeAccounts), hint: "Used the agent or the API (yours not counted)" },
    { id: "turns", label: "Model turns", value: count(totals.turns), hint: `${count(totals.api.requests)} API request${totals.api.requests === 1 ? "" : "s"}` },
    { id: "tokens", label: "Tokens", value: tokens(agentTokens + apiTokens), hint: `${tokens(totals.inputTokens + totals.api.inputTokens)} in · ${tokens(totals.outputTokens + totals.api.outputTokens)} out` },
    { id: "credits", label: "Credits deducted", value: credits(totals.credits), hint: "Charged to accounts for agent runs" },
    { id: "cost", label: "Estimated cost", value: usd(cost), hint: "At the models' list prices" },
    { id: "revenue", label: "Plan revenue", value: usdValue(totals.planRevenueUsd), hint: `API charged ${usd(totals.api.chargedMicros)}` },
  ];
  if (totals.turns === 0 && totals.api.requests === 0) {
    return (
      <>
        <Tiles tiles={tiles} />
        <div className="card"><StateNotice variant="empty" title={`No model use in the ${span}`}>Agent runs and API requests show up here as they happen.</StateNotice></div>
      </>
    );
  }
  const planRows = report.plans;
  return (
    <>
      <Tiles tiles={tiles} />
      {totals.unpricedTokens > 0 && <p className="field-hint">{tokens(totals.unpricedTokens)} tokens of models without a list price aren't in the estimate.</p>}
      <div className="api-charts">
        <ChartCard wide title={`Estimated cost per ${unit}`} note="Tokens times each model's list price">
          <TimeBars data={report.buckets.map(bucket => ({ start: bucket.start, values: { cost: microsToUsd(bucket.listMicros) } }))} series={COST_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={usdValue} ariaLabel={`Estimated cost per ${unit}, ${span}`} height={200} />
        </ChartCard>
        <ChartCard title={`Tokens per ${unit}`}>
          <TimeBars data={report.buckets.map(bucket => ({ start: bucket.start, values: { agent: bucket.agentTokens, api: bucket.apiTokens } }))} series={TOKEN_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={tokens} ariaLabel={`Tokens per ${unit}, ${span}`} />
        </ChartCard>
        <ChartCard title={`Credits deducted per ${unit}`}>
          <TimeBars data={report.buckets.map(bucket => ({ start: bucket.start, values: { credits: bucket.credits } }))} series={CREDIT_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={credits} ariaLabel={`Credits deducted per ${unit}, ${span}`} />
        </ChartCard>
        <ChartCard title={`Active accounts per ${unit}`}>
          <TimeBars data={report.buckets.map(bucket => ({ start: bucket.start, values: { active: bucket.activeAccounts } }))} series={ACTIVE_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={count} ariaLabel={`Active accounts per ${unit}, ${span}`} />
        </ChartCard>
        <ChartCard title="Estimated cost by model">
          <RankBars
            items={report.models.filter(model => model.listMicros !== null).map(model => ({ key: `${model.source}:${model.model}`, label: `${modelLabel(model.model)}${model.source === "api" ? " (API)" : ""}`, value: microsToUsd(model.listMicros ?? 0), detail: `${tokens(model.tokens)} tokens · ${count(model.turns)} ${model.source === "api" ? "requests" : "turns"}` }))}
            format={usdValue}
            ariaLabel={`Estimated cost by model, ${span}`}
          />
        </ChartCard>
      </div>
      <section className="card analytics-table-card" aria-labelledby="analytics-plans">
        <div className="card-head"><h3 id="analytics-plans">Agent use by plan</h3><span className="card-sub">Each turn counts under the plan its account had then</span></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="analytics-plans">
          <table className="data-table">
            <thead><tr><th scope="col">Plan</th><th scope="col" className="api-num">Accounts</th><th scope="col" className="api-num">Turns</th><th scope="col" className="api-num">Tokens</th><th scope="col" className="api-num">Credits deducted</th><th scope="col" className="api-num">Estimated cost</th><th scope="col" className="api-num">Revenue</th><th scope="col" className="api-num">Revenue − cost</th></tr></thead>
            <tbody>
              {planRows.map(row => {
                const paid = row.plan !== "free" && row.plan !== "operator";
                const margin = row.revenueUsd - microsToUsd(row.listMicros);
                return (
                  <tr key={row.plan}>
                    <th scope="row">{row.name}</th>
                    <td className="api-num">{count(row.accounts)}</td>
                    <td className="api-num">{count(row.turns)}</td>
                    <td className="api-num">{tokens(row.tokens)}</td>
                    <td className="api-num">{credits(row.credits)}</td>
                    <td className="api-num">{usd(row.listMicros)}</td>
                    <td className="api-num">{paid ? usdValue(row.revenueUsd) : "—"}</td>
                    <td className="api-num" data-tone={paid ? (margin < 0 ? "danger" : "success") : undefined}>{paid ? `${margin < 0 ? "−" : ""}${usdValue(Math.abs(margin))}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card analytics-table-card" aria-labelledby="analytics-accounts">
        <div className="card-head"><h3 id="analytics-accounts">Accounts using the most</h3><span className="card-sub">By estimated cost</span></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="analytics-accounts">
          <table className="data-table">
            <thead><tr><th scope="col">Account</th><th scope="col">Plan now</th><th scope="col" className="api-num">Turns and requests</th><th scope="col" className="api-num">Tokens</th><th scope="col" className="api-num">Credits deducted</th><th scope="col" className="api-num">Estimated cost</th></tr></thead>
            <tbody>
              {report.accounts.map(row => (
                <tr key={row.userId}>
                  <th scope="row">{row.name}</th>
                  <td>{report.plans.find(plan => plan.plan === row.plan)?.name ?? (row.plan === "free" ? "Free (no plan)" : row.plan === "operator" ? "Operator" : row.plan)}</td>
                  <td className="api-num">{count(row.turns)}</td>
                  <td className="api-num">{tokens(row.tokens)}</td>
                  <td className="api-num">{credits(row.credits)}</td>
                  <td className="api-num">{usd(row.listMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="field-hint">Estimated cost: each turn's input, output and cached tokens at its model's list price (what the same tokens would cost on the model provider's public API). Credits are what accounts were charged; the operator's own use is never charged.</p>
    </>
  );
}

export default function Analytics() {
  const [tab, setTab] = useState<"traffic" | "usage">("traffic");
  const [range, setRange] = useState<UsageRange>("7d");
  const traffic = useReport(adminApi.analyticsTraffic, range, tab === "traffic");
  const usage = useReport(adminApi.analyticsUsage, range, tab === "usage");
  const current = tab === "traffic" ? traffic : usage;
  const zone = usableTimeZone(current.data && "timeZone" in current.data ? current.data.timeZone : null);
  const viewer = viewerTimeZone();
  const body = (state: typeof traffic | typeof usage, render: () => ReactNode, what: string) => {
    if (state.data && state.range === range) return render();
    if (state.error) return <div className="card"><StateNotice variant="error" title={`Couldn't load the ${what}`} actions={<Button variant="primary" icon={RotateCcw} onClick={state.retry}>Try again</Button>}>{state.error}</StateNotice></div>;
    return <StateNotice variant="loading" size="sm" title={`Loading the ${what}…`} />;
  };
  return (
    <AppShell title="Analytics">
      <div className="page">
        <div className="page-wide">
          <header className="page-head">
            <div>
              <span className="eyebrow">Operator</span>
              <h2 className="page-title">Analytics</h2>
              <p className="page-sub">Who visits the site, when, from where and what they open, and how much the agent and the Developer API are used, with what those tokens cost at the models' list prices. Visits are counted without cookies or stored IP addresses; your own browsing isn't counted.</p>
            </div>
          </header>
          <Tabs.Root value={tab} onValueChange={value => setTab(value as "traffic" | "usage")} className="analytics">
            <div className="api-usage-head">
              <Tabs.List className="tabs" aria-label="Analytics">
                <Tabs.Trigger value="traffic" className="tab">Visitors</Tabs.Trigger>
                <Tabs.Trigger value="usage" className="tab">Usage and cost</Tabs.Trigger>
              </Tabs.List>
              <div className="api-usage-tools">
                {current.loading && current.data && <span className="api-updating"><Spinner size={13} />Updating…</span>}
                <RadioGroup.Root className="segmented" aria-label="Range" value={range} onValueChange={value => setRange(value as UsageRange)} orientation="horizontal" loop>
                  {USAGE_RANGES.map(value => <RadioGroup.Item key={value} value={value}>{RANGE_LABEL[value]}</RadioGroup.Item>)}
                </RadioGroup.Root>
              </div>
            </div>
            {zone && zone !== viewer && <p className="field-hint">Times on these charts are in {zone}.</p>}
            <Tabs.Content value="traffic" className="analytics-body">{body(traffic, () => <Traffic report={traffic.data!} />, "visitors")}</Tabs.Content>
            <Tabs.Content value="usage" className="analytics-body">{body(usage, () => <Usage report={usage.data!} />, "usage")}</Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </AppShell>
  );
}
