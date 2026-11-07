import { randomUUID } from "node:crypto";
import { brandText } from "@shared/brand";
import { MAX_QUEUED_MESSAGES, type QueuedMessage, type StatusReason, type TaskQueue, type TaskStatus } from "@shared/agent";
import { isFinalStatus } from "@shared/taskStatus";
import { query } from "../db/pg";
import { admissionRefusal, oneAtATime, type AdmissionRefusal } from "./admission";
import type { AttachmentRef } from "./attachments";
import { StorageError } from "../media/storage-errors";
import { followUp, isDraining, isRunning, onRunSettled, TaskBusy, type FollowUpRepo } from "./runner";
import { getAgentTask } from "./store";

// Follow-ups sent while a run is active wait here (curialy.queued_followups) and start one at a
// time, oldest first, when the run before them ends: from the run's own end in this process, and
// from a sweep that catches everything else (another instance, a restart, a start that had to wait
// for credits or the account's other task). A message is claimed in the database before it starts,
// so it starts once even with several instances.
//
// The queue goes on by itself after a completed run, and after a failed one the user started (the
// waiting message may be the fix). It waits for the user after a stop, an interruption, or a
// failure of a run it started itself, so one failure doesn't run through the whole queue.

type Row = {
  id: string; session_id: string; user_id: string; prompt: string; attachments: AttachmentRef[] | null; model: string | null;
  repo: FollowUpRepo | null; client_message_id: string; state: "waiting" | "starting" | "started" | "failed"; error: string | null;
  run_id: string | null; created_at: Date;
};
const COLUMNS = "id, session_id, user_id, prompt, attachments, model, repo, client_message_id, state, error, run_id, created_at";
/** What the queue shows: started messages are runs now, in the conversation. */
const SHOWN = "('waiting', 'starting', 'failed')";

const view = (row: Row): QueuedMessage => ({
  id: row.id,
  prompt: row.prompt,
  attachments: (row.attachments ?? []).map(ref => ({ id: ref.id, filename: ref.filename, mimeType: ref.mimeType, sizeBytes: ref.sizeBytes })),
  model: row.model,
  repo: row.repo ? { fullName: row.repo.fullName, branch: row.repo.branch ?? null, ...(row.repo.replace ? { replace: true } : {}) } : null,
  clientMessageId: row.client_message_id,
  state: row.state === "started" ? "starting" : row.state,
  error: row.error,
  createdAt: row.created_at.toISOString(),
});

export class QueueRejected extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/** Add a follow-up to the task's queue. Sending the same client message id again returns the first one. */
export async function queueMessage(taskId: string, userId: string, input: { prompt: string; attachments: AttachmentRef[]; model?: string | null; repo?: FollowUpRepo | null; clientMessageId?: string }) {
  // Always set: the run's user_message echoes it, which is how a stale claim is told from a started one.
  const clientMessageId = input.clientMessageId || `queued-${randomUUID()}`;
  const values = [taskId, userId, input.prompt, JSON.stringify(input.attachments), input.model ?? null, input.repo ? JSON.stringify({ fullName: input.repo.fullName, branch: input.repo.branch ?? null, ...(input.repo.replace ? { replace: true } : {}) }) : null, clientMessageId, MAX_QUEUED_MESSAGES];
  // The cap is checked in the insert itself (a soft limit: two sends at once may both get the last place).
  const { rows: [row] } = await query<Row>(
    `INSERT INTO curialy.queued_followups (session_id, user_id, prompt, attachments, model, repo, client_message_id)
     SELECT $1::uuid, $2::uuid, $3::text, $4::jsonb, $5::text, $6::jsonb, $7::text
     WHERE (SELECT count(*) FROM curialy.queued_followups WHERE session_id = $1::uuid AND state IN ${SHOWN}) < $8::int
     ON CONFLICT (session_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING ${COLUMNS}`,
    values,
  );
  if (row) return view(row);
  const { rows: [existing] } = await query<Row>(`SELECT ${COLUMNS} FROM curialy.queued_followups WHERE session_id = $1 AND client_message_id = $2`, [taskId, clientMessageId]);
  if (existing) return view(existing);
  throw new QueueRejected(`Up to ${MAX_QUEUED_MESSAGES} messages can wait at once. Remove one, or wait for the next to start.`);
}

/** The task's waiting messages, and why the queue waits for the user (if it does). */
export async function listQueue(task: QueueTask): Promise<TaskQueue> {
  const { rows } = await query<Row>(`SELECT ${COLUMNS} FROM curialy.queued_followups WHERE session_id = $1 AND state IN ${SHOWN} ORDER BY created_at, id`, [task.id]);
  const held = rows.some(row => row.state === "waiting") ? await holdReason(task) : null;
  return { items: rows.map(view), held };
}

/** Change a waiting message's text. Null when it is no longer waiting (it started, or was removed). */
export async function editQueued(taskId: string, itemId: string, prompt: string) {
  const { rows: [row] } = await query<Row>(`UPDATE curialy.queued_followups SET prompt = $3, updated_at = now() WHERE id = $2 AND session_id = $1 AND state IN ('waiting', 'failed') RETURNING ${COLUMNS}`, [taskId, itemId, prompt]);
  return row ? view(row) : null;
}

/** Remove a message that has not started. False when it already started (or is gone). */
export async function removeQueued(taskId: string, itemId: string) {
  const { rowCount } = await query(`DELETE FROM curialy.queued_followups WHERE id = $2 AND session_id = $1 AND state IN ('waiting', 'failed')`, [taskId, itemId]);
  return (rowCount ?? 0) > 0;
}

/** A failed message the user wants to try again goes back in line, at its place. */
export async function requeue(taskId: string, itemId: string) {
  const { rows: [row] } = await query<Row>(`UPDATE curialy.queued_followups SET state = 'waiting', error = NULL, updated_at = now() WHERE id = $2 AND session_id = $1 AND state = 'failed' RETURNING ${COLUMNS}`, [taskId, itemId]);
  return row ? view(row) : null;
}

type QueueTask = { id: string; status: TaskStatus; statusReason?: StatusReason; runId?: string; cancelRequested?: boolean };

/** Why the queue waits for the user after the task's latest run (null: it starts its next message by itself). */
async function holdReason(task: QueueTask) {
  if (!isFinalStatus(task.status)) return null;
  if (task.status === "cancelled") return task.statusReason === "credits" ? "The run stopped when the credits ran out, so the queue waits for you." : "The run was stopped, so the queue waits for you.";
  if (task.status === "interrupted") return "The run was interrupted, so the queue waits for you.";
  // A stop that arrived as the run was finishing still counts (the run ended anyway).
  if (task.cancelRequested) return "The run was stopped, so the queue waits for you.";
  if (task.status === "completed" || !task.runId) return null;
  const { rows } = await query("SELECT 1 FROM curialy.queued_followups WHERE run_id = $1 LIMIT 1", [task.runId]);
  return rows.length ? "The last queued message failed, so the rest wait for you." : null;
}

/** A queue row's state write, tried again on a passing database error (it records what already happened). */
async function writeState(text: string, values: unknown[]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await query(text, values);
    } catch (error) {
      if (attempt >= 3 || !passing(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
}

/** Whether a message's run has started: its user message (with the client id) is in the task's log. */
async function announced(row: Row) {
  const { rows } = await query("SELECT 1 FROM curialy.agent_execution_logs WHERE session_id = $1 AND type = 'user_message' AND data->>'clientMessageId' = $2 LIMIT 1", [row.session_id, row.client_message_id]);
  return rows.length > 0;
}

export type DrainResult =
  | { kind: "idle" | "running" | "busy" }
  | { kind: "held"; reason: string }
  | { kind: "refused"; refusal: AdmissionRefusal }
  | { kind: "deferred"; error: string }
  | { kind: "started"; runId: string; itemId: string };

const draining = new Set<string>();

/**
 * Start the task's next waiting message if its run has ended. force: the user asked for it, so a
 * held queue starts too. Admission (credits, one run at a time for free accounts) is checked now,
 * not when the message was queued; a refused start keeps the message waiting, with the reason.
 */
export async function drainQueue(taskId: string, opts: { force?: boolean } = {}): Promise<DrainResult> {
  if (isDraining()) return { kind: "idle" };
  if (draining.has(taskId)) return { kind: "busy" };
  draining.add(taskId);
  try {
    // A message that fails for good doesn't hold the ones behind it: the loop moves on to the next.
    for (let attempt = 0; attempt <= MAX_QUEUED_MESSAGES; attempt++) {
      if (isRunning(taskId)) return { kind: "running" };
      const task = await getAgentTask(taskId);
      if (!task) return { kind: "idle" };
      if (!isFinalStatus(task.status)) return { kind: "running" };
      const { rows: [next] } = await query<Row>(`SELECT ${COLUMNS} FROM curialy.queued_followups WHERE session_id = $1 AND state IN ('waiting', 'starting') ORDER BY created_at, id LIMIT 1`, [taskId]);
      if (!next) return { kind: "idle" };
      // An earlier message is being started (or its start was cut short): the later ones keep their
      // turn. Its run did start if its user message is in the log (only the record of it was lost).
      if (next.state === "starting") {
        if (!(await announced(next))) return { kind: "busy" };
        await writeState(`UPDATE curialy.queued_followups q SET state = 'started', updated_at = now(), run_id = ${RUN_FROM_LOG} WHERE q.id = $1 AND q.state = 'starting'`, [next.id]);
        continue;
      }
      if (!opts.force) {
        const held = await holdReason(task);
        if (held) return { kind: "held", reason: held };
      }
      const { rows: [owner] } = await query<{ role: string }>("SELECT role FROM curialy.users WHERE id = $1", [next.user_id]);
      const result = await oneAtATime(next.user_id, async (): Promise<DrainResult | "next"> => {
        const refusal = await admissionRefusal({ id: next.user_id, role: owner?.role ?? "user" });
        if (refusal) {
          await query("UPDATE curialy.queued_followups SET error = $2, updated_at = now() WHERE id = $1 AND state = 'waiting'", [next.id, refusal.error]);
          return { kind: "refused", refusal };
        }
        // Claimed with what it says now: an edit that landed meanwhile is what starts.
        const { rows: [claimed] } = await query<Row>(`UPDATE curialy.queued_followups SET state = 'starting', error = NULL, updated_at = now() WHERE id = $1 AND state = 'waiting' RETURNING ${COLUMNS}`, [next.id]);
        if (!claimed) return "next";
        let started: { runId: string };
        try {
          started = await followUp(taskId, claimed.prompt, claimed.attachments ?? [], { clientMessageId: claimed.client_message_id, expectedRunId: task.runId ?? null, model: claimed.model, repo: claimed.repo });
        } catch (error) {
          const text = brandText(error instanceof Error ? error.message : String(error)).slice(0, 500);
          // Refused only for now (the task or the server is busy, another start won, a restart), or a
          // passing storage or database error before anything was claimed: it waits for the next
          // chance. Anything else (a model or repository it can't use, a run that failed to start,
          // files that can't be restored) stops here, for the user to fix and try again.
          const after = await getAgentTask(taskId).catch(() => undefined);
          const claimedRun = Boolean(after && after.runId !== task.runId);
          const transient = error instanceof TaskBusy || (!claimedRun && passing(error));
          await writeState("UPDATE curialy.queued_followups SET state = $2, error = $3, updated_at = now() WHERE id = $1", [claimed.id, transient ? "waiting" : "failed", text]);
          return transient ? { kind: "deferred", error: text } : "next";
        }
        // The run has started whatever happens to this write (a claim left 'starting' is settled by
        // releaseStaleClaims, which finds the run's user message).
        await writeState("UPDATE curialy.queued_followups SET state = 'started', run_id = $2, updated_at = now() WHERE id = $1", [claimed.id, started.runId])
          .catch(error => console.error(`[queue] ${taskId}: could not record the start of ${claimed.id}:`, error instanceof Error ? error.message : error));
        return { kind: "started", runId: started.runId, itemId: claimed.id };
      });
      if (result !== "next") return result;
    }
    return { kind: "idle" };
  } finally {
    draining.delete(taskId);
  }
}

/**
 * An error the next attempt can get past: the database connection lost, a serialization failure or
 * deadlock, the database out of resources or restarting (SQLSTATE 08, 40001, 40P01, 53, 57P), a
 * network error, or storage that is unavailable for now. A constraint or data error never is.
 */
const passing = (error: unknown): boolean => {
  if (error instanceof StorageError) return Boolean(error.unavailable);
  // The pg driver and pool report a dropped connection or a pool timeout without a code.
  if (error instanceof Error && /^(Connection terminated|timeout exceeded when trying to connect)/.test(error.message)) return true;
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: unknown };
  if (typeof code !== "string") return cause !== undefined && cause !== error ? passing(cause) : false;
  return /^(08|53|57P|40001$|40P01$)/.test(code) || /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ESOCKETTIMEDOUT)$/.test(code);
};

/** A message's run, from the log: the run_start just before its user message (announce emits both). */
const RUN_FROM_LOG = `COALESCE(q.run_id, (SELECT (s.data->>'runId')::uuid FROM curialy.agent_execution_logs u
  JOIN curialy.agent_execution_logs s ON s.session_id = u.session_id AND s.type = 'run_start' AND s.seq < u.seq
  WHERE u.session_id = q.session_id AND u.type = 'user_message' AND u.data->>'clientMessageId' = q.client_message_id
  ORDER BY s.seq DESC LIMIT 1))`;

/** Claims left by a process that stopped mid-start go back in line, unless their run did start. */
async function releaseStaleClaims() {
  await query(
    `UPDATE curialy.queued_followups q SET state = 'waiting', updated_at = now()
     WHERE q.state = 'starting' AND q.updated_at < now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM curialy.agent_execution_logs l WHERE l.session_id = q.session_id AND l.type = 'user_message' AND l.data->>'clientMessageId' = q.client_message_id)`,
  );
  await query(
    `UPDATE curialy.queued_followups q SET state = 'started', updated_at = now(), run_id = ${RUN_FROM_LOG}
     WHERE q.state = 'starting' AND q.updated_at < now() - interval '10 minutes'`,
  );
}

async function sweep() {
  if (isDraining()) return;
  await releaseStaleClaims();
  // The queues that can start by themselves (holdReason in SQL), the ones touched longest ago first:
  // a refusal or deferral touches the session's next message, so queues refused again and again
  // (credits) go to the back instead of crowding out the others.
  const { rows } = await query<{ session_id: string }>(
    `SELECT q.session_id FROM curialy.queued_followups q JOIN curialy.chat_sessions s ON s.id = q.session_id
     WHERE q.state = 'waiting' AND s.cancel_requested_at IS NULL
       AND (s.status = 'completed' OR (s.status = 'failed' AND NOT EXISTS (SELECT 1 FROM curialy.queued_followups r WHERE r.run_id = s.run_id)))
     GROUP BY q.session_id ORDER BY max(q.updated_at) LIMIT 50`,
  );
  for (const row of rows) await drainQueue(row.session_id).catch(error => console.error(`[queue] ${row.session_id}:`, error instanceof Error ? error.message : error));
}

let started = false;
const SWEEP_MS = 30_000;

/** Start queued messages when runs end, and sweep for the rest. */
export function startFollowUpQueue() {
  if (started) return;
  started = true;
  onRunSettled(taskId => void drainQueue(taskId).catch(error => console.error(`[queue] ${taskId}:`, error instanceof Error ? error.message : error)));
  const timer = setInterval(() => void sweep().catch(error => console.error("[queue] sweep:", error instanceof Error ? error.message : error)), SWEEP_MS);
  timer.unref();
}
