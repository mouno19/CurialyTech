import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SCHEDULE_FAILURES, MAX_SCHEDULES } from "@shared/schedules";

// Scheduled tasks: what a schedule may be, how a due one is claimed and moved to its next time, and
// what starting it does (the same admission as any task; skipped and failed starts are recorded,
// and enough in a row turn it off). The tables are an in-memory stand-in matched by statement text.

type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  schedules: new Map<string, Row>(),
  runs: [] as Row[],
  users: new Map<string, Row>(),
  notices: [] as { taskId: string; message: string }[],
  refusal: null as null | { status: number; error: string; code: string },
  startError: null as null | Error,
  started: [] as Row[],
  skills: new Set<string>(),
  unexpected: [] as string[],
  ids: 0,
}));

vi.mock("./db/pg", () => {
  const run = async (sql: string, values: any[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    const rows = (list: Row[]) => ({ rows: list.map(row => ({ ...row })), rowCount: list.length });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text) || text.startsWith("SELECT pg_advisory_xact_lock")) return rows([]);
    if (text.startsWith("SELECT count(*)::int AS n FROM curialy.scheduled_tasks WHERE user_id = $1")) return rows([{ n: [...db.schedules.values()].filter(row => row.user_id === values[0]).length }]);
    if (text.startsWith("INSERT INTO curialy.scheduled_tasks")) {
      const [user_id, title, prompt, cron_expression, interval_hours, time_zone, mode, model_id, repo, repo_branch, skills, enabled, next_run_at] = values;
      const id = `00000000-0000-4000-8000-${String(++db.ids).padStart(12, "0")}`;
      const now = new Date();
      db.schedules.set(id, { id, user_id, title, prompt, cron_expression, interval_hours, time_zone, mode, model_id, repo, repo_branch, skill_ids: JSON.parse(skills), enabled, failures: 0, disabled_reason: null, next_run_at, last_run_at: null, created_at: now, updated_at: now });
      return rows([{ id }]);
    }
    if (text.startsWith("SELECT") && text.includes("FROM curialy.scheduled_tasks WHERE id = $1 AND user_id = $2")) return rows([...db.schedules.values()].filter(row => row.id === values[0] && row.user_id === values[1]));
    if (text.startsWith("SELECT") && text.includes("FROM curialy.scheduled_tasks WHERE id = $1")) return rows([...db.schedules.values()].filter(row => row.id === values[0]));
    if (text.includes("FROM curialy.scheduled_tasks WHERE user_id = $1 ORDER BY created_at")) return rows([...db.schedules.values()].filter(row => row.user_id === values[0]));
    if (text.includes("FROM curialy.scheduled_task_runs r WHERE schedule_id = ANY($1::uuid[])")) return rows(db.runs.filter(row => values[0].includes(row.schedule_id)).sort((a, b) => b.id - a.id));
    if (text.includes("WHERE enabled AND next_run_at <= now() ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED")) {
      const due = [...db.schedules.values()].filter(row => row.enabled && row.next_run_at.getTime() <= Date.now() && !row.claimed).sort((a, b) => a.next_run_at - b.next_run_at);
      return rows(due.slice(0, 1));
    }
    if (text.startsWith("UPDATE curialy.scheduled_tasks SET next_run_at = $2, last_run_at = now()")) {
      Object.assign(db.schedules.get(values[0])!, { next_run_at: values[1], last_run_at: new Date() });
      return rows([]);
    }
    if (text.startsWith("UPDATE curialy.scheduled_tasks SET enabled = false, disabled_reason = $2")) {
      Object.assign(db.schedules.get(values[0])!, { enabled: false, disabled_reason: values[1] });
      return rows([]);
    }
    if (text.startsWith("UPDATE curialy.scheduled_tasks SET failures = 0")) {
      db.schedules.get(values[0])!.failures = 0;
      return rows([]);
    }
    if (text.startsWith("UPDATE curialy.scheduled_tasks SET failures = failures + 1")) {
      const row = db.schedules.get(values[0])!;
      row.failures++;
      return rows([{ failures: row.failures }]);
    }
    if (text.startsWith("UPDATE curialy.scheduled_tasks SET title = $2")) {
      const [id, title, prompt, cron_expression, interval_hours, time_zone, mode, model_id, repo, repo_branch, skills, enabled, next_run_at] = values;
      const row = db.schedules.get(id)!;
      const reenabled = enabled && !row.enabled;
      Object.assign(row, { title, prompt, cron_expression, interval_hours, time_zone, mode, model_id, repo, repo_branch, skill_ids: JSON.parse(skills), enabled, next_run_at, failures: reenabled ? 0 : row.failures, disabled_reason: enabled ? null : row.disabled_reason });
      return rows([]);
    }
    if (text.startsWith("DELETE FROM curialy.scheduled_tasks WHERE id = $1")) {
      db.schedules.delete(values[0]);
      return rows([]);
    }
    if (text.startsWith("SELECT id, role, banned_at FROM curialy.users WHERE id = $1")) return rows(db.users.has(values[0]) ? [db.users.get(values[0])!] : []);
    if (text.startsWith("INSERT INTO curialy.scheduled_task_runs")) {
      const [schedule_id, task_id, scheduled_for, outcome, detail] = values;
      db.runs.push({ id: db.runs.length + 1, schedule_id, task_id, scheduled_for, started_at: new Date(), outcome, detail });
      return rows([]);
    }
    db.unexpected.push(text.slice(0, 140));
    throw new Error(`unexpected query: ${text.slice(0, 140)}`);
  };
  return { query: vi.fn(run), db: () => ({ connect: async () => ({ query: run, release: () => undefined }) }) };
});
vi.mock("./agent/admission", () => ({ admissionRefusal: vi.fn(async () => db.refusal), oneAtATime: (_user: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("./agent/runner", () => ({
  isDraining: () => false,
  startTask: vi.fn(async (req: Row, _attachments: unknown[], opts: Row) => {
    if (db.startError) throw db.startError;
    db.started.push({ req, opts });
    return `10000000-0000-4000-8000-${String(db.started.length).padStart(12, "0")}`;
  }),
}));
vi.mock("./agent/saved-skills", () => ({ loadTaskSkills: async (_user: string, ids: string[]) => ids.filter(id => db.skills.has(id)).map(id => ({ id })) }));
vi.mock("./agent/events", () => ({ appendTaskEvent: async (taskId: string, body: { message: string }) => { db.notices.push({ taskId, message: body.message }); } }));

const schedules = await import("./agent/schedules");

const ADA = { id: "u-ada", role: "user" };
const SKILL = "20000000-0000-4000-8000-000000000001";
const valid = { title: "Morning issues", prompt: "List the open issues in my repository and summarise them.", cron: "0 9 * * 1-5", timeZone: "Europe/Berlin" };

beforeEach(() => {
  db.schedules.clear();
  db.runs.length = 0;
  db.users.clear();
  db.users.set(ADA.id, { id: ADA.id, role: "user", banned_at: null });
  db.notices.length = 0;
  db.refusal = null;
  db.startError = null;
  db.started.length = 0;
  db.skills = new Set([SKILL]);
  db.unexpected.length = 0;
});

describe("creating and changing a schedule", () => {
  it("takes a cron in the account's time zone and sets its first run", async () => {
    const created = await schedules.createSchedule(ADA, { ...valid, skillIds: [SKILL] });
    expect(created).toMatchObject({ title: "Morning issues", cron: "0 9 * * 1-5", intervalHours: null, timeZone: "Europe/Berlin", mode: "agent", model: "auto", enabled: true, skillIds: [SKILL], runs: [] });
    // 09:00 in Berlin, on a weekday.
    const first = new Date(created.nextRunAt);
    expect(first.getTime()).toBeGreaterThan(Date.now());
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", weekday: "short" }).format(first)).toMatch(/^(Mon|Tue|Wed|Thu|Fri) 09:00$/);
  });

  it("refuses a timetable that isn't exactly one of cron and interval, too often, or in an unknown zone, a skill that isn't the account's, and too many schedules", async () => {
    await expect(schedules.createSchedule(ADA, { ...valid, cron: null })).rejects.toThrow("Choose when it runs");
    await expect(schedules.createSchedule(ADA, { ...valid, intervalHours: 6 })).rejects.toThrow("Choose when it runs");
    await expect(schedules.createSchedule(ADA, { ...valid, cron: "*/10 * * * *" })).rejects.toThrow("at most once an hour");
    await expect(schedules.createSchedule(ADA, { ...valid, cron: null, intervalHours: 0 })).rejects.toThrow();
    await expect(schedules.createSchedule(ADA, { ...valid, timeZone: "Mars/Olympus" })).rejects.toThrow("time zone");
    await expect(schedules.createSchedule(ADA, { ...valid, model: "not-a-model" })).rejects.toThrow("model");
    await expect(schedules.createSchedule(ADA, { ...valid, skillIds: ["20000000-0000-4000-8000-000000000009"] })).rejects.toThrow("not on this account");
    for (let n = 0; n < MAX_SCHEDULES; n++) await schedules.createSchedule(ADA, valid);
    await expect(schedules.createSchedule(ADA, valid)).rejects.toMatchObject({ status: 409 });
    expect(db.unexpected).toEqual([]);
  });

  it("changes only what is sent, moves the next run with a new timetable, and is the owner's alone", async () => {
    const created = await schedules.createSchedule(ADA, valid);
    const renamed = await schedules.updateSchedule(ADA.id, created.id, { title: "Weekday issues" });
    expect(renamed).toMatchObject({ title: "Weekday issues", cron: "0 9 * * 1-5", nextRunAt: created.nextRunAt });
    const hourly = await schedules.updateSchedule(ADA.id, created.id, { intervalHours: 3 });
    expect(hourly).toMatchObject({ cron: null, intervalHours: 3 });
    expect(Date.parse(hourly.nextRunAt) - Date.now()).toBeGreaterThan(2.9 * 3_600_000);
    await expect(schedules.updateSchedule("u-grace", created.id, { title: "Mine now" })).rejects.toMatchObject({ status: 404 });
    await expect(schedules.deleteSchedule("u-grace", created.id)).rejects.toMatchObject({ status: 404 });
    await schedules.deleteSchedule(ADA.id, created.id);
    expect(await schedules.listSchedules(ADA.id)).toEqual([]);
  });
});

describe("running when due", () => {
  /** A schedule that was due a minute ago. */
  async function due(patch: Row = {}) {
    const created = await schedules.createSchedule(ADA, { ...valid, cron: null, intervalHours: 6, repo: "octo/site", skillIds: [SKILL], ...patch });
    const row = db.schedules.get(created.id)!;
    row.next_run_at = new Date(Date.now() - 60_000);
    return row;
  }

  it("starts the task as its account would, moves to the next time on the cadence, and records it", async () => {
    const row = await due();
    const dueAt = row.next_run_at.getTime();
    expect(await schedules.runDueSchedules()).toBe(1);
    expect(db.started).toEqual([{ req: expect.objectContaining({ prompt: valid.prompt, model: "auto", mode: "agent", repo: "octo/site", skillIds: [SKILL], attachmentIds: [] }), opts: { userId: ADA.id, operator: false } }]);
    expect(row.next_run_at.getTime()).toBe(dueAt + 6 * 3_600_000);
    expect(db.runs).toEqual([expect.objectContaining({ schedule_id: row.id, task_id: expect.any(String), outcome: "started", detail: null })]);
    expect(db.notices[0].message).toBe('Started by your schedule "Morning issues" (Every 6 hours).');
    // Not due again until then.
    expect(await schedules.runDueSchedules()).toBe(0);
    expect(db.unexpected).toEqual([]);
  });

  it("skips a run while the account's other task is running, without counting it against the schedule", async () => {
    const row = await due();
    db.refusal = { status: 429, error: "You already have a task running.", code: "busy" };
    await schedules.runDueSchedules();
    expect(db.started).toHaveLength(0);
    expect(db.runs.at(-1)).toMatchObject({ outcome: "skipped", detail: "You already have a task running." });
    expect(row.failures).toBe(0);
  });

  it("turns itself off after enough starts in a row that didn't happen, saying why", async () => {
    const row = await due();
    db.refusal = { status: 402, error: "Your account has no credits right now.", code: "no_credits" };
    for (let n = 1; n <= MAX_SCHEDULE_FAILURES; n++) {
      row.next_run_at = new Date(Date.now() - 1000);
      await schedules.runDueSchedules();
      expect(row.failures).toBe(n);
    }
    expect(row).toMatchObject({ enabled: false, disabled_reason: expect.stringContaining("Your account has no credits right now.") });
    // Turning it back on starts the count again.
    const back = await schedules.updateSchedule(ADA.id, row.id, { enabled: true });
    expect(back).toMatchObject({ enabled: true, failures: 0, disabledReason: null });
  });

  it("records a start that failed, and skips an account that can't start tasks", async () => {
    const row = await due();
    db.startError = new Error("Curialy is running as many tasks as it can right now.");
    await schedules.runDueSchedules();
    expect(db.runs.at(-1)).toMatchObject({ outcome: "failed", detail: "Curialy is running as many tasks as it can right now." });
    db.startError = null;
    db.users.get(ADA.id)!.banned_at = new Date();
    row.next_run_at = new Date(Date.now() - 1000);
    await schedules.runDueSchedules();
    expect(db.runs.at(-1)).toMatchObject({ outcome: "skipped", detail: "The account can't start tasks." });
    expect(row.failures).toBe(2);
  });

  it("runs now on request without moving the timetable, and leaves out a skill deleted since", async () => {
    const created = await schedules.createSchedule(ADA, { ...valid, skillIds: [SKILL] });
    db.skills.clear();
    const result = await schedules.runScheduleNow(ADA.id, created.id);
    expect(result).toMatchObject({ outcome: "started", taskId: expect.any(String) });
    expect(db.started[0].req.skillIds).toEqual([]);
    expect(db.schedules.get(created.id)!.next_run_at.toISOString()).toBe(created.nextRunAt);
    // A refusal on Run now is the account's own doing: it isn't counted.
    db.refusal = { status: 402, error: "No credits.", code: "no_credits" };
    expect(await schedules.runScheduleNow(ADA.id, created.id)).toMatchObject({ outcome: "skipped", detail: "No credits." });
    expect(db.schedules.get(created.id)!.failures).toBe(0);
    await expect(schedules.runScheduleNow("u-grace", created.id)).rejects.toMatchObject({ status: 404 });
  });
});
