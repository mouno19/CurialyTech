import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { ArrowRight, BadgePercent, RotateCcw, TriangleAlert } from "lucide-react";
import { discountedUsd, formatUsd, MAX_PLAN_MONTHS, networkInfo, type BillingCatalog, type CreditUsageReport, type PlanId, type UsageRange } from "@shared/billing";
import type { CreditBalance } from "@shared/credits";
import { billingApi } from "@/lib/billing";
import { errorMessage } from "@/lib/api";
import { clockText, refreshAccount, useAccount } from "@/lib/account";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { useAnnouncer } from "@/components/task/useAnnouncer";
import { TimeBars, type ChartSeries } from "@/components/charts";
import { PaymentStatusChip } from "@/components/billing/PaymentStatusChip";
import { TopUpForm } from "@/components/billing/TopUpForm";
import { creditCount, dayText, microsText, shortDayText, spendableCredits, spendableMicrosText } from "@/components/billing/format";
import { shownStatus } from "@/components/billing/orderState";
import { EarnCredits } from "@/components/billing/EarnCredits";
import { daysLeftText, formatPrice, freeMultiple, freeTierLines, monthsText, offerBadge, offerSentence, ownAllowance, planAction, planConfigs, planState, vaultText } from "@/components/billing/plans";

// Plans & Billing: the account's plan and credits, the 30-day plans, the Developer API balance and
// its top-ups, credit use over time, the account's orders, and what a payment can be made with.
// Each section loads (and fails) on its own; ordering a plan or a top-up opens its payment page.

type UsageSpan = Extract<UsageRange, "7d" | "30d">;
const SPANS: { id: UsageSpan; label: string; days: number }[] = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
];
const CREDIT_SERIES: ChartSeries[] = [{ key: "credits", label: "Credits used", tone: "ink" }];

/** What's left, never rounded up ("0.96 credits left", not "1 credits left": a run needs a whole one), grouped like the rest of the page. */
function creditsLeftText(credits: CreditBalance) {
  if (credits.unlimited) return "Operator: not charged";
  const shown = creditCount(spendableCredits(credits.available));
  return `${shown} ${shown === "1" ? "credit" : "credits"} left`;
}
function allowanceHint(credits: CreditBalance) {
  if (credits.boost && credits.allowance === credits.boost.creditsPerWindow) return "The window starts when the boost begins and refills from that time.";
  return "The first window starts when you spend a credit, then it refills on that schedule.";
}

function refillText(credits: CreditBalance) {
  // Without an allowance nothing refills: the account's credits are its own (promo codes, grants).
  if (credits.unlimited || credits.allowance === 0) return null;
  if (!credits.resetsAt) return `${creditCount(credits.allowance)} every ${credits.windowHours} hours`;
  // A plan's allowance ends with the plan: a plan that ends first never sees this refill.
  const plan = credits.plan;
  if (plan && Date.parse(plan.expiresAt) < Date.parse(credits.resetsAt)) return `${plan.name} ends at ${clockText(plan.expiresAt)}, before this window refills`;
  return `Refills to ${creditCount(credits.allowance)} at ${clockText(credits.resetsAt)}`;
}

/** One request per section: the latest answer wins, an earlier one is kept while a newer one loads. */
function useLoad<T>(load: () => Promise<T>, fallback: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    setState(current => ({ ...current, error: null, loading: true }));
    load().then(
      data => { if (mine === seq.current) setState({ data, error: null, loading: false }); },
      error => { if (mine === seq.current) setState(current => ({ data: current.data, error: errorMessage(error, fallback), loading: false })); },
    );
  }, [load, fallback]);
  useEffect(() => {
    reload();
    return () => {
      seq.current += 1;
    };
  }, [reload]);
  return { ...state, reload };
}

export default function Billing() {
  const [, navigate] = useLocation();
  const { announce, region } = useAnnouncer();
  const { info, error: accountError } = useAccount();
  const catalog = useLoad(billingApi.catalog, "Couldn't load the plans.");
  const wallet = useLoad(billingApi.account, "Couldn't load your API balance.");
  const orders = useLoad(billingApi.orders, "Couldn't load your orders.");
  const [span, setSpan] = useState<UsageSpan>("7d");
  const loadUsage = useCallback(() => billingApi.creditUsage(span), [span]);
  const usage = useLoad(loadUsage, "Couldn't load your credit use.");
  const [creating, setCreating] = useState<PlanId | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const creatingRef = useRef(false);
  // An order that answers after the payer left the page stays on the Orders list: no pulling them back to pay it.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // /billing#api opens at the API balance once the sections above it have their final height.
  const jumped = useRef(false);
  const settled = Boolean((catalog.data || catalog.error) && (wallet.data || wallet.error) && (info || accountError));
  useEffect(() => {
    if (jumped.current || !settled || window.location.hash !== "#api") return;
    jumped.current = true;
    requestAnimationFrame(() => {
      const target = document.getElementById("api");
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
  }, [settled]);

  const credits = info?.credits ?? null;
  // What a plan does depends on the plan the account has: the account's, else the billing account's
  // (the same plan from a second request). Until one answers, the plan buttons wait.
  const planKnown = credits !== null || wallet.data !== null;
  const known = credits ? credits.plan : wallet.data?.plan ?? null;
  const plan = known && planState(known) ? known : null;
  const planError = !planKnown && accountError && wallet.error ? accountError : null;
  const retryPlan = () => {
    void refreshAccount();
    wallet.reload();
  };

  const orderPlan = async (planId: PlanId, name: string, months: number) => {
    if (creatingRef.current || !catalog.data?.paymentsOpen || !planKnown) return;
    creatingRef.current = true;
    setCreating(planId);
    setOrderError(null);
    announce(`Starting the ${name} order…`);
    try {
      const { order } = await billingApi.createOrder({ kind: "plan", planId, months });
      if (alive.current) navigate(`/pay/${encodeURIComponent(order.code)}`);
    } catch (error) {
      if (alive.current) setOrderError(errorMessage(error, "Couldn't start the order. Try again."));
    } finally {
      creatingRef.current = false;
      if (alive.current) setCreating(null);
    }
  };

  const offer = catalog.data ? offerBadge(catalog.data.discount, shortDayText) : null;
  const operator = Boolean(credits?.unlimited || wallet.data?.operator);
  const freeTier = catalog.data?.free ?? null;
  // Without a plan, the account's allowance is its own: the free one (often none), one the operator set, or the boost.
  const own = ownAllowance(credits, plan);
  const noAllowance = Boolean(credits && !credits.unlimited && !plan && own === 0);
  const onFree = Boolean(credits?.welcome && !credits.unlimited && !plan && own !== null && own === (freeTier?.creditsPerWindow ?? 0));

  return (
    <AppShell title="Plans & Billing">
      <div className="page">
        <div className="page-narrow bill-page">
          {region}
          <header className="page-head">
            <div>
              <span className="eyebrow">Plans & Billing</span>
              <h2 className="page-title">More credits, and a balance for the API</h2>
              <p className="page-sub">
                A plan raises your credits for a set number of days; it's paid once and doesn't renew. The Developer API is paid from a dollar balance you top up. Payments are made in crypto.
              </p>
            </div>
          </header>

          {catalog.data && offer && (
            <div className="bill-offer" role="note">
              <BadgePercent size={18} aria-hidden="true" />
              <p><strong>{offer}</strong> <span>{offerSentence(catalog.data.discount)} Top-ups aren't discounted.</span></p>
            </div>
          )}

          <section className="card" aria-labelledby="bill-account-title">
            <div className="card-head"><h2 id="bill-account-title">Your account</h2></div>
            {credits ? (
              <>
                <dl className="bill-facts">
                  <div className="bill-fact">
                    <dt>Plan</dt>
                    <dd>
                      {/* An account that started without the free credits isn't on the free one: say what it has. */}
                      <span className="bill-fact-value">{plan ? plan.name : !credits.welcome && !credits.unlimited ? "None" : "Free"}</span>
                      <span className="bill-fact-hint">
                        {plan ? `Until ${dayText(plan.expiresAt)} · ${daysLeftText(plan.expiresAt)}`
                          : credits.unlimited ? "Not charged"
                            : !credits.welcome ? "Credits on this account come from plans and promo codes."
                              : credits.boost ? `No plan: ${creditCount(credits.boost.creditsPerWindow)} every ${credits.boost.windowHours} hours while the boost lasts`
                                : onFree && noAllowance ? "No plan: welcome credits, and more on X" : "No plan"}
                      </span>
                    </dd>
                  </div>
                  <div className="bill-fact">
                    <dt>Credits</dt>
                    <dd>
                      <span className="bill-fact-value">{creditsLeftText(credits)}</span>
                      {refillText(credits) ? <span className="bill-fact-hint">{refillText(credits)}</span>
                        : !credits.unlimited && noAllowance && credits.welcome ? <span className="bill-fact-hint">Welcome credits don't refill.</span> : null}
                    </dd>
                  </div>
                  {!credits.unlimited && credits.allowance > 0 && (
                    <div className="bill-fact">
                      <dt>Allowance</dt>
                      <dd>
                        <span className="bill-fact-value">{creditCount(credits.allowance)} every {credits.windowHours} hours</span>
                        <span className="bill-fact-hint">{allowanceHint(credits)}</span>
                      </dd>
                    </div>
                  )}
                </dl>
                {operator && <p className="bill-note">The operator's account isn't charged for credits or API use, so it needs neither a plan nor a top-up.</p>}
              </>
            ) : accountError ? (
              <StateNotice variant="error" size="sm" title="Couldn't load your account" actions={<Button size="sm" icon={RotateCcw} onClick={() => void refreshAccount()}>Try again</Button>}>{accountError}</StateNotice>
            ) : (
              <div className="bill-facts" aria-hidden="true">
                {[0, 1, 2].map(index => <div key={index} className="bill-fact"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>)}
              </div>
            )}
          </section>

          {credits?.welcome && <EarnCredits onApiCredit={() => wallet.reload()} />}

          <section className="bill-section" aria-labelledby="bill-plans-title">
            <div className="bill-section-head">
              <h2 id="bill-plans-title" className="section-title">Plans</h2>
              <p className="field-hint">A plan runs from when its payment is applied. Paid once; nothing renews.</p>
            </div>
            {catalog.data ? (
              <PlanCards
                catalog={catalog.data}
                current={plan}
                planKnown={planKnown}
                planFailed={planError !== null}
                own={own}
                freeHere={onFree ? "yours" : credits && !credits.unlimited && !credits.welcome && !plan ? "not_included" : null}
                creating={creating}
                prepay={wallet.data?.prepay ?? null}
                onOrder={orderPlan}
              />
            ) : catalog.error ? (
              <div className="card">
                <StateNotice variant="error" size="sm" title="Couldn't load the plans" actions={<Button size="sm" icon={RotateCcw} onClick={catalog.reload}>Try again</Button>}>{catalog.error}</StateNotice>
              </div>
            ) : (
              <div className="bill-plans" aria-hidden="true">
                {[0, 1, 2].map(index => <div key={index} className="card bill-plan"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-block" /></div>)}
              </div>
            )}
            {catalog.data && planError && (
              <div className="card">
                <StateNotice variant="error" size="sm" title="Couldn't check your plan" actions={<Button size="sm" icon={RotateCcw} onClick={retryPlan}>Try again</Button>}>
                  {planError} What buying a plan does depends on the plan you have, so its buttons wait until it's known.
                </StateNotice>
              </div>
            )}
            {orderError && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{orderError}</p>}
            {catalog.data && !catalog.data.paymentsOpen && <p className="bill-note">Payments are paused right now, so plans can't be ordered. Your credits and any active plan keep working.</p>}
          </section>

          <section id="api" className="card bill-api" tabIndex={-1} aria-labelledby="bill-api-title">
            <div className="card-head">
              <h2 id="bill-api-title">Developer API balance</h2>
              <Link href="/developer" className="btn ghost sm">Usage and prices <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
            <div className="card-body bill-api-body">
              {wallet.data ? (
                <dl className="bill-facts bill-wallet">
                  {/* Never rounded up: a request whose hold is more than what's there is refused. */}
                  <div className="bill-fact"><dt>Balance</dt><dd><span className="bill-fact-value tabular">{spendableMicrosText(wallet.data.apiWallet.balanceMicros)}</span></dd></div>
                  <div className="bill-fact">
                    <dt>Reserved</dt>
                    <dd>
                      <span className="bill-fact-value tabular">{microsText(wallet.data.apiWallet.reservedMicros)}</span>
                      <span className="bill-fact-hint">{wallet.data.apiWallet.requestsInFlight > 0 ? `Held for ${wallet.data.apiWallet.requestsInFlight} running ${wallet.data.apiWallet.requestsInFlight === 1 ? "request" : "requests"}: the most they can cost` : "Nothing running"}</span>
                    </dd>
                  </div>
                  <div className="bill-fact"><dt>Available</dt><dd><span className="bill-fact-value tabular">{spendableMicrosText(wallet.data.apiWallet.availableMicros)}</span></dd></div>
                </dl>
              ) : wallet.error ? (
                <StateNotice variant="error" size="sm" title="Couldn't load your API balance" actions={<Button size="sm" icon={RotateCcw} onClick={wallet.reload}>Try again</Button>}>{wallet.error}</StateNotice>
              ) : (
                <div className="bill-facts" aria-hidden="true">{[0, 1, 2].map(index => <div key={index} className="bill-fact"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>)}</div>
              )}
              {operator && <p className="bill-note">The operator's API keys aren't charged; their use is still recorded for the charts.</p>}
              {/* /billing#api lands here: a failed catalog says so where the top-up belongs. */}
              {catalog.data ? <TopUpForm catalog={catalog.data} /> : catalog.error ? (
                <StateNotice variant="error" size="sm" title="Couldn't load the top-up options" actions={<Button size="sm" icon={RotateCcw} onClick={catalog.reload}>Try again</Button>}>{catalog.error}</StateNotice>
              ) : <span className="skeleton skeleton-block" aria-hidden="true" />}
            </div>
          </section>

          <section className="card" aria-labelledby="bill-usage-title" aria-busy={usage.loading || undefined}>
            <div className="card-head">
              <h2 id="bill-usage-title">Credits used</h2>
              <ToggleGroup.Root type="single" className="segmented" data-size="sm" aria-label="Period" value={span} onValueChange={value => { if (value === "7d" || value === "30d") setSpan(value); }}>
                {SPANS.map(item => <ToggleGroup.Item key={item.id} value={item.id}>{item.label}</ToggleGroup.Item>)}
              </ToggleGroup.Root>
            </div>
            <div className="card-body bill-usage">
              <CreditUse report={usage.data} error={usage.error} loading={usage.loading} onRetry={usage.reload} />
            </div>
          </section>

          <section className="card" aria-labelledby="bill-orders-title">
            <div className="card-head">
              <h2 id="bill-orders-title">Orders</h2>
              {orders.data && orders.data.orders.length > 0 && <span className="badge">{orders.data.orders.length}</span>}
            </div>
            {orders.data ? (
              orders.data.orders.length === 0 ? (
                <StateNotice variant="empty" size="sm" title="No orders yet">Plans and top-ups you order appear here, with their payment status.</StateNotice>
              ) : (
                <ul className="bill-orders">
                  {orders.data.orders.map(order => (
                    <li key={order.code}>
                      <Link href={`/pay/${encodeURIComponent(order.code)}`} className="bill-order">
                        <span className="bill-order-status"><PaymentStatusChip status={shownStatus(order)} size="sm" /></span>
                        <span className="bill-order-main">
                          <span className="bill-order-title">{order.title}</span>
                          <span className="bill-order-meta">
                            <span className="mono">{order.code}</span>
                            <span className="tabular">{formatUsd(order.priceUsd)}</span>
                            <span>{order.coin && order.network ? `${order.coin} · ${networkInfo(order.network)?.label ?? order.network}` : "No payment method yet"}</span>
                          </span>
                        </span>
                        <time className="bill-order-time" dateTime={order.createdAt}>{dayText(order.createdAt)}</time>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : orders.error ? (
              <StateNotice variant="error" size="sm" title="Couldn't load your orders" actions={<Button size="sm" icon={RotateCcw} onClick={orders.reload}>Try again</Button>}>{orders.error}</StateNotice>
            ) : (
              <div className="bill-orders" aria-hidden="true">{[0, 1].map(index => <div key={index} className="bill-order-skeleton"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>)}</div>
            )}
          </section>

          <section className="card" aria-labelledby="bill-methods-title">
            <div className="card-head"><h2 id="bill-methods-title">Paying with crypto</h2></div>
            <div className="card-body bill-methods">
              {catalog.data && (catalog.data.networks.length ? (
                <ul className="bill-networks" aria-label="Networks and coins accepted">
                  {catalog.data.networks.map(network => (
                    <li key={network.id} className="bill-network">
                      <span className="bill-network-name"><img src={network.logo} alt="" width={22} height={22} />{network.label}</span>
                      <span className="bill-coins">
                        {network.coins.map(coin => <span key={coin.coin} className="chip"><img src={coin.logo} alt="" width={14} height={14} />{coin.coin}</span>)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bill-note">No payment network is set up right now.</p>
              ))}
              <ul className="bill-rules">
                {/* True whether payments apply by themselves or wait for the operator's approval (the operator can turn that on). */}
                <li>Send the exact amount the payment page shows, on its network and in its coin. It's checked on-chain, then applied: by itself once it's confirmed, or after the operator has checked it.</li>
                <li>Crypto payments are final once they're applied.</li>
                <li>Plans don't renew: nothing is ever charged again by itself.</li>
                <li>A payment that can't be matched automatically goes to the operator, who reviews it. Keep its order code.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Free, Pro and Max: price (list and offer), credits per window against the free allowance, and the
 * button planAfterPurchase implies, once the account's plan is known. freeHere: the account has the
 * free allowance ("yours"), or has no allowance at all ("not_included"), so the Free card says which.
 * own: the account's own allowance where the page can see it; a plan at or under it adds nothing.
 */
function PlanCards({ catalog, current, planKnown, planFailed, own, freeHere, creating, prepay, onOrder }: {
  catalog: BillingCatalog;
  current: { id: PlanId; name: string; expiresAt: string } | null;
  planKnown: boolean;
  planFailed: boolean;
  own: number | null;
  freeHere: "yours" | "not_included" | null;
  creating: PlanId | null;
  /** The most months of each plan the account can pay for now (the server's limit; all of them until it loads). */
  prepay: Record<PlanId, number> | null;
  onOrder: (planId: PlanId, name: string, months: number) => void;
}) {
  // How many months each card is set to pay for (kept within what the account may still prepay).
  const [chosen, setChosen] = useState<Record<PlanId, number>>({ pro: 1, max: 1 });
  const configs = planConfigs(catalog.plans);
  const state = planState(current);
  const { creditsPerWindow: free, windowHours } = catalog.free;
  const freeLines = freeTierLines(catalog.free, shortDayText);
  const closed = !catalog.paymentsOpen;
  return (
    <ul className="bill-plans">
      <li className="card bill-plan" data-current={freeHere === "yours" || undefined}>
        <div className="bill-plan-head">
          <h3 className="bill-plan-name">Free</h3>
          {freeHere === "yours" && <span className="chip">Your plan</span>}
        </div>
        <p className="bill-plan-price"><span className="bill-plan-amount">$0</span></p>
        <p className="bill-plan-term">no payment</p>
        <p className="bill-plan-credits">
          {freeLines.headline}
          {freeLines.lines.map(line => <span key={line} className="bill-plan-multiple">{line}</span>)}
          <span className="bill-plan-multiple">{vaultText(false)}</span>
        </p>
        <p className="field-hint">{freeHere === "not_included" ? "Not included on this account." : free > 0 ? "The first window starts when you spend a credit, then it refills on that schedule." : "Welcome credits are given once and don't refill."}</p>
      </li>
      {catalog.plans.map(offer => {
        const room = prepay?.[offer.id] ?? MAX_PLAN_MONTHS;
        const months = Math.max(1, Math.min(chosen[offer.id] ?? 1, room || 1));
        const action = configs ? planAction(state, offer, configs, Date.now(), months) : null;
        // Each month at today's price and today's offer, rounded as the server rounds the order.
        const listTotal = offer.listUsd * months;
        const priceTotal = discountedUsd(listTotal, offer.discountPercent);
        const monthsId = `bill-plan-${offer.id}-months`;
        const mine = current?.id === offer.id;
        const discounted = offer.discountPercent > 0 && offer.listUsd > offer.priceUsd;
        const multiple = freeMultiple(offer.creditsPerWindow, free);
        // The account gets the larger of its own allowance and the plan's: this one would change nothing.
        const covered = own !== null && own >= offer.creditsPerWindow;
        const hintId = `bill-plan-${offer.id}-hint`;
        return (
          <li key={offer.id} className="card bill-plan" data-current={mine || undefined}>
            <div className="bill-plan-head">
              <h3 className="bill-plan-name">{offer.name}</h3>
              {mine && current && <span className="chip">Your plan · until {shortDayText(current.expiresAt)}</span>}
            </div>
            <p className="bill-plan-price">
              {discounted && <s className="bill-plan-list"><span className="sr-only">List price </span>{formatPrice(listTotal)}</s>}
              <span className="bill-plan-amount"><span className="sr-only">{discounted ? "Now " : ""}</span>{formatPrice(priceTotal)}</span>
              {discounted && <span className="chip">{offer.discountPercent}% off</span>}
            </p>
            <p className="bill-plan-term">
              {months > 1 ? `for ${monthsText(months)} (${offer.days * months} days), ${formatPrice(offer.priceUsd)} a month, paid once` : `for ${offer.days} days, paid once`}
            </p>
            <div className="field bill-plan-months">
              <label className="field-label" htmlFor={monthsId}>Pay for</label>
              <select
                id={monthsId}
                className="select"
                value={months}
                disabled={room === 0 || creating !== null}
                onChange={event => setChosen(previous => ({ ...previous, [offer.id]: Number(event.target.value) }))}
              >
                {Array.from({ length: MAX_PLAN_MONTHS }, (_, index) => index + 1).map(count => (
                  <option key={count} value={count} disabled={count > room}>
                    {monthsText(count)} · {formatPrice(discountedUsd(offer.listUsd * count, offer.discountPercent))}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {room === 0 ? `Your plan is already paid ${MAX_PLAN_MONTHS} months ahead, counting orders not paid yet.`
                  : room < MAX_PLAN_MONTHS ? `Up to ${monthsText(room)} more now: a plan runs at most ${MAX_PLAN_MONTHS} months ahead.`
                    : `Pay up to ${MAX_PLAN_MONTHS} months ahead at today's price.`}
              </p>
            </div>
            <p className="bill-plan-credits">
              {creditCount(offer.creditsPerWindow)} credits every {windowHours} hours
              {multiple && <span className="bill-plan-multiple">{multiple}× the free allowance</span>}
              <span className="bill-plan-multiple">{vaultText(true)}</span>
            </p>
            {/* What the button does comes first, so the buttons line up at the foot of every card. */}
            {!planKnown ? (
              // Until the plan is known, "Get Pro" could be wrong (on Max it adds days to Max): no guess.
              !planFailed && (
                <div className="bill-plan-action">
                  <Button variant="primary" block disabled>Checking your plan…</Button>
                </div>
              )
            ) : action && (
              <div className="bill-plan-action">
                <p id={hintId} className="field-hint">
                  {covered && own !== null ? `Your allowance is already ${creditCount(own)} credits every ${windowHours} hours, so ${offer.name} wouldn't raise it.` : action.hint}
                </p>
                <Button
                  variant={covered ? "secondary" : "primary"}
                  block
                  busy={creating === offer.id}
                  disabled={(creating !== null && creating !== offer.id) || room === 0}
                  aria-disabled={closed || undefined}
                  aria-describedby={hintId}
                  title={closed ? "Payments are paused right now" : undefined}
                  onClick={() => onOrder(offer.id, offer.name, months)}
                >
                  {creating === offer.id ? "Starting…" : action.label}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Credits used per day, from the server's report (labelled with the span the report covers, not the one just picked). */
function CreditUse({ report, error, loading, onRetry }: { report: CreditUsageReport | null; error: string | null; loading: boolean; onRetry: () => void }) {
  if (!report) {
    return error ? (
      <StateNotice variant="error" size="sm" title="Couldn't load your credit use" actions={<Button size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button>}>{error}</StateNotice>
    ) : (
      <>
        <p className="sr-only" role="status">Loading your credit use…</p>
        <span className="skeleton bill-chart-skeleton" aria-hidden="true" />
      </>
    );
  }
  const days = SPANS.find(item => item.id === report.range)?.days ?? report.buckets.length;
  const unit = report.bucket === "hour" ? "hour" : "day";
  return (
    <>
      {/* Runs are charged to the hundredth: creditCount keeps those decimals, so a 0.03 week doesn't read "0". */}
      <p className="bill-usage-total">
        <span className="tabular">{creditCount(report.totals.credits)}</span> credits across <span className="tabular">{report.totals.runs.toLocaleString("en-US")}</span> {report.totals.runs === 1 ? "run" : "runs"} in the last {days} days
      </p>
      <TimeBars
        data={report.buckets.map(bucket => ({ start: bucket.start, values: { credits: bucket.credits } }))}
        series={CREDIT_SERIES}
        bucket={report.bucket}
        format={creditCount}
        ariaLabel={`Credits used per ${unit}, last ${days} days`}
        timeZone={report.timeZone}
      />
      {report.allowance > 0 && <p className="field-hint">Your allowance is {creditCount(report.allowance)} credits every {report.windowHours} hours.</p>}
      {error && !loading && (
        <div className="notice" data-tone="danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">{error} The chart still shows the last {days} days.</div>
          <div className="notice-actions"><Button size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button></div>
        </div>
      )}
    </>
  );
}
