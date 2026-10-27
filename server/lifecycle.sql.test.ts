import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Opt-in: the lifecycle SQL against a real PostgreSQL, on TEMPORARY tables only (pg_temp, one
// connection, dropped when it closes). Set CURIALY_PG_TEST_URL to a database you may write temporary
// tables to. Every statement the lifecycle sends is checked: none may touch the real schema.

const url = process.env.CURIALY_PG_TEST_URL;
const sql = vi.hoisted(() => ({ client: null as import("pg").Client | null, statements: [] as string[] }));

vi.mock("./db/pg", () => {
  const run = async (text: string, values?: unknown[]) => {
    if (/\bcurialy\./i.test(text)) throw new Error(`statement would touch the real schema: ${text.slice(0, 160)}`);
    if (!sql.client) throw new Error("no test database connection");
    sql.statements.push(text);
    return sql.client.query(text, values as unknown[]);
  };
  return { query: run, heartbeatQuery: run };
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RUN = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!url)("lifecycle SQL on temporary tables", () => {
  let lifecycle: typeof import("./agent/lifecycle");
  let client: pg.Client;
  const LEGACY = "Interrupted by a server restart.";

  const exec = (text: string, values: unknown[] = []) => {
    if (/\bcurialy\./i.test(text)) throw new Error("test setup must not touch the real schema");
    return client.query(text, values);
  };
  const insertTask = (id: string, fields: Record<string, unknown>) => {
    const columns = ["id", ...Object.keys(fields)];
    return exec(`INSERT INTO pg_temp.chat_sessions (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, [id, ...Object.values(fields)]);
  };
  const insertEvent = (id: string, seq: number, data: Record<string, unknown>) =>
    exec("INSERT INTO pg_temp.agent_execution_logs (session_id, seq, type, data, created_at) VALUES ($1, $2, $3, $4::jsonb, now())", [id, seq, data.type, JSON.stringify(data)]);
  const task = async (id: string) => (await exec("SELECT * FROM pg_temp.chat_sessions WHERE id = $1", [id])).rows[0];
  const log = async (id: string) => (await exec("SELECT seq, type, data FROM pg_temp.agent_execution_logs WHERE session_id = $1 ORDER BY seq", [id])).rows as { seq: number; type: string; data: Record<string, unknown> }[];

  beforeAll(async () => {
    const parsed = new URL(url!);
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || parsed.searchParams.get("sslmode") === "disable";
    parsed.searchParams.delete("sslmode");
    client = new pg.Client({ connectionString: parsed.toString(), ssl: local ? false : { rejectUnauthorized: true, servername: parsed.hostname }, application_name: "curialy-lifecycle-test" });
    await client.connect();
    sql.client = client;
    await exec(`CREATE TEMP TABLE chat_sessions (
      id uuid PRIMARY KEY, status text NOT NULL, run_id uuid, attempt integer NOT NULL DEFAULT 0, worker_id text,
      lease_expires_at timestamptz, cancel_requested_at timestamptz, status_reason text, status_changed_at timestamptz,
      started_at timestamptz, finished_at timestamptz, outcome jsonb, error text, answer text,
      updated_at timestamptz NOT NULL DEFAULT now(), last_activity_at timestamptz NOT NULL DEFAULT now())`);
    await exec(`CREATE TEMP TABLE agent_execution_logs (
      session_id uuid NOT NULL REFERENCES pg_temp.chat_sessions(id) ON DELETE CASCADE, seq integer NOT NULL, type text NOT NULL,
      data jsonb NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (session_id, seq))`);
    lifecycle = await import("./agent/lifecycle");
    lifecycle.useSchemaForTests("pg_temp");
  });

  afterAll(async () => {
    lifecycle?.useSchemaForTests("curialy");
    await client?.end();
    sql.client = null;
  });

  beforeEach(async () => {
    await exec("TRUNCATE pg_temp.agent_execution_logs, pg_temp.chat_sessions");
  });

  it("writes the terminal events with the status change, exactly once when two writers race", async () => {
    const { transitionTask, terminalEvents } = lifecycle;
    await insertTask(ID(1), { status: "running", run_id: RUN(1), attempt: 1, worker_id: "other-box:1:ab", lease_expires_at: new Date(Date.now() + 30_000) });
    await insertEvent(ID(1), 1, { type: "status", status: "running" });
    const [interrupted, cancelled] = await Promise.all([
      transitionTask(ID(1), RUN(1), "interrupted", { reason: "lease_expired", events: terminalEvents("interrupted", { reason: "lease_expired" }) }),
      transitionTask(ID(1), RUN(1), "cancelled", { reason: "user_cancel", events: terminalEvents("cancelled", { reason: "user_cancel" }) }),
    ]);
    expect([interrupted.applied, cancelled.applied].filter(Boolean)).toHaveLength(1);
    const winner = interrupted.applied ? interrupted : cancelled;
    expect(winner.events.map(event => [event.seq, event.type])).toEqual([[2, "status"], [3, "done"]]);
    const row = await task(ID(1));
    const events = await log(ID(1));
    expect(events.map(event => event.type)).toEqual(["status", "status", "done"]);
    expect(events.at(-1)!.data.status).toBe(row.status);
    expect(row).toMatchObject({ worker_id: null, lease_expires_at: null });
    expect(row.finished_at).toBeInstanceOf(Date);
  });

  it("moves nothing and writes nothing when the run id does not match", async () => {
    const { transitionTask, terminalEvents } = lifecycle;
    await insertTask(ID(2), { status: "running", run_id: RUN(2) });
    for (const runId of [RUN(99), null]) {
      const result = await transitionTask(ID(2), runId, "completed", { answer: "zombie", events: terminalEvents("completed", { answer: "zombie" }) });
      expect(result).toEqual({ applied: false, events: [] });
    }
    // A status it may not move from is refused the same way.
    expect((await transitionTask(ID(2), RUN(2), "running", { from: ["queued"] })).applied).toBe(false);
    expect(await task(ID(2))).toMatchObject({ status: "running", answer: null });
    expect(await log(ID(2))).toEqual([]);
  });

  it("continues after the sequence numbers the live channel already handed out", async () => {
    const { transitionTask, terminalEvents } = lifecycle;
    await insertTask(ID(3), { status: "running", run_id: RUN(3) });
    const result = await transitionTask(ID(3), RUN(3), "completed", { answer: "Done.", outcome: { verification: "passed" }, events: terminalEvents("completed", { answer: "Done." }), baseSeq: 10 });
    expect(result.events.map(event => event.seq)).toEqual([11, 12]);
    expect(await task(ID(3))).toMatchObject({ status: "completed", answer: "Done.", outcome: { verification: "passed" } });
  });

  it("claims a new run only from a final row, fenced by the run the client saw", async () => {
    const { claimNextRun, WORKER_ID } = lifecycle;
    await insertTask(ID(4), { status: "failed", run_id: RUN(4), attempt: 1, error: "Boom", outcome: JSON.stringify({ verification: "failed" }), finished_at: new Date() });
    expect(await claimNextRun(ID(4), { runId: RUN(40), reason: "retry", expectedRunId: RUN(5) })).toBeNull();
    expect(await claimNextRun(ID(4), { runId: RUN(41), reason: "retry", expectedRunId: RUN(4) })).toEqual({ runId: RUN(41), attempt: 2 });
    const row = await task(ID(4));
    expect(row).toMatchObject({ status: "queued", run_id: RUN(41), attempt: 2, worker_id: WORKER_ID, status_reason: "retry", error: null, outcome: null, finished_at: null });
    expect(row.lease_expires_at.getTime()).toBeGreaterThan(Date.now());
    // A second click while the run is active starts nothing.
    expect(await claimNextRun(ID(4), { runId: RUN(42), reason: "retry" })).toBeNull();
    // Rows from before run ids existed are claimed with a null fence.
    await insertTask(ID(5), { status: "completed" });
    expect(await claimNextRun(ID(5), { runId: RUN(50), reason: "follow_up", expectedRunId: null })).toEqual({ runId: RUN(50), attempt: 1 });
  });

  it("recovers runs whose worker is gone and leaves live ones alone", async () => {
    const { reconcileStaleTasks } = lifecycle;
    await insertTask(ID(6), { status: "running" }); // pre-lease row
    await insertEvent(ID(6), 1, { type: "browser_session", sessionId: "s1", status: "live", liveUrl: null, replayUrl: "" });
    await insertEvent(ID(6), 2, { type: "browser_session", sessionId: "s2", status: "live", liveUrl: null, replayUrl: "" });
    await insertEvent(ID(6), 3, { type: "browser_session", sessionId: "s2", status: "ended", liveUrl: null, replayUrl: "" });
    await insertTask(ID(7), { status: "running", run_id: RUN(7), worker_id: "other-box:9:ab", lease_expires_at: new Date(Date.now() + 120_000) });
    await insertTask(ID(8), { status: "running", run_id: RUN(8), worker_id: "other-box:9:ab", lease_expires_at: new Date(Date.now() - 120_000) });
    await insertTask(ID(9), { status: "cancelling", run_id: RUN(9), worker_id: "other-box:9:ab", lease_expires_at: new Date(Date.now() - 120_000), cancel_requested_at: new Date() });
    const recovered = await reconcileStaleTasks(() => false);
    expect(recovered.sort((a, b) => a.taskId.localeCompare(b.taskId))).toEqual([
      { taskId: ID(6), status: "interrupted", reason: "server_restart" },
      { taskId: ID(8), status: "interrupted", reason: "lease_expired" },
      { taskId: ID(9), status: "cancelled", reason: "user_cancel" },
    ]);
    expect((await task(ID(7))).status).toBe("running");
    expect((await log(ID(6))).slice(3).map(event => [event.seq, event.type, event.data.sessionId ?? event.data.status])).toEqual([[4, "browser_session", "s1"], [5, "status", "interrupted"], [6, "done", "interrupted"]]);
    // Nothing left to do on the next pass.
    expect(await reconcileStaleTasks(() => false)).toEqual([]);
  });

  it("repairs a log that does not end like its row once, legacy restart rows as interrupted", async () => {
    const { repairEventLogs } = lifecycle;
    await insertTask(ID(10), { status: "failed", error: LEGACY });
    await insertEvent(ID(10), 1, { type: "status", status: "running" });
    await insertTask(ID(11), { status: "failed", run_id: RUN(11), error: "Boom", status_reason: "error" });
    await insertEvent(ID(11), 1, { type: "status", status: "running" });
    await insertTask(ID(12), { status: "completed", run_id: RUN(12) });
    await insertEvent(ID(12), 1, { type: "done", status: "completed", answer: "ok" });
    await insertEvent(ID(12), 2, { type: "deployment", deploymentId: "d1", status: "expired", detail: "" }); // later sweeper events are fine
    expect(await repairEventLogs()).toBe(2);
    expect((await log(ID(10))).map(event => event.data)).toEqual([
      { type: "status", status: "running" },
      { type: "status", status: "interrupted", reason: "server_restart" },
      { type: "done", status: "interrupted", answer: "", reason: "server_restart" },
    ]);
    expect((await log(ID(11))).at(-1)!.data).toEqual({ type: "done", status: "failed", answer: "", reason: "error", error: "Boom" });
    expect(await log(ID(12))).toHaveLength(2);
    expect(await repairEventLogs()).toBe(0);
  });

  it("renews only this worker's leases and counts runs leased anywhere", async () => {
    const { renewLeases, countActiveRuns, WORKER_ID } = lifecycle;
    await insertTask(ID(13), { status: "running", run_id: RUN(13), worker_id: WORKER_ID, lease_expires_at: new Date(Date.now() + 5000), cancel_requested_at: new Date() });
    await insertTask(ID(14), { status: "running", run_id: RUN(14), worker_id: "other-box:9:ab", lease_expires_at: new Date(Date.now() + 10_000) });
    await insertTask(ID(15), { status: "running", run_id: RUN(15), worker_id: "other-box:9:ab", lease_expires_at: new Date(Date.now() - 60_000) });
    expect(await renewLeases([{ taskId: ID(13), runId: RUN(13) }, { taskId: ID(14), runId: RUN(14) }])).toEqual([{ taskId: ID(13), runId: RUN(13), status: "running", cancelRequested: true }]);
    expect((await task(ID(13))).lease_expires_at.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect((await task(ID(14))).lease_expires_at.getTime()).toBeLessThan(Date.now() + 20_000); // not ours: untouched
    expect(await countActiveRuns()).toBe(2);
  });

  it("appends events after the last persisted one", async () => {
    const { appendLoggedEvents } = lifecycle;
    await insertTask(ID(16), { status: "completed" });
    await insertEvent(ID(16), 7, { type: "done", status: "completed", answer: "" });
    const appended = await appendLoggedEvents(ID(16), [{ type: "notice", level: "info", message: "a" }, { type: "notice", level: "info", message: "b\u0000" }]);
    expect(appended.map(event => [event.seq, (event as { message?: string }).message])).toEqual([[8, "a"], [9, "b"]]);
  });

  it("never sent a statement to the real schema", () => {
    expect(sql.statements.length).toBeGreaterThan(0);
    expect(sql.statements.some(text => /\bcurialy\./i.test(text))).toBe(false);
  });
});
