import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.CURIALY_DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.CURIALY_DB_PATH || path.join(dataDir, "curialy.db");

const globalStore = globalThis as typeof globalThis & { __curialyDb?: Database.Database };
const db = globalStore.__curialyDb ?? new Database(dbPath);
if (process.env.NODE_ENV !== "production") globalStore.__curialyDb = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS curialy_tasks (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    think INTEGER NOT NULL DEFAULT 0,
    web_search INTEGER NOT NULL DEFAULT 0,
    answer TEXT,
    plan_json TEXT NOT NULL DEFAULT '[]',
    skills_json TEXT NOT NULL DEFAULT '[]',
    provider TEXT,
    limitation TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS curialy_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES curialy_tasks(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS curialy_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT REFERENCES curialy_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS curialy_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS curialy_files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

type StoreTask = {
  id: string;
  prompt: string;
  status: "queued" | "planning" | "running" | "completed" | "failed" | "cancelled";
  model: string;
  think: boolean;
  webSearch: boolean;
  answer?: string;
  plan?: string[];
  skillsUsed?: string[];
  provider?: "platform-llm" | "local-demo";
  limitation?: string;
  createdAt: string;
  updatedAt: string;
};

type TaskRow = Omit<StoreTask, "think" | "webSearch" | "plan" | "skillsUsed" | "createdAt" | "updatedAt"> & {
  think: number;
  web_search: number;
  plan_json: string;
  skills_json: string;
  created_at: string;
  updated_at: string;
};

function fromRow(row: TaskRow): StoreTask {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    model: row.model,
    think: Boolean(row.think),
    webSearch: Boolean(row.web_search),
    answer: row.answer ?? undefined,
    plan: JSON.parse(row.plan_json || "[]"),
    skillsUsed: JSON.parse(row.skills_json || "[]"),
    provider: row.provider ?? undefined,
    limitation: row.limitation ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveTask(task: StoreTask) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO curialy_tasks (id, prompt, status, model, think, web_search, answer, plan_json, skills_json, provider, limitation, created_at, updated_at)
    VALUES (@id, @prompt, @status, @model, @think, @web_search, @answer, @plan_json, @skills_json, @provider, @limitation, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      prompt=excluded.prompt, status=excluded.status, model=excluded.model, think=excluded.think,
      web_search=excluded.web_search, answer=excluded.answer, plan_json=excluded.plan_json,
      skills_json=excluded.skills_json, provider=excluded.provider, limitation=excluded.limitation,
      updated_at=excluded.updated_at
  `).run({
    id: task.id, prompt: task.prompt, status: task.status, model: task.model, think: task.think ? 1 : 0,
    web_search: task.webSearch ? 1 : 0, answer: task.answer ?? null,
    plan_json: JSON.stringify(task.plan ?? []), skills_json: JSON.stringify(task.skillsUsed ?? []),
    provider: task.provider ?? null, limitation: task.limitation ?? null,
    created_at: task.createdAt || now, updated_at: now,
  });
  return getTask(task.id);
}

export function getTask(id: string) {
  const row = db.prepare("SELECT * FROM curialy_tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listTasks() {
  return (db.prepare("SELECT * FROM curialy_tasks ORDER BY created_at DESC LIMIT 100").all() as TaskRow[]).map(fromRow);
}

export function deleteTask(id: string) {
  return db.prepare("DELETE FROM curialy_tasks WHERE id = ?").run(id).changes > 0;
}

export function addMessage(taskId: string, role: string, content: string) {
  db.prepare("INSERT INTO curialy_messages (task_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(taskId, role, content, new Date().toISOString());
}

export function addEvent(taskId: string | null, title: string, detail: string) {
  db.prepare("INSERT INTO curialy_events (task_id, title, detail, created_at) VALUES (?, ?, ?, ?)").run(taskId, title, detail, new Date().toISOString());
}

export function listEvents() {
  return db.prepare("SELECT id, task_id as taskId, title, detail, created_at as createdAt FROM curialy_events ORDER BY id DESC LIMIT 50").all();
}

export function getSetting(key: string) {
  const row = db.prepare("SELECT value FROM curialy_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db.prepare(`INSERT INTO curialy_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, value, new Date().toISOString());
}

export function getStorageUsage() {
  let usedBytes = 0;
  try { usedBytes = fs.statSync(dbPath).size; } catch { /* database is created lazily */ }
  return { usedBytes, quotaBytes: 10 * 1024 * 1024 * 1024, isRealCalculation: true };
}

export function saveLibraryFile(file: { id: string; filename: string; mimeType: string; sizeBytes: number; storagePath: string; status: string }) {
  db.prepare(`INSERT INTO curialy_files (id, filename, mime_type, size_bytes, storage_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, status=excluded.status`).run(
    file.id, file.filename, file.mimeType, file.sizeBytes, file.storagePath, file.status, new Date().toISOString(),
  );
  return getLibraryFile(file.id);
}

export function getLibraryFile(id: string) {
  return db.prepare("SELECT id, filename, mime_type as mimeType, size_bytes as sizeBytes, status, created_at as createdAt FROM curialy_files WHERE id = ?").get(id);
}

export function listLibraryFiles() {
  return db.prepare("SELECT id, filename, mime_type as mimeType, size_bytes as sizeBytes, status, created_at as createdAt FROM curialy_files ORDER BY created_at DESC LIMIT 100").all();
}

export function deleteLibraryFile(id: string) {
  return db.prepare("DELETE FROM curialy_files WHERE id = ?").run(id).changes > 0;
}
