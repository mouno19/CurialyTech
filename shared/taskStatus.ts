// One status model for the whole app: the server validates transitions with it, every view
// derives what it shows from it. Keep it free of runtime dependencies (client and server import it).
import type { RunOutcome, StatusReason, TaskStatus } from "./agent";

export type StatusTone = "neutral" | "progress" | "success" | "warning" | "danger";

export const STATUS_META = {
  queued: { label: "Queued", tone: "progress", active: true, final: false, retryable: false },
  running: { label: "Running", tone: "progress", active: true, final: false, retryable: false },
  cancelling: { label: "Cancelling", tone: "warning", active: true, final: false, retryable: false },
  completed: { label: "Completed", tone: "success", active: false, final: true, retryable: false },
  failed: { label: "Failed", tone: "danger", active: false, final: true, retryable: true },
  cancelled: { label: "Cancelled", tone: "warning", active: false, final: true, retryable: true },
  interrupted: { label: "Interrupted", tone: "warning", active: false, final: true, retryable: true },
} as const satisfies Record<TaskStatus, { label: string; tone: StatusTone; active: boolean; final: boolean; retryable: boolean }>;

export const TASK_STATUSES = Object.keys(STATUS_META) as TaskStatus[];
export const ACTIVE_STATUSES = TASK_STATUSES.filter(status => STATUS_META[status].active);
export const FINAL_STATUSES = TASK_STATUSES.filter(status => STATUS_META[status].final);

export const isActiveStatus = (status: TaskStatus | null | undefined): boolean => Boolean(status && STATUS_META[status]?.active);
export const isFinalStatus = (status: TaskStatus | null | undefined): boolean => Boolean(status && STATUS_META[status]?.final);
export const isRetryable = (status: TaskStatus | null | undefined): boolean => Boolean(status && STATUS_META[status]?.retryable);
export const statusLabel = (status: TaskStatus | null | undefined) => (status && STATUS_META[status]?.label) || "Unknown";

/**
 * Allowed transitions. A final status only moves on to queued (a new run: follow-up, retry,
 * deploy). running -> cancelled is only taken when no live worker owns the run any more.
 */
export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "cancelling", "cancelled", "failed", "interrupted"],
  running: ["cancelling", "cancelled", "completed", "failed", "interrupted"],
  cancelling: ["cancelled", "completed", "failed", "interrupted"],
  completed: ["queued"],
  failed: ["queued"],
  cancelled: ["queued"],
  interrupted: ["queued"],
};

export function canTransition(from: TaskStatus, to: TaskStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Every status that may move to `to` (the WHERE clause of a conditional update). */
export function sourcesOf(to: TaskStatus): TaskStatus[] {
  return TASK_STATUSES.filter(from => canTransition(from, to));
}

const REASON_TEXT: Record<StatusReason, string> = {
  user_cancel: "Cancelled by you",
  cancel_timeout: "Stopped: the run did not stop within 30 seconds of the cancel request",
  server_restart: "The server restarted while this task was running",
  worker_lost: "The worker running this task stopped unexpectedly",
  lease_expired: "The worker running this task stopped responding",
  start_failed: "The run could not start",
  error: "The run stopped with an error",
  follow_up: "Follow-up requested",
  retry: "Retry requested",
  deploy: "Deploy requested",
  prompt: "Task started",
  credits: "Stopped: your account ran out of credits",
};

export function statusReasonText(reason: StatusReason | null | undefined) {
  return reason ? REASON_TEXT[reason] ?? null : null;
}

/** Legacy rows (before status_reason existed) recorded restarts only as this error text. */
export const LEGACY_RESTART_ERROR = "Interrupted by a server restart.";

/**
 * The status a task page should show.
 * - While the event stream is live, the newest streamed status wins (it is ahead of the row).
 * - Once the stream has ended (replay of a finished run), the stored row is the authority: a log
 *   that ends on "running" because its worker died must not keep the task "running".
 * - Without a row yet, fall back to the stream.
 */
export function deriveTaskStatus(input: { streamStatus: TaskStatus | null; streamLive: boolean; streamEnded: boolean; rowStatus: TaskStatus | null | undefined }): TaskStatus | null {
  const { streamStatus, streamLive, streamEnded, rowStatus } = input;
  if (!rowStatus) return streamStatus;
  if (streamLive && streamStatus) return streamStatus;
  if (streamEnded) return rowStatus;
  // Connecting or reconnecting: a final row is never contradicted by an older streamed "running".
  if (isFinalStatus(rowStatus)) return rowStatus;
  return streamStatus ?? rowStatus;
}

/** Problems a completed run still had (it finished, but not cleanly). Empty means a clean success. */
export function outcomeIssues(outcome: RunOutcome | null | undefined): string[] {
  if (!outcome) return [];
  const issues: string[] = [];
  if (outcome.verification === "failed") issues.push(outcome.failedCheck ? `Checks still failing: ${outcome.failedCheck.command}` : "Checks still failing");
  if (outcome.review && outcome.review.verdict !== "approve") issues.push(outcome.review.verdict === "none" ? "No review verdict" : "Review not approved");
  if (outcome.publish === "failed") issues.push("Publishing failed");
  if (outcome.publish === "blocked_unapproved") issues.push("Not published: review not approved");
  if (outcome.research === "partial") issues.push("Research incomplete");
  if (outcome.research === "failed") issues.push("Research failed");
  return issues;
}

export type DisplayState = "active" | "success" | "issues" | "failed" | "stopped";

/**
 * What a status chip, list row or counter should show: "success" only for a completed run without
 * issues; a completed run with failing checks, an unapproved review or failed publishing is
 * "issues"; cancelled and interrupted runs are "stopped".
 */
export function displayState(status: TaskStatus | null | undefined, outcome?: RunOutcome | null): DisplayState {
  if (!status || isActiveStatus(status)) return "active";
  if (status === "completed") return outcomeIssues(outcome).length ? "issues" : "success";
  if (status === "failed") return "failed";
  return "stopped";
}

export const DISPLAY_TONE: Record<DisplayState, StatusTone> = { active: "progress", success: "success", issues: "warning", failed: "danger", stopped: "warning" };

// ---- Deployments ----

export type DeploymentState = "creating" | "building" | "live" | "failed" | "expired" | "removed" | "interrupted";

export type DeploymentRowLike = {
  status: string;
  expiresAt: string | Date | null;
  deletedAt?: string | Date | null;
  removedReason?: string | null;
};

const time = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : NaN);

/**
 * Truthful state of a cloud preview from its stored row. An expired or removed preview is never
 * "live", whatever the event log last said; a creating/building row whose run is gone was abandoned.
 */
export function deriveDeploymentState(row: DeploymentRowLike, now: number, runActive: boolean): DeploymentState {
  const expires = time(row.expiresAt);
  const deleted = time(row.deletedAt);
  if (Number.isFinite(deleted)) {
    // A deploy cancelled before it went live was removed, not failed (its row is marked failed).
    if (row.removedReason === "cancelled") return "removed";
    if (row.status === "failed" || row.removedReason === "failed") return "failed";
    if (row.removedReason === "expired" || (Number.isFinite(expires) && deleted >= expires)) return "expired";
    if (row.removedReason === "interrupted") return "interrupted";
    return "removed";
  }
  if (row.status === "failed") return "failed";
  if (Number.isFinite(expires) && expires <= now) return "expired";
  if (row.status === "live") return "live";
  if (row.status === "interrupted") return "interrupted";
  if (row.status === "creating" || row.status === "building") return runActive ? (row.status as DeploymentState) : "interrupted";
  return "removed";
}
