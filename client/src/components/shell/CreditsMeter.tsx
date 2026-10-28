import { useId, useState, type FormEvent } from "react";
import { Coins, Gift, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { formatCredits, type CreditBalance } from "@shared/credits";
import { accountApi, errorMessage } from "@/lib/api";
import { clockText, refreshAccount, untilText, useAccount } from "@/lib/account";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { Tip } from "@/components/common/Tooltip";

/** One line for what's left, as the sidebar and the composer say it. */
export function creditsLine(credits: CreditBalance) {
  if (credits.unlimited) return "Operator: not charged";
  return `${formatCredits(credits.available)} credit${credits.available === 1 ? "" : "s"} left`;
}

export function refillLine(credits: CreditBalance) {
  if (credits.unlimited) return null;
  if (!credits.resetsAt) return `${formatCredits(credits.allowance)} every ${credits.windowHours} h`;
  return `Refills to ${formatCredits(credits.allowance)} at ${clockText(credits.resetsAt)}`;
}

/** The sidebar's credits: what's left, when it refills, and a way to redeem a promo code. */
export function CreditsMeter({ rail }: { rail: boolean }) {
  const { info } = useAccount();
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const { credits } = info;
  const share = credits.unlimited || credits.allowance === 0 ? 1 : Math.min(1, credits.remaining / credits.allowance);
  const low = !credits.unlimited && credits.available < 5;
  const button = (
    <button type="button" className="nav-item credits-meter" data-low={low || undefined} onClick={() => setOpen(true)} aria-label={rail ? `${creditsLine(credits)}. Open credits` : undefined}>
      <Coins size={17} aria-hidden="true" />
      <span className="nav-text credits-text">
        <span className="credits-left">{creditsLine(credits)}</span>
        {!credits.unlimited && (
          <span className="credits-bar" aria-hidden="true"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
        )}
      </span>
    </button>
  );
  return (
    <>
      {rail ? <Tip content={creditsLine(credits)} side="right">{button}</Tip> : button}
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
      toast.success(`${formatCredits(result.credits)} credits added.`, { description: "They're spent after this window's credits and don't expire." });
    } catch (redeemError) {
      setError(errorMessage(redeemError, "That code didn't work."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Credits" description={credits.unlimited ? "The operator's account is not charged." : `Every account gets ${formatCredits(credits.allowance)} credits every ${credits.windowHours} hours; a window starts with the first credit you spend.`}>
      {!credits.unlimited && (
        <dl className="credits-facts">
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
