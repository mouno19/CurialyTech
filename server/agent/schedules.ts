import { Router, type NextFunction, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { MODELS, type CreateTaskRequest } from "@shared/agent";
import { brandText } from "@shared/brand";
import {
  describeSchedule, MAX_INTERVAL_HOURS, MAX_SCHEDULE_FAILURES, MAX_SCHEDULES, MAX_SCHEDULES_OPERATOR, MIN_INTERVAL_HOURS, nextRunAt, parseCron, validTimeZone,
  type ScheduledTask, type ScheduleRun,
} from "@shared/schedules";
import { SAVED_SKILL_LIMITS } from "@shared/skills";
import { accountOf, rateLimited, requireUser } from "../auth";
import { db, query } from "../db/pg";
import { admissionRefusal, oneAtATime } from "./admission";
import { appendTaskEvent } from "./events";
import { isDraining, startTask } from "./runner";
import { loadTaskSkills } from "./saved-skills";

// Scheduled tasks: a prompt an account runs by itself every few hours or at set times (shared/
// schedules.ts reads the timetable). When one is due, a tick here claims it (the row is locked, so
// two workers never start it twice), moves it to its next time, and starts it as a new task with
// the rules every task start has: credits, one run at a time, the sandbox. Each attempt is a
// scheduled_task_runs row: the task it started, or why it was skipped. A schedule that can't start
// MAX_SCHEDULE_FAILURES times in a row turns itself off and says why.

const TICK_MS = 30_000;
/** Due schedules started per tick (more wait for the next one). */
const PER_TICK = 5;

type Row = {
  id: string; user_id: string; title: string; prompt: string; cron_expression: string | null; interval_hours: number | null; time_zone: string;
  mode: "agent" | "chat"; model_id: string | null; repo: string | null; repo_branch: string | null; skill_ids: string[] | null;
  enabled: boolean; failures: number; disabled_reason: string | null; next_run_at: Date; last_run_at: Date | null; created_at: Date; updated_at: Date;
};
type RunRow = { id: string; schedule_id: string; task_id: string | null; scheduled_for: Date; started_at: Date; outcome: ScheduleRun["outcome"]; detail: string | null };

export class ScheduleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const COLUMNS = "id, user_id, title, prompt, cron_expression, interval_hours, time_zone, mode, model_id, repo, repo_branch, skill_ids, enabled, failures, disabled_reason, next_run_at, last_run_at, created_at, updated_at";

function view(row: Row, runs: RunRow[]): ScheduledTask {
  return {
    id: row.id, title: row.title, prompt: row.prompt, cron: row.cron_expression, intervalHours: row.interval_hours, timeZone: row.time_zone, mode: row.mode,
    model: row.model_id ?? "auto", repo: row.repo, repoBranch: row.repo_branch, skillIds: row.skill_ids ?? [], enabled: row.enabled, failures: row.failures,
    disabledReason: row.disabled_reason, nextRunAt: row.next_run_at.toISOString(), lastRunAt: row.last_run_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    runs: runs.map(run => ({ id: String(run.id), taskId: run.task_id, scheduledFor: run.scheduled_for.toISOString(), startedAt: run.started_at.toISOString(), outcome: run.outcome, detail: run.detail })),
  };
}

// ---- Validation ----

const MODEL_IDS = new Set(MODELS.map(model => model.id));

const fields = {
  title: z.string().trim().min(1, "Give the schedule a name.").max(120, "Keep the name under 120 characters."),
  prompt: z.string().trim().min(2, "Describe what the task should do.").max(20_000),
  cron: z.string().trim().max(100).nullish(),
  intervalHours: z.number().int("Hours are a whole number.").min(MIN_INTERVAL_HOURS, `Run at most once every ${MIN_INTERVAL_HOURS} hour.`).max(MAX_INTERVAL_HOURS, `Run at least once every ${MAX_INTERVAL_HOURS / 24} days.`).nullish(),
  timeZone: z.string().trim().refine(validTimeZone, "That time zone isn't known (use a name such as Europe/Berlin)."),
  mode: z.enum(["agent", "chat"]),
  model: z.string().trim().max(120).refine(model => model === "auto" || MODEL_IDS.has(model), "That model isn't offered."),
  repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repository must be owner/name").nullish(),
  repoBranch: z.string().trim().max(200).nullish(),
  skillIds: z.array(z.string().uuid("One of those skills is not on this account.")).max(SAVED_SKILL_LIMITS.maxPerTask, `A task can use ${SAVED_SKILL_LIMITS.maxPerTask} skills.`),
  enabled: z.boolean(),
};
const inputSchema = z.object({ ...fields, mode: fields.mode.default("agent"), model: fields.model.default("auto"), skillIds: fields.skillIds.default([]), enabled: fields.enabled.default(true) });
/** A change: only the fields sent (no defaults, so nothing left out is reset). */
const patchSchema = z.object(fields).partial();
type Input = z.infer<typeof inputSchema>;

/** The timetable must be exactly one of a cron expression and an interval, and give a next run. */
function timetable(input: Pick<Input, "cron" | "intervalHours" | "timeZone">) {
  const cron = input.cron?.trim() || null;
  const intervalHours = input.intervalHours ?? null;
  if ((cron === null) === (intervalHours === null)) throw new ScheduleError("Choose when it runs: every few hours, or at set times.");
  if (cron) {
    const parsed = parseCron(cron);
    if ("error" in parsed) throw new ScheduleError(parsed.error);
  }
  const next = nextRunAt({ cron, intervalHours, timeZone: input.timeZone }, Date.now());
  if (next === null) throw new ScheduleError("That timetable never comes round in the next year.");
  return { cron, intervalHours, next: new Date(next) };
}

// ---- Reading and writing an account's schedules ----

async function runsOf(ids: string[]): Promise<Map<string, RunRow[]>> {
  const runs = new Map<string, RunRow[]>();
  if (!ids.length) return runs;
  const { rows } = await query<RunRow>(
    `SELECT id, schedule_id, task_id, scheduled_for, started_at, outcome, detail FROM (
       SELECT r.*, row_number() OVER (PARTITION BY schedule_id ORDER BY id DESC) AS n FROM curialy.scheduled_task_runs r WHERE schedule_id = ANY($1::uuid[])
     ) latest WHERE n <= 5 ORDER BY id DESC`,
    [ids],
  );
  for (const row of rows) runs.set(row.schedule_id, [...(runs.get(row.schedule_id) ?? []), row]);
  return runs;
}

export async function listSchedules(userId: string): Promise<ScheduledTask[]> {
  const { rows } = await query<Row>(`SELECT ${COLUMNS} FROM curialy.scheduled_tasks WHERE user_id = $1 ORDER BY created_at`, [userId]);
  const runs = await runsOf(rows.map(row => row.id));
  return rows.map(row => view(row, runs.get(row.id) ?? []));
}

async function ownSchedule(userId: string, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ScheduleError("No schedule with that id on this account.", 404);
  const { rows: [row] } = await query<Row>(`SELECT ${COLUMNS} FROM curialy.scheduled_tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!row) throw new ScheduleError("No schedule with that id on this account.", 404);
  return row;
}

async function scheduleView(id: string) {
  const { rows: [row] } = await query<Row>(`SELECT ${COLUMNS} FROM curialy.scheduled_tasks WHERE id = $1`, [id]);
  return view(row, (await runsOf([id])).get(id) ?? []);
}

export async function createSchedule(user: { id: string; role: string }, body: unknown): Promise<ScheduledTask> {
  const input = inputSchema.parse(body);
  const when = timetable(input);
  const skills = await loadTaskSkills(user.id, input.skillIds);
  if (skills.length !== new Set(input.skillIds).size) throw new ScheduleError("One of those skills is not on this account.");
  const max = user.role === "admin" ? MAX_SCHEDULES_OPERATOR : MAX_SCHEDULES;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    // An account's schedules are counted and added one at a time (two tabs can't pass the limit).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`curialy-schedules:${user.id}`]);
    const { rows: [count] } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM curialy.scheduled_tasks WHERE user_id = $1", [user.id]);
    if (count.n >= max) throw new ScheduleError(`An account can keep ${max} schedules. Delete one to add another.`, 409);
    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO curialy.scheduled_tasks (user_id, title, prompt, cron_expression, interval_hours, time_zone, mode, model_id, repo, repo_branch, skill_ids, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13) RETURNING id`,
      [user.id, input.title, input.prompt, when.cron, when.intervalHours, input.timeZone, input.mode, input.model, input.repo ?? null, input.repo ? input.repoBranch ?? null : null, JSON.stringify(skills.map(skill => skill.id)), input.enabled, when.next],
    );
    await client.query("COMMIT");
    return scheduleView(row.id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** A change: fields left out stay. A new timetable (or turning it back on) sets the next run from now. */
export async function updateSchedule(userId: string, id: string, body: unknown): Promise<ScheduledTask> {
  const row = await ownSchedule(userId, id);
  const patch = patchSchema.parse(body ?? {});
  const merged: Input = {
    title: patch.title ?? row.title, prompt: patch.prompt ?? row.prompt, timeZone: patch.timeZone ?? row.time_zone, mode: patch.mode ?? row.mode,
    model: patch.model ?? row.model_id ?? "auto", repo: patch.repo === undefined ? row.repo : patch.repo, repoBranch: patch.repoBranch === undefined ? row.repo_branch : patch.repoBranch,
    skillIds: patch.skillIds ?? row.skill_ids ?? [], enabled: patch.enabled ?? row.enabled,
    // A new cron replaces an interval and the other way round.
    cron: patch.cron !== undefined || patch.intervalHours !== undefined ? patch.cron ?? null : row.cron_expression,
    intervalHours: patch.cron !== undefined || patch.intervalHours !== undefined ? patch.intervalHours ?? null : row.interval_hours,
  };
  const when = timetable(merged);
  const retimed = merged.cron !== row.cron_expression || merged.intervalHours !== row.interval_hours || merged.timeZone !== row.time_zone || (merged.enabled && !row.enabled);
  const skills = patch.skillIds ? await loadTaskSkills(userId, merged.skillIds) : null;
  if (skills && skills.length !== new Set(merged.skillIds).size) throw new ScheduleError("One of those skills is not on this account.");
  await query(
    `UPDATE curialy.scheduled_tasks SET title = $2, prompt = $3, cron_expression = $4, interval_hours = $5, time_zone = $6, mode = $7, model_id = $8, repo = $9, repo_branch = $10,
       skill_ids = $11::jsonb, enabled = $12, next_run_at = $13, failures = CASE WHEN $12 AND NOT enabled THEN 0 ELSE failures END,
       disabled_reason = CASE WHEN $12 THEN NULL ELSE disabled_reason END, updated_at = now() WHERE id = $1`,
    [row.id, merged.title, merged.prompt, when.cron, when.intervalHours, merged.timeZone, merged.mode, merged.model, merged.repo ?? null, merged.repo ? merged.repoBranch ?? null : null,
      JSON.stringify(skills ? skills.map(skill => skill.id) : merged.skillIds), merged.enabled, retimed ? when.next : row.next_run_at],
  );
  return scheduleView(row.id);
}

export async function deleteSchedule(userId: string, id: string) {
  const row = await ownSchedule(userId, id);
  await query("DELETE FROM curialy.scheduled_tasks WHERE id = $1", [row.id]);
}

// ---- Starting one ----

/** The task a schedule starts: what it says, with the skills still on the account. */
async function requestOf(row: Row): Promise<CreateTaskRequest> {
  const skills = await loadTaskSkills(row.user_id, row.skill_ids ?? []);
  return {
    prompt: row.prompt, model: row.model_id ?? "auto", mode: row.mode, effort: "medium", webSearch: false, attachmentIds: [],
    repo: row.mode === "agent" ? row.repo : null, repoBranch: row.mode === "agent" ? row.repo_branch : null, skillIds: skills.map(skill => skill.id), tools: [],
  };
}

/** counts: a start that didn't happen and counts toward turning the schedule off (not "another task was running"). */
export type FireResult = { outcome: ScheduleRun["outcome"]; taskId: string | null; detail: string | null; counts?: boolean };

const recordRun = (scheduleId: string, scheduledFor: Date, result: FireResult) =>
  query("INSERT INTO curialy.scheduled_task_runs (schedule_id, task_id, scheduled_for, outcome, detail) VALUES ($1, $2, $3, $4, $5)", [scheduleId, result.taskId, scheduledFor, result.outcome, result.detail]);

/**
 * Starts the schedule's task now, as its account would (the same admission: credits, one run at a
 * time, the sandbox), records the attempt, and keeps count of starts that didn't happen in a row
 * (byUser: the account pressed Run now, so a refusal doesn't count toward turning it off).
 */
export async function fireSchedule(row: Row, scheduledFor: Date, opts: { byUser?: boolean } = {}): Promise<FireResult> {
  const { rows: [user] } = await query<{ id: string; role: string; banned_at: Date | null }>("SELECT id, role, banned_at FROM curialy.users WHERE id = $1", [row.user_id]);
  let result: FireResult;
  if (!user || user.banned_at) {
    result = { outcome: "skipped", taskId: null, detail: "The account can't start tasks.", counts: true };
  } else {
    result = await oneAtATime(user.id, async (): Promise<FireResult> => {
      const refusal = await admissionRefusal(user);
      if (refusal) return { outcome: "skipped", taskId: null, detail: brandText(refusal.error), counts: refusal.code !== "busy" };
      try {
        const taskId = await startTask(await requestOf(row), [], { userId: user.id, operator: user.role === "admin" });
        return { outcome: "started", taskId, detail: null };
      } catch (error) {
        return { outcome: "failed", taskId: null, detail: brandText(error instanceof Error ? error.message : "The task couldn't start."), counts: true };
      }
    });
  }
  await recordRun(row.id, scheduledFor, result);
  if (result.outcome === "started" && result.taskId) {
    await appendTaskEvent(result.taskId, { type: "notice", level: "info", message: `Started by your schedule "${row.title}" (${describeSchedule({ cron: row.cron_expression, intervalHours: row.interval_hours, timeZone: row.time_zone })}).` }).catch(() => undefined);
    await query("UPDATE curialy.scheduled_tasks SET failures = 0, updated_at = now() WHERE id = $1", [row.id]);
  } else if (!opts.byUser && result.counts) {
    const { rows: [after] } = await query<{ failures: number }>("UPDATE curialy.scheduled_tasks SET failures = failures + 1, updated_at = now() WHERE id = $1 RETURNING failures", [row.id]);
    if (after && after.failures >= MAX_SCHEDULE_FAILURES) {
      await query(
        "UPDATE curialy.scheduled_tasks SET enabled = false, disabled_reason = $2, updated_at = now() WHERE id = $1",
        [row.id, `Turned off after ${MAX_SCHEDULE_FAILURES} runs in a row couldn't start. The last one: ${result.detail ?? "it didn't start."}`],
      );
    }
  }
  return { outcome: result.outcome, taskId: result.taskId, detail: result.detail };
}

/** Run now: starts the schedule's task at once; its timetable stays as it is. */
export async function runScheduleNow(userId: string, id: string) {
  const row = await ownSchedule(userId, id);
  return fireSchedule(row, new Date(), { byUser: true });
}

/**
 * Claims the most overdue enabled schedule (none other worker holds), moves it to its next time
 * and returns it with the time it was due. A schedule missed while the server was down runs once,
 * not once per missed time.
 */
async function claimDue(client: PoolClient): Promise<{ row: Row; dueAt: Date } | null> {
  await client.query("BEGIN");
  try {
    const { rows: [row] } = await client.query<Row>(
      `SELECT ${COLUMNS} FROM curialy.scheduled_tasks WHERE enabled AND next_run_at <= now() ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const now = Date.now();
    const next = nextRunAt({ cron: row.cron_expression, intervalHours: row.interval_hours, timeZone: row.time_zone }, now, row.next_run_at.getTime());
    if (next === null) {
      await client.query("UPDATE curialy.scheduled_tasks SET enabled = false, disabled_reason = $2, updated_at = now() WHERE id = $1", [row.id, "Its timetable doesn't come round again."]);
    } else {
      await client.query("UPDATE curialy.scheduled_tasks SET next_run_at = $2, last_run_at = now(), updated_at = now() WHERE id = $1", [row.id, new Date(next)]);
    }
    await client.query("COMMIT");
    return { row, dueAt: row.next_run_at };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** One tick: starts up to PER_TICK due schedules (none while the server is restarting). */
export async function runDueSchedules(): Promise<number> {
  if (isDraining()) return 0;
  let started = 0;
  for (let count = 0; count < PER_TICK; count++) {
    const client = await db().connect();
    let claimed: Awaited<ReturnType<typeof claimDue>>;
    try {
      claimed = await claimDue(client);
    } finally {
      client.release();
    }
    if (!claimed) break;
    const result = await fireSchedule(claimed.row, claimed.dueAt);
    if (result.outcome === "started") started++;
  }
  return started;
}

let ticking = false;
/** Starts the scheduler (once per process); the returned function stops it. */
export function startScheduler() {
  const tick = () => {
    if (ticking) return;
    ticking = true;
    void runDueSchedules()
      .then(started => { if (started) console.log(`[schedules] started ${started} scheduled task(s)`); })
      .catch(error => console.error("[schedules] tick failed:", error instanceof Error ? error.message : error))
      .finally(() => { ticking = false; });
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

// ---- Routes (/api/agent/schedules) ----

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  fn(req, res).catch(error => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
    if (error instanceof ScheduleError) return res.status(error.status).json({ error: error.message });
    console.error("[schedules]", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Something went wrong. Try again." });
  });
};

export function schedulesRouter() {
  const router = Router();
  router.use(requireUser);

  router.get("/", handle(async (req, res) => {
    const user = accountOf(req);
    res.json({ schedules: await listSchedules(user.id), limits: { max: user.role === "admin" ? MAX_SCHEDULES_OPERATOR : MAX_SCHEDULES, minIntervalHours: MIN_INTERVAL_HOURS, maxIntervalHours: MAX_INTERVAL_HOURS } });
  }));

  router.post("/", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`schedules:${user.id}`, 60)) return res.status(429).json({ error: "Too many changes in a row. Wait a few minutes, then try again." });
    res.status(201).json({ schedule: await createSchedule(user, req.body) });
  }));

  router.patch("/:id", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`schedules:${user.id}`, 60)) return res.status(429).json({ error: "Too many changes in a row. Wait a few minutes, then try again." });
    res.json({ schedule: await updateSchedule(user.id, String(req.params.id), req.body) });
  }));

  router.delete("/:id", handle(async (req, res) => {
    await deleteSchedule(accountOf(req).id, String(req.params.id));
    res.json({ deleted: true });
  }));

  // Starts the task now (same rules as any start); the timetable is unchanged.
  router.post("/:id/run", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`schedules-run:${user.id}`, 20)) return res.status(429).json({ error: "Too many runs in a row. Wait a few minutes, then try again." });
    const result = await runScheduleNow(user.id, String(req.params.id));
    const schedule = await scheduleView(String(req.params.id));
    if (result.outcome !== "started") return res.status(409).json({ ...result, error: result.detail ?? "The task didn't start.", schedule });
    res.status(201).json({ ...result, schedule });
  }));

  return router;
}
