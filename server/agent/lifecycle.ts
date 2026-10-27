import os from "node:os";
import { randomBytes } from "node:crypto";
import type { AgentEvent, AgentEventBody, RunOutcome, StatusReason, TaskStatus } from "@shared/agent";
import { ACTIVE_STATUSES, FINAL_STATUSES, LEGACY_RESTART_ERROR, sourcesOf } from "@shared/taskStatus";
import { heartbeatQuery, query } from "../db/pg";
import { cleanText, toJsonb } from "../db/json";

// Task lifecycle: who owns a run, and the only place task status changes.
//
// Every run gets a run_id (fencing token). The worker that claims it records worker_id and keeps a
// lease alive with a heartbeat. Status changes are conditional updates ("only if the row is still in
// one of these statuses and still belongs to this run"), and terminal status changes insert their
// status/done events in the same statement, so the row and the replayed event log always agree.
// A run whose worker is gone (restart, crash, lost lease) is moved to "interrupted" by the
// reconciler; nothing here ever reports success for work that did not finish.

/** Identifies this process: host, pid and a per-boot nonce (pids are reused across restarts). */
export const WORKER_ID = `${os.hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
export const LEASE_SECONDS = 45;
export const HEARTBEAT_MS = 15_000;
export const RECONCILE_MS = 30_000;

let schema = "curialy";
/** Tests point the lifecycle SQL at temporary tables; production never calls this. */
export function useSchemaForTests(name: string) {
  schema = name;
}
const t = (table: string) => `${schema}.${table}`;

export type LifecycleRow = {
  id: string;
  status: TaskStatus;
  runId: string | null;
  attempt: number;
  workerId: string | null;
  leaseLive: boolean;
  /** Seconds since the lease ran out (null while live or when there is no lease). */
  leaseExpiredFor: number | null;
  cancelRequested: boolean;
  /** Why the row is in its status (getLifecycleRow only). */
  statusReason: StatusReason | null;
};

const LEASE_COLUMNS = `(lease_expires_at IS NOT NULL AND lease_expires_at > now()) AS lease_live,
  CASE WHEN lease_expires_at IS NOT NULL AND lease_expires_at <= now() THEN EXTRACT(EPOCH FROM now() - lease_expires_at)::float ELSE NULL END AS lease_expired_for,
  cancel_requested_at IS NOT NULL AS cancel_requested`;

type LeaseRow = { id: string; status: TaskStatus; run_id: string | null; attempt: number; worker_id: string | null; lease_live: boolean; lease_expired_for: number | null; cancel_requested: boolean; status_reason?: StatusReason | null };
const toLifecycleRow = (row: LeaseRow): LifecycleRow => ({
  id: row.id, status: row.status, runId: row.run_id, attempt: row.attempt, workerId: row.worker_id, leaseLive: row.lease_live,
  leaseExpiredFor: row.lease_expired_for === null ? null : Number(row.lease_expired_for), cancelRequested: row.cancel_requested, statusReason: row.status_reason ?? null,
});

export async function getLifecycleRow(taskId: string): Promise<LifecycleRow | null> {
  const { rows } = await query<LeaseRow>(`SELECT id, status, run_id, attempt, worker_id, status_reason, ${LEASE_COLUMNS} FROM ${t("chat_sessions")} WHERE id = $1`, [taskId]);
  return rows[0] ? toLifecycleRow(rows[0]) : null;
}

/**
 * primary (default): owns recovery of rows written by pre-lease code, the log repair and the
 * sweepers. replica (AGENT_INSTANCE_ROLE=replica, e.g. a side test instance sharing a database):
 * runs tasks and recovers only leased runs whose worker is provably gone.
 */
export const IS_PRIMARY = (process.env.AGENT_INSTANCE_ROLE ?? "primary") !== "replica";

/**
 * Start a new run on a finished task (follow-up, retry, deploy): final -> queued with a fresh run id,
 * owned by this worker. Returns null when the task is active or `expectedRunId` is stale, so two
 * clicks can never start two runs.
 */
export async function claimNextRun(taskId: string, opts: { runId: string; reason: StatusReason; expectedRunId?: string | null }) {
  const values: unknown[] = [taskId, opts.runId, WORKER_ID, opts.reason, FINAL_STATUSES];
  let fence = "";
  if (opts.expectedRunId !== undefined) {
    values.push(opts.expectedRunId);
    fence = `AND run_id IS NOT DISTINCT FROM $${values.length}::uuid`;
  }
  const { rows } = await query<{ attempt: number }>(
    `UPDATE ${t("chat_sessions")} SET status = 'queued', run_id = $2, attempt = attempt + 1, worker_id = $3,
       lease_expires_at = now() + interval '${LEASE_SECONDS} seconds', status_reason = $4, status_changed_at = now(),
       error = NULL, answer = NULL, cancel_requested_at = NULL, started_at = NULL, finished_at = NULL, outcome = NULL,
       updated_at = now(), last_activity_at = now()
     WHERE id = $1 AND status = ANY($5::text[]) ${fence}
     RETURNING attempt`, values,
  );
  return rows[0] ? { runId: opts.runId, attempt: rows[0].attempt } : null;
}

export type TransitionOptions = {
  /** Statuses the row must currently be in (defaults to every status allowed to move to `to`). */
  from?: TaskStatus[];
  reason?: StatusReason | null;
  /** Error text shown with a failed run (null clears it). */
  error?: string | null;
  answer?: string;
  outcome?: RunOutcome | null;
  /** Events inserted atomically with the status change (e.g. the terminal status + done pair). */
  events?: AgentEventBody[];
  /** The live channel's sequence number, so inserted events continue after what viewers already saw. */
  baseSeq?: number;
  /** Mark a cancel request on the row (cancelling). */
  cancelRequested?: boolean;
};

export type TransitionResult = { applied: boolean; events: AgentEvent[] };

/**
 * The single way task status changes. Applies only if the row is in one of `from` and still belongs
 * to `runId` (null matches legacy rows without a run id); zero rows means another writer won.
 */
export async function transitionTask(taskId: string, runId: string | null, to: TaskStatus, opts: TransitionOptions = {}): Promise<TransitionResult> {
  const from = opts.from ?? sourcesOf(to);
  const final = FINAL_STATUSES.includes(to);
  const sets = ["status = $2", "status_changed_at = now()", "updated_at = now()", "last_activity_at = now()"];
  const values: unknown[] = [taskId, to, from, runId];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (opts.reason !== undefined) sets.push(`status_reason = ${param(opts.reason)}`);
  // Text columns reject NUL bytes too; an unstorable answer must not cost the run its terminal status.
  if (opts.error !== undefined) sets.push(`error = ${param(opts.error === null ? null : cleanText(opts.error))}`);
  if (opts.answer !== undefined) sets.push(`answer = ${param(cleanText(opts.answer))}`);
  if (opts.outcome !== undefined) sets.push(`outcome = ${param(opts.outcome === null ? null : toJsonb(opts.outcome))}::jsonb`);
  if (to === "running") sets.push("started_at = COALESCE(started_at, now())", `lease_expires_at = now() + interval '${LEASE_SECONDS} seconds'`);
  if (to === "cancelling" || opts.cancelRequested) sets.push("cancel_requested_at = COALESCE(cancel_requested_at, now())");
  if (final) sets.push("finished_at = now()", "worker_id = NULL", "lease_expires_at = NULL");
  const events = opts.events ?? [];
  const eventsParam = param(toJsonb(events));
  const baseParam = param(Math.max(0, Math.floor(opts.baseSeq ?? 0)));
  const { rows } = await query<{ moved: string; inserted: { seq: number; ts: string; data: AgentEventBody }[] | null }>(
    `WITH moved AS (
       UPDATE ${t("chat_sessions")} SET ${sets.join(", ")}
       WHERE id = $1 AND status = ANY($3::text[]) AND run_id IS NOT DISTINCT FROM $4::uuid
       RETURNING id
     ), base AS (
       SELECT GREATEST(${baseParam}::int, COALESCE(MAX(seq), 0)) AS s FROM ${t("agent_execution_logs")} WHERE session_id = $1
     ), ins AS (
       INSERT INTO ${t("agent_execution_logs")} (session_id, seq, type, data, created_at)
       SELECT $1, base.s + e.ord, e.data->>'type', e.data, now()
       FROM moved, base, jsonb_array_elements(${eventsParam}::jsonb) WITH ORDINALITY AS e(data, ord)
       RETURNING seq, created_at, data
     )
     SELECT (SELECT count(*) FROM moved) AS moved,
            (SELECT json_agg(json_build_object('seq', seq, 'ts', created_at, 'data', data) ORDER BY seq) FROM ins) AS inserted`,
    values,
  );
  const applied = Number(rows[0]?.moved ?? 0) > 0;
  const inserted = (rows[0]?.inserted ?? []).map(row => ({ ...row.data, seq: row.seq, ts: new Date(row.ts).toISOString() }) as AgentEvent);
  return { applied, events: inserted };
}

/** The status + done pair that ends every run in the event log. */
export function terminalEvents(status: TaskStatus, opts: { reason?: StatusReason; error?: string; answer?: string; outcome?: RunOutcome } = {}): AgentEventBody[] {
  return [
    { type: "status", status, ...(opts.reason ? { reason: opts.reason } : {}) },
    { type: "done", status, answer: opts.answer ?? "", ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.error ? { error: opts.error } : {}), ...(opts.outcome ? { outcome: opts.outcome } : {}) },
  ];
}

/**
 * browser_session "ended" events for sessions the log still shows as live: when a run stops without
 * its worker (restart, crash), nothing else would ever close them and a replay would show a dead
 * live view.
 */
export async function closeOpenSessionEvents(taskId: string): Promise<AgentEventBody[]> {
  const { rows } = await query<{ sid: string; last: string }>(
    `SELECT data->>'sessionId' AS sid, (array_agg(data->>'status' ORDER BY seq DESC))[1] AS last
     FROM ${t("agent_execution_logs")} WHERE session_id = $1 AND type = 'browser_session' GROUP BY 1`, [taskId],
  );
  return rows.filter(row => row.sid && row.last === "live").map(row => ({ type: "browser_session", sessionId: row.sid, status: "ended", liveUrl: null, replayUrl: "", reason: "interrupted" }) as AgentEventBody);
}

/**
 * A run_start for a run whose start never reached the log (its worker died right after the claim),
 * so the end recorded for it is not read as the end of the previous run.
 */
export async function missingRunStart(taskId: string, runId: string | null, attempt: number): Promise<AgentEventBody[]> {
  if (!runId) return [];
  const { rows } = await query<{ found: boolean; reason: StatusReason | null }>(
    `SELECT EXISTS (SELECT 1 FROM ${t("agent_execution_logs")} WHERE session_id = $1 AND type = 'run_start' AND data->>'runId' = $2) AS found,
            (SELECT status_reason FROM ${t("chat_sessions")} WHERE id = $1) AS reason`, [taskId, runId],
  );
  if (rows[0]?.found !== false) return [];
  const reason = rows[0]?.reason;
  const trigger = reason === "retry" ? "retry" : reason === "deploy" ? "deploy" : reason === "follow_up" ? "follow_up" : "prompt";
  return [{ type: "run_start", runId, attempt, trigger }];
}

/**
 * Append events to a task's log outside a live run (sweepers, repairs), continuing after the last
 * persisted sequence number. Retries on the rare sequence collision.
 */
export async function appendLoggedEvents(taskId: string, bodies: AgentEventBody[]): Promise<AgentEvent[]> {
  if (!bodies.length) return [];
  for (let attempt = 1; ; attempt++) {
    try {
      const { rows } = await query<{ seq: number; created_at: Date; data: AgentEventBody }>(
        `WITH base AS (SELECT COALESCE(MAX(seq), 0) AS s FROM ${t("agent_execution_logs")} WHERE session_id = $1)
         INSERT INTO ${t("agent_execution_logs")} (session_id, seq, type, data, created_at)
         SELECT $1, base.s + e.ord, e.data->>'type', e.data, now()
         FROM base, jsonb_array_elements($2::jsonb) WITH ORDINALITY AS e(data, ord)
         RETURNING seq, created_at, data`,
        [taskId, toJsonb(bodies)],
      );
      return rows.sort((a, b) => a.seq - b.seq).map(row => ({ ...row.data, seq: row.seq, ts: row.created_at.toISOString() }) as AgentEvent);
    } catch (error) {
      if ((error as { code?: string }).code !== "23505" || attempt >= 4) throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Ownership: heartbeat and staleness
// ---------------------------------------------------------------------------

/** Renew the leases of runs this worker holds. Returns what the database still agrees we own. */
export async function renewLeases(runs: { taskId: string; runId: string }[]) {
  if (!runs.length) return [];
  // Its own connection: renewals must not wait behind snapshots and event batches in the main pool.
  const { rows } = await heartbeatQuery<{ id: string; run_id: string; status: TaskStatus; cancel_requested: boolean }>(
    `UPDATE ${t("chat_sessions")} SET lease_expires_at = now() + interval '${LEASE_SECONDS} seconds'
     WHERE worker_id = $1 AND id = ANY($2::uuid[]) AND run_id = ANY($3::uuid[]) AND status = ANY($4::text[])
     RETURNING id, run_id, status, cancel_requested_at IS NOT NULL AS cancel_requested`,
    [WORKER_ID, runs.map(run => run.taskId), runs.map(run => run.runId), ACTIVE_STATUSES],
  );
  return rows.map(row => ({ taskId: row.id, runId: row.run_id, status: row.status, cancelRequested: row.cancel_requested }));
}

type WorkerParts = { host: string; pid: number; nonce: string };

export function parseWorkerId(workerId: string | null): WorkerParts | null {
  if (!workerId) return null;
  const match = /^(.*):(\d+):([0-9a-f]+)$/.exec(workerId);
  return match ? { host: match[1], pid: Number(match[2]), nonce: match[3] } : null;
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type StaleVerdict = { stale: false } | { stale: true; reason: StatusReason };

/**
 * Whether an active row's run can no longer finish. Rows this process runs are never stale here
 * (the caller skips them). Legacy rows (no worker id) come from code without leases: their worker
 * is the previous process, so they are reclaimed.
 */
export function judgeStaleness(row: { workerId: string | null; leaseLive: boolean; leaseExpiredFor?: number | null }, self = WORKER_ID, alive: (pid: number) => boolean = pidAlive, primary = IS_PRIMARY): StaleVerdict {
  // Rows from pre-lease code: their worker is the previous process. Only a primary reclaims them, so
  // a replica sharing the database never interrupts a run an older production process is executing.
  if (!row.workerId) return primary ? { stale: true, reason: "server_restart" } : { stale: false };
  if (row.workerId === self) return { stale: true, reason: "worker_lost" };
  const owner = parseWorkerId(row.workerId);
  const me = parseWorkerId(self);
  if (owner && me && owner.host === me.host) {
    // Same machine: a dead pid (or the same pid with another nonce, i.e. a previous boot) is certain.
    if (owner.pid === me.pid || !alive(owner.pid)) return { stale: true, reason: "server_restart" };
    // Alive on this machine: it fences itself when it cannot renew; give it time before taking over.
    return (row.leaseExpiredFor ?? 0) > 2 * LEASE_SECONDS ? { stale: true, reason: "lease_expired" } : { stale: false };
  }
  if (!row.leaseLive) return { stale: true, reason: "lease_expired" };
  return { stale: false };
}

/**
 * Move every active run whose worker is gone to interrupted (or cancelled, if a cancel was already
 * requested), with its terminal events. `isLocal` tells which runs this process is executing.
 */
export async function reconcileStaleTasks(isLocal: (taskId: string, runId: string | null) => boolean) {
  const { rows: raw } = await query<LeaseRow>(
    `SELECT id, status, run_id, attempt, worker_id, ${LEASE_COLUMNS} FROM ${t("chat_sessions")} WHERE status = ANY($1::text[])`, [ACTIVE_STATUSES],
  );
  const recovered: { taskId: string; status: TaskStatus; reason: StatusReason }[] = [];
  for (const row of raw) {
    if (isLocal(row.id, row.run_id)) continue;
    const verdict = judgeStaleness({ workerId: row.worker_id, leaseLive: row.lease_live, leaseExpiredFor: row.lease_expired_for === null ? null : Number(row.lease_expired_for) });
    if (!verdict.stale) continue;
    const cancelled = row.status === "cancelling" || row.cancel_requested;
    const status: TaskStatus = cancelled ? "cancelled" : "interrupted";
    const reason: StatusReason = cancelled ? "user_cancel" : verdict.reason;
    const closing = await closeOpenSessionEvents(row.id).catch(() => [] as AgentEventBody[]);
    const opening = await missingRunStart(row.id, row.run_id, row.attempt).catch(() => [] as AgentEventBody[]);
    const result = await transitionTask(row.id, row.run_id, status, { from: [row.status], reason, events: [...opening, ...closing, ...terminalEvents(status, { reason })] });
    if (result.applied) recovered.push({ taskId: row.id, status, reason });
  }
  return recovered;
}

/**
 * Final rows whose event log does not end on a matching done event (crash windows of older code,
 * dropped batches): append the terminal pair so a replay shows what the row says. Rows recovered
 * by the pre-lease code (failed + the old restart text) are shown, and repaired, as interrupted.
 * Each append happens only if the row is still in that state (it may have started a new run).
 */
export async function repairEventLogs(limit = 300) {
  if (!IS_PRIMARY) return 0;
  const shown = `CASE WHEN s.status = 'failed' AND s.error = '${LEGACY_RESTART_ERROR.replace(/'/g, "''")}' THEN 'interrupted' ELSE s.status END`;
  const { rows } = await query<{ id: string; status: TaskStatus; shown: TaskStatus; run_id: string | null; status_reason: StatusReason | null; error: string | null }>(
    `SELECT s.id, s.status, ${shown} AS shown, s.run_id, s.status_reason, s.error FROM ${t("chat_sessions")} s
     WHERE s.status = ANY($1::text[])
       AND s.updated_at > now() - interval '90 days'
       AND COALESCE((
         SELECT CASE WHEN l.type = 'done' THEN l.data->>'status' ELSE '' END
         FROM ${t("agent_execution_logs")} l
         WHERE l.session_id = s.id AND l.type IN ('status', 'done', 'run_start', 'user_message')
         ORDER BY l.seq DESC LIMIT 1
       ), '') <> ${shown}
     ORDER BY s.updated_at DESC LIMIT $2`,
    [FINAL_STATUSES, limit],
  );
  let repaired = 0;
  for (const row of rows) {
    const legacy = row.shown !== row.status;
    const reason = legacy ? "server_restart" : row.status_reason ?? undefined;
    const closing = await closeOpenSessionEvents(row.id).catch(() => [] as AgentEventBody[]);
    const events = [...closing, ...terminalEvents(row.shown, { reason, error: row.shown === "failed" ? row.error ?? undefined : undefined })];
    const { rowCount } = await query(
      `WITH s AS (SELECT 1 FROM ${t("chat_sessions")} WHERE id = $1 AND status = $2 AND run_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE),
            base AS (SELECT COALESCE(MAX(seq), 0) AS m FROM ${t("agent_execution_logs")} WHERE session_id = $1)
       INSERT INTO ${t("agent_execution_logs")} (session_id, seq, type, data, created_at)
       SELECT $1, base.m + e.ord, e.data->>'type', e.data, now() FROM s, base, jsonb_array_elements($4::jsonb) WITH ORDINALITY AS e(data, ord)`,
      [row.id, row.status, row.run_id, toJsonb(events)],
    ).catch(error => { console.error(`[lifecycle] repair ${row.id} failed:`, error.message); return { rowCount: 0 }; });
    if (rowCount) repaired++;
  }
  return repaired;
}

/** Rows a live worker (any process) is running right now. */
export async function countActiveRuns() {
  const { rows } = await query<{ count: string }>(
    `SELECT count(*) AS count FROM ${t("chat_sessions")} WHERE status = ANY($1::text[]) AND lease_expires_at > now()`, [ACTIVE_STATUSES],
  );
  return Number(rows[0]?.count ?? 0);
}
