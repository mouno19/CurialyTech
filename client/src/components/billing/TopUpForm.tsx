import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { DollarSign, Info, TriangleAlert, Wallet } from "lucide-react";
import type { BillingCatalog } from "@shared/billing";
import { billingApi } from "@/lib/billing";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/common/Button";
import { formatPrice } from "./plans";
import { parseTopUp } from "./topUp";

/**
 * Presets ($5, $10, $25, $50, $100) and a custom whole-dollar amount ($5–$1,000); creates an API top-up order and
 * navigates to /pay/:code itself. Shows why it is unavailable when payments are closed.
 */
export function TopUpForm({ catalog, compact = false }: { catalog: BillingCatalog; compact?: boolean }) {
  const [, navigate] = useLocation();
  const ids = { legend: useId(), custom: useId(), hint: useId(), error: useId() };
  const limits = catalog.apiTopup;
  const presets = limits.presets.filter(amount => amount >= limits.minUsd && amount <= limits.maxUsd);
  const [choice, setChoice] = useState(() => (presets.includes(25) ? "25" : presets.length ? String(presets[0]) : "custom"));
  const [custom, setCustom] = useState("");
  const [showProblem, setShowProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inFlight = useRef(false);
  const customRef = useRef<HTMLInputElement>(null);
  // An order that answers after the payer left the page stays on the Orders list: no pulling them back to pay it.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const closed = !catalog.paymentsOpen;
  const amount = choice === "custom" ? parseTopUp(custom, limits) : { ok: true as const, amountUsd: Number(choice) };
  const problem = choice === "custom" && showProblem && !amount.ok ? amount.error : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (closed || inFlight.current) return;
    if (!amount.ok) {
      setShowProblem(true);
      customRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const { order } = await billingApi.createOrder({ kind: "api", amountUsd: amount.amountUsd });
      if (alive.current) navigate(`/pay/${encodeURIComponent(order.code)}`);
    } catch (error) {
      if (alive.current) setFailure(errorMessage(error, "Couldn't start the top-up. Try again."));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <form className="topup" data-compact={compact || undefined} onSubmit={event => void submit(event)} noValidate>
      {!compact && (
        <p className="topup-intro">
          Requests are charged to this balance at each model's list price{catalog.discount.apiPercent > 0 ? `, ${catalog.discount.apiPercent}% off right now` : ""}. Top-ups aren't discounted: $1 paid is $1 of balance.
        </p>
      )}
      <fieldset className="topup-fieldset" disabled={closed}>
        <legend id={ids.legend} className="field-label">Amount</legend>
        <RadioGroup.Root
          className="topup-presets"
          value={choice}
          aria-labelledby={ids.legend}
          orientation="horizontal"
          loop
          onValueChange={value => {
            setChoice(value);
            setShowProblem(false);
            setFailure(null);
          }}
        >
          {presets.map(preset => <RadioGroup.Item key={preset} value={String(preset)} className="topup-preset">{formatPrice(preset)}</RadioGroup.Item>)}
          <RadioGroup.Item value="custom" className="topup-preset">Other</RadioGroup.Item>
        </RadioGroup.Root>
        {choice === "custom" && (
          <div className="field topup-custom">
            <label className="field-label" htmlFor={ids.custom}>Amount in dollars</label>
            <div className="input-wrap">
              <DollarSign size={15} aria-hidden="true" />
              <input
                id={ids.custom}
                ref={customRef}
                className="input tabular"
                inputMode="numeric"
                autoComplete="off"
                maxLength={9}
                value={custom}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? ids.error : ids.hint}
                onChange={event => {
                  setCustom(event.target.value);
                  setShowProblem(false);
                }}
                onBlur={() => setShowProblem(custom.trim() !== "")}
              />
            </div>
            {problem ? (
              <p id={ids.error} className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{problem}</p>
            ) : (
              <p id={ids.hint} className="field-hint">Whole dollars, {formatPrice(limits.minUsd)} to {formatPrice(limits.maxUsd)}.</p>
            )}
          </div>
        )}
      </fieldset>
      {closed && (
        <div className="notice" data-tone="neutral">
          <Info size={16} aria-hidden="true" />
          <div className="notice-body">Payments are paused right now, so top-ups can't be ordered. Your balance keeps working.</div>
        </div>
      )}
      {failure && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{failure}</p>}
      <div className="topup-actions">
        <Button type="submit" variant="primary" icon={Wallet} busy={busy} disabled={closed}>
          {busy ? "Starting the top-up…" : amount.ok ? `Top up ${formatPrice(amount.amountUsd)}` : "Top up"}
        </Button>
        <span className="field-hint">You pay in crypto on the next page.</span>
      </div>
    </form>
  );
}
