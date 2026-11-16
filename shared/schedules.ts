// Scheduled tasks: a prompt an account runs by itself on a timetable, every few hours or at set
// times (a 5-field cron expression read in the account's time zone). Shared by the server (which
// starts them when due) and the client (which shows the next run while the form is filled in).
// No runtime dependencies: time zones go through Intl.

/** Hours between runs of an interval schedule. */
export const MIN_INTERVAL_HOURS = 1;
export const MAX_INTERVAL_HOURS = 720;
/** Schedules an account may keep (the operator's limit is higher). */
export const MAX_SCHEDULES = 10;
export const MAX_SCHEDULES_OPERATOR = 50;
/** A schedule that couldn't start this many times in a row turns itself off. */
export const MAX_SCHEDULE_FAILURES = 5;

export type ScheduleRun = {
  id: string;
  /** The task it started (null when it was skipped, failed, or the task was deleted since). */
  taskId: string | null;
  scheduledFor: string;
  startedAt: string;
  outcome: "started" | "skipped" | "failed";
  /** Why it was skipped or failed: safe to show the account. */
  detail: string | null;
};

export type ScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  /** Exactly one of these is set: a 5-field cron expression, or hours between runs. */
  cron: string | null;
  intervalHours: number | null;
  timeZone: string;
  mode: "agent" | "chat";
  /** "auto" or a model id. */
  model: string;
  repo: string | null;
  repoBranch: string | null;
  skillIds: string[];
  enabled: boolean;
  /** Starts that failed or were skipped in a row; disabledReason: why it turned itself off. */
  failures: number;
  disabledReason: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The latest attempts, newest first. */
  runs: ScheduleRun[];
};

/** What the form sends (a change sends only what changed). */
export type ScheduleInput = {
  title: string;
  prompt: string;
  cron?: string | null;
  intervalHours?: number | null;
  timeZone: string;
  mode?: "agent" | "chat";
  model?: string;
  repo?: string | null;
  repoBranch?: string | null;
  skillIds?: string[];
  enabled?: boolean;
};

/** The prompt in "/schedule <prompt>" ("" for a bare /schedule), or null when the text isn't one. */
export function scheduleQuery(text: string): string | null {
  const match = /^\/schedule(?::|\s|$)([\s\S]*)$/i.exec(text.trim());
  return match ? match[1].trim() : null;
}

// ---- Cron ----

/** Sorted allowed values of each field; dom/dow "restricted": the field isn't "*". */
export type CronSpec = { minutes: number[]; hours: number[]; days: number[]; months: number[]; weekdays: number[]; daysRestricted: boolean; weekdaysRestricted: boolean };

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function parseField(field: string, min: number, max: number, names?: string[], nameBase = 0): number[] | null {
  const value = (text: string) => {
    const upper = text.toUpperCase();
    const named = names ? names.indexOf(upper) : -1;
    if (named >= 0) return named + nameBase;
    return /^\d+$/.test(text) ? Number(text) : NaN;
  };
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    if (part.split("/").length > 2) return null;
    const step = stepText === undefined ? 1 : /^\d+$/.test(stepText) ? Number(stepText) : NaN;
    if (!(step >= 1)) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      from = value(a);
      to = value(b);
    } else {
      from = value(range);
      to = stepText === undefined ? from : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) return null;
    for (let n = from; n <= to; n += step) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * A 5-field cron expression (minute hour day-of-month month day-of-week; numbers, *, lists, ranges,
 * steps, JAN–DEC and SUN–SAT; 0 and 7 are Sunday), or why it isn't one. The minute must be a single
 * number, so a schedule runs at most once an hour.
 */
export function parseCron(expression: string): { spec: CronSpec } | { error: string } {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return { error: "A cron expression has five fields: minute, hour, day of month, month and day of week (e.g. 0 9 * * 1-5)." };
  const [minute, hour, day, month, weekday] = fields;
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return { error: "The minute must be one number from 0 to 59: a schedule runs at most once an hour." };
  const hours = parseField(hour, 0, 23);
  const days = parseField(day, 1, 31);
  const months = parseField(month, 1, 12, MONTH_NAMES, 1);
  const weekdays = parseField(weekday, 0, 7, DAY_NAMES);
  if (!hours) return { error: "The hour field isn't valid (0–23, *, lists, ranges or steps)." };
  if (!days) return { error: "The day-of-month field isn't valid (1–31, *, lists, ranges or steps)." };
  if (!months) return { error: "The month field isn't valid (1–12 or JAN–DEC, *, lists, ranges or steps)." };
  if (!weekdays) return { error: "The day-of-week field isn't valid (0–7 or SUN–SAT, *, lists, ranges or steps)." };
  return {
    spec: {
      minutes: [Number(minute)], hours, days, months, weekdays: [...new Set(weekdays.map(dayOfWeek => dayOfWeek % 7))].sort((a, b) => a - b),
      daysRestricted: day !== "*", weekdaysRestricted: weekday !== "*",
    },
  };
}

// ---- Time zones ----

/** The time zone name works in Intl (an IANA name such as Europe/Berlin, or UTC). */
export function validTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallFormatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The wall clock in `timeZone` at an instant. */
export function wallClock(instant: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of wallFormatter(timeZone).formatToParts(instant)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

/** The instant a wall-clock time in `timeZone` names, or null when it doesn't exist there (a clock change skips it). */
function instantOf(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number | null {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const wall = wallClock(instant, timeZone);
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - instant;
  };
  // The offsets a day either side cover both sides of a clock change: a time it skips matches
  // neither, a time it repeats matches both (the earlier counts).
  const DAY = 86_400_000;
  for (const guess of [...new Set([naive - offsetAt(naive - DAY), naive - offsetAt(naive + DAY)])].sort((a, b) => a - b)) {
    const wall = wallClock(guess, timeZone);
    if (wall.year === year && wall.month === month && wall.day === day && wall.hour === hour && wall.minute === minute) return guess;
  }
  return null;
}

/** The first time after `after` (ms) that the cron spec names in `timeZone`, within about 400 days (null: none). */
export function nextCronRun(spec: CronSpec, timeZone: string, after: number): number | null {
  const today = wallClock(after, timeZone);
  for (let offset = 0; offset < 400; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (!spec.months.includes(month)) continue;
    // Cron's rule: with both day fields restricted, either may match.
    const byDay = spec.days.includes(day);
    const byWeekday = spec.weekdays.includes(date.getUTCDay());
    const matches = spec.daysRestricted && spec.weekdaysRestricted ? byDay || byWeekday : spec.daysRestricted ? byDay : spec.weekdaysRestricted ? byWeekday : true;
    if (!matches) continue;
    for (const hour of spec.hours) {
      for (const minute of spec.minutes) {
        const instant = instantOf(year, month, day, hour, minute, timeZone);
        if (instant !== null && instant > after) return instant;
      }
    }
  }
  return null;
}

/**
 * When a schedule runs next, after `after` (ms). An interval schedule keeps its cadence from the run
 * it was due for (`from`): the first of from + k × interval that is after `after`.
 */
export function nextRunAt(schedule: { cron: string | null; intervalHours: number | null; timeZone: string }, after: number, from = after): number | null {
  if (schedule.cron) {
    const parsed = parseCron(schedule.cron);
    return "spec" in parsed ? nextCronRun(parsed.spec, schedule.timeZone, after) : null;
  }
  const step = (schedule.intervalHours ?? 0) * 3_600_000;
  if (!(step > 0)) return null;
  if (from > after) return from;
  return from + (Math.floor((after - from) / step) + 1) * step;
}

// ---- In words ----

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY_WORDS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Every 6 hours", "Every day at 09:00", "Weekdays at 09:00", "Mondays at 08:30", or the expression itself, with the time zone. */
export function describeSchedule(schedule: { cron: string | null; intervalHours: number | null; timeZone: string }): string {
  if (!schedule.cron) {
    const hours = schedule.intervalHours ?? 0;
    return hours === 1 ? "Every hour" : hours % 24 === 0 ? (hours === 24 ? "Every day" : `Every ${hours / 24} days`) : `Every ${hours} hours`;
  }
  const parsed = parseCron(schedule.cron);
  const zone = ` (${schedule.timeZone})`;
  if (!("spec" in parsed)) return `${schedule.cron}${zone}`;
  const { spec } = parsed;
  const [, hourField, dayField, monthField, weekdayField] = schedule.cron.trim().split(/\s+/);
  if (spec.hours.length === 1 && dayField === "*" && monthField === "*") {
    const at = `at ${pad(spec.hours[0])}:${pad(spec.minutes[0])}`;
    if (weekdayField === "*") return `Every day ${at}${zone}`;
    if (spec.weekdays.join(",") === "1,2,3,4,5") return `Weekdays ${at}${zone}`;
    if (spec.weekdays.join(",") === "0,6") return `Weekends ${at}${zone}`;
    if (spec.weekdays.length === 1) return `${WEEKDAY_WORDS[spec.weekdays[0]]} ${at}${zone}`;
  }
  if (hourField === "*" && dayField === "*" && monthField === "*" && weekdayField === "*") return `Every hour at :${pad(spec.minutes[0])}${zone}`;
  return `Cron ${schedule.cron.trim()}${zone}`;
}
