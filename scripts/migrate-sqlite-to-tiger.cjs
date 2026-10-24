#!/usr/bin/env node
// One-off, idempotent: copy agent sessions + execution logs from the old SQLite file into Tiger.
// Usage: node scripts/migrate-sqlite-to-tiger.cjs /srv/curialyai-next/data/curialy.db
// Reads the Tiger connection from TIGER_DATABASE_URL, or ~/.pgpass when unset.
const fs = require("node:fs");
const path = require("node:path");
const Database = require(require.resolve("better-sqlite3", { paths: ["/srv/curialyai/node_modules", process.cwd()] }));
const { Client } = require("pg");

function tigerClient() {
  if (process.env.TIGER_DATABASE_URL) {
    const url = new URL(process.env.TIGER_DATABASE_URL);
    url.searchParams.delete("sslmode");
    return new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true, servername: url.hostname } });
  }
  const [host, port, database, user, ...pw] = fs.readFileSync(path.join(process.env.HOME, ".pgpass"), "utf8").trim().split(":");
  return new Client({ host, port: Number(port), database, user, password: pw.join(":"), ssl: { rejectUnauthorized: true } });
}

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error(`SQLite file not found: ${file}`);
  const sqlite = new Database(file, { readonly: true });
  const hasTable = name => Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  if (!hasTable("agent_tasks")) return console.log("No agent_tasks table; nothing to migrate.");
  const pg = tigerClient();
  await pg.connect();
  const admin = (await pg.query(`INSERT INTO curialy.users (handle, display_name, role) VALUES ('admin','Operator','admin')
    ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle RETURNING id`)).rows[0].id;

  const tasks = sqlite.prepare("SELECT * FROM agent_tasks").all();
  let events = 0;
  for (const task of tasks) {
    const status = ["queued", "running"].includes(task.status) ? "failed" : task.status;
    const workspace = fs.existsSync(path.join("/srv/curialy-workspaces", task.id)) ? "live" : "none";
    await pg.query("BEGIN");
    try {
      await pg.query(
        `INSERT INTO curialy.chat_sessions (id, user_id, prompt, status, mode, model, effort, web_search, phase, answer, error, usage, files_changed,
           conversation, conversation_format, workspace_state, last_activity_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'anthropic',$15,$16,$17,$16)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, answer = EXCLUDED.answer, error = EXCLUDED.error, usage = EXCLUDED.usage,
           files_changed = EXCLUDED.files_changed, conversation = EXCLUDED.conversation, updated_at = EXCLUDED.updated_at`,
        [task.id, admin, task.prompt, status, task.mode, task.model, task.effort, Boolean(task.web_search), task.phase, task.answer,
          status !== task.status ? (task.error || "Interrupted during migration.") : task.error, task.usage_json, task.files_changed,
          task.conversation_json, workspace, task.updated_at, task.created_at],
      );
      const rows = sqlite.prepare("SELECT seq, type, data_json, created_at FROM agent_events WHERE task_id = ? ORDER BY seq").all(task.id);
      for (let i = 0; i < rows.length; i += 300) {
        const chunk = rows.slice(i, i + 300);
        const values = [];
        const tuples = chunk.map((row, j) => {
          values.push(task.id, row.seq, row.type, row.data_json, row.created_at);
          const b = j * 5;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
        });
        await pg.query(`INSERT INTO curialy.agent_execution_logs (session_id, seq, type, data, created_at) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`, values);
      }
      events += rows.length;
      // Visible chat log: the original prompt and the final answer.
      await pg.query("DELETE FROM curialy.messages WHERE session_id = $1", [task.id]);
      await pg.query("INSERT INTO curialy.messages (session_id, role, content, created_at) VALUES ($1,'user',$2,$3)", [task.id, task.prompt, task.created_at]);
      if (task.answer) await pg.query("INSERT INTO curialy.messages (session_id, role, content, model, created_at) VALUES ($1,'assistant',$2,$3,$4)", [task.id, task.answer, task.model, task.updated_at]);
      await pg.query("COMMIT");
    } catch (error) {
      await pg.query("ROLLBACK");
      throw error;
    }
  }
  const check = await pg.query("SELECT COUNT(*)::int AS sessions, (SELECT COUNT(*)::int FROM curialy.agent_execution_logs) AS events FROM curialy.chat_sessions");
  console.log(`Migrated ${tasks.length} sessions and ${events} events. Tiger now has`, check.rows[0]);
  await pg.end();
})().catch(error => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
