import type { LucideIcon } from "lucide-react";
import { Check, CircleSlash, CircleX, Clock, TriangleAlert } from "lucide-react";
import { formatUsd, type PaymentOrder, type PaymentStatus } from "@shared/billing";
import { clockText } from "@/lib/account";
import { CopyButton } from "./CopyButton";
import { momentText } from "./format";
import { clockLeft, orderTimeline, type StepState } from "./orderState";
import { PaymentStatusChip } from "./PaymentStatusChip";

/**
 * The order: its code, what it buys, the list price and the offer, what is paid, its status and,
 * while it awaits payment, the time left (not a live region: the page announces milestones).
 */
export function OrderSummary({ order, status, secondsLeft, onCopied }: { order: PaymentOrder; status: PaymentStatus; secondsLeft: number | null; onCopied: (message: string) => void }) {
  const discounted = order.discountPercent > 0 && order.listUsd > order.priceUsd;
  const link = `${window.location.origin}/pay/${encodeURIComponent(order.code)}`;
  return (
    <section className="card pay-summary" aria-labelledby="pay-summary-title">
      <div className="card-head">
        <h2 id="pay-summary-title">Order</h2>
        <PaymentStatusChip status={status} />
      </div>
      <div className="pay-summary-body">
        <div className="pay-code">
          <code>{order.code}</code>
          <CopyButton value={order.code} what="Order code" onCopied={onCopied} variant="ghost" />
        </div>
        <p className="pay-item">{order.title}</p>
        <p className="pay-price">
          {discounted && (
            <>
              <s className="pay-price-list"><span className="sr-only">List price </span>{formatUsd(order.listUsd)}</s>
              <span className="chip">{order.discountPercent}% off</span>
            </>
          )}
          <span className="pay-price-paid"><span className="sr-only">{discounted ? "You pay " : "Price "}</span>{formatUsd(order.priceUsd)}</span>
        </p>
        {order.kind === "api" && order.creditUsd !== null && <p className="field-hint">Adds {formatUsd(order.creditUsd)} of API usage at the prices on the Developer API page.</p>}
        {secondsLeft !== null && secondsLeft > 0 && (
          <p className="pay-deadline">
            <Clock size={14} aria-hidden="true" />
            <span>Expires in <span className="tabular pay-deadline-left">{clockLeft(secondsLeft)}</span>, at <time dateTime={order.expiresAt}>{clockText(order.expiresAt)}</time></span>
          </p>
        )}
      </div>
      <div className="card-foot pay-summary-foot">
        <CopyButton value={link} what="Link" label="Copy link to this page" onCopied={onCopied} />
        <span className="field-hint">Only this account can open it.</span>
      </div>
    </section>
  );
}

const STEP_ICON: Partial<Record<StepState, LucideIcon>> = { done: Check, attention: TriangleAlert, failed: CircleX, ended: CircleSlash };
const STEP_STATE: Record<StepState, string> = { done: "done", current: "now", todo: "to come", attention: "needs attention", failed: "rejected", ended: "ended" };

/** The steps so far and to come, with the server's times; every recorded event in a fold below. */
export function OrderTimeline({ order, now }: { order: PaymentOrder; now: number }) {
  const steps = orderTimeline(order, now);
  const events = [...(order.events ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <section className="card pay-timeline" aria-labelledby="pay-timeline-title">
      <div className="card-head"><h2 id="pay-timeline-title">Progress</h2></div>
      <ol className="pay-steps">
        {steps.map(step => {
          const Icon = STEP_ICON[step.state];
          return (
            <li key={step.key} className="pay-step-row" data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
              <span className="pay-step-mark" aria-hidden="true">{Icon ? <Icon size={13} aria-hidden="true" /> : null}</span>
              <span className="pay-step-body">
                <span className="pay-step-label">{step.label}<span className="sr-only">: {STEP_STATE[step.state]}</span></span>
                {step.detail && <span className="pay-step-detail">{step.detail}</span>}
                {step.at && <time className="pay-step-time" dateTime={step.at}>{momentText(step.at)}</time>}
              </span>
            </li>
          );
        })}
      </ol>
      {events.length > 0 && (
        <details className="pay-history">
          <summary>Order history</summary>
          <ol className="pay-history-list">
            {events.map((event, index) => (
              <li key={`${event.status}-${event.at}-${index}`}>
                <PaymentStatusChip status={event.status} size="sm" live={false} />
                <time dateTime={event.at}>{momentText(event.at)}</time>
                {event.note && <span className="pay-history-note">{event.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
