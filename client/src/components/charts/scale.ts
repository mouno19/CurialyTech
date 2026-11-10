// Pure geometry and labels for the hand-built charts (no DOM, so they are tested in node): round
// axis ticks, thin bars, stacked segments split by surface gaps, rounded data ends, and which
// buckets get a time label.

/** Steps of 1, 2 and 5 times a power of ten (2.5 would put 0.025 on a cents axis, shown as "$0.03"). */
const STEPS = [1, 2, 5];

/** Drops float noise (0.30000000000000004) from a tick value. */
const clean = (value: number) => Number(value.toPrecision(12));

/** The smallest round step at or above `raw` (whole numbers when `integer`). */
function roundStep(raw: number, integer: boolean) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = STEPS.map(multiple => multiple * power).find(candidate => candidate >= raw - 1e-12) ?? 10 * power;
  return integer ? Math.max(1, Math.ceil(step)) : clean(step);
}

/** The next round step after `step`: 1 → 2 → 5 → 10. */
function nextStep(step: number) {
  const power = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const multiple = Math.round(step / power);
  return clean(multiple === 1 ? 2 * power : multiple === 2 ? 5 * power : 10 * power);
}

/**
 * Ticks from 0 to a round maximum at or above `max`, in at most `intervals` equal steps; whole
 * numbers only when the data are counts. [0] when there is nothing to scale.
 */
export function niceTicks(max: number, intervals = 4, integer = false, minStep = 0): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0];
  const step = Math.max(roundStep(max / Math.max(1, intervals), integer), minStep);
  const count = Math.max(1, Math.ceil(max / step - 1e-9));
  return Array.from({ length: count + 1 }, (_, index) => clean(index * step));
}

/**
 * Ticks whose labels all read differently in the caller's format: a format with cents shows 0.005
 * and 0.01 both as "$0.01", so the step grows until every label is distinct.
 */
export function ticksFor(max: number, intervals: number, integer: boolean, format: (value: number) => string): number[] {
  let ticks = niceTicks(max, intervals, integer);
  for (let tries = 0; tries < 6 && ticks.length > 1; tries++) {
    const labels = ticks.map(format);
    if (new Set(labels).size === labels.length) break;
    ticks = niceTicks(max, intervals, integer, nextStep(ticks[1]));
  }
  return ticks;
}

/** A reference line further above the data than this (as a multiple of the highest bar) is noted, not drawn. */
export const REFERENCE_REACH = 4;

/**
 * The y axis: its ticks, its top, and whether the reference line is drawn. A reference far above
 * the bars would squash them to slivers, so past REFERENCE_REACH the chart notes it instead.
 */
export function yDomain(dataMax: number, reference: number | null | undefined, intervals: number, integer: boolean, format: (value: number) => string) {
  const ref = typeof reference === "number" && Number.isFinite(reference) && reference > 0 ? reference : null;
  const drawn = ref !== null && ref <= dataMax * REFERENCE_REACH;
  const ticks = ticksFor(drawn && ref !== null ? Math.max(dataMax, ref) : dataMax, intervals, integer, format);
  return { ticks, max: ticks[ticks.length - 1], referenceDrawn: drawn };
}

/** Thin marks: at most 24px, about two thirds of the slot, and a surface gap of 2px or more between neighbours where the slot allows it. */
export function barWidth(slot: number) {
  if (!(slot > 0)) return 0;
  if (slot >= 6) return Math.min(24, slot - Math.max(2, slot * 0.34));
  return Math.max(1, slot - 1);
}

export type Segment = { y: number; height: number };

/**
 * One stacked bar's segments, bottom-up, in pixels (null for a zero value). The top of the bar is
 * exactly its total; each segment below another gives up `gap` px at its top for the surface gap.
 * A non-zero value is never thinner than `minPx`, so a small one stays visible.
 */
export function stackSegments(values: number[], pxPerUnit: number, baseline: number, gap = 2, minPx = 1): (Segment | null)[] {
  const last = values.findLastIndex(value => value > 0);
  let sum = 0;
  return values.map((value, index) => {
    if (!(value > 0)) return null;
    const bottom = baseline - sum * pxPerUnit;
    sum += value;
    const top = baseline - sum * pxPerUnit + (index < last ? gap : 0);
    const height = Math.max(minPx, bottom - top);
    return { y: bottom - height, height };
  });
}

/** Per-bucket totals of a stack. */
export const stackTotals = (rows: number[][]) => rows.map(values => values.reduce((sum, value) => sum + value, 0));

const n = (value: number) => clean(Math.round(value * 100) / 100);

/** SVG path for a bar with rounded top corners (its data end) and a square base on the baseline. */
export function roundedTop(x: number, y: number, width: number, height: number, radius = 4) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (r === 0) return `M${n(x)} ${n(y + height)}V${n(y)}H${n(x + width)}V${n(y + height)}Z`;
  return `M${n(x)} ${n(y + height)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}H${n(x + width - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + width)} ${n(y + r)}V${n(y + height)}Z`;
}

/** How many buckets apart time labels may sit. */
export const HOUR_STEPS = [1, 2, 3, 4, 6, 12, 24];
export const DAY_STEPS = [1, 2, 3, 7, 14, 30, 60, 90];

export type AxisMark = { index: number; width: number };

/**
 * Where a time label is drawn: centred under its bucket (the plot starts at `left`), kept inside
 * the svg [0, edge]. Time labels sit under the baseline, so they may reach into the y labels' gutter.
 */
export function labelCentre(index: number, width: number, left: number, slot: number, edge: number) {
  return Math.min(Math.max(left + (index + 0.5) * slot, width / 2), edge - width / 2);
}

/**
 * The first step with at most `most` labels that all clear their neighbours by `gap` px where
 * `centre` draws them (an end label pulled inside the chart can land on its neighbour).
 * `marks(step)` gives the labelled buckets and their widths ("Nov 30" next to "1"). The last
 * step when none fits.
 */
export function fitStep(steps: number[], gap: number, marks: (step: number) => AxisMark[], centre: (mark: AxisMark) => number, most = 12) {
  for (const step of steps) {
    const placed = marks(step);
    if (placed.length > most) continue;
    const clear = placed.every((mark, index) => {
      if (index === 0) return true;
      const before = placed[index - 1];
      return centre(mark) - mark.width / 2 - (centre(before) + before.width / 2) >= gap;
    });
    if (clear) return step;
  }
  return steps[steps.length - 1];
}

/**
 * Which buckets carry a time label. Hours: the round ones (a multiple of the step, so 00, 06, 12, 18).
 * Days: counted back from the latest, so today is always labelled.
 */
export function labelIndices(bucket: "hour" | "day", hours: number[], step: number) {
  const count = hours.length;
  if (!count) return [];
  if (bucket === "hour") {
    const round = hours.flatMap((hour, index) => (hour % step === 0 ? [index] : []));
    if (round.length) return round;
  }
  const indices: number[] = [];
  for (let index = count - 1; index >= 0; index -= Math.max(1, step)) indices.unshift(index);
  return indices;
}

/** Roughly how wide a label in the mono axis face is (Geist Mono advances 0.6em per character). */
export const textWidth = (text: string, size = 10.5) => text.length * size * 0.62;

// ---- Bucket labels ----

type LabelOptions = { locale?: string; timeZone?: string };

const zones = new Map<string, boolean>();

/** A time zone this browser can label with, or undefined (the viewer's clock): an unknown name would throw. */
export function usableTimeZone(zone: string | null | undefined): string | undefined {
  if (!zone) return undefined;
  let known = zones.get(zone);
  if (known === undefined) {
    try {
      known = Boolean(new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone);
    } catch {
      known = false;
    }
    zones.set(zone, known);
  }
  return known ? zone : undefined;
}

/** The viewer's own time zone, or null when the browser doesn't say. */
export function viewerTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions, { locale, timeZone }: LabelOptions) {
  const key = `${locale ?? ""}|${timeZone ?? ""}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) formatters.set(key, (found = new Intl.DateTimeFormat(locale, { ...options, timeZone })));
  return found;
}

/** The bucket's hour (0-23) on the viewer's clock, or in `timeZone`. */
export function bucketHour(iso: string, timeZone?: string) {
  const date = new Date(iso);
  if (!timeZone) return date.getHours();
  return Number(formatter({ hour: "numeric", hourCycle: "h23" }, { locale: "en-US", timeZone }).format(date)) % 24;
}

/**
 * A bucket's label. axis: short ("2 PM", the date at midnight, "Nov 9"); full: for tooltips and the
 * table ("Sun, Nov 9, 2:00 PM"; "Sun, Nov 9"). The viewer's locale and clock unless given.
 */
export function bucketLabel(iso: string, bucket: "hour" | "day", style: "axis" | "full", options: LabelOptions = {}) {
  const date = new Date(iso);
  if (style === "full") {
    return formatter(bucket === "hour"
      ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", month: "short", day: "numeric" }, options).format(date);
  }
  if (bucket === "hour" && bucketHour(iso, options.timeZone) !== 0) return formatter({ hour: "numeric" }, options).format(date);
  return formatter({ month: "short", day: "numeric" }, options).format(date);
}

/**
 * The axis labels for the chosen buckets. Hours: "2 PM", with the date at midnight. Days: the day
 * of the month, with the month on the first label and wherever it changes ("Nov 29", "30", "Dec 1").
 */
export function axisLabels(starts: string[], indices: number[], bucket: "hour" | "day", options: LabelOptions = {}) {
  if (bucket === "hour") return indices.map(index => bucketLabel(starts[index], "hour", "axis", options));
  let month = "";
  return indices.map(index => {
    const date = new Date(starts[index]);
    const current = formatter({ month: "short" }, options).format(date);
    const label = current === month ? formatter({ day: "numeric" }, options).format(date) : formatter({ month: "short", day: "numeric" }, options).format(date);
    month = current;
    return label;
  });
}
