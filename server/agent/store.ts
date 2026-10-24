import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, AgentEventBody, AgentTaskSummary, PhaseId, TaskMode, TaskStatus, ThinkingLevel } from "@shared/agent";
import { adminUserId, db, query } from "../db/pg";

// Conversation history is stored in the wire format of the provider that produced it.
export type ConversationFormat = "anthropic" | "openai";
export type StoredConversation = Anthropic.MessageParam[] | Record<string, unknown>[];

type SessionRow = {
  id: string; prompt: string; status: TaskStatus; mode: TaskMode; model: string; effort: ThinkingLevel; web_search: boolean;
  phase: PhaseId | null; answer: string | null; error: string | null; usage: AgentTaskSummary["usage"]; files_changed: number;
  workspace_state: string; created_at: Date; updated_at: Date;
};

const SUMMARY_COLUMNS = "id, prompt, status, mode, model, effort, web_search, phase, answer, error, usage, files_changed, workspace_state, created_at, updated_at";

function fromRow(row: SessionRow): AgentTaskSummary & { workspaceState: string } {
  return {
    id: row.id, prompt: row.prompt, status: row.status, mode: row.mode, model: row.model, effort: row.effort,
    webSearch: row.web_search, phase: row.phase, answer: row.answer ?? undefined, error: row.error ?? undefined,
    usage: row.usage, filesChanged: row.files_changed, workspaceState: row.workspace_state,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

export async function createAgentTask(task: { id: string; prompt: string; mode: TaskMode; model: string; effort: ThinkingLevel; webSearch: boolean; format: ConversationFormat }) {
  const userId = await adminUserId();
  await query(
    `INSERT INTO curialy.chat_sessions (id, user_id, prompt, status, mode, model, effort, web_search, conversation_format)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8)`,
    [task.id, userId, task.prompt, task.mode, task.model, task.effort, task.webSearch, task.format],
  );
}

export type TaskPatch = Partial<{
  status: TaskStatus; phase: PhaseId | null; model: string; answer: string; error: string | null;
  usage: AgentTaskSummary["usage"]; filesChanged: number; conversation: StoredConversation; workspaceState: string;
}>;

const COLUMN_FOR: Record<keyof TaskPatch, string> = {
  status: "status", phase: "phase", model: "model", answer: "answer", error: "error", usage: "usage",
  filesChanged: "files_changed", conversation: "conversation", workspaceState: "workspace_state",
};

// Updates for one task are chained so they land in the order they were issued even though
// each is a network round-trip to Tiger.
const updateChains = new Map<string, Promise<unknown>>();

export function updateAgentTask(id: string, patch: TaskPatch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof TaskPatch, unknown][];
  if (!entries.length) return Promise.resolve();
  const sets = entries.map(([key], index) => `${COLUMN_FOR[key]} = $${index + 2}`);
  const values = entries.map(([key, value]) => (key === "usage" || key === "conversation" ? JSON.stringify(value) : value));
  const run = () => query(`UPDATE curialy.chat_sessions SET ${sets.join(", ")}, updated_at = now(), last_activity_at = now() WHERE id = $1`, [id, ...values]);
  const previous = updateChains.get(id) ?? Promise.resolve();
  const next = previous.then(run, run).catch(error => console.error(`[store] update ${id} failed:`, error.message));
  updateChains.set(id, next);
  void next.finally(() => { if (updateChains.get(id) === next) updateChains.delete(id); });
  return next;
}

export async function settleTaskWrites(id: string) {
  await updateChains.get(id);
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

export async function listAgentTasks(limit = 200) {
  const { rows } = await query<SessionRow>(`SELECT ${SUMMARY_COLUMNS} FROM curialy.chat_sessions ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(fromRow);
}

export async function deleteAgentTask(id: string) {
  const { rowCount } = await query("DELETE FROM curialy.chat_sessions WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

/** Sessions left running by a crash or restart can never finish; mark them failed on boot. */
export async function failOrphanedTasks() {
  const { rowCount } = await query(
    `UPDATE curialy.chat_sessions SET status = 'failed', error = 'Interrupted by a server restart.', updated_at = now()
     WHERE status IN ('queued', 'running')`,
  );
  return rowCount ?? 0;
}

/** Visible chat log (user prompts and final assistant answers), separate from the raw execution log. */
export async function addMessage(sessionId: string, role: "user" | "assistant", content: string, model?: string) {
  await query("INSERT INTO curialy.messages (session_id, role, content, model) VALUES ($1, $2, $3, $4)", [sessionId, role, content, model ?? null]);
}

export async function insertEvents(taskId: string, events: AgentEvent[]) {
  if (!events.length) return;
  const values: unknown[] = [];
  const tuples = events.map((event, index) => {
    const { seq, ts, ...body } = event;
    values.push(taskId, seq, body.type, JSON.stringify(body), ts);
    const base = index * 5;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  await query(`INSERT INTO curialy.agent_execution_logs (session_id, seq, type, data, created_at) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`, values);
}

export async function lastSeq(taskId: string) {
  const { rows } = await query<{ seq: number | null }>("SELECT MAX(seq) AS seq FROM curialy.agent_execution_logs WHERE session_id = $1", [taskId]);
  return rows[0]?.seq ?? 0;
}

export async function listEventsAfter(taskId: string, afterSeq: number): Promise<AgentEvent[]> {
  const { rows } = await query<{ seq: number; data: AgentEventBody; created_at: Date }>(
    "SELECT seq, data, created_at FROM curialy.agent_execution_logs WHERE session_id = $1 AND seq > $2 ORDER BY seq", [taskId, afterSeq],
  );
  return rows.map(row => ({ ...row.data, seq: row.seq, ts: row.created_at.toISOString() }));
}

export async function agentStats() {
  const { rows } = await query<Record<string, string | null>>(`SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed, COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'running') AS running, COALESCE(SUM(files_changed), 0) AS files FROM curialy.chat_sessions`);
  const row = rows[0];
  return { total: Number(row.total), completed: Number(row.completed), failed: Number(row.failed), running: Number(row.running), filesChanged: Number(row.files) };
}

// ---- Workspace snapshots: the durable copy of an agent's files (the VPS copy is scratch) ----

export async function saveWorkspaceSnapshot(sessionId: string, files: { path: string; content: Buffer; sha256: string }[]) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM curialy.workspace_files WHERE session_id = $1", [sessionId]);
    for (let index = 0; index < files.length; index += 50) {
      const chunk = files.slice(index, index + 50);
      const values: unknown[] = [];
      const tuples = chunk.map((file, i) => {
        values.push(sessionId, file.path, file.content, file.content.length, file.sha256);
        const base = i * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });
      await client.query(`INSERT INTO curialy.workspace_files (session_id, path, content, size_bytes, sha256) VALUES ${tuples.join(", ")}`, values);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadWorkspaceSnapshot(sessionId: string) {
  const { rows } = await query<{ path: string; content: Buffer }>("SELECT path, content FROM curialy.workspace_files WHERE session_id = $1", [sessionId]);
  return rows;
}

export async function listWorkspaceSnapshot(sessionId: string) {
  const { rows } = await query<{ path: string; size_bytes: number }>("SELECT path, size_bytes FROM curialy.workspace_files WHERE session_id = $1 ORDER BY path", [sessionId]);
  return rows;
}

export async function readSnapshotFile(sessionId: string, path: string) {
  const { rows } = await query<{ content: Buffer }>("SELECT content FROM curialy.workspace_files WHERE session_id = $1 AND path = $2", [sessionId, path]);
  return rows[0]?.content;
}

/** Sessions whose scratch workspace has been idle long enough to be archived and removed. */
export async function idleWorkspaces(idleMinutes: number) {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM curialy.chat_sessions WHERE workspace_state = 'live' AND status NOT IN ('queued', 'running')
     AND last_activity_at < now() - ($1 || ' minutes')::interval`, [String(idleMinutes)],
  );
  return rows.map(row => row.id);
}
