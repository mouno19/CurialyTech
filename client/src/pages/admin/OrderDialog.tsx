import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Check, CircleX, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_PLANS, formatUsd, networkInfo, PAYMENT_STATUS, type AdminPaymentOrder, type BillingAccount, type BillingSettings, type PaymentStatus, type PlanId } from "@shared/billing";
import { CopyButton } from "@/components/billing/CopyButton";
import { creditCount, dayText, fullText, momentText } from "@/components/billing/format";
import { PaymentStatusChip } from "@/components/billing/PaymentStatusChip";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Dialog } from "@/components/common/Dialog";
import { StateNotice } from "@/components/common/StateNotice";
import { errorMessage, relativeTime } from "@/lib/api";
import { adminBillingApi } from "@/lib/billing";
import { ExplorerLink, Fact, focusWhenClosed } from "./parts";
import {
  accountName, ACTOR_LABEL, appliedText, approveCaution, approveDetail, approveText, chainFinding, confirmationsText, explorerAddressUrl, methodText, orderChangeText,
} from "./payments";

/** A hash or an address: monospace, breaks anywhere, with a copy button and the explorer link. */
function ChainValue({ value, what, href, explorer, onCopied }: { value: string; what: string; href: string | null; explorer: string | undefined; onCopied: (message: string) => void }) {
  return (
    <span className="admin-chain-value">
      <code className="admin-mono">{value}</code>
      <span className="admin-chain-actions">
        <CopyButton value={value} what={what} onCopied={onCopied} variant="ghost" />
        <ExplorerLink href={href} explorer={explorer} what={`the ${what.toLowerCase()}`} />
      </span>
    </span>
  );
}

const FINDING_ICON = { success: Check, warning: TriangleAlert, neutral: null } as const;

/**
 * How often an open order reloads: every 10 s while the network is checked, every 20 s while the
 * payer can still change it (another hash on an order in review, a late one on an expired order).
 * Completed and rejected orders don't move on by themselves.
 */
const FOLLOW_MS: Partial<Record<PaymentStatus, number>> = { pending: 10_000, confirming: 10_000, awaiting_payment: 20_000, review: 20_000, expired: 20_000 };

/**
 * One order with everything the server knows about it, and the operator's actions: check the
 * transaction on-chain again, approve and apply the order, or reject it with a reason. An order
 * that can still move on reloads while the dialog is open (and on coming back to the tab), and is
 * read again right before an approval or a rejection goes through.
 */
export function OrderDialog({ code, settings, onClose, onChanged, announce }: {
  code: string;
  /** The billing settings: the plans' names and lengths, for what approving would give. */
  settings: BillingSettings | null;
  onClose: () => void;
  /** The order changed: checked again, approved or rejected here, or moved on by itself. */
  onChanged: (order: AdminPaymentOrder) => void;
  /** The page's status region (copies, status changes). */
  announce: (message: string) => void;
}) {
  const [order, setOrder] = useState<AdminPaymentOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  // The operator approved it here (rather than the order completing by itself while a confirmation was open).
  const [approvedHere, setApprovedHere] = useState(false);
  // The account's plan, for what approving a plan order gives (undefined: not known yet).
  const [accountPlan, setAccountPlan] = useState<BillingAccount["plan"] | undefined>(undefined);
  const id = useId();
  // Every write counts: a reload that started before an action finished must not undo it.
  const version = useRef(0);
  const statusRef = useRef(order?.status);
  statusRef.current = order?.status;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const show = useCallback((next: AdminPaymentOrder) => {
    version.current += 1;
    setOrder(next);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const mine = version.current;
    try {
      const result = await adminBillingApi.order(code);
      if (mine === version.current) show(result.order);
    } catch (loadError) {
      setError(errorMessage(loadError, "Couldn't load this order."));
    }
  }, [code, show]);
  useEffect(() => void load(), [load]);

  // Orders that can still move on, by themselves or by the payer, are followed while the dialog is
  // open, and caught up at once on coming back to the tab (from the block explorer, say).
  const status = order?.status;
  const follow = useCallback(() => {
    const mine = version.current;
    adminBillingApi.order(code).then(({ order: next }) => {
      if (mine !== version.current) return;
      const before = statusRef.current;
      show(next);
      if (before !== next.status) {
        onChangedRef.current(next);
        announce(`${next.code} is now ${PAYMENT_STATUS[next.status].label.toLowerCase()}.`);
      }
    }, () => undefined);
  }, [code, show, announce]);
  useEffect(() => {
    const every = status ? FOLLOW_MS[status] : undefined;
    if (!every) return;
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => { if (visible()) follow(); }, every);
    const onVisibility = () => { if (visible()) follow(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status, follow]);

  const userId = order?.user.id;
  const wantsPlan = order?.kind === "plan" && order.status !== "completed";
  useEffect(() => {
    if (!userId || !wantsPlan) return;
    let live = true;
    adminBillingApi.account(userId).then(result => { if (live) setAccountPlan(result.plan); }, () => undefined);
    return () => { live = false; };
  }, [userId, wantsPlan]);

  const planName = (planId: PlanId) => settings?.plans[planId]?.name ?? DEFAULT_PLANS[planId].name;

  const recheck = async () => {
    setChecking(true);
    setActionError(null);
    try {
      const { order: next } = await adminBillingApi.recheck(code);
      show(next);
      onChanged(next);
      toast(`Checked ${next.code} again`, { description: `${PAYMENT_STATUS[next.status].label}${next.statusDetail ? `: ${next.statusDetail}` : ""}` });
    } catch (checkError) {
      setActionError(errorMessage(checkError, "Couldn't check it again."));
    } finally {
      setChecking(false);
    }
  };
  // The order as the operator saw it when they opened Approve or Reject: the decision is about that order.
  const seen = useRef<AdminPaymentOrder | null>(null);
  const openConfirm = (open: (value: boolean) => void) => {
    seen.current = order;
    open(true);
  };
  // The button that opened the confirmation is gone once the order is completed or rejected: focus goes to its new status.
  const statusBox = useRef<HTMLDivElement>(null);
  /**
   * Reads the order again right before a decision goes through (false: there is nothing to decide).
   * When it moved on since the confirmation opened (the payer sent another hash, a check finished),
   * the dialog shows it as it is now and the confirmation says why it needs another look (a second
   * confirm acts on what is shown then). One that completed by itself closes the confirmation.
   */
  const unchanged = async () => {
    const { order: fresh } = await adminBillingApi.order(code);
    const changed = seen.current ? orderChangeText(seen.current, fresh) : null;
    if (!changed) return true;
    const before = statusRef.current;
    seen.current = fresh;
    show(fresh);
    if (before !== fresh.status) onChanged(fresh);
    if (fresh.status !== "completed") throw new Error(changed);
    toast(changed);
    focusWhenClosed(statusBox);
    return false;
  };
  /** A refused decision (the order completed meanwhile, its payment belongs to another order): show the order as it is now. */
  const refused = (failure: unknown): never => {
    void load();
    throw failure;
  };

  const approve = async () => {
    if (!(await unchanged())) return;
    const { order: next } = await adminBillingApi.approve(code, note.trim()).catch(refused);
    setApprovedHere(true);
    show(next);
    onChanged(next);
    setNote("");
    setActionError(null);
    toast.success(`${next.code} approved and applied.`, { description: appliedText(next, planName, dayText) ?? undefined });
    focusWhenClosed(statusBox);
  };
  const reject = async () => {
    if (!(await unchanged())) return;
    const { order: next } = await adminBillingApi.reject(code, reason.trim()).catch(refused);
    show(next);
    onChanged(next);
    setReason("");
    setActionError(null);
    toast.success(`${next.code} rejected.`);
    focusWhenClosed(statusBox);
  };

  const done = order?.status === "completed";
  // Shown in a confirmation still open when the order completed by itself (the page's status region has said so already).
  const completedMeanwhile = done && !approvedHere ? (
    <div className="notice admin-confirm-done" data-tone="success">
      <Check size={16} aria-hidden="true" />
      <div className="notice-body">This order completed while you had it open, so there is nothing left to decide.</div>
    </div>
  ) : null;
  const footer = order && !done ? (
    <>
      {order.txHash && order.status !== "rejected" && (
        <Button icon={RefreshCw} busy={checking} onClick={() => void recheck()}>{checking ? "Checking…" : "Check again"}</Button>
      )}
      {order.status !== "rejected" && <Button variant="danger" icon={CircleX} disabled={checking} onClick={() => openConfirm(setRejecting)}>Reject</Button>}
      <Button variant="primary" icon={Check} disabled={checking} onClick={() => openConfirm(setApproving)}>Approve and apply</Button>
    </>
  ) : undefined;

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose(); }} size="lg" title={`Order ${code}`} description={order ? `${order.title} · ${accountName(order.user)}` : undefined} footer={footer}>
      {order === null ? (
        error ? (
          <StateNotice variant="error" size="sm" title="Couldn't load the order" actions={<Button size="sm" icon={RotateCcw} onClick={() => void load()}>Try again</Button>}>{error}</StateNotice>
        ) : (
          <StateNotice variant="loading" size="sm" title="Loading the order…" />
        )
      ) : (
        <OrderBody order={order} planName={planName} autoVerify={settings?.autoVerify ?? null} announce={announce} statusBox={statusBox} />
      )}
      {actionError && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{actionError}</p>}

      {order && (
        <>
          {/* A completed order (by itself while a confirmation was open) has nothing left to decide. */}
          <ConfirmDialog open={approving} onOpenChange={setApproving} title={`Approve ${order.code}?`} confirmLabel="Approve and apply" busyLabel="Applying…" confirmDisabled={done} onConfirm={approve}>
            {completedMeanwhile}
            <p>{approveText(order, accountPlan, settings?.plans ?? null, dayText)}</p>
            <ApproveFinding order={order} />
            <div className="field admin-confirm-field">
              <label className="field-label" htmlFor={`${id}-note`}>Note (optional)</label>
              <input id={`${id}-note`} className="input" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="How you checked the payment" aria-describedby={`${id}-note-hint`} />
              <p id={`${id}-note-hint`} className="field-hint">Kept with the order for operators. The payer doesn't see it.</p>
            </div>
          </ConfirmDialog>
          <ConfirmDialog open={rejecting} onOpenChange={setRejecting} title={`Reject ${order.code}?`} confirmLabel="Reject order" busyLabel="Rejecting…" tone="danger" confirmDisabled={done || !reason.trim()} onConfirm={reject}>
            {completedMeanwhile}
            <p>Nothing is applied and the order isn't checked any more. The payer can't submit another transaction for it; you can still approve it later.</p>
            <div className="field admin-confirm-field">
              <label className="field-label" htmlFor={`${id}-reason`}>Reason</label>
              <textarea id={`${id}-reason`} className="textarea" rows={3} value={reason} maxLength={500} required aria-required="true" onChange={event => setReason(event.target.value)} aria-describedby={`${id}-reason-hint`} />
              <p id={`${id}-reason-hint`} className="field-hint">Required. The payer sees it on their payment page.</p>
            </div>
          </ConfirmDialog>
        </>
      )}
    </Dialog>
  );
}

/**
 * In the approve confirmation: what the check found and why the order is where it is (the status
 * detail, unless it only repeats the amounts), with a word of caution unless the server verified the payment.
 */
function ApproveFinding({ order }: { order: AdminPaymentOrder }) {
  const finding = chainFinding(order);
  const Icon = FINDING_ICON[finding.tone];
  const text = [finding.text, approveDetail(order, finding), approveCaution(order, finding)].filter(Boolean).join(" ");
  return (
    <p className="admin-confirm-finding" data-tone={finding.tone}>
      {Icon && <Icon size={15} aria-hidden="true" />}
      <span>{text}</span>
    </p>
  );
}

function OrderBody({ order, planName, autoVerify, announce, statusBox }: {
  order: AdminPaymentOrder;
  planName: (id: PlanId) => string;
  /** Whether payments are applied by themselves once they match (null: not known). */
  autoVerify: boolean | null;
  announce: (message: string) => void;
  /** The status line: focus lands here after a decision removed the button that made it. */
  statusBox: RefObject<HTMLDivElement | null>;
}) {
  const id = useId();
  const network = networkInfo(order.network);
  const explorer = network?.explorer.name;
  const discounted = order.discountPercent > 0 && order.listUsd > order.priceUsd;
  const finding = chainFinding(order);
  const FindingIcon = FINDING_ICON[finding.tone];
  const applied = appliedText(order, planName, dayText);
  const confirmations = confirmationsText(order);
  const events = [...order.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const user = order.user;

  return (
    <div className="admin-order">
      <div className="admin-order-status" ref={statusBox} tabIndex={-1} role="group" aria-label={`Status: ${PAYMENT_STATUS[order.status].label}`}>
        <PaymentStatusChip status={order.status} size="lg" />
        {order.statusDetail && order.status !== "review" && order.status !== "rejected" && <span className="admin-order-detail">{order.statusDetail}</span>}
      </div>
      {order.status === "review" && (
        <div className="notice" data-tone="warning">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body"><strong className="notice-title">Waiting for you</strong><p>{order.statusDetail ?? "This payment needs a decision."}</p></div>
        </div>
      )}
      {order.status === "rejected" && (
        <div className="notice" data-tone="danger">
          <CircleX size={16} aria-hidden="true" />
          <div className="notice-body"><strong className="notice-title">Rejected</strong><p>{order.statusDetail ?? "No reason was given."}</p></div>
        </div>
      )}
      {order.status === "completed" && (
        <div className="notice" data-tone="success">
          <Check size={16} aria-hidden="true" />
          <div className="notice-body">
            <strong className="notice-title">Completed and applied</strong>
            <p>{applied ?? "The order is complete."}{order.completedAt ? ` · ${fullText(order.completedAt)}` : ""}</p>
          </div>
        </div>
      )}

      <section className="admin-order-group" aria-labelledby={`${id}-order`}>
        <h4 id={`${id}-order`} className="admin-form-title">Order</h4>
        <dl className="admin-facts">
          <Fact label="Account">
            {accountName(user)}
            {user.login && user.name && user.name !== user.login && <span className="admin-sub">{user.name}</span>}
          </Fact>
          <Fact label="Item">
            {order.title}
            {/* The plan as it was sold: approving gives these terms, even if the plan has changed since. */}
            {order.kind === "plan" && order.planCreditsPerWindow != null && <span className="admin-sub">{creditCount(order.planCreditsPerWindow)} credits per window</span>}
          </Fact>
          <Fact label="Price">
            {formatUsd(order.priceUsd)}
            {discounted && <span className="admin-sub">List {formatUsd(order.listUsd)} · {order.discountPercent}% off</span>}
            {order.kind === "api" && order.creditUsd !== null && <span className="admin-sub">Adds {formatUsd(order.creditUsd)} to the API balance</span>}
          </Fact>
          <Fact label="Created"><time dateTime={order.createdAt}>{fullText(order.createdAt)}</time></Fact>
          {order.quotedAt && <Fact label="Details issued"><time dateTime={order.quotedAt}>{fullText(order.quotedAt)}</time></Fact>}
          <Fact label="Window ends"><time dateTime={order.expiresAt}>{fullText(order.expiresAt)}</time></Fact>
          {order.submitUntil && order.status !== "awaiting_payment" && <Fact label="Hash taken until"><time dateTime={order.submitUntil}>{fullText(order.submitUntil)}</time></Fact>}
          {order.completedAt && <Fact label="Completed"><time dateTime={order.completedAt}>{fullText(order.completedAt)}</time></Fact>}
          {order.adminNote && <Fact label="Operator's note">{order.adminNote}</Fact>}
        </dl>
      </section>

      <section className="admin-order-group" aria-labelledby={`${id}-payment`}>
        <h4 id={`${id}-payment`} className="admin-form-title">Payment</h4>
        <dl className="admin-facts">
          <Fact label="Network · coin">{methodText(order) ?? <span className="admin-faint">Not chosen yet</span>}</Fact>
          {order.expectedAmount && (
            <Fact label="Exact amount">
              <span className="mono">{order.expectedAmount} {order.coin}</span>
              {order.quoteUsdPrice !== null && <span className="admin-sub">Quoted at {formatUsd(order.quoteUsdPrice)} per {order.coin}</span>}
            </Fact>
          )}
          {order.payAddress && (
            <Fact label="To the wallet"><ChainValue value={order.payAddress} what="Wallet address" href={explorerAddressUrl(order.network, order.payAddress)} explorer={explorer} onCopied={announce} /></Fact>
          )}
          <Fact label="Transaction">
            {order.txHash ? <ChainValue value={order.txHash} what="Transaction hash" href={order.explorerUrl} explorer={explorer} onCopied={announce} /> : <span className="admin-faint">No hash submitted</span>}
          </Fact>
          {order.submittedAt && <Fact label="Hash submitted"><time dateTime={order.submittedAt}>{fullText(order.submittedAt)}</time></Fact>}
        </dl>
      </section>

      {order.txHash && (
        <section className="admin-order-group" aria-labelledby={`${id}-chain`}>
          <h4 id={`${id}-chain`} className="admin-form-title">On-chain check</h4>
          <p className="admin-finding" data-tone={finding.tone}>
            {FindingIcon && <FindingIcon size={15} aria-hidden="true" />}
            <span>{finding.text}</span>
          </p>
          <dl className="admin-facts">
            <Fact label="Received">{order.receivedAmount !== null ? <span className="mono">{order.receivedAmount} {order.coin}</span> : <span className="admin-faint">None recorded</span>}</Fact>
            {/* A mismatch stops the check before it counts confirmations: the block is known, the count isn't. */}
            <Fact label="Confirmations">{confirmations ?? <span className="admin-faint">{order.txBlockTime && (order.status === "review" || order.status === "rejected") ? "Not counted" : "Not in a block yet"}</span>}</Fact>
            {order.txFrom && <Fact label="From"><ChainValue value={order.txFrom} what="Sender address" href={explorerAddressUrl(order.network, order.txFrom)} explorer={explorer} onCopied={announce} /></Fact>}
            {order.txBlockTime && <Fact label="Block time"><time dateTime={order.txBlockTime}>{fullText(order.txBlockTime)}</time></Fact>}
            {order.chainVerifiedAt && <Fact label="Verified"><time dateTime={order.chainVerifiedAt}>{fullText(order.chainVerifiedAt)}</time></Fact>}
            <Fact label="Checks">
              {order.checkCount} {order.checkCount === 1 ? "check" : "checks"}
              {order.lastCheckedAt && <span className="admin-sub">Last checked <time dateTime={order.lastCheckedAt}>{relativeTime(order.lastCheckedAt)}</time></span>}
            </Fact>
          </dl>
          {order.status !== "completed" && order.status !== "rejected" && (
            <p className="field-hint">
              Check again asks the network now.
              {autoVerify === true ? " A payment that matches is applied, as the automatic checks do."
                : autoVerify === false ? " A payment that matches still waits for your approval: verified payments aren't applied automatically."
                  : " A payment that matches may be applied right away."}
            </p>
          )}
        </section>
      )}

      <section className="admin-order-group" aria-labelledby={`${id}-history`}>
        <h4 id={`${id}-history`} className="admin-form-title">History</h4>
        {events.length === 0 ? <p className="field-hint">Nothing recorded yet.</p> : (
          <ol className="admin-events">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <PaymentStatusChip status={event.status} size="sm" live={false} />
                <span className="admin-event-body">
                  <span className="admin-event-meta"><time dateTime={event.at}>{momentText(event.at)}</time> · {ACTOR_LABEL[event.actor]}</span>
                  {event.note && <span className="admin-event-note">{event.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
