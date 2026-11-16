import { describe, expect, it } from "vitest";
import { describeSchedule, nextCronRun, nextRunAt, parseCron, validTimeZone, type CronSpec } from "./schedules";

// Schedules: the cron fields a schedule may use (at most once an hour), the next time one runs in
// the account's time zone (clock changes included), interval cadence, and how a timetable reads.

const spec = (expression: string): CronSpec => {
  const parsed = parseCron(expression);
  if (!("spec" in parsed)) throw new Error(parsed.error);
  return parsed.spec;
};
const next = (expression: string, timeZone: string, after: string) => {
  const at = nextCronRun(spec(expression), timeZone, Date.parse(after));
  return at === null ? null : new Date(at).toISOString();
};

describe("parseCron", () => {
  it("reads numbers, lists, ranges, steps and names, Sunday as 0 or 7", () => {
    expect(spec("0 9 * * 1-5")).toMatchObject({ minutes: [0], hours: [9], weekdays: [1, 2, 3, 4, 5], daysRestricted: false, weekdaysRestricted: true });
    expect(spec("30 8,12,18 * JAN-MAR MON,FRI")).toMatchObject({ hours: [8, 12, 18], months: [1, 2, 3], weekdays: [1, 5] });
    expect(spec("0 */6 * * 7").hours).toEqual([0, 6, 12, 18]);
    expect(spec("0 0 * * 7").weekdays).toEqual([0]);
    expect(spec("0 9-17/4 1,15 * *")).toMatchObject({ hours: [9, 13, 17], days: [1, 15], daysRestricted: true });
  });

  it("allows at most one run an hour, and says what's wrong", () => {
    expect(parseCron("*/5 * * * *")).toEqual({ error: expect.stringContaining("at most once an hour") });
    expect(parseCron("0,30 * * * *")).toEqual({ error: expect.stringContaining("at most once an hour") });
    expect(parseCron("0 9 * *")).toEqual({ error: expect.stringContaining("five fields") });
    expect(parseCron("0 24 * * *")).toEqual({ error: expect.stringContaining("hour field") });
    expect(parseCron("0 9 0 * *")).toEqual({ error: expect.stringContaining("day-of-month") });
    expect(parseCron("0 9 * 13 *")).toEqual({ error: expect.stringContaining("month field") });
    expect(parseCron("0 9 * * FUNDAY")).toEqual({ error: expect.stringContaining("day-of-week") });
    expect(parseCron("0 9-5 * * *")).toEqual({ error: expect.stringContaining("hour field") });
  });
});

describe("nextCronRun", () => {
  it("runs at the wall-clock time in the schedule's time zone, across a clock change", () => {
    // 09:00 in Berlin is 08:00 UTC in winter time, 07:00 UTC from 29 March 2026 (summer time).
    expect(next("0 9 * * *", "Europe/Berlin", "2026-03-27T12:00:00Z")).toBe("2026-03-28T08:00:00.000Z");
    expect(next("0 9 * * *", "Europe/Berlin", "2026-03-28T08:00:00Z")).toBe("2026-03-29T07:00:00.000Z");
    expect(next("0 9 * * *", "UTC", "2026-03-28T09:00:00Z")).toBe("2026-03-29T09:00:00.000Z");
  });

  it("skips a time the clock change leaves out, and takes the first of a time it repeats", () => {
    // 02:30 doesn't exist in Berlin on 29 March 2026 (01:59 is followed by 03:00).
    expect(next("30 2 * * *", "Europe/Berlin", "2026-03-28T03:00:00Z")).toBe("2026-03-30T00:30:00.000Z");
    // 02:30 happens twice on 25 October 2026: the first one counts.
    expect(next("30 2 * * *", "Europe/Berlin", "2026-10-24T12:00:00Z")).toBe("2026-10-25T00:30:00.000Z");
    expect(next("30 2 * * *", "Europe/Berlin", "2026-10-25T00:30:00Z")).toBe("2026-10-26T01:30:00.000Z");
  });

  it("follows weekdays, months, and cron's either-day rule when both day fields are set", () => {
    // Friday 13 November 2026, after 09:00: next weekday 09:00 is Monday.
    expect(next("0 9 * * 1-5", "UTC", "2026-11-13T10:00:00Z")).toBe("2026-11-16T09:00:00.000Z");
    // The 1st of the month or a Monday: Monday 30 November, then Tuesday 1 December.
    expect(next("0 0 1 * 1", "UTC", "2026-11-24T12:00:00Z")).toBe("2026-11-30T00:00:00.000Z");
    expect(next("0 0 1 * 1", "UTC", "2026-11-30T00:00:00Z")).toBe("2026-12-01T00:00:00.000Z");
    expect(next("0 12 29 2 *", "UTC", "2026-03-01T00:00:00Z")).toBeNull();
  });
});

describe("nextRunAt", () => {
  const HOUR = 3_600_000;
  const from = Date.parse("2026-11-16T09:00:00Z");
  it("keeps an interval's cadence from the time it was due, and runs a missed one once", () => {
    const every = { cron: null, intervalHours: 6, timeZone: "UTC" };
    expect(nextRunAt(every, from, from)).toBe(from + 6 * HOUR);
    // Down for 20 hours: one run now, then back on the 6-hour grid (not four catch-up runs).
    expect(nextRunAt(every, from + 20 * HOUR, from)).toBe(from + 24 * HOUR);
    expect(nextRunAt(every, from - HOUR, from)).toBe(from);
    expect(nextRunAt({ cron: null, intervalHours: null, timeZone: "UTC" }, from)).toBeNull();
    expect(nextRunAt({ cron: "0 9 * * *", intervalHours: null, timeZone: "UTC" }, from)).toBe(from + 24 * HOUR);
    expect(nextRunAt({ cron: "*/5 * * * *", intervalHours: null, timeZone: "UTC" }, from)).toBeNull();
  });
});

describe("in words", () => {
  it("names common timetables plainly and shows the rest as cron, with the time zone", () => {
    expect(describeSchedule({ cron: null, intervalHours: 1, timeZone: "UTC" })).toBe("Every hour");
    expect(describeSchedule({ cron: null, intervalHours: 6, timeZone: "UTC" })).toBe("Every 6 hours");
    expect(describeSchedule({ cron: null, intervalHours: 24, timeZone: "UTC" })).toBe("Every day");
    expect(describeSchedule({ cron: null, intervalHours: 48, timeZone: "UTC" })).toBe("Every 2 days");
    expect(describeSchedule({ cron: "0 9 * * *", intervalHours: null, timeZone: "Europe/Berlin" })).toBe("Every day at 09:00 (Europe/Berlin)");
    expect(describeSchedule({ cron: "0 9 * * 1-5", intervalHours: null, timeZone: "UTC" })).toBe("Weekdays at 09:00 (UTC)");
    expect(describeSchedule({ cron: "30 8 * * MON", intervalHours: null, timeZone: "UTC" })).toBe("Mondays at 08:30 (UTC)");
    expect(describeSchedule({ cron: "15 * * * *", intervalHours: null, timeZone: "UTC" })).toBe("Every hour at :15 (UTC)");
    expect(describeSchedule({ cron: "0 9 1 * *", intervalHours: null, timeZone: "UTC" })).toBe("Cron 0 9 1 * * (UTC)");
  });

  it("knows the time zones Intl knows", () => {
    expect(validTimeZone("Europe/Berlin")).toBe(true);
    expect(validTimeZone("UTC")).toBe(true);
    expect(validTimeZone("Mars/Olympus")).toBe(false);
    expect(validTimeZone("")).toBe(false);
  });
});
