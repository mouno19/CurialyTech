import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Tabs from "@radix-ui/react-tabs";
import { BadgePercent, Check, Copy, Info, KeyRound, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { TopUpForm } from "@/components/billing/TopUpForm";
import { RankBars, TimeBars, type ChartSeries } from "@/components/charts";
import { usableTimeZone, viewerTimeZone } from "@/components/charts/scale";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Dialog } from "@/components/common/Dialog";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { developerApi, errorMessage } from "@/lib/api";
import { billingApi } from "@/lib/billing";
import {
  formatPerMillion, formatTokenCount, formatUsd, microsToUsd, USAGE_RANGES,
  type ApiModelPrice, type ApiUsageReport, type ApiUsageTotals, type BillingAccount, type BillingCatalog, type TokenPrices, type UsageRange,
} from "@shared/billing";
import { GATEWAY_BASE_URL, GATEWAY_MODEL_IDS, GATEWAY_MODELS, gatewayModel, type ApiKeyInfo, type GatewayModel } from "@shared/gateway";

// The Developer API page: the API balance (what is available, what running requests hold, adding
// to it), the endpoint, the account's keys (created here, shown once, revoked here), code to copy,
// usage, prices and the errors the API returns. Requests are paid from the API balance at each
// model's price, never from credits. Keys are secrets: after the reveal dialog closes, only a
// prefix remains.

const ORIGIN = GATEWAY_BASE_URL.replace(/\/v1$/, "");

/** Claude answers on both endpoints; GPT, Grok, Kimi and GLM speak the OpenAI format only. */
const MODEL_GROUPS: { id: string; format: GatewayModel["format"]; title: string; note: string; models: GatewayModel[] }[] = [
  { id: "claude", format: "anthropic", title: "Claude", note: "/v1/messages and /v1/chat/completions", models: GATEWAY_MODELS.filter(model => model.format === "anthropic") },
  { id: "openai", format: "openai", title: "GPT, Grok, Kimi and GLM", note: "/v1/chat/completions", models: GATEWAY_MODELS.filter(model => model.format === "openai") },
];

function modelSummary(ids: string[]) {
  if (ids.length >= GATEWAY_MODELS.length) return [`All ${GATEWAY_MODELS.length} models`];
  return ids.length > 3 ? [...ids.slice(0, 3), `+${ids.length - 3} more`] : ids;
}

const SAMPLES = [
  {
    id: "curl",
    label: "cURL",
    code: `curl ${GATEWAY_BASE_URL}/messages \\
  -H "x-api-key: $CURIALY_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  },
  {
    id: "python-anthropic",
    label: "Python · Anthropic SDK",
    code: `import os
import anthropic

# Anthropic SDKs add /v1 themselves: give them the site, not the /v1 URL.
client = anthropic.Anthropic(
    base_url="${ORIGIN}",
    api_key=os.environ["CURIALY_API_KEY"],
)
message = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
# A reply can start with a thinking block: print its text blocks.
print("".join(block.text for block in message.content if block.type == "text"))`,
  },
  {
    id: "python-openai",
    label: "Python · OpenAI SDK",
    code: `import os
from openai import OpenAI

client = OpenAI(base_url="${GATEWAY_BASE_URL}", api_key=os.environ["CURIALY_API_KEY"])
response = client.chat.completions.create(
    model="claude-opus-5-5",  # or "openai-gpt-5.5", "grok-4.7", "kimi-k3", "glm-5.3", ...
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
  },
  {
    id: "node",
    label: "Node.js",
    code: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${ORIGIN}",
  apiKey: process.env.CURIALY_API_KEY,
});

const message = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
// A reply can start with a thinking block: print its text blocks.
console.log(message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join(""));`,
  },
];

/** What the API answers when a request can't run (server/gateway), in status order. */
const ERRORS: { status: number; type: string; text: string }[] = [
  { status: 400, type: "invalid_request_error", text: "The request isn't valid: no model, max_tokens over the model's limit, or a body that isn't valid JSON." },
  { status: 401, type: "authentication_error", text: "The key is missing, mistyped or revoked." },
  { status: 402, type: "insufficient_balance", text: "Your API balance is empty or below zero, or this request could cost more than is available: about the most it could cost is reserved before it runs. Add balance, or lower max_tokens." },
  { status: 403, type: "permission_error", text: "This key can't use that model: it isn't on the key's list, or it has no price." },
  { status: 404, type: "not_found_error", text: "Unknown endpoint, or a model this key can't use." },
  { status: 413, type: "invalid_request_error", text: "The request body is over 8 MB." },
  { status: 429, type: "rate_limit_error", text: "Too many requests at once on this account, or the API is busy. Wait a moment and send it again." },
  { status: 503, type: "curialy_api_error", text: "The model service is unavailable right now. Try again shortly." },
];

const ERROR_SAMPLE = `{
  "error": {
    "message": "Your API balance is empty. Add balance on the Developer API page: https://curialy.tech/developer",
    "type": "insufficient_balance",
    "code": 402
  }
}`;

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const moment = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Counts as the dashboard shows them: exact up to 9,999, then compact (12.3K, 4.5M). */
const count = (value: number) => (value >= 10_000 ? compact.format(value) : value.toLocaleString("en-US"));
const plural = (value: number, one: string) => `${count(value)} ${value === 1 ? one : `${one}s`}`;
/** A hold, in dollars and cents as the API's own messages say it. */
const dollars = (micros: number) => formatUsd(microsToUsd(micros));
/**
 * A balance or what is available, never rounded up (4,995,001 micro-dollars is $4.99, not $5.00):
 * whole cents from a cent, four decimals below one ("$0.0042"). A balance below zero rounds down too.
 */
const funds = (micros: number) => formatUsd(Math.abs(micros) >= 10_000 ? Math.floor(micros / 10_000) / 100 : Math.floor(micros / 100) / 10_000);
/** What a balance below zero owes, never rounded down (the next top-up covers at least this). */
const owing = (micros: number) => formatUsd(micros >= 10_000 ? Math.ceil(micros / 10_000) / 100 : Math.ceil(micros / 100) / 10_000);
const wholeDollars = (usd: number) => `$${usd.toLocaleString("en-US")}`;
/** Spend: cents from $1, up to four decimals below that (a quiet day can cost $0.0123). */
function spend(usd: number) {
  const size = Math.abs(usd);
  if (size === 0 || size >= 1 || size < 0.0001) return formatUsd(usd);
  return `${usd < 0 ? "-" : ""}$${size.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
const allTokens = (totals: ApiUsageTotals) => totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens;
/** "A, B and C" */
const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const RANGE_LABEL: Record<UsageRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "90d": "90 days" };

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy here: select the text and copy it yourself.");
  }
}

// ---- Billing data ----

/** The account's API wallet, refreshed every 15 s while the tab is visible and on coming back to it. */
function useBillingAccount(onBalanceUp: (account: BillingAccount) => void) {
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const balance = useRef<number | null>(null);
  const balanceUp = useRef(onBalanceUp);
  useEffect(() => { balanceUp.current = onBalanceUp; });
  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const next = await billingApi.account();
      // Only money coming in raises the balance (holds change what is available, not the balance).
      if (balance.current !== null && next.apiWallet.balanceMicros > balance.current && !next.operator) balanceUp.current(next);
      balance.current = next.apiWallet.balanceMicros;
      setAccount(next);
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't load your API balance."));
    } finally {
      inflight.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => { if (visible()) void load(); }, 15_000);
    const onVisibility = () => { if (visible()) void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);
  return { account, error, reload: load };
}

/**
 * The catalog without an offer that has ended since it loaded: list prices and no offer, so the page
 * never shows prices below what is charged while the next catalog loads (or when it can't). A catalog
 * loaded after the end is the server's word and is kept as it is.
 */
function withoutEndedOffer(catalog: BillingCatalog, loadedAt: number, now: number): BillingCatalog {
  const end = catalog.discount.endsAt ? Date.parse(catalog.discount.endsAt) : Number.NaN;
  if (!(end <= now) || loadedAt >= end) return catalog;
  const list = ({ input, output, cacheRead, cacheWrite }: TokenPrices): TokenPrices => ({ input, output, cacheRead, cacheWrite });
  return {
    ...catalog,
    discount: { plansPercent: 0, apiPercent: 0, endsAt: null },
    plans: catalog.plans.map(plan => ({ ...plan, priceUsd: plan.listUsd, discountPercent: 0 })),
    models: catalog.models.map(model => ({ ...model, price: list(model.list), longContext: model.longContext && { ...model.longContext, price: list(model.longContext) } })),
  };
}

/** Prices, the offer and the top-up limits, kept current: the offer can end, or the operator can change it, while the page is open. */
function useCatalog() {
  const [loaded, setLoaded] = useState<{ catalog: BillingCatalog; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadedAt = useRef(0);
  const load = useCallback(() => {
    setError(null);
    loadedAt.current = Date.now();
    billingApi.catalog().then(
      catalog => setLoaded({ catalog, at: Date.now() }),
      failure => setError(errorMessage(failure, "Couldn't load the prices.")),
    );
  }, []);
  useEffect(() => load(), [load]);
  // On coming back to the tab, and every five minutes while it is shown (at most once a minute).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current >= 60_000) load();
    };
    const timer = setInterval(refresh, 5 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  // The moment the offer ends (a timer waits at most about 23 days, then looks again).
  const endsAt = loaded?.catalog.discount.endsAt ?? null;
  useEffect(() => {
    if (!endsAt) return;
    const left = Date.parse(endsAt) - Date.now();
    if (!(left > 0)) return;
    const timer = setTimeout(() => {
      setNow(Date.now());
      if (Date.parse(endsAt) <= Date.now()) load();
    }, Math.min(left + 1_000, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [endsAt, load, now]);
  const catalog = useMemo(() => (loaded ? withoutEndedOffer(loaded.catalog, loaded.at, now) : null), [loaded, now]);
  return { catalog, error, reload: load };
}

/** One range's usage report. The last one stays on screen while the next loads, so nothing jumps. */
function useApiUsage(range: UsageRange) {
  const [report, setReport] = useState<ApiUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    billingApi.apiUsage(range).then(
      next => { if (live) setReport(next); },
      failure => {
        if (!live) return;
        // The last range's numbers under the new range's name would mislead: show the error instead.
        setReport(null);
        setError(errorMessage(failure, "Couldn't load your usage."));
      },
    ).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { report, error, loading, retry };
}

// ---- Balance ----

/**
 * What the available balance (or the smallest top-up, while nothing is available) buys on one model,
 * at its price after the offer. A balance below zero is paid first from the top-up, so it buys less.
 */
function WhatItBuys({ models, availableMicros, balanceMicros, paidUsd, balanceUsd }: { models: ApiModelPrice[]; availableMicros: number; balanceMicros: number; paidUsd: number; balanceUsd: number }) {
  const id = useId();
  const [modelId, setModelId] = useState(models[0].id);
  const model = models.find(entry => entry.id === modelId) ?? models[0];
  const owed = Math.max(0, -balanceMicros);
  const usd = availableMicros > 0 ? microsToUsd(availableMicros) : balanceUsd - microsToUsd(owed);
  // What is owed takes all of the smallest top-up: nothing to show.
  if (!(usd > 0)) return null;
  const tokens = (perMillion: number) => (perMillion > 0 ? compact.format(Math.floor((usd / perMillion) * 1_000_000)) : null);
  const output = tokens(model.price.output);
  const input = tokens(model.price.input);
  const label = availableMicros > 0 ? `What ${funds(availableMicros)} buys`
    : owed > 0 ? `What a ${wholeDollars(paidUsd)} top-up buys, after the ${owing(owed)} you owe`
      : `What a ${wholeDollars(paidUsd)} top-up buys`;
  return (
    <div className="api-buys">
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className="select" value={model.id} aria-describedby={output && input ? `${id}-result` : undefined} onChange={event => setModelId(event.target.value)}>
        {models.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      {output && input && (
        <p id={`${id}-result`} className="api-buys-result">
          About <strong>{output} output tokens</strong> or {input} input tokens on {model.label}, at {formatPerMillion(model.price.output)} and {formatPerMillion(model.price.input)} per 1M.
        </p>
      )}
    </div>
  );
}

function BalanceCard({ account, error, catalog, onAdd, onRetry }: { account: BillingAccount | null; error: string | null; catalog: BillingCatalog | null; onAdd: () => void; onRetry: () => void }) {
  let body: ReactNode;
  if (!account) {
    body = error ? (
      <StateNotice variant="error" size="sm" title="Couldn't load your API balance" actions={<Button icon={RotateCcw} onClick={onRetry}>Try again</Button>}>{error}</StateNotice>
    ) : (
      <div className="api-balance-body">
        <p className="sr-only" role="status">Loading your API balance…</p>
        <div className="api-hero" aria-hidden="true">
          <span className="skeleton skeleton-text api-skeleton-label" />
          <span className="skeleton api-skeleton-hero" />
        </div>
      </div>
    );
  } else if (account.operator) {
    body = (
      <div className="api-balance-body">
        <div className="api-hero">
          <span className="micro">API use</span>
          <span className="api-hero-value" data-words="">Not charged</span>
        </div>
        <p className="api-balance-note">This is the operator's account: its API requests aren't charged and nothing is reserved for them. They're still recorded, so the usage below shows them at list prices.</p>
      </div>
    );
  } else {
    const wallet = account.apiWallet;
    const reserving = wallet.requestsInFlight > 0 || wallet.reservedMicros > 0;
    body = (
      <div className="api-balance-body">
        <div className="api-hero">
          <span className="micro">Available</span>
          <span className="api-hero-value">{funds(wallet.availableMicros)}</span>
        </div>
        <dl className="api-facts">
          <div><dt>Balance</dt><dd>{funds(wallet.balanceMicros)}</dd></div>
          <div>
            <dt>Reserved for running requests</dt>
            <dd>{reserving ? `${dollars(wallet.reservedMicros)} · ${plural(wallet.reservedTokens, "token")} · ${plural(wallet.requestsInFlight, "request")}` : "Nothing right now"}</dd>
          </div>
        </dl>
        {wallet.balanceMicros < 0 ? (
          <div className="notice" data-tone="warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <div className="notice-body">You owe {owing(-wallet.balanceMicros)}: a reply cost more than was reserved for it. Requests are refused until you add balance, and your next top-up pays this first.</div>
          </div>
        ) : wallet.balanceMicros === 0 ? (
          <div className="notice" data-tone="warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <div className="notice-body">Your API balance is empty, so requests are refused until you add balance.</div>
          </div>
        ) : wallet.availableMicros <= 0 ? (
          <div className="notice" data-tone="neutral">
            <Info size={16} aria-hidden="true" />
            <div className="notice-body">All of it is reserved for the requests running now, so new ones are refused until those finish or you add balance.</div>
          </div>
        ) : null}
        <p className="field-hint">While a request runs, about the most it could cost is reserved from your balance: its prompt is estimated, so a reply can cost a little more. When it ends you pay for the tokens it used, and the rest is released.</p>
        {error && <p className="api-stale">Couldn't refresh the balance just now: {error}</p>}
        {catalog && catalog.models.length > 0 && <WhatItBuys models={catalog.models} availableMicros={wallet.availableMicros} balanceMicros={wallet.balanceMicros} paidUsd={catalog.apiTopup.minUsd} balanceUsd={catalog.apiTopup.minUsd * catalog.apiTopup.creditPerUsd} />}
      </div>
    );
  }
  return (
    <section className="card api-balance" aria-labelledby="dev-balance">
      <div className="card-head">
        <h2 id="dev-balance">API balance</h2>
        {account && !account.operator && <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>Add balance</Button>}
      </div>
      {body}
      <div className="card-foot">
        <p className="api-foot-text">Orders and receipts are on <Link href="/billing#api" className="link">Plans &amp; Billing</Link>.</p>
      </div>
    </section>
  );
}

function AddBalanceDialog({ open, onOpenChange, catalog, error, onRetry }: { open: boolean; onOpenChange: (open: boolean) => void; catalog: BillingCatalog | null; error: string | null; onRetry: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add balance"
      description={catalog
        ? `Whole dollars from ${wholeDollars(catalog.apiTopup.minUsd)} to ${wholeDollars(catalog.apiTopup.maxUsd)}, paid in crypto. The crossed price is the balance you receive.`
        : "Top up your API balance with crypto."}
    >
      {catalog ? (
        <TopUpForm catalog={catalog} compact />
      ) : error ? (
        <StateNotice variant="error" size="sm" title="Couldn't load the top-up options" actions={<Button icon={RotateCcw} onClick={onRetry}>Try again</Button>}>{error}</StateNotice>
      ) : (
        <StateNotice variant="loading" size="sm" title="Loading the top-up options…" />
      )}
    </Dialog>
  );
}

// ---- Prices ----

/**
 * The longest reply a model gives here: its own limit, but never more than the max_tokens the API
 * takes (a streamed request may ask for at most that). Null when the list has no limit for it.
 */
const longestReply = (model: ApiModelPrice) => (model.maxOutput === null ? null : Math.min(model.maxOutput, model.maxTokens.streaming));

/** A model limit, or a dash when the list has none. */
function Limit({ tokens }: { tokens: number | null }) {
  if (tokens) return <>{formatTokenCount(tokens)}</>;
  return <><span aria-hidden="true">—</span><span className="sr-only">Not listed</span></>;
}

/** A price per 1M tokens: the list price struck through next to the price after the offer. */
function PriceCell({ label, list, now, discounted }: { label: string; list: number; now: number; discounted: boolean }) {
  return (
    <td role="cell" className="num api-num">
      <span className="api-cell-label" aria-hidden="true">{label}</span>
      {discounted && list !== now ? (
        <>
          <s className="api-list"><span className="sr-only">List price </span>{formatPerMillion(list)}</s>
          <span className="sr-only">, now </span>
          <span className="api-now">{formatPerMillion(now)}</span>
        </>
      ) : (
        <span className="api-now">{formatPerMillion(now)}</span>
      )}
    </td>
  );
}

function PriceCells({ list, now, discounted, cacheWrite }: { list: TokenPrices; now: TokenPrices; discounted: boolean; cacheWrite: boolean }) {
  return (
    <>
      <PriceCell label="Input" list={list.input} now={now.input} discounted={discounted} />
      <PriceCell label="Output" list={list.output} now={now.output} discounted={discounted} />
      <PriceCell label="Cache read" list={list.cacheRead} now={now.cacheRead} discounted={discounted} />
      {cacheWrite && <PriceCell label="Cache write" list={list.cacheWrite} now={now.cacheWrite} discounted={discounted} />}
    </>
  );
}

function PriceTable({ title, models, discounted, cacheWrite }: { title: string; models: ApiModelPrice[]; discounted: boolean; cacheWrite: boolean }) {
  return (
    <div className="api-price-wrap">
      {/* Explicit roles: below a 960px card each row is laid out as a block, which can drop table semantics. */}
      <table className="data-table api-price-table" role="table" aria-label={`${title} prices per 1M tokens`}>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Model</th>
            <th role="columnheader" scope="col" className="api-num">Context</th>
            <th role="columnheader" scope="col" className="api-num">Max output</th>
            <th role="columnheader" scope="col" className="api-num">Input</th>
            <th role="columnheader" scope="col" className="api-num">Output</th>
            <th role="columnheader" scope="col" className="api-num">Cache read</th>
            {cacheWrite && <th role="columnheader" scope="col" className="api-num">Cache write</th>}
            <th role="columnheader" scope="col" className="api-num">max_tokens</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {models.map(model => (
            <Fragment key={model.id}>
              <tr role="row" data-long={model.longContext ? "" : undefined}>
                <th role="rowheader" scope="row">
                  <span className="api-model">{model.label}</span>
                  <code className="api-model-id">{model.id}</code>
                </th>
                <td role="cell" className="num api-num"><span className="api-cell-label" aria-hidden="true">Context</span><Limit tokens={model.contextWindow} /></td>
                <td role="cell" className="num api-num"><span className="api-cell-label" aria-hidden="true">Max output</span><Limit tokens={longestReply(model)} /></td>
                <PriceCells list={model.list} now={model.price} discounted={discounted} cacheWrite={cacheWrite} />
                <td role="cell" className="num api-num">
                  <span className="api-cell-label" aria-hidden="true">max_tokens</span>
                  <span className="api-line">{model.maxTokens.streaming.toLocaleString("en-US")} streaming</span>
                  <span className="api-sub">{model.maxTokens.nonStreaming.toLocaleString("en-US")} without</span>
                </td>
              </tr>
              {model.longContext && (
                <tr role="row" className="api-long">
                  <th role="rowheader" scope="row"><span className="sr-only">{model.label}: </span>Prompts over {formatTokenCount(model.longContext.above)} tokens</th>
                  <td role="cell" />
                  <td role="cell" />
                  <PriceCells list={model.longContext} now={model.longContext.price} discounted={discounted} cacheWrite={cacheWrite} />
                  <td role="cell" />
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PricesCard({ catalog, error, operator, onRetry }: { catalog: BillingCatalog | null; error: string | null; operator: boolean; onRetry: () => void }) {
  const percent = catalog?.discount.apiPercent ?? 0;
  const endsAt = catalog?.discount.endsAt ?? null;
  const models = catalog?.models ?? [];
  const cacheWrite = models.some(model => model.list.cacheWrite !== model.list.input);
  return (
    <section className="card api-prices" aria-labelledby="dev-prices">
      <div className="card-head">
        <h2 id="dev-prices">Prices</h2>
        {percent > 0 && (
          <span className="chip api-offer"><BadgePercent size={12} aria-hidden="true" />{percent}% off · {endsAt ? `ends ${moment.format(new Date(endsAt))}` : "limited time"}</span>
        )}
      </div>
      {!catalog ? (
        error ? (
          <StateNotice variant="error" size="sm" title="Couldn't load the prices" actions={<Button icon={RotateCcw} onClick={onRetry}>Try again</Button>}>{error}</StateNotice>
        ) : (
          <StateNotice variant="loading" size="sm" title="Loading the prices…" />
        )
      ) : (
        <div className="api-prices-body">
          <p className="api-lead">{percent > 0 ? "Per 1 million tokens. The list price is struck through next to what you pay with the offer." : "Per 1 million tokens."}</p>
          {MODEL_GROUPS.map(group => {
            const priced = models.filter(model => model.format === group.format);
            // A gateway model without a price can't be called (the operator's keys aside).
            const unpriced = group.models.filter(model => !models.some(entry => entry.id === model.id)).map(model => model.label);
            if (!priced.length && !unpriced.length) return null;
            const them = unpriced.length === 1 ? "it" : "them";
            return (
              <div key={group.id} className="api-group">
                <h3 className="api-group-title">{group.title} <span className="api-group-note">{group.note}</span></h3>
                {priced.length > 0 && <PriceTable title={group.title} models={priced} discounted={percent > 0} cacheWrite={priced.some(model => model.list.cacheWrite !== model.list.input)} />}
                {unpriced.length > 0 && (
                  <p className="api-unpriced">
                    {andList(unpriced)} {unpriced.length === 1 ? "has" : "have"} no price{operator ? `: only the operator's keys can call ${them}.` : `, so keys can't call ${them}.`}
                  </p>
                )}
              </div>
            );
          })}
          <ul className="api-notes">
            <li>Requests are charged to your API balance at these prices. While one runs, about the most it could cost is reserved: its prompt (estimated from its size) and all of its max_tokens. A reply can cost a little more than was reserved, which takes the balance below zero until a top-up covers it.</li>
            <li>Cached input bills at the cache-read rate{cacheWrite ? "; input written to the cache bills at the cache-write rate" : ""}.</li>
            {models.some(model => model.longContext) && <li>A prompt over a model's long-context size (cached tokens included) bills the whole request at the rates on its second row.</li>}
            <li>max_tokens: the first limit is for replies that stream (<code>stream: true</code>), the second for replies that don't. Longer replies must stream.</li>
            {models.some(model => model.maxOutput !== null && model.maxOutput < model.maxTokens.streaming) && (
              <li>Max output is the longest reply a model writes. A larger max_tokens is accepted, but it reserves more than a reply can use.</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---- Usage ----

const TOKEN_SERIES: ChartSeries[] = [
  { key: "input", label: "Input", tone: "ink" },
  { key: "cached", label: "Cached", tone: "slate" },
  { key: "output", label: "Output", tone: "accent" },
];
const REQUEST_SERIES: ChartSeries[] = [{ key: "requests", label: "Requests", tone: "ink" }];

/**
 * The charts' data for one report. Spend is what was paid, so the chart's highest bar, its label and
 * its totals are the spend (the saving and the list price are on the tiles above it). The operator
 * isn't charged: its spend is shown at list prices. Input counts what was written to the cache too.
 */
function usageCharts(report: ApiUsageReport, operator: boolean, modelLabel: (id: string) => string) {
  const spendSeries: ChartSeries[] = operator
    ? [{ key: "list", label: "At list prices (not charged)", tone: "ink" }]
    : [{ key: "paid", label: "Paid", tone: "ink" }];
  return {
    spendSeries,
    spend: report.buckets.map(bucket => ({
      start: bucket.start,
      values: (operator ? { list: microsToUsd(bucket.listMicros) } : { paid: microsToUsd(bucket.costMicros) }) as Record<string, number>,
    })),
    tokens: report.buckets.map(bucket => ({ start: bucket.start, values: { input: bucket.inputTokens + bucket.cacheWriteTokens, cached: bucket.cacheReadTokens, output: bucket.outputTokens } })),
    requests: report.buckets.map(bucket => ({ start: bucket.start, values: { requests: bucket.requests } })),
    models: report.byModel.map(entry => ({
      key: entry.model,
      label: modelLabel(entry.model),
      value: microsToUsd(operator ? entry.listMicros : entry.costMicros),
      detail: `${plural(entry.requests, "request")} · ${plural(allTokens(entry), "token")}`,
    })),
  };
}

function UsageTotals({ totals, operator }: { totals: ApiUsageTotals; operator: boolean }) {
  const tiles: { id: string; label: string; value: string; hint?: string }[] = [
    { id: "spent", label: "Spent", value: spend(microsToUsd(totals.costMicros)), hint: operator ? "Not charged" : undefined },
    operator
      ? { id: "list", label: "At list prices", value: spend(microsToUsd(totals.listMicros)) }
      : { id: "saved", label: "Saved by the offer", value: spend(microsToUsd(Math.max(0, totals.listMicros - totals.costMicros))), hint: `List price ${spend(microsToUsd(totals.listMicros))}` },
    { id: "requests", label: "Requests", value: count(totals.requests) },
    { id: "input", label: "Input tokens", value: count(totals.inputTokens + totals.cacheWriteTokens), hint: totals.cacheWriteTokens > 0 ? `${count(totals.cacheWriteTokens)} written to the cache` : undefined },
    { id: "cached", label: "Cached tokens", value: count(totals.cacheReadTokens), hint: "At the cache-read rate" },
    { id: "output", label: "Output tokens", value: count(totals.outputTokens) },
  ];
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

function ChartCard({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section className="card api-chart" data-wide={wide || undefined} aria-labelledby={id}>
      <div className="card-head"><h3 id={id}>{title}</h3></div>
      <div className="api-chart-body">{children}</div>
    </section>
  );
}

function KeyUsage({ rows, operator, keys }: { rows: ApiUsageReport["byKey"]; operator: boolean; keys: ApiKeyInfo[] | null }) {
  const cost = (row: ApiUsageTotals) => (operator ? row.listMicros : row.costMicros);
  const sorted = [...rows].sort((a, b) => cost(b) - cost(a) || b.requests - a.requests);
  const spent = operator ? "At list prices" : "Spend";
  // The prefix sits under the key's name, so the numbers fit beside it in a half-width card; a
  // narrower one lays each key out as a block of labelled values (usage.css), never scrolling the spend away.
  return (
    <div className="table-wrap api-table api-key-table" tabIndex={0} role="region" aria-label="Usage by key">
      {/* Explicit roles: the narrow layout turns rows into blocks, which can drop table semantics. */}
      <table className="data-table" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Key</th>
            <th role="columnheader" scope="col" className="api-num">Requests</th>
            <th role="columnheader" scope="col" className="api-num">Tokens</th>
            <th role="columnheader" scope="col" className="api-num">{spent}</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sorted.map(row => {
            const revoked = keys?.find(key => key.id === row.keyId)?.status === "revoked";
            return (
              <tr role="row" key={row.keyId ?? "deleted"}>
                <th role="rowheader" scope="row">
                  <span className="api-key-name">
                    {row.keyId ? row.name ?? "Unnamed key" : "Deleted key"}
                    {revoked && <span className="status-badge" data-tone="neutral" data-size="sm">Revoked</span>}
                  </span>
                  {row.prefix && <code className="dev-key-prefix api-key-prefix">{row.prefix}…</code>}
                </th>
                <td role="cell" className="num api-num"><span className="api-cell-label" aria-hidden="true">Requests</span>{count(row.requests)}</td>
                <td role="cell" className="num api-num"><span className="api-cell-label" aria-hidden="true">Tokens</span>{count(allTokens(row))}</td>
                <td role="cell" className="num api-num"><span className="api-cell-label" aria-hidden="true">{spent}</span>{spend(microsToUsd(cost(row)))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UsageSection({ range, onRange, usage, operator, accountError, onRetryAccount, modelLabel, keys, onCreateKey }: {
  range: UsageRange;
  onRange: (range: UsageRange) => void;
  usage: ReturnType<typeof useApiUsage>;
  /** null until the account has loaded: the operator's spend reads differently. */
  operator: boolean | null;
  /** Why the account hasn't loaded (null: it has, or it is still loading). */
  accountError: string | null;
  onRetryAccount: () => void;
  modelLabel: (id: string) => string;
  keys: ApiKeyInfo[] | null;
  onCreateKey: () => void;
}) {
  const { report, error, loading, retry } = usage;
  const charts = useMemo(() => (report && operator !== null ? usageCharts(report, operator, modelLabel) : null), [report, operator, modelLabel]);
  const unit = report?.bucket === "hour" ? "hour" : "day";
  const span = report ? `last ${RANGE_LABEL[report.range]}` : "";
  // The server cuts days and hours on the viewer's clock when it knows that zone, on UTC otherwise: the charts say which.
  const zone = usableTimeZone(report?.timeZone);
  const viewer = viewerTimeZone();
  let body: ReactNode;
  if (!report || !charts || operator === null) {
    body = error ? (
      <StateNotice variant="error" title="Couldn't load your usage" actions={<Button variant="primary" icon={RotateCcw} onClick={retry}>Try again</Button>}>{error}</StateNotice>
    ) : report && operator === null && accountError ? (
      // Without the account it isn't known whether these requests were charged (the operator's aren't).
      <StateNotice variant="unavailable" title="Your usage can't be shown yet" actions={<Button variant="primary" icon={RotateCcw} onClick={onRetryAccount}>Try again</Button>}>
        Your account didn't load, so it isn't known yet how these requests were charged. It's tried again every 15 seconds.
      </StateNotice>
    ) : (
      <StateNotice variant="loading" size="sm" title="Loading your usage…" />
    );
  } else if (report.totals.requests === 0) {
    const noKeys = keys !== null && !keys.some(key => key.status === "active");
    body = (
      <div className="card">
        <StateNotice variant="empty" title={`No API requests in the ${span}`} actions={noKeys ? <Button variant="primary" icon={Plus} onClick={onCreateKey}>Create key</Button> : undefined}>
          Requests made with your keys show up here once they finish, with what they cost and the tokens they used.
        </StateNotice>
      </div>
    );
  } else {
    body = (
      <>
        <UsageTotals totals={report.totals} operator={operator} />
        {zone && zone !== viewer && <p className="field-hint">Times on these charts are in {zone}.</p>}
        <div className="api-charts">
          {/* One series, so no legend: the title says what it shows. */}
          <ChartCard wide title={operator ? `List-price cost per ${unit}` : `Spend per ${unit}`}>
            <TimeBars data={charts.spend} series={charts.spendSeries} bucket={report.bucket} timeZone={report.timeZone} format={spend} ariaLabel={`${operator ? "List-price cost (not charged)" : "Spend"} per ${unit}, ${span}`} height={200} />
          </ChartCard>
          <ChartCard title={`Tokens per ${unit}`}>
            <TimeBars data={charts.tokens} series={TOKEN_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={count} ariaLabel={`Tokens per ${unit}, ${span}`} />
          </ChartCard>
          <ChartCard title={`Requests per ${unit}`}>
            <TimeBars data={charts.requests} series={REQUEST_SERIES} bucket={report.bucket} timeZone={report.timeZone} format={count} ariaLabel={`Requests per ${unit}, ${span}`} />
          </ChartCard>
          <ChartCard title={operator ? "List-price cost by model" : "Spend by model"}>
            <RankBars items={charts.models} format={spend} ariaLabel={`${operator ? "List-price cost (not charged)" : "Spend"} by model, ${span}`} />
          </ChartCard>
          <ChartCard title="By key">
            <KeyUsage rows={report.byKey} operator={operator} keys={keys} />
          </ChartCard>
        </div>
      </>
    );
  }
  return (
    <section className="api-usage" aria-labelledby="dev-usage">
      <div className="api-usage-head">
        <h2 id="dev-usage" className="section-title">Usage</h2>
        <div className="api-usage-tools">
          {loading && report && <span className="api-updating"><Spinner size={13} />Updating…</span>}
          <RadioGroup.Root className="segmented" aria-label="Range" value={range} onValueChange={value => onRange(value as UsageRange)} orientation="horizontal" loop>
            {USAGE_RANGES.map(value => <RadioGroup.Item key={value} value={value}>{RANGE_LABEL[value]}</RadioGroup.Item>)}
          </RadioGroup.Root>
        </div>
      </div>
      <div className="api-usage-body" aria-busy={(loading && report !== null) || undefined}>{body}</div>
    </section>
  );
}

// ---- Errors ----

function ErrorsCard() {
  return (
    <section className="card" aria-labelledby="dev-errors">
      <div className="card-head"><h2 id="dev-errors">Errors</h2></div>
      <div className="api-errors-body">
        <p className="api-lead">A request that can't run gets an HTTP error with a JSON body whose <code>message</code> says what to change. A streamed reply that fails after it has started ends with an error event instead.</p>
        <dl className="api-errors">
          {ERRORS.map(entry => (
            <div key={`${entry.status}-${entry.type}`}>
              <dt><span className="api-status">{entry.status}</span><code>{entry.type}</code></dt>
              <dd>{entry.text}</dd>
            </div>
          ))}
        </dl>
        <pre className="code-block" aria-label="Example error body"><code>{ERROR_SAMPLE}</code></pre>
      </div>
    </section>
  );
}

// ---- Keys ----

function CopyField({ value, what }: { value: string; what: string }) {
  return (
    <div className="dev-copy">
      <code>{value}</code>
      <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copy(value, what)} aria-label={`Copy the ${what.toLowerCase()}`}>Copy</Button>
    </div>
  );
}

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (created: { key: ApiKeyInfo; secret: string }) => void }) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [models, setModels] = useState<string[]>(GATEWAY_MODEL_IDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName("");
    setModels(GATEWAY_MODEL_IDS);
    setError(null);
  }, [open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Name the key, for example after the app that will use it.");
    if (!models.length) return setError("Choose at least one model.");
    setBusy(true);
    setError(null);
    try {
      onCreated(await developerApi.create(name.trim(), models));
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't create the key."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      title="Create an API key"
      description="Name it after the app or environment that will use it, so you can tell keys apart later."
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form={`${nameId}-form`} icon={KeyRound} busy={busy}>Create key</Button>
        </>
      )}
    >
      <form id={`${nameId}-form`} className="stack" onSubmit={event => void submit(event)} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={nameId}>Name</label>
          <input id={nameId} className="input" value={name} maxLength={60} placeholder="Production app" autoComplete="off" onChange={event => setName(event.target.value)} />
        </div>
        {MODEL_GROUPS.map(group => {
          const ids = group.models.map(model => model.id);
          const all = ids.every(id => models.includes(id));
          return (
            <fieldset key={group.id} className="field dev-fieldset">
              <legend className="field-label dev-legend">
                {group.title}
                <button type="button" className="btn link sm" onClick={() => setModels(current => (all ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])]))}>{all ? "None" : "All"}</button>
              </legend>
              {group.models.map(model => (
                <label key={model.id} className="dev-check">
                  <input type="checkbox" checked={models.includes(model.id)} onChange={event => setModels(current => (event.target.checked ? [...current, model.id] : current.filter(id => id !== model.id)))} />
                  <span>{model.label}</span>
                  <code>{model.id}</code>
                </label>
              ))}
            </fieldset>
          );
        })}
        {error && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
      </form>
    </Dialog>
  );
}

function RevealKeyDialog({ created, onDone }: { created: { key: ApiKeyInfo; secret: string } | null; onDone: () => void }) {
  return (
    <Dialog
      open={created !== null}
      onOpenChange={open => { if (!open) onDone(); }}
      dismissible={false}
      title="Save your new key"
      description="This is the only time it is shown. Store it in your app's secret settings or a password manager; if it is lost, create a new key and revoke this one."
      footer={<Button variant="primary" icon={Check} onClick={onDone}>I've saved it</Button>}
    >
      {created && (
        <div className="stack">
          <code className="dev-secret" aria-label={`API key for ${created.key.name}`}>{created.secret}</code>
          <Button variant="secondary" icon={Copy} onClick={() => void copy(created.secret, "API key")}>Copy key</Button>
          <p className="field-hint">Treat it like a password: anyone with it can spend this account's API balance. Never put it in code you publish or in a web page.</p>
        </div>
      )}
    </Dialog>
  );
}

function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKeyInfo; onRevoke: (key: ApiKeyInfo) => void }) {
  const active = apiKey.status === "active";
  return (
    <li className="dev-key" data-revoked={active ? undefined : ""}>
      <div className="dev-key-main">
        <span className="dev-key-name">{apiKey.name}</span>
        <span className="dev-key-meta">
          Created {day.format(new Date(apiKey.createdAt))} · {apiKey.lastUsedAt ? `last used ${moment.format(new Date(apiKey.lastUsedAt))}` : "never used"}
        </span>
      </div>
      <code className="dev-key-prefix" aria-label={`Key starting ${apiKey.prefix}`}>{apiKey.prefix}…</code>
      <ul className="dev-models dev-key-models" aria-label="Models" title={apiKey.allowedModels.join(", ")}>
        {modelSummary(apiKey.allowedModels).map(item => <li key={item} className="chip mono">{item}</li>)}
      </ul>
      {active ? (
        <Button size="sm" variant="danger" onClick={() => onRevoke(apiKey)} aria-label={`Revoke ${apiKey.name}`}>Revoke</Button>
      ) : (
        <span className="status-badge" data-tone="neutral" data-size="sm">Revoked</span>
      )}
    </li>
  );
}

export default function DeveloperPortal() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: ApiKeyInfo; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState<UsageRange>("7d");
  // The page's one polite live region, for milestones: a top-up landed, another range loaded.
  const [announcement, setAnnouncement] = useState("");
  const load = useCallback(() => {
    setError(null);
    developerApi.keys().then(data => setKeys(data.keys), failure => setError(errorMessage(failure, "Couldn't load your keys.")));
  }, []);
  useEffect(() => load(), [load]);

  const billing = useBillingAccount(account => setAnnouncement(`Your API balance is now ${funds(account.apiWallet.balanceMicros)}.`));
  const prices = useCatalog();
  const usage = useApiUsage(range);
  // Unknown until the account has loaded: the operator's requests aren't charged, so its usage must not read as savings.
  const operator = billing.account ? billing.account.operator : null;
  const modelLabel = useCallback(
    (id: string) => prices.catalog?.models.find(model => model.id === id)?.label ?? gatewayModel(id)?.label ?? id,
    [prices.catalog],
  );

  // Say what a newly picked range shows once it has loaded.
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current || usage.loading || !usage.report) return;
    picked.current = false;
    const { totals, range: shown } = usage.report;
    setAnnouncement(`Showing the last ${RANGE_LABEL[shown]}: ${plural(totals.requests, "request")}${operator === false ? `, ${spend(microsToUsd(totals.costMicros))} spent` : ""}.`);
  }, [usage.loading, usage.report, operator]);

  const active = keys?.filter(key => key.status === "active").length ?? 0;
  return (
    <AppShell title="Developer API">
      <div className="page">
        <div className="page-narrow dev-page">
          <header className="page-head">
            <div>
              <span className="eyebrow">Developer API</span>
              <h2 className="page-title">Call Curialy's models from your code</h2>
              <p className="page-sub">Create a key, point an Anthropic or OpenAI SDK at Curialy, and send requests from your own apps. Each request is paid from your API balance at the model's price, shown below.{prices.catalog && prices.catalog.free.rewards.apiUsd > 0 ? ` Follow @${prices.catalog.free.rewards.followHandle} and post about Curialy, and $${prices.catalog.free.rewards.apiUsd} is added to this balance once.` : ""}</p>
            </div>
          </header>

          <BalanceCard account={billing.account} error={billing.error} catalog={prices.catalog} onAdd={() => setAdding(true)} onRetry={() => void billing.reload()} />

          <section className="card" aria-labelledby="dev-endpoint">
            <div className="card-head"><h2 id="dev-endpoint">Endpoint</h2></div>
            <div className="dev-endpoint">
              <div className="field">
                <span className="field-label">Base URL</span>
                <CopyField value={GATEWAY_BASE_URL} what="Base URL" />
                <span className="field-hint">For OpenAI SDKs and plain HTTP. Anthropic SDKs add <code>/v1</code> themselves, so they take <code>{ORIGIN}</code>.</span>
              </div>
              {MODEL_GROUPS.map(group => (
                <div key={group.id} className="field">
                  <span className="field-label">{group.title} <span className="dev-group-note">{group.note}</span></span>
                  <ul className="dev-models" aria-label={`${group.title} models`}>
                    {group.models.map(model => <li key={model.id} className="chip mono" title={model.label}>{model.id}</li>)}
                  </ul>
                </div>
              ))}
              <p className="field-hint">Send the key as <code>x-api-key</code> or <code>Authorization: Bearer</code>. Both <code>/v1/messages</code> (Anthropic) and <code>/v1/chat/completions</code> (OpenAI) are available, streamed or whole, and <code>/v1/models</code> lists what a key may use. GPT 5, Grok and Kimi reason before they answer: give them room in <code>max_tokens</code> (a very small limit can return an empty reply).</p>
            </div>
          </section>

          <section className="card" aria-labelledby="dev-keys">
            <div className="card-head">
              <h2 id="dev-keys">API keys{keys && active > 0 ? <span className="badge">{active}</span> : null}</h2>
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>Create key</Button>
            </div>
            {keys === null ? (
              error ? (
                <StateNotice variant="error" title="Couldn't load your keys" actions={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice>
              ) : (
                <div className="dev-keys">
                  <p className="sr-only" role="status">Loading your keys…</p>
                  {[0, 1].map(index => <div key={index} className="dev-key" aria-hidden="true"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>)}
                </div>
              )
            ) : keys.length === 0 ? (
              <StateNotice variant="empty" title="No keys yet">Create a key to call the API from your code. Each key shows its secret once, when you create it.</StateNotice>
            ) : (
              <ul className="dev-keys" aria-label="Your API keys">
                {keys.map(key => <KeyRow key={key.id} apiKey={key} onRevoke={setRevoking} />)}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="dev-quickstart">
            <div className="card-head"><h2 id="dev-quickstart">Quickstart</h2></div>
            <Tabs.Root defaultValue="curl" className="dev-samples">
              <Tabs.List className="tabs" aria-label="Code samples">
                {SAMPLES.map(sample => <Tabs.Trigger key={sample.id} value={sample.id} className="tab">{sample.label}</Tabs.Trigger>)}
              </Tabs.List>
              {SAMPLES.map(sample => (
                <Tabs.Content key={sample.id} value={sample.id} className="tab-panel dev-sample">
                  <pre className="code-block"><code>{sample.code}</code></pre>
                  <Button size="sm" variant="secondary" icon={Copy} className="dev-sample-copy" onClick={() => void copy(sample.code, "Code")} aria-label={`Copy the ${sample.label} sample`}>Copy</Button>
                </Tabs.Content>
              ))}
            </Tabs.Root>
            <p className="field-hint dev-samples-note">The samples read the key from the <code>CURIALY_API_KEY</code> environment variable, so it never sits in your code.</p>
          </section>

          <UsageSection
            range={range}
            onRange={next => { picked.current = true; setRange(next); }}
            usage={usage}
            operator={operator}
            accountError={billing.account ? null : billing.error}
            onRetryAccount={() => void billing.reload()}
            modelLabel={modelLabel}
            keys={keys}
            onCreateKey={() => setCreating(true)}
          />

          <PricesCard catalog={prices.catalog} error={prices.error} operator={operator === true} onRetry={prices.reload} />

          <ErrorsCard />
        </div>
      </div>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} onCreated={result => { setCreating(false); setCreated(result); setKeys(current => [result.key, ...(current ?? [])]); }} />
      <RevealKeyDialog created={created} onDone={() => setCreated(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={open => { if (!open) setRevoking(null); }}
        title={revoking ? `Revoke ${revoking.name}?` : "Revoke key?"}
        confirmLabel="Revoke key"
        busyLabel="Revoking…"
        tone="danger"
        onConfirm={async () => {
          if (!revoking) return;
          const { key } = await developerApi.revoke(revoking.id);
          setKeys(current => current?.map(entry => (entry.id === key.id ? key : entry)) ?? null);
          toast.success(`${key.name} revoked`);
        }}
      >
        Apps using this key stop working at once. This can't be undone; create a new key if you need one again.
      </ConfirmDialog>
      <AddBalanceDialog open={adding} onOpenChange={setAdding} catalog={prices.catalog} error={prices.error} onRetry={prices.reload} />
      <p className="sr-only" role="status">{announcement}</p>
    </AppShell>
  );
}
