import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Redirect, useLocation } from "wouter";
import { CircleCheck, CircleX, ExternalLink, Info, Printer, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { DEFAULT_PLANS, isPlanId, networkInfo, normalizeOrderCode, normalizeTxHash, type BillingCatalog, type CoinId, type NetworkId, type PaymentOrder } from "@shared/billing";
import { billingApi, type NewOrder } from "@/lib/billing";
import { ApiError, errorMessage } from "@/lib/api";
import { clockText, refreshAccount, useAccount } from "@/lib/account";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { useCountdown } from "@/components/common/useCountdown";
import { useAnnouncer } from "@/components/task/useAnnouncer";
import { HashForm } from "@/components/billing/HashForm";
import { MethodPicker } from "@/components/billing/MethodPicker";
import { OrderSummary, OrderTimeline } from "@/components/billing/OrderSummary";
import { PaymentDetails } from "@/components/billing/PaymentDetails";
import { Receipt } from "@/components/billing/Receipt";
import { dayText, fullText } from "@/components/billing/format";
import {
  canSubmitHash, completedText, confirmationShare, confirmationText, detailsIssued, doubleCheck, milestone, payView, pollDelay, retryDelay, shortHash, shownStatus, submitDeadline, transferFound,
  type PayView,
} from "@/components/billing/orderState";

// The payment page for one order (the CurialyTeam flow): pick a network and a coin, send the exact
// amount to the wallet shown, paste the transaction hash, and watch the server check it on-chain.
// Responses are sequenced so an older one never overwrites a newer one; one action runs at a time;
// actions wait while the order on screen is out of date. Polling: every 5 s while the network is
// checked, every 20 s while a payment is awaited, every 30 s while the operator reviews it, never
// while the tab is hidden; after a failed ask it keeps trying, backing off to once a minute.

type Load = "loading" | "ready" | "missing" | "failed";
type Busy = "method" | "hash" | "reorder" | null;
/** stays: it explains the panel its catch-up moves to (details issued for another coin, a payment confirming meanwhile), so that move keeps it. */
type ActionError = { action: Exclude<Busy, null>; title: string; message: string; advice: string; stays?: boolean };

/** No answer, or a failure the server didn't explain: the request may have gone through, so the order itself says what happened. */
const outcomeUnknown = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || (error.status >= 500 && (!error.code || error.code === "server_error"));

const HEADLINE: Record<PayView, string> = {
  choose: "Choose how to pay",
  pay: "Send the payment",
  pending: "Checking the network",
  confirming: "Confirming the payment",
  completed: "Payment complete",
  review: "Payment in review",
  rejected: "Payment rejected",
  expired: "This order expired",
};

function subline(order: PaymentOrder, view: PayView): string {
  const where = networkInfo(order.network)?.label ?? "the network";
  switch (view) {
    case "choose": return "Pick the network and the coin you'll pay with. The wallet and the exact amount come next.";
    case "pay": return `Send exactly ${order.expectedAmount} ${order.coin} on ${where}, then paste the transaction hash below.`;
    case "pending": return `Your transaction is being looked for on ${where}. This page updates by itself.`;
    case "confirming": return `Your transaction is on ${where} and is being confirmed.`;
    case "completed": return "The payment is applied to your account.";
    // Not every review ends in the payment's favour (nothing may have arrived): no promise here.
    case "review": return "The operator is reviewing this payment and decides what happens next; this page shows the result.";
    case "rejected": return "This payment wasn't accepted.";
    default: return "Its payment window has closed.";
  }
}

/** /pay/:code: a code typed in another case or without the dash moves to its canonical address. */
export default function Pay({ code: raw }: { code: string }) {
  const code = normalizeOrderCode(raw);
  if (code && code !== raw) return <Redirect to={`/pay/${code}`} replace />;
  return <PayPage code={code} />;
}

function PayPage({ code }: { code: string | null }) {
  const [, navigate] = useLocation();
  const account = useAccount().info;
  const { announce, region } = useAnnouncer();
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [load, setLoad] = useState<Load>(code ? "loading" : "missing");
  const [loadError, setLoadError] = useState<string | null>(null);
  // Failed asks in a row while an order is on screen; a 401 stops them (signing in again is the app's).
  const [failures, setFailures] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  // An action that changed nothing, said so (the hash submitted again is the one the order has).
  const [actionNote, setActionNote] = useState<string | null>(null);
  // The hash being typed: kept here so it survives the panel switching to the late form at the deadline.
  const [draftHash, setDraftHash] = useState("");
  // Bumped after every action, so polling picks up again even when the action changed nothing.
  const [kick, setKick] = useState(0);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const lastFetch = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  // Focus was last in the panel: the control an action used goes with the panel it swaps out.
  const focusInPanel = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current += 1;
    };
  }, []);

  const fetchOrder = useCallback(async (manual = false) => {
    if (!code) return;
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    if (manual) setRefreshing(true);
    try {
      const { order: next } = await billingApi.order(code);
      if (!alive.current || mine !== seq.current) return;
      setOrder(next);
      setLoad("ready");
      setLoadError(null);
      setFailures(0);
      setSignedOut(false);
      if (manual) announce("Order status updated.");
    } catch (error) {
      if (!alive.current || mine !== seq.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setOrder(null);
        setLoad("missing");
        setLoadError(null);
        setFailures(0);
      } else {
        // With an order on screen this is a stale view (actions wait, asks back off); without one, a failed load.
        setLoad(current => (current === "ready" ? current : "failed"));
        setLoadError(errorMessage(error, "Couldn't load this order."));
        setFailures(count => count + 1);
        setSignedOut(error instanceof ApiError && error.status === 401);
      }
    } finally {
      if (alive.current && mine === seq.current) setRefreshing(false);
    }
  }, [code, announce]);

  useEffect(() => void fetchOrder(), [fetchOrder]);

  const loadCatalog = useCallback(() => {
    setCatalogError(null);
    billingApi.catalog().then(
      data => alive.current && setCatalog(data),
      error => alive.current && setCatalogError(errorMessage(error, "Couldn't load the payment networks.")),
    );
  }, []);
  useEffect(() => loadCatalog(), [loadCatalog]);

  // The deadline flips the view to expired here, at the second it passes; the late-hash window closes the same way.
  const awaiting = order?.status === "awaiting_payment";
  const secondsLeft = useCountdown(awaiting && order ? Date.parse(order.expiresAt) : null, 1000);
  const lateUntil = order && (awaiting || order.status === "expired") ? submitDeadline(order) : null;
  useCountdown(lateUntil, 30_000);
  const now = Date.now();
  const view = order ? payView(order, now) : null;
  const status = order ? shownStatus(order, now) : null;
  const stale = Boolean(order && loadError);
  const ready = !busy && !refreshing && !stale;
  const hashOpen = order ? canSubmitHash(order, now) : false;

  // Ask again while the order can move by itself; each answer (or action) arms the next ask. A
  // failed ask (a restart, a dropped connection) is retried with a backoff instead of stopping.
  const pace = order && !busy ? pollDelay(order.status) : null;
  const delay = pace === null ? null : !loadError ? pace : signedOut ? null : retryDelay(failures, pace);
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") void fetchOrder();
    }, Math.max(1000, lastFetch.current + delay - Date.now()));
    return () => clearTimeout(timer);
  }, [delay, fetchOrder, order, kick, failures]);

  // Back on the tab: catch up at once (a hidden tab isn't polled), out of date or not.
  const open = order !== null && order.status !== "completed" && order.status !== "rejected" && order.status !== "expired";
  useEffect(() => {
    if (!open || signedOut) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && !inFlight.current && Date.now() - lastFetch.current >= 3000) void fetchOrder();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [open, signedOut, fetchOrder]);

  // Milestones: the page announces each new panel once (not the first one it opens on).
  const shownView = useRef<PayView | null>(null);
  useEffect(() => {
    if (!order || !view) return;
    const before = shownView.current;
    shownView.current = view;
    if (before === null || before === view) return;
    const text = milestone(order, view);
    if (text) announce(text);
    // What an action said was about the panel before (one that explains this move stays for it).
    setActionError(error => (error?.stays ? { ...error, stays: false } : null));
    setActionNote(null);
    // The focused control went with the old panel: the new one takes focus (its title names it).
    const active = document.activeElement;
    if (focusInPanel.current && (!active || active === document.body || !active.isConnected)) panelRef.current?.focus({ preventScroll: true });
    // The sidebar's credits (and plan) change with a completed order.
    if (view === "completed") void refreshAccount();
  }, [order, view, announce]);

  // A new hash on the order (this page's, or from another tab) settles what was said about the last one.
  const currentHash = order?.txHash ?? null;
  const orderNetwork = order?.network ?? null;
  useEffect(() => {
    setActionError(error => (error?.action === "hash" ? null : error));
    setActionNote(null);
    // The hash typed is the order's now (an answer was lost, and the check showed it): nothing is left to submit.
    if (currentHash && orderNetwork) setDraftHash(draft => (normalizeTxHash(orderNetwork, draft) === currentHash ? "" : draft));
  }, [currentHash, orderNetwork]);

  const begin = (kind: Exclude<Busy, null>) => {
    if (!ready || inFlight.current) return false;
    inFlight.current = true;
    // A poll still in flight must not overwrite what this action returns.
    seq.current += 1;
    setBusy(kind);
    setActionError(null);
    setActionNote(null);
    return true;
  };
  const finish = () => {
    inFlight.current = false;
    if (!alive.current) return;
    setBusy(null);
    setKick(count => count + 1);
  };
  const apply = (next: PaymentOrder) => {
    seq.current += 1;
    setOrder(next);
    setLoad("ready");
    setLoadError(null);
    setFailures(0);
  };
  // A 409 means the order moved on (details already issued, already confirming, expired): show what it is now.
  const catchUp = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409) void fetchOrder();
  };

  const chooseMethod = async (network: NetworkId, coin: CoinId) => {
    if (!code || !begin("method")) return;
    try {
      const { order: next } = await billingApi.chooseMethod(code, network, coin);
      if (alive.current) apply(next);
    } catch (error) {
      if (!alive.current) return;
      const message = errorMessage(error, "Something went wrong.");
      if (outcomeUnknown(error)) {
        setActionError({ action: "method", title: "We couldn't tell whether the details were issued", message, advice: "The page checks the order again. Don't send anything until the wallet and the exact amount show on this page." });
        void fetchOrder();
      } else {
        // Details issued earlier for another network or coin: the catch-up shows those, and this says why.
        const locked = error instanceof ApiError && error.code === "details_locked";
        setActionError({ action: "method", title: "Couldn't get the payment details", message, advice: locked ? "This page now shows the details that were issued." : "Don't send anything until the wallet and the exact amount show on this page.", stays: locked });
        catchUp(error);
      }
    } finally {
      finish();
    }
  };

  const submitHash = async (txHash: string) => {
    if (!code || !begin("hash")) return;
    const before = view;
    const previous = order?.txHash ?? null;
    try {
      const { order: next } = await billingApi.submitHash(code, txHash);
      if (!alive.current) return;
      apply(next);
      setDraftHash("");
      if (previous === txHash && next.txHash === txHash) {
        // The server keeps a hash it already has as it is: nothing new is checked.
        setActionNote("That hash is already on this order.");
        announce("That hash is already on this order.");
      } else if (before === "pending" && payView(next) === "pending") {
        // A replacement while the first hash is looked for keeps the same panel, so say it here.
        announce(`New transaction hash received. Looking for it on ${networkInfo(next.network)?.label ?? "the network"}.`);
      }
    } catch (error) {
      if (!alive.current) return;
      const message = errorMessage(error, "Something went wrong.");
      if (outcomeUnknown(error)) {
        // The server may have stored it: the order says, and a hash it shows ends this message.
        setActionError({ action: "hash", title: "We couldn't tell whether the hash was received", message, advice: "The page checks the order again: if the hash doesn't show on it, submit it once more. Don't send the payment again." });
        void fetchOrder();
      } else {
        const reason = error instanceof ApiError ? error.code : undefined;
        // Confirming, completed or rejected meanwhile: the catch-up shows it, and there's nothing to resubmit.
        const moved = reason === "already_confirming" || reason === "order_completed" || reason === "order_rejected";
        const advice = moved ? "This page now shows where the order is."
          : reason === "order_expired" ? ""
            : reason === "too_many_orders" ? "Don't send the payment again."
              : error instanceof ApiError && error.status === 429 ? "Don't send the payment again: submit the hash once more in a few minutes."
                : "Don't send the payment again: check the hash and submit it once more.";
        setActionError({ action: "hash", title: "The transaction hash wasn't taken", message, advice, stays: moved });
        catchUp(error);
      }
    } finally {
      finish();
    }
  };

  const startNewOrder = async () => {
    if (!order || !begin("reorder")) return;
    const input: NewOrder = order.kind === "plan" && order.planId ? { kind: "plan", planId: order.planId } : { kind: "api", amountUsd: Math.round(order.creditUsd ?? order.listUsd) };
    try {
      const { order: next } = await billingApi.createOrder(input);
      if (alive.current) navigate(`/pay/${encodeURIComponent(next.code)}`);
    } catch (error) {
      if (alive.current) setActionError({ action: "reorder", title: "Couldn't start a new order", message: errorMessage(error, "Something went wrong."), advice: "Your orders are listed on the Plans & Billing page." });
    } finally {
      finish();
    }
  };

  // The operator can rename plans: the catalog's name first, then the account's, then the default.
  const planName = (id: string) => {
    const offered = catalog?.plans.find(plan => plan.id === id);
    if (offered) return offered.name;
    const own = account?.credits.plan;
    if (own && own.id === id) return own.name;
    return isPlanId(id) ? DEFAULT_PLANS[id].name : id;
  };

  if (!order || !view || !status) {
    return (
      <AppShell title="Payment" crumb="Plans & Billing" crumbHref="/billing">
        <div className="page">
          <div className="page-narrow pay-page">
            {load === "loading" ? (
              <StateNotice variant="loading" size="lg" title="Loading the order…" />
            ) : load === "missing" ? (
              <StateNotice variant="empty" size="lg" title="No order with that code on this account" actions={<Link href="/billing" className="btn primary">Go to Plans & Billing</Link>}>
                Check the link, and that you're signed in to the account that placed the order: Plans & Billing lists all of its orders. If you already sent a payment, keep its transaction hash and don't pay again.
              </StateNotice>
            ) : (
              <StateNotice variant="error" size="lg" title="Couldn't load the order" actions={<><Button variant="primary" icon={RotateCcw} busy={refreshing} onClick={() => void fetchOrder(true)}>Try again</Button><Link href="/billing" className="btn">Plans & Billing</Link></>}>
                {loadError} The order isn't gone: don't send a payment until its details show here.
              </StateNotice>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  const network = networkInfo(order.network);
  const where = network?.label ?? "the network";
  const actions: TopbarAction[] = [
    { id: "refresh", label: refreshing ? "Checking…" : "Check now", icon: RefreshCw, priority: "secondary", busy: refreshing, disabled: Boolean(busy), title: "Ask the server for this order's status now", onSelect: () => void fetchOrder(true) },
  ];
  const hashForm = (sent: boolean, submitLabel?: string) => (
    <HashForm order={order} value={draftHash} onValueChange={setDraftHash} sent={sent} submitting={busy === "hash"} blocked={!ready} submitLabel={submitLabel} onSubmit={txHash => void submitHash(txHash)} />
  );
  const txLink = order.txHash ? (
    <p className="pay-tx">
      <span className="micro">Transaction</span>
      {order.explorerUrl ? (
        <a className="link" href={order.explorerUrl} target="_blank" rel="noopener noreferrer">
          <span className="mono">{shortHash(order.txHash)}</span><ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (view on {network?.explorer.name ?? "the block explorer"}, opens in a new tab)</span>
        </a>
      ) : <span className="mono">{shortHash(order.txHash)}</span>}
    </p>
  ) : null;

  // A new hash replaces the order's: what the check found for the old one goes with it. A match is
  // this order's payment, so there's nothing to replace; a transfer that didn't match is named first.
  const found = transferFound(order);
  const replaceFold = hashOpen && found !== "match" ? (
    <details className="pay-more">
      <summary>Pasted the wrong hash?</summary>
      {found === "other" && order.txHash && (
        <div className="notice pay-replace" data-tone="warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <p>This replaces the transaction above (<span className="mono">{shortHash(order.txHash)}</span>, {order.receivedAmount} {order.coin} received): the order stops showing it.</p>
            {order.receivedAmount !== order.expectedAmount && <p>Sent a second transfer to make up a difference? Don't paste it here: keep both hashes and the order code for the operator, who adds them up.</p>}
          </div>
        </div>
      )}
      {hashForm(true, "Replace the hash")}
    </details>
  ) : null;

  let panel: ReactNode = null;
  switch (view) {
    case "choose":
      panel = <MethodPicker order={order} catalog={catalog} catalogError={catalogError} onRetryCatalog={loadCatalog} busy={busy === "method"} blocked={!ready} onChoose={chooseMethod} />;
      break;
    case "pay":
      panel = (
        <>
          <PaymentDetails order={order} onCopied={announce} />
          <section className="pay-submit" aria-labelledby="pay-submit-title">
            <h3 id="pay-submit-title" className="pay-step-title">Then paste the transaction hash</h3>
            {hashForm(false)}
          </section>
        </>
      );
      break;
    case "pending":
      panel = (
        <div className="pay-state">
          <p className="pay-state-lead"><Spinner size={16} />Looking for your transaction on {where}…</p>
          {order.statusDetail && <p className="pay-text">{order.statusDetail}</p>}
          {txLink}
          <p className="field-hint">The page checks again every few seconds{network ? `; ${network.label} usually confirms in ${network.wait}` : ""}. You can close it: the check carries on without it.</p>
          {replaceFold}
        </div>
      );
      break;
    case "confirming": {
      // Every confirmation in, and a second network provider asked before it counts: the server's
      // words, not a full bar that reads as done.
      const checking = doubleCheck(order);
      const counts = confirmationText(order);
      const share = confirmationShare(order);
      const required = order.requiredConfirmations ?? network?.confirmations ?? 0;
      panel = (
        <div className="pay-state">
          <p className="pay-state-lead">Found on {where}.</p>
          {checking ? (
            <p className="pay-text">{checking}</p>
          ) : required > 1 && counts && share !== null ? (
            <div className="pay-progress">
              <div className="pay-progress-head"><span id="pay-confirmations">Confirmations</span><span className="tabular">{counts}</span></div>
              <div className="pay-progress-track" role="progressbar" aria-labelledby="pay-confirmations" aria-valuemin={0} aria-valuemax={required} aria-valuenow={Math.round(share * required)} aria-valuetext={counts}>
                <span style={{ width: `${Math.round(share * 100)}%` }} />
              </div>
            </div>
          ) : (
            <p className="pay-text">{order.statusDetail ?? `Waiting for ${where} to finalize it.`}</p>
          )}
          <p className="field-hint">{required > 1 && !checking ? `A payment on ${where} needs ${required} confirmations, usually ${network?.wait ?? "within minutes"}. ` : ""}The page updates by itself.</p>
          {txLink}
        </div>
      );
      break;
    }
    case "completed":
      panel = (
        <div className="pay-state">
          <div className="pay-done">
            <CircleCheck size={28} aria-hidden="true" />
            <div className="pay-done-body">
              <h3 className="serif-title">Thank you</h3>
              <p className="pay-text">{completedText(order, planName, account?.credits.plan ?? null, account?.credits.windowHours ?? catalog?.free.windowHours ?? null)}</p>
              <div className="cluster">
                <Link href="/" className="btn primary">Back to the workspace</Link>
                <Link href="/developer" className="btn">Developer API</Link>
              </div>
            </div>
          </div>
          <Receipt order={order} account={account?.user ?? null} planName={planName} />
          <div className="pay-receipt-actions">
            <Button icon={Printer} onClick={() => window.print()}>Print or save as PDF</Button>
            <span className="field-hint">Prints the receipt alone.</span>
          </div>
        </div>
      );
      break;
    case "review":
      panel = (
        <div className="pay-state">
          <div className="notice" data-tone="warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <div className="notice-body">
              <strong className="notice-title">The operator is reviewing this payment</strong>
              {order.statusDetail && <p>{order.statusDetail}</p>}
            </div>
          </div>
          {txLink}
          {/* What to do depends on what the check found: a match only waits, anything else may need the right hash. */}
          {found === "match" ? (
            <p className="pay-text">The transaction above sent exactly this order's amount, so there's nothing more to send or paste. Keep the order code <code className="mono">{order.code}</code>: the operator decides, and this page shows the result.</p>
          ) : (
            <p className="pay-text">
              {found === "other" ? "Payments that can't be matched automatically are checked by hand. " : ""}
              Keep the order code <code className="mono">{order.code}</code>, and don't send another payment for this order unless the operator asks you to.
              {found === "none" && replaceFold ? " If the hash above is the wrong one, paste the right one below." : ""}
            </p>
          )}
          {replaceFold}
        </div>
      );
      break;
    case "rejected":
      panel = (
        <div className="pay-state">
          <div className="notice" data-tone="danger">
            <CircleX size={16} aria-hidden="true" />
            <div className="notice-body">
              <strong className="notice-title">This payment was rejected</strong>
              {order.statusDetail && <p>{order.statusDetail}</p>}
            </div>
          </div>
          {txLink}
          {/* What a rejection usually asks for: paying again, on a new order. */}
          <div className="pay-new">
            <Button variant="primary" icon={RotateCcw} busy={busy === "reorder"} aria-disabled={!ready || undefined} onClick={() => void startNewOrder()}>{busy === "reorder" ? "Starting…" : "Start a new order"}</Button>
            <Link href="/billing" className="btn">Back to Plans & Billing</Link>
          </div>
        </div>
      );
      break;
    case "expired": {
      const issued = detailsIssued(order);
      panel = (
        <div className="pay-state">
          <p className="pay-state-lead">{issued ? `The payment window closed at ${clockText(order.expiresAt)} on ${dayText(order.expiresAt)}.` : "It expired before payment details were issued."}</p>
          <p className="pay-text">Don't send a payment for this order now.</p>
          {hashOpen && lateUntil !== null && (
            <section className="pay-late" aria-labelledby="pay-late-title">
              <h3 id="pay-late-title" className="pay-step-title">Already sent it? Paste the transaction hash</h3>
              <p className="field-hint">If you sent exactly {order.expectedAmount} {order.coin} on {where}, it's checked like any other payment; one made after the window closed may go to the operator's review. This stays open until {fullText(new Date(lateUntil).toISOString())}.</p>
              {hashForm(true)}
            </section>
          )}
          <div className="pay-new">
            <Button variant={hashOpen ? "secondary" : "primary"} icon={RotateCcw} busy={busy === "reorder"} aria-disabled={!ready || undefined} onClick={() => void startNewOrder()}>{busy === "reorder" ? "Starting…" : "Start a new order"}</Button>
            <span className="field-hint">{order.title}, at the current price.</span>
          </div>
        </div>
      );
      break;
    }
  }

  return (
    <AppShell title={order.title} crumb="Plans & Billing" crumbHref="/billing" topbarActions={actions}>
      <div className="page">
        <div className="page-narrow pay-page">
          {region}
          <header className="page-head">
            <div>
              <span className="eyebrow">Payment</span>
              <h2 id="pay-title" className="page-title">{HEADLINE[view]}</h2>
              <p className="page-sub">{subline(order, view)}</p>
            </div>
          </header>
          {stale && (
            <div className="notice pay-stale" data-tone="danger" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body">
                <strong className="notice-title">Couldn't refresh this order</strong>
                <p>{loadError} What's shown may be out of date{delay !== null ? ", and the page keeps trying by itself" : ""}: check again before you send anything.</p>
              </div>
              <div className="notice-actions"><Button size="sm" icon={RotateCcw} busy={refreshing} onClick={() => void fetchOrder(true)}>Try again</Button></div>
            </div>
          )}
          <div className="pay-grid">
            <OrderSummary order={order} status={status} secondsLeft={status === "awaiting_payment" ? secondsLeft : null} onCopied={announce} />
            <section
              ref={panelRef}
              className="card pay-panel"
              tabIndex={-1}
              aria-labelledby="pay-title"
              aria-busy={busy || refreshing ? true : undefined}
              onFocus={() => {
                focusInPanel.current = true;
              }}
              onBlur={event => {
                // Only a move to something else on the page: a control removed with its panel blurs to nothing.
                const next = event.relatedTarget;
                if (next instanceof Node && !event.currentTarget.contains(next)) focusInPanel.current = false;
              }}
            >
              {panel}
              {stale && <p className="field-hint">Actions wait until this order is up to date: use Try again at the top of the page.</p>}
              {actionNote && (
                <div className="notice pay-action-note" data-tone="info">
                  <Info size={16} aria-hidden="true" />
                  <div className="notice-body">{actionNote}</div>
                </div>
              )}
              {actionError && (
                <div className="notice pay-action-error" data-tone="danger" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <div className="notice-body">
                    <strong className="notice-title">{actionError.title}</strong>
                    <p>{actionError.message}{actionError.advice ? ` ${actionError.advice}` : ""}</p>
                  </div>
                </div>
              )}
            </section>
            <OrderTimeline order={order} now={now} />
          </div>
        </div>
      </div>
      {view === "completed" && createPortal(<div className="receipt-print"><Receipt order={order} account={account?.user ?? null} planName={planName} idPrefix="receipt-print" /></div>, document.body)}
    </AppShell>
  );
}
