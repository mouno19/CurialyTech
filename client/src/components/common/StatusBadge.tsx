import type { LucideIcon } from "lucide-react";
import { Check, CircleSlash, CircleX, TriangleAlert, Unplug } from "lucide-react";
import type { RunOutcome, StatusReason, TaskStatus } from "@shared/agent";
import { STATUS_META, displayState, isActiveStatus, outcomeIssues, statusReasonText, type StatusTone } from "@shared/taskStatus";
import { cx } from "./cx";

export type StatusDisplay = { label: string; tone: StatusTone; live: boolean; icon: LucideIcon | null };

/**
 * Label, tone and glyph for a task status: STATUS_META for the label, displayState for "Completed
 * with issues". Success styling only for a completed run without outcome issues.
 */
export function statusDisplay(status: TaskStatus | null | undefined, outcome?: RunOutcome | null): StatusDisplay {
  if (!status || !STATUS_META[status]) return { label: "Unknown", tone: "neutral", live: false, icon: null };
  const meta = STATUS_META[status];
  if (isActiveStatus(status)) return { label: meta.label, tone: meta.tone, live: true, icon: null };
  const state = displayState(status, outcome);
  if (state === "success") return { label: meta.label, tone: "success", live: false, icon: Check };
  if (state === "issues") return { label: "Completed with issues", tone: "warning", live: false, icon: TriangleAlert };
  if (state === "failed") return { label: meta.label, tone: "danger", live: false, icon: CircleX };
  return { label: meta.label, tone: meta.tone, live: false, icon: status === "interrupted" ? Unplug : CircleSlash };
}

export type StatusBadgeProps = {
  status: TaskStatus | null | undefined;
  outcome?: RunOutcome | null;
  /** Why the task is in this status; shown as the tooltip (show it as text elsewhere too). */
  reason?: StatusReason | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/** The one status chip: text always visible, tone via data-tone, a live dot only while active. Not a live region. */
export function StatusBadge({ status, outcome, reason, size = "md", className }: StatusBadgeProps) {
  const { label, tone, live, icon: Icon } = statusDisplay(status, outcome);
  const note = [statusReasonText(reason), ...(status === "completed" ? outcomeIssues(outcome) : [])].filter(Boolean).join(" · ");
  const glyph = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  return (
    <span className={cx("status-badge", className)} data-tone={tone} data-size={size} data-status={status ?? "unknown"} title={note || undefined}>
      {live ? <span className="status-dot" data-live="" aria-hidden="true" /> : Icon ? <Icon size={glyph} aria-hidden="true" /> : <span className="status-dot" aria-hidden="true" />}
      {label}
    </span>
  );
}
