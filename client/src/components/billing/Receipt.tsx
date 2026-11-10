import { ExternalLink } from "lucide-react";
import { formatUsd, networkInfo, type PaymentOrder } from "@shared/billing";
import type { Account } from "@/lib/api";
import { Wordmark } from "@/components/brand/Logo";
import { dayText, fullText } from "./format";

/** What completing the order did, for the receipt and the success panel. */
export function appliedText(order: PaymentOrder, planName: (id: string) => string) {
  const applied = order.applied;
  if (!applied) return null;
  if (typeof applied.apiBalanceAddedUsd === "number") return `${formatUsd(applied.apiBalanceAddedUsd)} added to the API balance`;
  if (applied.planId && applied.planExpiresAt) return `${planName(applied.planId)} until ${dayText(applied.planExpiresAt)}`;
  return null;
}

/**
 * The receipt of a completed order: what was bought, at what price, how it was paid and what it
 * did. The page prints it alone (billing.css @media print). idPrefix keeps ids unique when the
 * page renders it twice (on screen, and the copy it prints).
 */
export function Receipt({ order, account, planName, idPrefix = "receipt" }: { order: PaymentOrder; account: Account | null; planName: (id: string) => string; idPrefix?: string }) {
  const network = networkInfo(order.network);
  const on = network ? ` on ${network.label}` : "";
  // What the chain saw arrive; an order the operator approved without that shows what it asked for instead.
  const received = order.receivedAmount && Number(order.receivedAmount) > 0 ? order.receivedAmount : null;
  const saved = order.listUsd - order.priceUsd;
  const applied = appliedText(order, planName);
  const holder = account ? [account.displayName, account.login ? `@${account.login}` : account.email].filter(Boolean).join(" · ") : null;
  return (
    <section className="receipt" aria-labelledby={`${idPrefix}-title`}>
      <header className="receipt-head">
        <Wordmark />
        <div className="receipt-heading">
          <p className="micro">Receipt</p>
          <h3 id={`${idPrefix}-title`} className="receipt-title">Order {order.code}</h3>
        </div>
      </header>
      <dl className="receipt-rows">
        <div><dt>Order</dt><dd className="mono">{order.code}</dd></div>
        {holder && <div><dt>Account</dt><dd>{holder}</dd></div>}
        <div><dt>Item</dt><dd>{order.title}</dd></div>
        <div><dt>List price</dt><dd className="tabular">{formatUsd(order.listUsd)}</dd></div>
        {order.discountPercent > 0 && saved > 0 && <div><dt>Offer</dt><dd className="tabular">{order.discountPercent}% off (−{formatUsd(saved)})</dd></div>}
        <div><dt>Paid</dt><dd className="tabular receipt-paid">{formatUsd(order.priceUsd)}</dd></div>
        {order.coin && (received ? (
          <div><dt>Paid with</dt><dd><span className="mono">{received} {order.coin}</span>{on}</dd></div>
        ) : order.expectedAmount ? (
          <div><dt>Payment details</dt><dd><span className="mono">{order.expectedAmount} {order.coin}</span>{on}</dd></div>
        ) : null)}
        {order.txHash && (
          <div>
            <dt>Transaction</dt>
            <dd className="receipt-hash">
              {order.explorerUrl ? (
                <a className="link" href={order.explorerUrl} target="_blank" rel="noopener noreferrer">
                  <span className="mono">{order.txHash}</span><ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens {network?.explorer.name ?? "the block explorer"} in a new tab)</span>
                </a>
              ) : <span className="mono">{order.txHash}</span>}
            </dd>
          </div>
        )}
        {order.completedAt && <div><dt>Completed</dt><dd><time dateTime={order.completedAt}>{fullText(order.completedAt)}</time></dd></div>}
        {applied && <div><dt>Applied</dt><dd>{applied}</dd></div>}
      </dl>
      <p className="receipt-note">Crypto payments are final once applied. Keep this order code if you ever need to ask about it.</p>
    </section>
  );
}
