import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, AgentEventBody, AgentTaskSummary, PhaseId, TaskMode, TaskStatus, ThinkingLevel } from "@shared/agent";
import { db } from "../curialy-store";

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    effort TEXT NOT NULL,
    web_search INTEGER NOT NULL DEFAULT 0,
    phase TEXT,
    answer TEXT,
    error TEXT,
    usage_json TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"thinkingTokens":0}',
    files_changed INTEGER NOT NULL DEFAULT 0,
    conversation_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_events (
    task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, seq)
  );
`);

type TaskRow = {
  id: string; prompt: string; status: TaskStatus; mode: TaskMode; model: string; effort: ThinkingLevel;
  web_search: number; phase: PhaseId | null; answer: string | null; error: string | null; usage_json: string;
  files_changed: number; conversation_json: string; created_at: string; updated_at: string;
};

function fromRow(row: TaskRow): AgentTaskSummary {
  return {
    id: row.id, prompt: row.prompt, status: row.status, mode: row.mode, model: row.model, effort: row.effort,
    webSearch: Boolean(row.web_search), phase: row.phase, answer: row.answer ?? undefined, error: row.error ?? undefined,
    usage: JSON.parse(row.usage_json), filesChanged: row.files_changed, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createAgentTask(task: { id: string; prompt: string; mode: TaskMode; model: string; effort: ThinkingLevel; webSearch: boolean }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_tasks (id, prompt, status, mode, model, effort, web_search, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)`).run(task.id, task.prompt, task.mode, task.model, task.effort, task.webSearch ? 1 : 0, now, now);
}

export function updateAgentTask(id: string, patch: Partial<{ status: TaskStatus; phase: PhaseId | null; model: string; answer: string; error: string | null; usage: AgentTaskSummary["usage"]; filesChanged: number; conversation: Anthropic.MessageParam[] }>) {
  const columns: Record<string, unknown> = {};
  if (patch.status !== undefined) columns.status = patch.status;
  if (patch.phase !== undefined) columns.phase = patch.phase;
  if (patch.model !== undefined) columns.model = patch.model;
  if (patch.answer !== undefined) columns.answer = patch.answer;
  if (patch.error !== undefined) columns.error = patch.error;
  if (patch.usage !== undefined) columns.usage_json = JSON.stringify(patch.usage);
  if (patch.filesChanged !== undefined) columns.files_changed = patch.filesChanged;
  if (patch.conversation !== undefined) columns.conversation_json = JSON.stringify(patch.conversation);
  columns.updated_at = new Date().toISOString();
  const sets = Object.keys(columns).map(key => `${key} = @${key}`).join(", ");
  db.prepare(`UPDATE agent_tasks SET ${sets} WHERE id = @id`).run({ ...columns, id });
}

export function getAgentTask(id: string) {
  const row = db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function getConversation(id: string): Anthropic.MessageParam[] {
  const row = db.prepare("SELECT conversation_json FROM agent_tasks WHERE id = ?").get(id) as { conversation_json: string } | undefined;
  return row ? JSON.parse(row.conversation_json) : [];
}

export function listAgentTasks(limit = 200) {
  return (db.prepare("SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT ?").all(limit) as TaskRow[]).map(fromRow);
}

export function deleteAgentTask(id: string) {
  return db.prepare("DELETE FROM agent_tasks WHERE id = ?").run(id).changes > 0;
}

/** Tasks left "running" by a crash or restart can never finish; mark them failed on boot. */
export function failOrphanedTasks() {
  return db.prepare(`UPDATE agent_tasks SET status = 'failed', error = 'Interrupted by a server restart.', updated_at = ?
    WHERE status IN ('queued', 'running')`).run(new Date().toISOString()).changes;
}

const insertEvent = db.prepare("INSERT INTO agent_events (task_id, seq, type, data_json, created_at) VALUES (?, ?, ?, ?, ?)");

export function appendEvent(taskId: string, seq: number, body: AgentEventBody, ts: string) {
  insertEvent.run(taskId, seq, body.type, JSON.stringify(body), ts);
}

export function lastSeq(taskId: string) {
  const row = db.prepare("SELECT MAX(seq) AS seq FROM agent_events WHERE task_id = ?").get(taskId) as { seq: number | null };
  return row.seq ?? 0;
}

export function listEventsAfter(taskId: string, afterSeq: number): AgentEvent[] {
  const rows = db.prepare("SELECT seq, data_json, created_at FROM agent_events WHERE task_id = ? AND seq > ? ORDER BY seq").all(taskId, afterSeq) as { seq: number; data_json: string; created_at: string }[];
  return rows.map(row => ({ ...(JSON.parse(row.data_json) as AgentEventBody), seq: row.seq, ts: row.created_at }));
}

export function agentStats() {
  const row = db.prepare(`SELECT COUNT(*) AS total,
      SUM(status = 'completed') AS completed, SUM(status = 'failed') AS failed, SUM(status = 'running') AS running,
      SUM(files_changed) AS files FROM agent_tasks`).get() as Record<string, number | null>;
  return { total: row.total ?? 0, completed: row.completed ?? 0, failed: row.failed ?? 0, running: row.running ?? 0, filesChanged: row.files ?? 0 };
}
