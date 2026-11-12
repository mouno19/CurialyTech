import { useId, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Coins, Gift, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { formatCredits, type CreditBalance } from "@shared/credits";
import { accountApi, errorMessage } from "@/lib/api";
import { clockText, refreshAccount, untilText, useAccount } from "@/lib/account";
import { shortDayText } from "@/components/billing/format";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { Tip } from "@/components/common/Tooltip";

/** One line for what's left, as the sidebar and the composer say it. */
export function creditsLine(credits: CreditBalance) {
  if (credits.unlimited) return "Operator: not charged";
  return `${formatCredits(credits.available)} credit${credits.available === 1 ? "" : "s"} left`;
}

export function refillLine(credits: CreditBalance) {
  // Without an allowance nothing refills: the account's credits are its own (promo codes, grants).
  if (credits.unlimited || credits.allowance === 0) return null;
  if (!credits.resetsAt) return `${formatCredits(credits.allowance)} every ${credits.windowHours} h`;
  // A plan that ends first won't be there for the refill: say when it ends instead.
  if (credits.plan && Date.parse(credits.plan.expiresAt) < Date.parse(credits.resetsAt)) return `${credits.plan.name} ends at ${clockText(credits.plan.expiresAt)}, before this window refills`;
  return `Refills to ${formatCredits(credits.allowance)} at ${clockText(credits.resetsAt)}`;
}

/** "Pro until 9 Dec", or null without an active plan. */
export function planLine(credits: CreditBalance, now = Date.now()) {
  const plan = credits.plan;
  if (!plan || !(Date.parse(plan.expiresAt) > now)) return null;
  return `${plan.name} until ${shortDayText(plan.expiresAt)}`;
}

/** The sidebar's credits: what's left, the plan, when it refills, and a way to redeem a promo code or get more. */
export function CreditsMeter({ rail }: { rail: boolean }) {
  const { info } = useAccount();
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const { credits } = info;
  const share = credits.unlimited ? 1 : credits.allowance === 0 ? (credits.available > 0 ? 1 : 0) : Math.min(1, credits.remaining / credits.allowance);
  const low = !credits.unlimited && credits.available < 5;
  const plan = credits.unlimited ? null : planLine(credits);
  const summary = plan ? `${creditsLine(credits)} · ${plan}` : creditsLine(credits);
  const button = (
    <button type="button" className="nav-item credits-meter" data-low={low || undefined} onClick={() => setOpen(true)} aria-label={rail ? `${summary}. Open credits` : undefined}>
      <Coins size={17} aria-hidden="true" />
      <span className="nav-text credits-text">
        <span className="credits-left">{creditsLine(credits)}</span>
        {plan && <span className="credits-plan">{plan}</span>}
        {!credits.unlimited && (
          <span className="credits-bar" aria-hidden="true"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
        )}
      </span>
    </button>
  );
  return (
    <>
      {rail ? <Tip content={summary} side="right">{button}</Tip> : button}
      <CreditsDialog open={open} onOpenChange={setOpen} credits={credits} />
    </>
  );
}

export function CreditsDialog({ open, onOpenChange, credits }: { open: boolean; onOpenChange: (open: boolean) => void; credits: CreditBalance }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await accountApi.redeem(code);
      await refreshAccount();
      setCode("");
      toast.success(`${formatCredits(result.credits)} credits added.`, { description: credits.allowance > 0 ? "They're spent after this window's credits and don't expire." : "They don't expire or refill." });
    } catch (redeemError) {
      setError(errorMessage(redeemError, "That code didn't work."));
    } finally {
      setBusy(false);
    }
  };
  const plan = credits.unlimited ? null : planLine(credits);
  const windowFromBoost = credits.boost !== null && credits.allowance === credits.boost.creditsPerWindow;
  const windowSentence = windowFromBoost
    ? "The window starts when the boost begins and refills from that time."
    : "The first window starts when you spend a credit, then it refills on that schedule.";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Credits" description={
      credits.unlimited ? "The operator's account is not charged."
        : credits.allowance === 0 ? "Credits on this account come from the welcome credits, X and promo codes. They don't refill."
          : `${plan ? `With ${plan}, this` : credits.boost ? "With the X boost, this" : "This"} account gets ${formatCredits(credits.allowance)} credits every ${credits.windowHours} hours. ${windowSentence}`
    }       footer={credits.unlimited ? undefined : (
      // A plan adds credits to every window; the page also has the X rewards, the API balance and past orders.
      <Link href={credits.canEarn ? "/billing#rewards" : "/billing"} className={plan ? "btn" : "btn primary"} onClick={() => onOpenChange(false)}>{plan ? "Plans & Billing" : credits.canEarn ? "Earn credits on X" : "Get more credits"}</Link>
    )}>
      {!credits.unlimited && credits.allowance === 0 && (
        <dl className="credits-facts">
          <div><dt>Credits</dt><dd>{formatCredits(credits.bonus)}</dd></div>
        </dl>
      )}
      {!credits.unlimited && credits.allowance > 0 && (
        <dl className="credits-facts">
          <div><dt>Plan</dt><dd>{plan ?? (credits.boost ? "Free · X boost" : "Free")}</dd></div>
          <div><dt>This window</dt><dd>{formatCredits(credits.remaining)} of {formatCredits(credits.allowance)} left</dd></div>
          <div><dt>Bonus credits</dt><dd>{formatCredits(credits.bonus)}</dd></div>
          <div><dt>Refill</dt><dd>{credits.resetsAt ? `${clockText(credits.resetsAt)} (${untilText(credits.resetsAt)})` : "Your full allowance is ready"}</dd></div>
        </dl>
      )}
      {!credits.unlimited && <p className="field-hint">A task's cost depends on its model and length: a short task takes a few credits, a long build tens. Opus models spend credits five times faster; Haiku, Flash and Llama a quarter as fast.</p>}
      <form className="credits-redeem" onSubmit={redeem} noValidate>
        <label className="field-label" htmlFor="promo-code"><Gift size={14} aria-hidden="true" /> Promo code</label>
        <div className="credits-redeem-row">
          <input
            id="promo-code"
            className="input"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCDE-FGHJK"
            value={code}
            maxLength={64}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={event => setCode(event.target.value)}
          />
          <Button type="submit" variant="primary" busy={busy} disabled={!code.trim()}>Redeem</Button>
        </div>
        {error && (
          <p id={errorId} className="field-error" role="alert">
            <TriangleAlert size={14} aria-hidden="true" />
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
