import pg from "pg";

// All durable state lives in Tiger Cloud (managed PostgreSQL/TimescaleDB). Nothing user-related is
// written to the VPS disk; the VPS only runs the app and short-lived agent workspaces.

let pool: pg.Pool | null = null;

export function db() {
  if (pool) return pool;
  const connectionString = process.env.TIGER_DATABASE_URL;
  if (!connectionString) throw new Error("TIGER_DATABASE_URL is not configured.");
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode"); // TLS is configured explicitly below (full certificate verification).
  pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, servername: url.hostname },
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "curialy-app",
  });
  pool.on("error", error => console.error("[db] idle client error:", error.message));
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, values?: unknown[]) {
  return db().query<T>(text, values);
}

export async function closeDb() {
  await Promise.all([pool?.end(), heartbeatPool?.end()]);
  pool = null;
  heartbeatPool = null;
}

let heartbeatPool: pg.Pool | null = null;

/** A one-connection pool for lease renewals, with a short statement timeout (never queued behind bulk I/O). */
export async function heartbeatQuery<T extends pg.QueryResultRow = any>(text: string, values?: unknown[]) {
  if (!heartbeatPool) {
    const connectionString = process.env.TIGER_DATABASE_URL;
    if (!connectionString) throw new Error("TIGER_DATABASE_URL is not configured.");
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    heartbeatPool = new pg.Pool({
      connectionString: url.toString(), ssl: { rejectUnauthorized: true, servername: url.hostname },
      max: 1, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 5000, statement_timeout: 5000, application_name: "curialy-heartbeat",
    });
    heartbeatPool.on("error", error => console.error("[db] heartbeat client error:", error.message));
  }
  return heartbeatPool.query<T>(text, values);
}

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE SCHEMA IF NOT EXISTS curialy;
      CREATE TABLE IF NOT EXISTS curialy.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        handle text UNIQUE NOT NULL,
        display_name text NOT NULL,
        role text NOT NULL DEFAULT 'admin',
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS curialy.chat_sessions (
        id uuid PRIMARY KEY,
        user_id uuid REFERENCES curialy.users(id) ON DELETE SET NULL,
        prompt text NOT NULL,
        status text NOT NULL,
        mode text NOT NULL,
        model text NOT NULL,
        effort text NOT NULL,
        web_search boolean NOT NULL DEFAULT false,
        phase text,
        answer text,
        error text,
        usage jsonb NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"thinkingTokens":0}',
        files_changed integer NOT NULL DEFAULT 0,
        conversation jsonb NOT NULL DEFAULT '[]',
        conversation_format text NOT NULL DEFAULT 'anthropic',
        workspace_state text NOT NULL DEFAULT 'none',
        last_activity_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chat_sessions_created_idx ON curialy.chat_sessions (created_at DESC);
      CREATE TABLE IF NOT EXISTS curialy.messages (
        id bigserial PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES curialy.chat_sessions(id) ON DELETE CASCADE,
        role text NOT NULL,
        content text NOT NULL,
        model text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS messages_session_idx ON curialy.messages (session_id, id);
      CREATE TABLE IF NOT EXISTS curialy.agent_execution_logs (
        session_id uuid NOT NULL REFERENCES curialy.chat_sessions(id) ON DELETE CASCADE,
        seq integer NOT NULL,
        type text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS curialy.file_metadata (
        id uuid PRIMARY KEY,
        session_id uuid REFERENCES curialy.chat_sessions(id) ON DELETE SET NULL,
        user_id uuid REFERENCES curialy.users(id) ON DELETE SET NULL,
        kind text NOT NULL,
        filename text NOT NULL,
        mime_type text NOT NULL,
        size_bytes integer NOT NULL,
        storage text NOT NULL,
        stage_path text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS curialy.workspace_files (
        session_id uuid NOT NULL REFERENCES curialy.chat_sessions(id) ON DELETE CASCADE,
        path text NOT NULL,
        content bytea NOT NULL,
        size_bytes integer NOT NULL,
        sha256 text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, path)
      );
      CREATE TABLE IF NOT EXISTS curialy.deployments (
        id uuid PRIMARY KEY,
        session_id uuid REFERENCES curialy.chat_sessions(id) ON DELETE SET NULL,
        provider text NOT NULL,
        service_id text,
        repo text,
        url text,
        status text NOT NULL,
        detail text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS deployments_live_idx ON curialy.deployments (expires_at) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS curialy.legacy_records (
        source text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        PRIMARY KEY (source, id)
      );
    `,
  },
  {
    id: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS curialy.github_connections (
        user_id uuid PRIMARY KEY REFERENCES curialy.users(id) ON DELETE CASCADE,
        github_id bigint NOT NULL,
        login text NOT NULL,
        name text,
        email text,
        avatar_url text,
        scopes text NOT NULL DEFAULT '',
        token_ciphertext bytea NOT NULL,
        token_iv bytea NOT NULL,
        token_tag bytea NOT NULL,
        connected_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_repo text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_repo_url text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_pushed_at timestamptz;
      ALTER TABLE curialy.deployments ADD COLUMN IF NOT EXISTS repo_owned_by_user boolean NOT NULL DEFAULT false;
    `,
  },
  {
    id: 3,
    sql: `
      -- 'export': agent-created project pushed as a full tree; 'linked': an existing repo cloned into the workspace.
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_mode text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_branch text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_base_sha text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_repo_path text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_pushed jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS github_deleted jsonb NOT NULL DEFAULT '[]';
      UPDATE curialy.chat_sessions SET github_mode = 'export' WHERE github_repo IS NOT NULL AND github_mode IS NULL;
    `,
  },
  {
    id: 4,
    sql: `ALTER TABLE curialy.file_metadata ADD COLUMN IF NOT EXISTS source_path text;
          CREATE INDEX IF NOT EXISTS file_metadata_session_idx ON curialy.file_metadata (session_id, created_at);`,
  },
  {
    id: 5,
    sql: `ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS team boolean NOT NULL DEFAULT false;
          ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS team_state jsonb;`,
  },
  {
    id: 6,
    sql: `
      -- Run ownership and truthful lifecycle (server/agent/lifecycle.ts). Additive only: older code
      -- ignores these columns. run_id fences every run-scoped write; the lease is renewed by the
      -- worker's heartbeat so a dead worker's runs can be recognised and interrupted.
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS run_id uuid;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS worker_id text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS status_reason text;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS finished_at timestamptz;
      ALTER TABLE curialy.chat_sessions ADD COLUMN IF NOT EXISTS outcome jsonb;
      CREATE INDEX IF NOT EXISTS chat_sessions_active_idx ON curialy.chat_sessions (lease_expires_at)
        WHERE status IN ('queued', 'running', 'cancelling');
      -- No data is rewritten: rows the old boot recovery marked failed ('Interrupted by a server
      -- restart.') are shown as interrupted by the read path (store.ts fromRow), so a rollback to the
      -- previous build still understands every row.

      -- Deployments: every event carries the row id; cleanup records why a preview went away.
      ALTER TABLE curialy.deployments ADD COLUMN IF NOT EXISTS call_id text;
      ALTER TABLE curialy.deployments ADD COLUMN IF NOT EXISTS name text;
      ALTER TABLE curialy.deployments ADD COLUMN IF NOT EXISTS removed_reason text;
      ALTER TABLE curialy.deployments ADD COLUMN IF NOT EXISTS last_error text;
      ALTER TABLE curialy.deployments ADD COLUMN IF NOT EXISTS cleanup_detail text;
      CREATE INDEX IF NOT EXISTS deployments_session_idx ON curialy.deployments (session_id, created_at);

      -- Media rows whose object is known to be gone (e.g. stored in a previous storage account).
      ALTER TABLE curialy.file_metadata ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'stored';
      ALTER TABLE curialy.file_metadata ADD COLUMN IF NOT EXISTS missing_at timestamptz;

      -- Workspace snapshots also keep the built site ('build') so an archived preview is still known.
      ALTER TABLE curialy.workspace_files ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'source';
    `,
  },
];

export async function migrate() {
  const client = await db().connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS curialy");
    await client.query("CREATE TABLE IF NOT EXISTS curialy.schema_migrations (id integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    // Serialize concurrent boots (e.g. a restart overlapping the old process).
    await client.query("SELECT pg_advisory_lock(7718001)");
    const { rows } = await client.query<{ id: number }>("SELECT id FROM curialy.schema_migrations");
    const applied = new Set(rows.map(row => row.id));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO curialy.schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
        console.log(`[db] applied migration ${migration.id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(7718001)").catch(() => undefined);
    client.release();
  }
}

/** The single operator account; auth itself is a stateless signed cookie. */
export async function adminUserId() {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO curialy.users (handle, display_name, role) VALUES ('admin', 'Operator', 'admin')
     ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle RETURNING id`,
  );
  return rows[0].id;
}
