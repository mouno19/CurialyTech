import type { LucideIcon } from "lucide-react";
import { Check, CircleX, Clock, TriangleAlert } from "lucide-react";
import { PAYMENT_STATUS, type PaymentStatus } from "@shared/billing";

const ICONS: Partial<Record<PaymentStatus, LucideIcon>> = { completed: Check, review: TriangleAlert, rejected: CircleX, expired: Clock };

/**
 * An order's status as a chip (the StatusBadge look): text always, a live dot only while the network
 * is checked. live={false} for a past event in a history list: only what is happening now pulses.
 * Not a live region.
 */
export function PaymentStatusChip({ status, size = "md", className, live: current }: { status: PaymentStatus; size?: "sm" | "md" | "lg"; className?: string; live?: boolean }) {
  const meta = PAYMENT_STATUS[status];
  const live = current ?? (status === "pending" || status === "confirming");
  const Icon = ICONS[status];
  const glyph = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  return (
    <span className={className ? `status-badge ${className}` : "status-badge"} data-tone={meta.tone} data-size={size} data-status={status}>
      {live ? <span className="status-dot" data-live="" aria-hidden="true" /> : Icon ? <Icon size={glyph} aria-hidden="true" /> : <span className="status-dot" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
