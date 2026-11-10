import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Send, TriangleAlert } from "lucide-react";
import { networkInfo, normalizeTxHash, type PaymentOrder } from "@shared/billing";
import { Button } from "@/components/common/Button";
import { hashHint, hashProblem } from "./orderState";

type Problem = { field: "check" | "hash"; text: string } | null;

/**
 * The transaction hash: a tick that the payer sends (or sent) the order's coin on its network, the
 * hash itself (checked against the network's format before anything is sent), and where to find it.
 * The page keeps what was typed (value), so it survives the switch to the late form at the deadline.
 */
export function HashForm({ order, value: raw, onValueChange: setRaw, sent = false, submitting, blocked, submitLabel = "Submit hash", onSubmit }: {
  order: PaymentOrder;
  value: string;
  onValueChange: (value: string) => void;
  /** Already sent (a late or replacement hash): the tick is in the past tense. */
  sent?: boolean;
  submitting: boolean;
  /** Another request is running or the order on screen is out of date: the form waits. */
  blocked: boolean;
  submitLabel?: string;
  onSubmit: (txHash: string) => void;
}) {
  const ids = { check: useId(), checkError: useId(), hash: useId(), hint: useId(), error: useId() };
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const hashRef = useRef<HTMLInputElement>(null);
  const network = networkInfo(order.network);
  const where = network?.label ?? "the network";
  const coin = order.coin ?? "the coin";
  useEffect(() => {
    setChecked(false);
    setProblem(null);
  }, [order.code, order.network, order.coin, order.payAddress]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting || blocked || !order.network) return;
    if (!checked) {
      setProblem({ field: "check", text: `First check that your wallet ${sent ? "sent" : "sends"} ${coin} on ${where}, then tick the box.` });
      checkRef.current?.focus();
      return;
    }
    const issue = hashProblem(order.network, raw);
    const txHash = normalizeTxHash(order.network, raw);
    if (issue || !txHash) {
      setProblem({ field: "hash", text: issue ?? "That isn't a transaction hash." });
      hashRef.current?.focus();
      return;
    }
    setProblem(null);
    onSubmit(txHash);
  };

  return (
    <form className="pay-hash" onSubmit={submit} noValidate>
      <div className="pay-check-wrap">
        <label className="pay-check" htmlFor={ids.check}>
          <input
            id={ids.check}
            ref={checkRef}
            type="checkbox"
            checked={checked}
            aria-invalid={problem?.field === "check" || undefined}
            aria-describedby={problem?.field === "check" ? ids.checkError : undefined}
            onChange={event => {
              setChecked(event.target.checked);
              if (problem?.field === "check") setProblem(null);
            }}
          />
          <span>{sent ? `I sent ${coin} on ${where}` : `I'm sending ${coin} on ${where}`}</span>
        </label>
        {problem?.field === "check" && <p id={ids.checkError} className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{problem.text}</p>}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={ids.hash}>Transaction hash</label>
        <div className="pay-hash-row">
          <input
            id={ids.hash}
            ref={hashRef}
            className="input mono"
            value={raw}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={network?.family === "solana" ? "Transaction signature" : "0x…"}
            aria-invalid={problem?.field === "hash" || undefined}
            aria-describedby={problem?.field === "hash" ? ids.error : ids.hint}
            onChange={event => {
              setRaw(event.target.value);
              if (problem?.field === "hash") setProblem(null);
            }}
          />
          <Button type="submit" variant="primary" icon={Send} busy={submitting} aria-disabled={blocked || undefined}>{submitting ? "Submitting…" : submitLabel}</Button>
        </div>
        {problem?.field === "hash" ? (
          <p id={ids.error} className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{problem.text}</p>
        ) : (
          <p id={ids.hint} className="field-hint">{hashHint(order.network)}</p>
        )}
      </div>
      <details className="pay-help">
        <summary>Where do I find it?</summary>
        <p>
          In your wallet, open the transfer you just made: the transaction hash{network?.family === "solana" ? " (Solana calls it the signature)" : ""} is in its details, often next to a link to {network?.explorer.name ?? "a block explorer"}.
          On an exchange, it's the TxID in your withdrawal history. Never paste a seed phrase or a private key here: checking a payment needs neither.
        </p>
      </details>
    </form>
  );
}
