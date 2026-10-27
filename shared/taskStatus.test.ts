import { describe, expect, it } from "vitest";
import type { RunOutcome, StatusReason, TaskStatus } from "./agent";
import {
  ACTIVE_STATUSES, canTransition, deriveDeploymentState, deriveTaskStatus, DISPLAY_TONE, displayState, FINAL_STATUSES, isActiveStatus,
  isFinalStatus, isRetryable, LEGACY_RESTART_ERROR, outcomeIssues, sourcesOf, STATUS_META, statusLabel, statusReasonText, TASK_STATUSES, TRANSITIONS,
} from "./taskStatus";

const VENDORS = /snowflake|cortex|relaystation|browserbase|render|manus|tiger|paper instruments|tinker/i;

describe("status transitions", () => {
  it("partitions statuses into active and final", () => {
    expect(ACTIVE_STATUSES).toEqual(["queued", "running", "cancelling"]);
    expect(FINAL_STATUSES).toEqual(["completed", "failed", "cancelled", "interrupted"]);
    for (const status of TASK_STATUSES) expect(isActiveStatus(status)).toBe(!isFinalStatus(status));
    expect(TASK_STATUSES.filter(isRetryable)).toEqual(["failed", "cancelled", "interrupted"]);
    expect(isActiveStatus(null)).toBe(false);
    expect(isFinalStatus(undefined)).toBe(false);
    expect(statusLabel("interrupted")).toBe("Interrupted");
    expect(statusLabel(null)).toBe("Unknown");
  });

  it("only lets a final status start a new run, and never stays put", () => {
    for (const status of FINAL_STATUSES) expect(TRANSITIONS[status]).toEqual(["queued"]);
    for (const status of TASK_STATUSES) expect(canTransition(status, status)).toBe(false);
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("cancelling", "completed")).toBe(true); // finished before the stop took effect
    expect(canTransition("queued", "completed")).toBe(false); // nothing ran
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("interrupted", "cancelled")).toBe(false);
    expect(canTransition("bogus" as TaskStatus, "queued")).toBe(false);
  });

  it("derives the WHERE clause of a conditional update from the transition table", () => {
    expect(sourcesOf("running")).toEqual(["queued"]);
    expect(sourcesOf("cancelling")).toEqual(["queued", "running"]);
    expect(sourcesOf("completed")).toEqual(["running", "cancelling"]);
    expect(sourcesOf("cancelled")).toEqual(["queued", "running", "cancelling"]);
    expect(sourcesOf("queued")).toEqual(FINAL_STATUSES);
    // The reconciler can always settle an active row, whatever state its worker left it in.
    expect(sourcesOf("interrupted")).toEqual(ACTIVE_STATUSES);
    expect(sourcesOf("failed")).toEqual(ACTIVE_STATUSES);
  });

  it("explains every reason in neutral words", () => {
    const reasons: StatusReason[] = ["user_cancel", "cancel_timeout", "server_restart", "worker_lost", "lease_expired", "start_failed", "error", "follow_up", "retry", "deploy", "prompt"];
    for (const reason of reasons) {
      expect(statusReasonText(reason)).toEqual(expect.any(String));
      expect(statusReasonText(reason)).not.toMatch(VENDORS);
    }
    expect(statusReasonText(null)).toBeNull();
    expect(statusReasonText("nope" as StatusReason)).toBeNull();
    for (const status of TASK_STATUSES) expect(STATUS_META[status].label).not.toMatch(VENDORS);
    expect(LEGACY_RESTART_ERROR).toBe("Interrupted by a server restart.");
  });
});

describe("deriveTaskStatus", () => {
  const derive = (streamStatus: TaskStatus | null, streamLive: boolean, streamEnded: boolean, rowStatus: TaskStatus | null | undefined) =>
    deriveTaskStatus({ streamStatus, streamLive, streamEnded, rowStatus });

  it("trusts the row once the replay of a dead run has ended (orphan log ending on running)", () => {
    expect(derive("running", false, true, "interrupted")).toBe("interrupted");
    expect(derive("cancelling", false, true, "cancelled")).toBe("cancelled");
    // A row fetched before the reconciler ran is still the authority; the page polls it.
    expect(derive("running", false, true, "running")).toBe("running");
  });

  it("lets a live stream win over the stored row", () => {
    expect(derive("cancelling", true, false, "running")).toBe("cancelling");
    expect(derive("completed", true, false, "running")).toBe("completed");
    // A follow-up that just started streams ahead of a row loaded before it.
    expect(derive("running", true, false, "completed")).toBe("running");
    // Live but nothing streamed yet: the row.
    expect(derive(null, true, false, "queued")).toBe("queued");
  });

  it("never lets an older streamed status contradict a final row while connecting", () => {
    expect(derive("running", false, false, "completed")).toBe("completed");
    expect(derive("running", false, false, "interrupted")).toBe("interrupted");
    expect(derive("cancelling", false, false, "running")).toBe("cancelling");
    expect(derive(null, false, false, "running")).toBe("running");
  });

  it("falls back to the stream without a row", () => {
    expect(derive("running", true, false, undefined)).toBe("running");
    expect(derive(null, false, false, null)).toBeNull();
  });
});

describe("outcome and display state", () => {
  const clean: RunOutcome = { verification: "passed" };

  it("shows success only for a clean completed run", () => {
    expect(outcomeIssues(clean)).toEqual([]);
    expect(outcomeIssues(null)).toEqual([]);
    expect(displayState("completed", clean)).toBe("success");
    expect(displayState("completed")).toBe("success");
    expect(displayState("completed", { verification: "skipped", review: { verdict: "approve", rounds: 1 }, publish: "done", research: "completed" })).toBe("success");
    expect(DISPLAY_TONE.success).toBe("success");
    for (const state of ["active", "issues", "failed", "stopped"] as const) expect(DISPLAY_TONE[state]).not.toBe("success");
  });

  it("reports a completed run with failing checks, an unapproved review or failed publishing as issues", () => {
    const failedChecks: RunOutcome = { verification: "failed", failedCheck: { command: "npm test", exitCode: 1 } };
    expect(displayState("completed", failedChecks)).toBe("issues");
    expect(outcomeIssues(failedChecks)).toEqual(["Checks still failing: npm test"]);
    expect(outcomeIssues({ verification: "failed" })).toEqual(["Checks still failing"]);
    expect(outcomeIssues({ verification: "passed", review: { verdict: "request_changes", rounds: 3 } })).toEqual(["Review not approved"]);
    expect(outcomeIssues({ verification: "passed", review: { verdict: "none", rounds: 3 } })).toEqual(["No review verdict"]);
    expect(outcomeIssues({ verification: "passed", publish: "failed" })).toEqual(["Publishing failed"]);
    expect(outcomeIssues({ verification: "passed", publish: "blocked_unapproved" })).toEqual(["Not published: review not approved"]);
    expect(outcomeIssues({ verification: "none", research: "partial" })).toEqual(["Research incomplete"]);
    expect(outcomeIssues({ verification: "none", research: "failed" })).toEqual(["Research failed"]);
    expect(DISPLAY_TONE[displayState("completed", failedChecks)]).toBe("warning");
  });

  it("never shows a stopped or failed run as a success, whatever its outcome says", () => {
    expect(displayState("failed", clean)).toBe("failed");
    expect(displayState("cancelled", clean)).toBe("stopped");
    expect(displayState("interrupted", clean)).toBe("stopped");
    for (const status of ACTIVE_STATUSES) expect(displayState(status, clean)).toBe("active");
  });
});

describe("deriveDeploymentState", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const later = "2026-10-27T13:00:00Z";
  const earlier = "2026-10-27T11:00:00Z";
  const state = (row: Parameters<typeof deriveDeploymentState>[0], runActive = false) => deriveDeploymentState(row, now, runActive);

  it("is live only before it expires", () => {
    expect(state({ status: "live", expiresAt: later })).toBe("live");
    expect(state({ status: "live", expiresAt: new Date(later) })).toBe("live");
    expect(state({ status: "live", expiresAt: earlier })).toBe("expired");
    expect(state({ status: "live", expiresAt: new Date(now).toISOString() })).toBe("expired");
  });

  it("explains a removed preview by why it went away", () => {
    expect(state({ status: "live", expiresAt: later, deletedAt: earlier, removedReason: "expired" })).toBe("expired");
    // Taken down by the user after it had already expired: it expired.
    expect(state({ status: "live", expiresAt: earlier, deletedAt: new Date(now).toISOString(), removedReason: "user" })).toBe("expired");
    expect(state({ status: "live", expiresAt: later, deletedAt: earlier, removedReason: "user" })).toBe("removed");
    expect(state({ status: "building", expiresAt: later, deletedAt: earlier, removedReason: "interrupted" })).toBe("interrupted");
    expect(state({ status: "failed", expiresAt: later, deletedAt: earlier, removedReason: "failed" })).toBe("failed");
    // Cancelled before it went live: the row is marked failed, but it was removed (as the log says).
    expect(state({ status: "failed", expiresAt: later, deletedAt: earlier, removedReason: "cancelled" })).toBe("removed");
  });

  it("keeps a failed deploy failed", () => {
    expect(state({ status: "failed", expiresAt: later })).toBe("failed");
    expect(state({ status: "failed", expiresAt: earlier })).toBe("failed");
  });

  it("treats creating/building without an active run as interrupted", () => {
    expect(state({ status: "creating", expiresAt: later }, true)).toBe("creating");
    expect(state({ status: "building", expiresAt: later }, true)).toBe("building");
    expect(state({ status: "creating", expiresAt: later }, false)).toBe("interrupted");
    expect(state({ status: "building", expiresAt: later }, false)).toBe("interrupted");
    expect(state({ status: "building", expiresAt: earlier }, true)).toBe("expired");
  });
});
