import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, AgentEventBody, AgentTaskSummary, PhaseId, RunOutcome, StatusReason, TaskMode, TaskStatus, ThinkingLevel } from "@shared/agent";
import { ACTIVE_STATUSES, LEGACY_RESTART_ERROR } from "@shared/taskStatus";
import { adminUserId, db, query } from "../db/pg";
import { cleanText, toJsonb } from "../db/json";
import { LEASE_SECONDS, WORKER_ID } from "./lifecycle";

// Conversation history is stored in the wire format of the provider that produced it.
export type ConversationFormat = "anthropic" | "openai";
export type StoredConversation = Anthropic.MessageParam[] | Record<string, unknown>[];

type SessionRow = {
  id: string; prompt: string; status: TaskStatus; mode: TaskMode; model: string; effort: ThinkingLevel; web_search: boolean;
  phase: PhaseId | null; answer: string | null; error: string | null; usage: AgentTaskSummary["usage"]; files_changed: number;
  workspace_state: string; github_repo: string | null; github_repo_url: string | null; github_pushed_at: Date | null;
  github_mode: "export" | "linked" | null; github_branch: string | null; team: boolean; created_at: Date; updated_at: Date;
  status_reason: StatusReason | null; status_changed_at: Date | null; started_at: Date | null; finished_at: Date | null;
  run_id: string | null; attempt: number; cancel_requested_at: Date | null; outcome: RunOutcome | null;
};

const SUMMARY_COLUMNS = "id, prompt, status, mode, model, effort, web_search, phase, answer, error, usage, files_changed, workspace_state, github_repo, github_repo_url, github_pushed_at, github_mode, github_branch, team, created_at, updated_at, status_reason, status_changed_at, started_at, finished_at, run_id, attempt, cancel_requested_at, outcome";

function fromRow(row: SessionRow): AgentTaskSummary & { workspaceState: string } {
  // Rows recovered by the pre-lease code were marked failed with this text; they were interrupted.
  const legacyRestart = row.status === "failed" && row.error === LEGACY_RESTART_ERROR;
  return {
    id: row.id, prompt: row.prompt, status: legacyRestart ? "interrupted" : row.status, mode: row.mode, model: row.model, effort: row.effort,
    webSearch: row.web_search, phase: row.phase, answer: row.answer ?? undefined, error: legacyRestart ? undefined : row.error ?? undefined,
    usage: row.usage, filesChanged: row.files_changed, workspaceState: row.workspace_state,
    githubRepo: row.github_repo ?? undefined, githubRepoUrl: row.github_repo_url ?? undefined, githubPushedAt: row.github_pushed_at?.toISOString(),
    githubMode: row.github_mode ?? undefined, githubBranch: row.github_branch ?? undefined, team: row.team,
    statusReason: (legacyRestart ? "server_restart" : row.status_reason) ?? undefined,
    statusChangedAt: row.status_changed_at?.toISOString(), startedAt: row.started_at?.toISOString(), finishedAt: row.finished_at?.toISOString(),
    runId: row.run_id ?? undefined, attempt: row.attempt, cancelRequested: Boolean(row.cancel_requested_at), outcome: row.outcome ?? undefined,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

/** Insert a new task already claimed by this worker for its first run (so a crash before it starts is recoverable). */
export async function createAgentTask(task: { id: string; runId: string; prompt: string; mode: TaskMode; model: string; effort: ThinkingLevel; webSearch: boolean; format: ConversationFormat; team?: boolean }) {
  const userId = await adminUserId();
  await query(
    `INSERT INTO curialy.chat_sessions (id, user_id, prompt, status, mode, model, effort, web_search, conversation_format, team,
       run_id, attempt, worker_id, lease_expires_at, status_reason, status_changed_at)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9, $10, 1, $11, now() + interval '${LEASE_SECONDS} seconds', 'prompt', now())`,
    [task.id, userId, cleanText(task.prompt), task.mode, task.model, task.effort, task.webSearch, task.format, Boolean(task.team), task.runId, WORKER_ID],
  );
}

export async function getTeamState<T>(id: string): Promise<T | null> {
  const { rows } = await query<{ team_state: T | null }>("SELECT team_state FROM curialy.chat_sessions WHERE id = $1", [id]);
  return rows[0]?.team_state ?? null;
}

const teamChains = new Map<string, Promise<unknown>>();
/** Ordered, fire-and-forget persistence of the team's state (each agent's history, plan, reviews), fenced to the run. */
export function saveTeamState(id: string, state: unknown, runId?: string) {
  const json = toJsonb(state);
  const run = () => runId
    ? query("UPDATE curialy.chat_sessions SET team_state = $2, updated_at = now(), last_activity_at = now() WHERE id = $1 AND run_id = $3", [id, json, runId])
    : query("UPDATE curialy.chat_sessions SET team_state = $2, updated_at = now(), last_activity_at = now() WHERE id = $1", [id, json]);
  const next = (teamChains.get(id) ?? Promise.resolve()).then(run, run).catch(error => console.error(`[store] team state ${id}:`, error.message));
  teamChains.set(id, next);
  return next;
}

export async function settleTeamWrites(id: string) {
  await teamChains.get(id);
}

/** Bulk task data written during a run. Status never goes through here: see lifecycle.transitionTask. */
export type TaskPatch = Partial<{
  phase: PhaseId | null; model: string; usage: AgentTaskSummary["usage"]; filesChanged: number;
  conversation: StoredConversation; workspaceState: string;
}>;

const COLUMN_FOR: Record<keyof TaskPatch, string> = {
  phase: "phase", model: "model", usage: "usage", filesChanged: "files_changed", conversation: "conversation", workspaceState: "workspace_state",
};

// Writes for one task are chained so they land in the order they were issued even though each is a
// network round-trip to Tiger. A patch issued while an earlier one is still waiting its turn is
// merged into it (later values win), and values are serialized only when the write runs, so a slow
// database never holds one full copy of the conversation per pending write.
type QueuedWrite = { patch: TaskPatch; fence?: string; started: boolean; promise: Promise<void> };
const writeState = new Map<string, { tail: Promise<void>; queued: QueuedWrite | null }>();

async function runUpdate(id: string, patch: TaskPatch, fence?: string) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof TaskPatch, unknown][];
  if (!entries.length) return;
  const sets = entries.map(([key], index) => `${COLUMN_FOR[key]} = $${index + 2}`);
  const values: unknown[] = entries.map(([key, value]) => (key === "usage" || key === "conversation" ? toJsonb(value) : value));
  // Fenced writes also require the run to be active: a run that outlived its interruption or
  // cancellation cannot overwrite the conversation afterwards.
  const fenceClause = fence ? ` AND run_id = $${values.length + 2} AND status IN ('queued', 'running', 'cancelling')` : "";
  await query(`UPDATE curialy.chat_sessions SET ${sets.join(", ")}, updated_at = now(), last_activity_at = now() WHERE id = $1${fenceClause}`, [id, ...values, ...(fence ? [fence] : [])]);
}

/**
 * Queue a write of run data. `fence` (the run id) makes the write a no-op once another run owns the
 * task, so a run that outlived its cancellation cannot overwrite its successor's conversation.
 */
export function updateAgentTask(id: string, patch: TaskPatch, fence?: string): Promise<void> {
  let state = writeState.get(id);
  if (!state) {
    state = { tail: Promise.resolve(), queued: null };
    writeState.set(id, state);
  }
  const queued = state.queued;
  if (queued && !queued.started && queued.fence === fence) {
    Object.assign(queued.patch, patch);
    return queued.promise;
  }
  const current = state;
  const entry: QueuedWrite = { patch: { ...patch }, fence, started: false, promise: Promise.resolve() };
  entry.promise = current.tail.then(async () => {
    entry.started = true;
    if (current.queued === entry) current.queued = null;
    await runUpdate(id, entry.patch, entry.fence);
  }).catch(error => console.error(`[store] update ${id} failed:`, error instanceof Error ? error.message : error));
  current.queued = entry;
  current.tail = entry.promise;
  void entry.promise.finally(() => { if (writeState.get(id) === current && current.tail === entry.promise) writeState.delete(id); });
  return entry.promise;
}

export async function settleTaskWrites(id: string) {
  await writeState.get(id)?.tail;
}

export async function getAgentTask(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const { rows } = await query<SessionRow>(`SELECT ${SUMMARY_COLUMNS} FROM curialy.chat_sessions WHERE id = $1`, [id]);
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function getConversation(id: string): Promise<{ format: ConversationFormat; messages: StoredConversation }> {
  const { rows } = await query<{ conversation: StoredConversation; conversation_format: ConversationFormat }>(
    "SELECT conversation, conversation_format FROM curialy.chat_sessions WHERE id = $1", [id],
  );
  return rows[0] ? { format: rows[0].conversation_format, messages: rows[0].conversation } : { format: "anthropic", messages: [] };
}

/** Task list rows: everything but the full answer text (lists poll; the answer is on the task page). */
export async function listAgentTasks(limit = 200) {
  const { rows } = await query<SessionRow>(`SELECT ${SUMMARY_COLUMNS.replace("answer, ", "NULL::text AS answer, ")} FROM curialy.chat_sessions ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(fromRow);
}

export async function deleteAgentTask(id: string) {
  const { rowCount } = await query("DELETE FROM curialy.chat_sessions WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

/** Visible chat log (user prompts and final assistant answers), separate from the raw execution log. */
export async function addMessage(sessionId: string, role: "user" | "assistant", content: string, model?: string) {
  await query("INSERT INTO curialy.messages (session_id, role, content, model) VALUES ($1, $2, $3, $4)", [sessionId, role, cleanText(content), model ?? null]);
}

/**
 * Insert committed events; returns how many rows were new (a retry of a batch that landed inserts 0).
 * With `runId`, the batch is only written while that run still owns the task and is active, so a
 * worker that lost its run cannot interleave events into its successor's log, nor append any after
 * the done event recovery wrote for it (recovery keeps the run id).
 */
export async function insertEvents(taskId: string, events: AgentEvent[], runId?: string) {
  if (!events.length) return 0;
  const values: unknown[] = [];
  const tuples = events.map((event, index) => {
    const { seq, ts, ...body } = event;
    values.push(taskId, seq, body.type, toJsonb(body), ts);
    const base = index * 5;
    return `($${base + 1}::uuid, $${base + 2}::int, $${base + 3}::text, $${base + 4}::jsonb, $${base + 5}::timestamptz)`;
  });
  if (!runId) {
    const { rowCount } = await query(`INSERT INTO curialy.agent_execution_logs (session_id, seq, type, data, created_at) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`, values);
    return rowCount ?? 0;
  }
  values.push(runId);
  const { rowCount } = await query(
    `INSERT INTO curialy.agent_execution_logs (session_id, seq, type, data, created_at)
     SELECT v.* FROM (VALUES ${tuples.join(", ")}) AS v(session_id, seq, type, data, created_at)
     WHERE EXISTS (SELECT 1 FROM curialy.chat_sessions WHERE id = v.session_id AND run_id = $${values.length}::uuid AND status IN ('queued', 'running', 'cancelling'))
     ON CONFLICT DO NOTHING`, values,
  );
  return rowCount ?? 0;
}

export async function lastSeq(taskId: string) {
  const { rows } = await query<{ seq: number | null }>("SELECT MAX(seq) AS seq FROM curialy.agent_execution_logs WHERE session_id = $1", [taskId]);
  return rows[0]?.seq ?? 0;
}

/** Persisted events with afterSeq < seq < beforeSeq, in order. */
export async function listEventsAfter(taskId: string, afterSeq: number, beforeSeq = 2_147_483_647): Promise<AgentEvent[]> {
  const { rows } = await query<{ seq: number; data: AgentEventBody; created_at: Date }>(
    "SELECT seq, data, created_at FROM curialy.agent_execution_logs WHERE session_id = $1 AND seq > $2 AND seq < $3 ORDER BY seq", [taskId, afterSeq, beforeSeq],
  );
  // Older logs stored the live browser's vendor view address (with an access token): never replay it.
  return rows.map(row => {
    const data = row.data.type === "browser_session" ? { ...row.data, liveUrl: null, replayUrl: "" } : row.data;
    return { ...data, seq: row.seq, ts: row.created_at.toISOString() } as AgentEvent;
  });
}

export async function agentStats() {
  // Legacy restart rows (failed + the old restart text) count as interrupted, not as failures.
  const { rows } = await query<Record<string, string | null>>(`SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'completed' AND (outcome->>'verification' = 'failed'
        OR (outcome ? 'review' AND outcome->'review'->>'verdict' <> 'approve')
        OR outcome->>'publish' IN ('failed', 'blocked_unapproved') OR outcome->>'research' IN ('partial', 'failed'))) AS completed_with_issues,
      COUNT(*) FILTER (WHERE status = 'failed' AND error IS DISTINCT FROM $1) AS failed,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      COUNT(*) FILTER (WHERE status = 'interrupted' OR (status = 'failed' AND error = $1)) AS interrupted,
      COUNT(*) FILTER (WHERE status = ANY($2::text[])) AS running, COALESCE(SUM(files_changed), 0) AS files FROM curialy.chat_sessions`, [LEGACY_RESTART_ERROR, ACTIVE_STATUSES]);
  const row = rows[0];
  return {
    total: Number(row.total), completed: Number(row.completed), completedWithIssues: Number(row.completed_with_issues ?? 0), failed: Number(row.failed), cancelled: Number(row.cancelled),
    interrupted: Number(row.interrupted), running: Number(row.running), filesChanged: Number(row.files),
  };
}

// ---- Workspace snapshots: the durable copy of an agent's files (the VPS copy is scratch) ----

/** artifact: a file attached to the chat while file storage was down; kept until the task is deleted. */
export type SnapshotRole = "source" | "build" | "artifact";

export async function saveWorkspaceSnapshot(sessionId: string, files: { path: string; content: Buffer; sha256: string; role?: SnapshotRole }[]) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    // Artifacts kept here during a storage outage are not part of the workspace copy: never dropped.
    await client.query("DELETE FROM curialy.workspace_files WHERE session_id = $1 AND role <> 'artifact'", [sessionId]);
    for (let index = 0; index < files.length; index += 50) {
      const chunk = files.slice(index, index + 50);
      const values: unknown[] = [];
      const tuples = chunk.map((file, i) => {
        values.push(sessionId, file.path, file.content, file.content.length, file.sha256, file.role ?? "source");
        const base = i * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      });
      await client.query(`INSERT INTO curialy.workspace_files (session_id, path, content, size_bytes, sha256, role) VALUES ${tuples.join(", ")}
        ON CONFLICT (session_id, path) DO UPDATE SET content = EXCLUDED.content, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256, role = EXCLUDED.role, updated_at = now()`, values);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Keep chat attachments that could not go to file storage: the durable copy behind their
 * "kept in the workspace" links once the workspace is archived (a source copy already counts).
 */
export async function saveArtifactSnapshot(sessionId: string, files: { path: string; content: Buffer; sha256: string }[]) {
  for (const file of files) {
    await query(
      `INSERT INTO curialy.workspace_files (session_id, path, content, size_bytes, sha256, role) VALUES ($1, $2, $3, $4, $5, 'artifact')
       ON CONFLICT (session_id, path) DO UPDATE SET content = EXCLUDED.content, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256, updated_at = now()
       WHERE curialy.workspace_files.role = 'artifact'`,
      [sessionId, file.path, file.content, file.content.length, file.sha256],
    );
  }
}

/** Snapshot files: sources by default (export, deploy); a restore also asks for the archived build. */
export async function loadWorkspaceSnapshot(sessionId: string, roles: SnapshotRole[] = ["source"]) {
  const { rows } = await query<{ path: string; content: Buffer; role: SnapshotRole }>("SELECT path, content, role FROM curialy.workspace_files WHERE session_id = $1 AND role = ANY($2::text[])", [sessionId, roles]);
  return rows;
}

export async function listWorkspaceSnapshot(sessionId: string) {
  const { rows } = await query<{ path: string; size_bytes: number; role: SnapshotRole }>("SELECT path, size_bytes, role FROM curialy.workspace_files WHERE session_id = $1 ORDER BY path", [sessionId]);
  return rows;
}

export async function readSnapshotFile(sessionId: string, path: string) {
  const { rows } = await query<{ content: Buffer }>("SELECT content FROM curialy.workspace_files WHERE session_id = $1 AND path = $2", [sessionId, path]);
  return rows[0]?.content;
}

/** Sessions whose scratch workspace has been idle long enough to be archived and removed. */
export async function idleWorkspaces(idleMinutes: number) {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM curialy.chat_sessions WHERE workspace_state = 'live' AND NOT (status = ANY($2::text[]))
     AND last_activity_at < now() - ($1 || ' minutes')::interval`, [String(idleMinutes), ACTIVE_STATUSES],
  );
  return rows.map(row => row.id);
}
