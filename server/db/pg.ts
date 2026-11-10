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
  {
    id: 7,
    sql: `
      -- Which storage account holds each file (normalized account identifier). NULL: stored before
      -- this was recorded. A file whose account is not the one the server uses now is reported as
      -- stored elsewhere, never as missing (switching accounts back must find it again).
      ALTER TABLE curialy.file_metadata ADD COLUMN IF NOT EXISTS stage_account text;
    `,
  },
  {
    id: 8,
    sql: `
      -- Public accounts: everyone signs in with GitHub. The operator account (handle 'admin') keeps its
      -- data and its password sign-in; signing in with the GitHub account it connected reaches it too.
      ALTER TABLE curialy.users ALTER COLUMN role SET DEFAULT 'user';
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS github_id bigint;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS login text;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS avatar_url text;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS email text;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
      -- Credits: an allowance per window (NULL: the default in settings), bonus credits from promo codes
      -- and grants (spent after the window's, never expire), and the current window.
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS credit_allowance integer;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS bonus_credits numeric(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS window_started_at timestamptz;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS window_used numeric(12,2) NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX IF NOT EXISTS users_github_id_key ON curialy.users (github_id) WHERE github_id IS NOT NULL;

      INSERT INTO curialy.users (handle, display_name, role) VALUES ('admin', 'Operator', 'admin') ON CONFLICT (handle) DO NOTHING;
      UPDATE curialy.users u SET github_id = c.github_id, login = c.login, avatar_url = c.avatar_url, email = c.email
        FROM curialy.github_connections c WHERE c.user_id = u.id AND u.handle = 'admin' AND u.github_id IS NULL;
      -- Rows from before ownership was recorded: a file belongs to its task's owner, everything else to the operator.
      UPDATE curialy.file_metadata f SET user_id = s.user_id FROM curialy.chat_sessions s
        WHERE f.user_id IS NULL AND f.session_id = s.id AND s.user_id IS NOT NULL;
      UPDATE curialy.file_metadata SET user_id = (SELECT id FROM curialy.users WHERE handle = 'admin') WHERE user_id IS NULL;
      UPDATE curialy.chat_sessions SET user_id = (SELECT id FROM curialy.users WHERE handle = 'admin') WHERE user_id IS NULL;
      CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON curialy.chat_sessions (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS file_metadata_user_idx ON curialy.file_metadata (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS curialy.credit_events (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE CASCADE,
        kind text NOT NULL,
        amount numeric(12,2) NOT NULL,
        session_id uuid REFERENCES curialy.chat_sessions(id) ON DELETE SET NULL,
        detail text,
        created_by uuid REFERENCES curialy.users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS credit_events_user_idx ON curialy.credit_events (user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS curialy.promo_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL,
        credits integer NOT NULL CHECK (credits > 0),
        for_user_id uuid REFERENCES curialy.users(id) ON DELETE CASCADE,
        max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
        redemptions integer NOT NULL DEFAULT 0,
        expires_at timestamptz,
        disabled_at timestamptz,
        note text,
        created_by uuid REFERENCES curialy.users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_key ON curialy.promo_codes (upper(code));
      CREATE TABLE IF NOT EXISTS curialy.promo_redemptions (
        code_id uuid NOT NULL REFERENCES curialy.promo_codes(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE CASCADE,
        credits integer NOT NULL,
        redeemed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (code_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS curialy.app_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_by uuid REFERENCES curialy.users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: 9,
    sql: `
      -- Developer API keys. The secret is shown once and never stored: only its SHA-256 (for lookup)
      -- and a short prefix to recognise it by. Revoked keys stay listed with their history.
      CREATE TABLE IF NOT EXISTS curialy.api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE CASCADE,
        name text NOT NULL,
        key_hash text NOT NULL UNIQUE,
        key_prefix text NOT NULL,
        allowed_models jsonb NOT NULL DEFAULT '["claude-opus-5-5", "claude-sonnet-4-5"]'::jsonb,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        revoked_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS api_keys_user_idx ON curialy.api_keys (user_id, created_at DESC);
    `,
  },
  {
    id: 10,
    sql: `
      -- Follow-ups sent while a task's run is active: each starts by itself when the run before it
      -- ends (server/agent/queue.ts). Started ones stay, with the run they started, so a re-sent
      -- client message id is recognised; removed ones are deleted.
      CREATE TABLE IF NOT EXISTS curialy.queued_followups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES curialy.chat_sessions(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE CASCADE,
        prompt text NOT NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        model text,
        repo jsonb,
        client_message_id text,
        state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'starting', 'started', 'failed')),
        error text,
        run_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS queued_followups_session_idx ON curialy.queued_followups (session_id, state, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS queued_followups_client_idx ON curialy.queued_followups (session_id, client_message_id) WHERE client_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS queued_followups_run_idx ON curialy.queued_followups (run_id) WHERE run_id IS NOT NULL;
    `,
  },
  {
    id: 11,
    sql: `
      -- Sign-ups (server/signup-network.ts): a keyed hash of the network an account was created
      -- from (never the address), and whether it started without the free allowance. Older
      -- accounts have neither and are not counted.
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS signup_network bytea;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS free_allowance_withheld boolean NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS users_signup_network_idx ON curialy.users (signup_network) WHERE signup_network IS NOT NULL;
    `,
  },
  {
    id: 12,
    sql: `
      -- Plans (frozen allowance at purchase), and the Developer API balance in micro-dollars.
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS plan_id text;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS plan_credits_per_window integer;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS api_balance_micros bigint NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS curialy.payment_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL UNIQUE,
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE RESTRICT,
        kind text NOT NULL CHECK (kind IN ('plan', 'api')),
        plan_id text CHECK (plan_id IS NULL OR plan_id IN ('pro', 'max')),
        -- What a plan gives, fixed when it is sold (the operator may change the plan before it is paid).
        plan_days integer, plan_credits_per_window integer,
        list_usd numeric(12,2) NOT NULL,
        discount_percent integer NOT NULL DEFAULT 0,
        price_usd numeric(12,2) NOT NULL,
        credit_usd numeric(12,2),
        network text, coin text, pay_address text,
        expected_amount text, expected_units numeric(78,0), quote_usd_price numeric(20,8), quoted_at timestamptz,
        tx_hash text,
        status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','pending','confirming','review','completed','rejected','expired')),
        status_detail text,
        confirmations integer, required_confirmations integer,
        tx_from text, tx_block_time timestamptz, received_units numeric(78,0), chain_verified_at timestamptz,
        check_count integer NOT NULL DEFAULT 0, next_check_at timestamptz, last_checked_at timestamptz,
        admin_note text,
        expires_at timestamptz NOT NULL,
        submitted_at timestamptz, completed_at timestamptz, applied_at timestamptz, applied_detail jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      -- One transaction pays one order: only an order it matched holds it (confirming, completed, or verified
      -- and waiting for the operator). Anyone can paste a hash they see arrive at the wallet, so an order
      -- whose check didn't match blocks nobody.
      CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_paid_tx_idx ON curialy.payment_orders (network, tx_hash)
        WHERE tx_hash IS NOT NULL AND (status IN ('confirming', 'completed') OR (status = 'review' AND chain_verified_at IS NOT NULL));
      CREATE INDEX IF NOT EXISTS payment_orders_tx_idx ON curialy.payment_orders (network, tx_hash) WHERE tx_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON curialy.payment_orders (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS payment_orders_check_idx ON curialy.payment_orders (status, next_check_at);
      CREATE INDEX IF NOT EXISTS payment_orders_amount_idx ON curialy.payment_orders (network, coin, expected_units) WHERE expected_units IS NOT NULL;

      CREATE TABLE IF NOT EXISTS curialy.payment_events (
        id bigserial PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES curialy.payment_orders(id) ON DELETE CASCADE,
        from_status text, to_status text NOT NULL,
        actor text NOT NULL CHECK (actor IN ('customer', 'system', 'admin')), actor_id uuid,
        note text, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS payment_events_order_idx ON curialy.payment_events (order_id, id);

      CREATE TABLE IF NOT EXISTS curialy.api_usage (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE CASCADE,
        key_id uuid REFERENCES curialy.api_keys(id) ON DELETE SET NULL,
        model text NOT NULL,
        input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
        cache_read_tokens integer NOT NULL DEFAULT 0, cache_write_tokens integer NOT NULL DEFAULT 0,
        list_micros bigint NOT NULL DEFAULT 0, cost_micros bigint NOT NULL DEFAULT 0, discount_percent integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS api_usage_user_idx ON curialy.api_usage (user_id, created_at);

      CREATE TABLE IF NOT EXISTS curialy.api_ledger (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES curialy.users(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('topup', 'grant', 'refund', 'adjust')),
        amount_micros bigint NOT NULL, balance_after_micros bigint NOT NULL,
        order_id uuid REFERENCES curialy.payment_orders(id) ON DELETE SET NULL,
        note text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS api_ledger_user_idx ON curialy.api_ledger (user_id, created_at DESC);
    `,
  },
  {
    id: 13,
    sql: `
      -- A plan order can pay for several periods at once (1 to 6): how many. Older orders paid for one.
      ALTER TABLE curialy.payment_orders ADD COLUMN IF NOT EXISTS plan_months integer;
    `,
  },
  {
    id: 14,
    sql: `
      -- Credits earned on X (server/rewards.ts): the X account linked to this one (one X account per
      -- account), when it was found following the operator's account and when its post about the site
      -- was accepted (each reward once; both: the launch boost applies). A post pays one account.
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_user_id text;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_username text;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_linked_at timestamptz;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_followed_at timestamptz;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_posted_at timestamptz;
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_post_id text;
      CREATE UNIQUE INDEX IF NOT EXISTS users_x_user_id_key ON curialy.users (x_user_id) WHERE x_user_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS users_x_post_id_key ON curialy.users (x_post_id) WHERE x_post_id IS NOT NULL;

      -- The free credits change shape: welcome credits once (default 60) and the X rewards instead of
      -- a refilling allowance for everyone. Saved settings keep their other fields.
      UPDATE curialy.app_settings SET value = value || '{"creditsPerWindow": 0}'::jsonb WHERE key = 'credits';
      -- Close the free windows already open, so usage counted against the old allowance isn't charged
      -- to a boost claimed later. A plan's window and an allowance set for one account stay.
      UPDATE curialy.users SET window_started_at = NULL, window_used = 0
        WHERE credit_allowance IS NULL AND (plan_expires_at IS NULL OR plan_expires_at <= now());
      -- Accounts from before start the new system the way a new account does: with the welcome
      -- credits, unless they had no free allowance. The operator's account is not charged anyway.
      WITH granted AS (
        UPDATE curialy.users SET bonus_credits = bonus_credits + 60 WHERE role <> 'admin' AND NOT free_allowance_withheld RETURNING id
      )
      INSERT INTO curialy.credit_events (user_id, kind, amount, detail) SELECT id, 'welcome', 60, 'welcome credits' FROM granted;
    `,
  },
  {
    id: 15,
    sql: `
      -- $20 on the Developer API balance, once, when both X rewards are claimed (server/rewards.ts).
      ALTER TABLE curialy.users ADD COLUMN IF NOT EXISTS x_api_granted_at timestamptz;
      -- Anyone who already did both before this column existed gets it now. It is not paid again.
      WITH granted AS (
        UPDATE curialy.users SET api_balance_micros = api_balance_micros + 20000000, x_api_granted_at = now()
          WHERE x_followed_at IS NOT NULL AND x_posted_at IS NOT NULL AND x_api_granted_at IS NULL AND NOT free_allowance_withheld
          RETURNING id, api_balance_micros
      )
      INSERT INTO curialy.api_ledger (user_id, kind, amount_micros, balance_after_micros, note)
      SELECT id, 'grant', 20000000, api_balance_micros, 'Developer API credit for following and posting on X' FROM granted;
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

/** The operator account (handle 'admin'): password sign-in and everything from before public accounts. */
let operatorId: Promise<string> | null = null;
export function adminUserId() {
  operatorId ??= query<{ id: string }>(
    `INSERT INTO curialy.users (handle, display_name, role) VALUES ('admin', 'Operator', 'admin')
     ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle RETURNING id`,
  ).then(({ rows }) => rows[0].id);
  // A failed lookup is retried next time instead of being cached.
  operatorId.catch(() => { operatorId = null; });
  return operatorId;
}
