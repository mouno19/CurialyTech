import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { CalendarClock, CircleSlash, Coins, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_PLANS, formatUsd, microsToUsd, PLAN_IDS, type AdminAccountBilling, type BillingSettings, type PlanId } from "@shared/billing";
import { creditCount, dayText, fullText, microsText, momentText, shortDayText } from "@/components/billing/format";
import { PaymentStatusChip } from "@/components/billing/PaymentStatusChip";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Dialog } from "@/components/common/Dialog";
import { StateNotice } from "@/components/common/StateNotice";
import { errorMessage, type AdminUser } from "@/lib/api";
import { adminBillingApi } from "@/lib/billing";
import { balanceChangePreview, balanceChangeText, grantLabel, grantResult, grantSentence, LEDGER_LABEL, parseBalanceChange, parseDays, planChipText, planStateOf } from "./accounts";
import type { OrderChange } from "./PaymentsPanel";
import { focusWhenClosed, TextField } from "./parts";

/** The accounts list's plans and API balance: "Pro · until 9 Dec" for each plan running (or No plan), and the balance. */
export function AccountBillingCell({ user }: { user: AdminUser }) {
  if (user.role === "admin") return <span className="admin-sub">not charged</span>;
  const chips = (user.plans ?? (user.plan ? [user.plan] : [])).map(plan => planChipText(plan, shortDayText)).filter(chip => chip !== null);
  return (
    <div className="admin-billing-cell">
      {chips.length ? chips.map(chip => <span key={chip} className="chip">{chip}</span>) : <span className="admin-faint">No plan</span>}
      <span className="admin-sub">API {formatUsd(user.apiBalanceUsd)}</span>
    </div>
  );
}

/**
 * An account's plans and Developer API balance: give, extend or add a plan (like a purchase of that
 * many days: Pro and Max run side by side), end one now, add or remove balance, and the account's
 * orders (each opens the order dialog) and API ledger.
 */
export function AccountBillingDialog({ user, settings, orderChange, onClose, onChanged, onOpenOrder }: {
  user: AdminUser;
  /** The billing settings: the plans' names and lengths, for what giving one does. */
  settings: BillingSettings | null;
  /** The last order changed in the order dialog: this account's reloads. */
  orderChange: OrderChange | null;
  onClose: () => void;
  /** The account's plan or balance changed (the accounts list reloads). */
  onChanged: () => void;
  onOpenOrder: (code: string) => void;
}) {
  const [data, setData] = useState<AdminAccountBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<PlanId>("pro");
  const [days, setDays] = useState(String(settings?.plans.pro.days ?? DEFAULT_PLANS.pro.days));
  const [planNote, setPlanNote] = useState("");
  const [amount, setAmount] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [busy, setBusy] = useState<"plan" | "balance" | null>(null);
  // Field errors show once a submit was tried, and follow the field from then on; the server's own errors are kept apart.
  const [daysTried, setDaysTried] = useState(false);
  const [amountTried, setAmountTried] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // A balance change waits for its confirmation, which says what it does to the balance before any money moves.
  const [change, setChange] = useState<number | null>(null);
  const [changing, setChanging] = useState(false);
  // The plan whose "End now" was pressed, while its confirmation is open.
  const [ending, setEnding] = useState<PlanId | null>(null);
  const [endNote, setEndNote] = useState("");
  // "End now" goes with the plan it ended: focus goes to the plan's heading instead.
  const planTitle = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const name = user.login ? `@${user.login}` : user.name;
  const openedAt = useRef(Date.now());
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await adminBillingApi.account(user.id));
    } catch (loadError) {
      setError(errorMessage(loadError, "Couldn't load this account's billing."));
    }
  }, [user.id]);
  useEffect(() => void load(), [load]);
  // One of this account's orders was approved or rejected in the order dialog: its plan or balance may have changed.
  useEffect(() => {
    if (!orderChange || orderChange.at <= openedAt.current || orderChange.order.user.id !== user.id) return;
    void load();
    onChangedRef.current();
  }, [orderChange, user.id, load]);

  const plans = settings?.plans ?? null;
  const planName = (option: PlanId) => plans?.[option]?.name ?? DEFAULT_PLANS[option].name;
  const current = planStateOf(data?.plans);
  const parsedDays = parseDays(days);
  const parsedAmount = parseBalanceChange(amount);
  const result = plans && parsedDays.ok ? grantResult(current, planId, parsedDays.days, plans) : null;

  const give = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!parsedDays.ok) {
      setDaysTried(true);
      document.getElementById(`${id}-days`)?.focus();
      return;
    }
    setBusy("plan");
    setPlanError(null);
    try {
      const next = await adminBillingApi.grantPlan(user.id, planId, parsedDays.days, planNote.trim());
      setData(next);
      setPlanNote("");
      const given = next.plans.find(plan => plan.id === planId);
      toast.success(given ? `${name} has ${given.name} until ${dayText(given.expiresAt)}.` : `${planName(planId)} given to ${name}.`);
      onChanged();
    } catch (grantError) {
      setPlanError(errorMessage(grantError));
    } finally {
      setBusy(null);
    }
  };

  const adjust = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!parsedAmount.ok) {
      setAmountTried(true);
      document.getElementById(`${id}-amount`)?.focus();
      return;
    }
    setChange(parsedAmount.amountUsd);
    setChanging(true);
  };

  /** Runs from the confirmation: a failure stays there with the server's reason. */
  const applyChange = async () => {
    if (change === null) return;
    setBusy("balance");
    try {
      const before = data?.apiWallet.balanceMicros ?? 0;
      const next = await adminBillingApi.adjustApiBalance(user.id, change, balanceNote.trim());
      // The ledger has what was actually applied (a removal never takes the balance below zero).
      const entry = next.ledger[0];
      const recorded = entry && (entry.kind === "grant" || entry.kind === "adjust") ? entry : null;
      const applied = recorded ? recorded.amountUsd : microsToUsd(next.apiWallet.balanceMicros - before);
      const after = recorded ? recorded.balanceAfterUsd : microsToUsd(next.apiWallet.balanceMicros);
      setData(next);
      setAmount("");
      setBalanceNote("");
      setAmountTried(false);
      toast.success(balanceChangeText(name, change, applied, after));
      onChanged();
      // With the amount cleared, the button that opened the confirmation is disabled: focus goes to the amount.
      focusWhenClosed({ current: document.getElementById(`${id}-amount`) });
    } finally {
      setBusy(null);
    }
  };

  const endingPlan = ending ? data?.plans.find(plan => plan.id === ending) ?? null : null;
  const endPlan = async () => {
    if (!endingPlan) return;
    const next = await adminBillingApi.endPlan(user.id, endNote.trim(), endingPlan.id);
    setData(next);
    setEndNote("");
    toast.success(`${name}'s ${endingPlan.name} plan has ended.`);
    onChanged();
    focusWhenClosed(planTitle);
  };

  const wallet = data?.apiWallet;
  const preview = change !== null && wallet ? balanceChangePreview(name, change, wallet.balanceMicros) : null;
  return (
    <Dialog open onOpenChange={next => { if (!next) onClose(); }} size="lg" title={`Billing · ${name}`} description={user.role === "admin" ? "The operator's account isn't charged for credits or API use." : "Plan, Developer API balance and payments."}>
      {data === null ? (
        error ? (
          <StateNotice variant="error" size="sm" title="Couldn't load the billing" actions={<Button size="sm" icon={RotateCcw} onClick={() => void load()}>Try again</Button>}>{error}</StateNotice>
        ) : (
          <StateNotice variant="loading" size="sm" title="Loading the billing…" />
        )
      ) : (
        <>
          <section className="admin-form" aria-labelledby={`${id}-plan`}>
            <h4 id={`${id}-plan`} ref={planTitle} tabIndex={-1} className="admin-form-title">{data.plans.length > 1 ? "Plans" : "Plan"}</h4>
            {data.plans.length ? data.plans.map(plan => (
              <div key={plan.id} className="admin-bill-now">
                <CalendarClock size={16} aria-hidden="true" />
                <p><strong>{plan.name}</strong> until {fullText(plan.expiresAt)} · {creditCount(plan.creditsPerWindow)} credits per window</p>
                <Button size="sm" variant="danger" icon={CircleSlash} disabled={busy !== null} onClick={() => setEnding(plan.id)} aria-label={`End ${plan.name} now`}>End now</Button>
              </div>
            )) : (
              <p className="field-hint">No plan: the account has its own allowance (the free one unless you set another under Credits).</p>
            )}
            {data.plans.length > 1 && <p className="field-hint">The plans run side by side, each until its own end: {creditCount(data.plans.reduce((sum, plan) => sum + plan.creditsPerWindow, 0))} credits per window while both last.</p>}
            <form className="admin-form" onSubmit={give} noValidate>
              <div className="admin-form-row">
                <fieldset className="admin-fieldset">
                  <legend className="field-label" id={`${id}-which`}>Give, extend or add</legend>
                  <RadioGroup.Root className="segmented" aria-labelledby={`${id}-which`} value={planId} onValueChange={value => { if (value === "pro" || value === "max") setPlanId(value); }} orientation="horizontal" loop>
                    {PLAN_IDS.map(option => <RadioGroup.Item key={option} value={option}>{planName(option)}</RadioGroup.Item>)}
                  </RadioGroup.Root>
                </fieldset>
                <TextField id={`${id}-days`} label="Days" type="number" inputMode="numeric" min={1} max={366} step="1" value={days} error={daysTried && !parsedDays.ok ? parsedDays.error : undefined} onChange={event => setDays(event.target.value)} />
                <TextField id={`${id}-plan-note`} className="admin-grow" label="Note (optional)" value={planNote} maxLength={200} onChange={event => setPlanNote(event.target.value)} placeholder="Why, for your records" />
              </div>
              {result && plans && parsedDays.ok && <p className="field-hint">{grantSentence(result, planId, parsedDays.days, current, plans, dayText)} It works like a purchase of that many days, without a payment.</p>}
              {planError && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{planError}</p>}
              <div className="admin-actions">
                <Button type="submit" variant="primary" busy={busy === "plan"} disabled={busy === "balance"}>{result && plans ? grantLabel(result.effect, planId, plans) : "Give plan"}</Button>
              </div>
            </form>
          </section>

          <section className="admin-form" aria-labelledby={`${id}-api`}>
            <h4 id={`${id}-api`} className="admin-form-title">Developer API balance</h4>
            {wallet && (
              <p className="admin-bill-now">
                <Coins size={16} aria-hidden="true" />
                <span>
                  <strong>{microsText(wallet.balanceMicros)}</strong>
                  {wallet.reservedMicros > 0
                    ? ` · ${microsText(wallet.reservedMicros)} held for ${wallet.requestsInFlight} ${wallet.requestsInFlight === 1 ? "request" : "requests"} running · ${microsText(wallet.availableMicros)} available`
                    : " available"}
                </span>
              </p>
            )}
            <form className="admin-form" onSubmit={adjust} noValidate>
              <div className="admin-form-row">
                <TextField id={`${id}-amount`} label="Add or remove (USD)" hint="10 adds $10; -10 removes $10." error={amountTried && !parsedAmount.ok ? parsedAmount.error : undefined} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="10" autoComplete="off" />
                <TextField id={`${id}-balance-note`} className="admin-grow" label="Note (optional)" value={balanceNote} maxLength={200} onChange={event => setBalanceNote(event.target.value)} placeholder="Why, for your records" />
              </div>
              <div className="admin-actions">
                <Button type="submit" variant="primary" busy={busy === "balance"} disabled={busy === "plan" || !amount.trim()}>Change balance</Button>
              </div>
            </form>
            <p className="field-hint">The balance never goes below $0.00: a larger removal takes what there is.</p>
          </section>

          <section className="admin-form" aria-labelledby={`${id}-orders`}>
            <h4 id={`${id}-orders`} className="admin-form-title">Orders</h4>
            {data.orders.length === 0 ? <p className="field-hint">No orders yet.</p> : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={`Orders of ${name}`}>
                <table className="data-table admin-table admin-mini-table">
                  <thead><tr><th scope="col">Order</th><th scope="col">Item</th><th scope="col" className="admin-col-num">Price</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
                  <tbody>
                    {data.orders.map(order => (
                      <tr key={order.code} className="admin-pay-row">
                        <td><button type="button" className="admin-order-link" onClick={() => onOpenOrder(order.code)}><span className="sr-only">Open order </span>{order.code}</button></td>
                        <td className="admin-pay-item">{order.title}</td>
                        <td className="num admin-col-num">{formatUsd(order.priceUsd)}</td>
                        <td><PaymentStatusChip status={order.status} size="sm" /></td>
                        <td className="num"><time dateTime={order.createdAt}>{momentText(order.createdAt)}</time></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-form" aria-labelledby={`${id}-ledger`}>
            <h4 id={`${id}-ledger`} className="admin-form-title">API balance history</h4>
            {data.ledger.length === 0 ? <p className="field-hint">No top-ups or changes yet.</p> : (
              <ul className="admin-history admin-ledger">
                {data.ledger.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <span className="num" data-sign={entry.amountUsd < 0 ? "minus" : "plus"}>{entry.amountUsd > 0 ? "+" : ""}{formatUsd(entry.amountUsd)}</span>
                    <span>
                      {LEDGER_LABEL[entry.kind]}
                      {entry.orderCode && <> · <button type="button" className="admin-inline-link" onClick={() => onOpenOrder(entry.orderCode!)}>{entry.orderCode}</button></>}
                      {entry.note && entry.note !== `order ${entry.orderCode}` ? ` · ${entry.note}` : ""}
                      <span className="admin-sub">Balance after: {formatUsd(entry.balanceAfterUsd)}</span>
                    </span>
                    <span className="admin-sub"><time dateTime={entry.at}>{momentText(entry.at)}</time></span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {endingPlan && (
            <ConfirmDialog open={ending !== null} onOpenChange={open => { if (!open) setEnding(null); }} title={`End ${name}'s ${endingPlan.name} plan now?`} confirmLabel="End plan" busyLabel="Ending…" tone="danger" onConfirm={endPlan}>
              <p>
                It's set to run until {fullText(endingPlan.expiresAt)}.{" "}
                {data.plans.some(plan => plan.id !== endingPlan.id)
                  ? `The account's other plan keeps running, with its own credits per window. Nothing is refunded.`
                  : "From now on the account gets the credits per window it has without a plan. Nothing is refunded."}
              </p>
              <div className="field admin-confirm-field">
                <label className="field-label" htmlFor={`${id}-end-note`}>Note (optional)</label>
                <input id={`${id}-end-note`} className="input" value={endNote} maxLength={200} onChange={event => setEndNote(event.target.value)} placeholder="Why, for your records" />
              </div>
            </ConfirmDialog>
          )}
          {change !== null && preview && (
            <ConfirmDialog
              open={changing} onOpenChange={setChanging} tone={change < 0 ? "danger" : "default"} confirmDisabled={!preview.possible} onConfirm={applyChange}
              title={change < 0 ? `Remove ${formatUsd(-change)} from ${name}'s API balance?` : `Add ${formatUsd(change)} to ${name}'s API balance?`}
              confirmLabel={change < 0 ? "Remove balance" : "Add balance"} busyLabel={change < 0 ? "Removing…" : "Adding…"}
            >
              <p>{preview.text}</p>
              {balanceNote.trim() && <p className="field-hint admin-confirm-note">Note for your records: {balanceNote.trim()}</p>}
            </ConfirmDialog>
          )}
        </>
      )}
    </Dialog>
  );
}
