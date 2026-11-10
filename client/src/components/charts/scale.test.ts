import { describe, expect, it } from "vitest";
import {
  axisLabels, barWidth, bucketHour, bucketLabel, DAY_STEPS, fitStep, HOUR_STEPS, labelCentre, labelIndices, niceTicks, REFERENCE_REACH, roundedTop,
  stackSegments, stackTotals, textWidth, ticksFor, usableTimeZone, viewerTimeZone, yDomain,
} from "./scale";

const cents = (value: number) => `$${value.toFixed(2)}`;
// ICU puts a narrow no-break space before AM/PM in newer releases.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("niceTicks (the y axis)", () => {
  it("ends at a round value at or above the data, in a few steps of 1, 2 or 5", () => {
    expect(niceTicks(2.1)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(4.01)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(100)).toEqual([0, 50, 100]);
    expect(niceTicks(12_345_678)).toEqual([0, 5_000_000, 10_000_000, 15_000_000]);
  });
  it("never uses 2.5 steps (a cents axis would show 0.025 as $0.03)", () => {
    expect(niceTicks(0.09)).toEqual([0, 0.05, 0.1]);
    expect(niceTicks(9)).toEqual([0, 5, 10]);
  });
  it("keeps tick values free of float noise", () => {
    expect(niceTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceTicks(0.0007)).toEqual([0, 0.0002, 0.0004, 0.0006, 0.0008]);
  });
  it("gives counts whole-number ticks", () => {
    expect(niceTicks(1, 4, true)).toEqual([0, 1]);
    expect(niceTicks(3, 4, true)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7, 4, true)).toEqual([0, 2, 4, 6, 8]);
  });
  it("stays within the number of intervals asked for", () => {
    for (const max of [0.013, 1.7, 33, 412, 9_999, 87_654]) {
      for (const intervals of [3, 4]) expect(niceTicks(max, intervals).length - 1).toBeLessThanOrEqual(intervals);
    }
  });
  it("has nothing to scale for zero, negative or invalid maxima", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(-3)).toEqual([0]);
    expect(niceTicks(Number.NaN)).toEqual([0]);
    expect(niceTicks(Number.POSITIVE_INFINITY)).toEqual([0]);
  });
});

describe("ticksFor (labels the reader can tell apart)", () => {
  it("widens the step until every label reads differently in the format", () => {
    // 0.005 and 0.01 both read "$0.01" in cents.
    expect(niceTicks(0.011)).toEqual([0, 0.005, 0.01, 0.015]);
    expect(ticksFor(0.011, 4, false, cents)).toEqual([0, 0.01, 0.02]);
  });
  it("keeps the round ticks when the format already tells them apart", () => {
    expect(ticksFor(0.011, 4, false, value => `$${value}`)).toEqual([0, 0.005, 0.01, 0.015]);
    expect(ticksFor(2.1, 4, false, cents)).toEqual([0, 1, 2, 3]);
  });
});

describe("yDomain (the reference line)", () => {
  it("raises the top to include a reference that is close to the data", () => {
    const domain = yDomain(450, 600, 4, true, String);
    expect(domain.referenceDrawn).toBe(true);
    expect(domain.max).toBeGreaterThanOrEqual(600);
  });
  it("notes a reference far above the bars instead of squashing them", () => {
    const domain = yDomain(100, 100 * REFERENCE_REACH + 1, 4, true, String);
    expect(domain.referenceDrawn).toBe(false);
    expect(domain.max).toBe(100);
  });
  it("ignores a missing or meaningless reference", () => {
    expect(yDomain(10, undefined, 4, true, String).referenceDrawn).toBe(false);
    expect(yDomain(10, 0, 4, true, String).referenceDrawn).toBe(false);
    expect(yDomain(10, Number.NaN, 4, true, String).referenceDrawn).toBe(false);
  });
});

describe("barWidth (thin marks)", () => {
  it("caps bars at 24px", () => {
    expect(barWidth(40)).toBe(24);
    expect(barWidth(400)).toBe(24);
  });
  it("leaves a surface gap of at least 2px where the slot allows it", () => {
    for (const slot of [6, 8, 12.5, 20, 30]) expect(slot - barWidth(slot)).toBeGreaterThanOrEqual(2);
  });
  it("still draws something in a crowded range", () => {
    expect(barWidth(3)).toBe(2);
    expect(barWidth(1.2)).toBe(1);
    expect(barWidth(0)).toBe(0);
  });
});

describe("stackSegments (stacking)", () => {
  it("stacks bottom-up, ends exactly at the total, and splits neighbours with a surface gap", () => {
    const [paid, none, saved] = stackSegments([3, 0, 2], 10, 100, 2);
    expect(paid).toEqual({ y: 72, height: 28 });
    expect(none).toBeNull();
    // The top segment is not trimmed: the bar's top is 5 units above the baseline.
    expect(saved).toEqual({ y: 50, height: 20 });
  });
  it("keeps a tiny value visible", () => {
    const [tiny, big] = stackSegments([0.01, 5], 10, 100, 2, 1);
    expect(tiny).toEqual({ y: 99, height: 1 });
    expect(big!.y).toBeCloseTo(49.9, 5);
  });
  it("draws nothing for an empty bucket", () => {
    expect(stackSegments([0, 0], 10, 100)).toEqual([null, null]);
  });
  it("totals each bucket", () => {
    expect(stackTotals([[1, 2, 3], [0, 0, 0], [0.5]])).toEqual([6, 0, 0.5]);
  });
});

describe("roundedTop (the data end)", () => {
  it("rounds the top corners and keeps the base square", () => {
    expect(roundedTop(0, 10, 20, 50)).toBe("M0 60V14A4 4 0 0 1 4 10H16A4 4 0 0 1 20 14V60Z");
  });
  it("shrinks the radius for narrow or short bars", () => {
    expect(roundedTop(5, 0, 2, 50)).toBe("M5 50V1A1 1 0 0 1 6 0H6A1 1 0 0 1 7 1V50Z");
    expect(roundedTop(0, 9, 10, 1)).toBe("M0 10V10A1 1 0 0 1 1 9H9A1 1 0 0 1 10 10V10Z");
  });
});

describe("time labels", () => {
  const even = (count: number, width: number) => (step: number) => labelIndices("day", new Array(count).fill(0), step).map(index => ({ index, width }));
  // Centred under the bucket, nothing pulled in.
  const at = (slot: number) => (mark: { index: number }) => (mark.index + 0.5) * slot;
  it("labels as often as the labels clear each other", () => {
    // 30px labels and a 10px gap need 40px between centres.
    expect(fitStep(DAY_STEPS, 10, even(28, 30), at(12))).toBe(7);
    expect(fitStep(DAY_STEPS, 10, even(7, 30), at(40))).toBe(1);
  });
  it("weighs each pair of neighbours by its own widths", () => {
    // A wide label next to narrow ones fits where two wide ones would not: (30 + 8) / 2 + 10 <= 30 < 30 + 10.
    const mixed = (step: number) => [0, step, 2 * step].map((index, position) => ({ index, width: position === 0 ? 30 : 8 }));
    expect(fitStep(DAY_STEPS, 10, mixed, at(30))).toBe(1);
    expect(fitStep(DAY_STEPS, 10, step => [0, step].map(index => ({ index, width: 30 })), at(30))).toBe(2);
  });
  it("judges an end label where it is drawn, pulled inside the chart", () => {
    expect(fitStep(DAY_STEPS, 8, even(90, 30), at(2.8))).toBe(14);
    // Today's label is pulled 13px left, onto its neighbour two weeks back: every 30 days instead.
    expect(fitStep(DAY_STEPS, 8, even(90, 30), mark => labelCentre(mark.index, mark.width, 0, 2.8, 252))).toBe(30);
  });
  it("keeps labels inside the svg, reaching into the gutter if need be", () => {
    expect(labelCentre(10, 20, 50, 10, 300)).toBe(155);
    expect(labelCentre(0, 80, 20, 10, 300)).toBe(40);
    expect(labelCentre(24, 40, 50, 10, 300)).toBe(280);
  });
  it("keeps to a dozen labels however much room there is", () => {
    expect(fitStep(DAY_STEPS, 8, even(30, 10), at(100))).toBe(3);
    expect(fitStep(DAY_STEPS, 8, even(30, 10), at(100), 30)).toBe(1);
  });
  it("falls back to the widest step when nothing fits", () => {
    expect(fitStep(HOUR_STEPS, 10, even(24, 60), at(0.1))).toBe(24);
    expect(fitStep(DAY_STEPS, 10, even(90, 30), at(0))).toBe(90);
  });
  it("names the month on the first day label and where it changes", () => {
    const starts = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map(day => `${day}T00:00:00.000Z`);
    expect(axisLabels(starts, [0, 1, 2, 3], "day", { locale: "en-US", timeZone: "UTC" })).toEqual(["Oct 30", "31", "Nov 1", "2"]);
    expect(axisLabels(starts, [1, 3], "day", { locale: "en-US", timeZone: "UTC" })).toEqual(["Oct 31", "Nov 2"]);
  });
  it("puts hourly labels on round hours", () => {
    const hours = Array.from({ length: 24 }, (_, index) => (22 + index) % 24);
    expect(labelIndices("hour", hours, 6).map(index => hours[index])).toEqual([0, 6, 12, 18]);
  });
  it("counts daily labels back from the latest day", () => {
    expect(labelIndices("day", new Array(30).fill(0), 7)).toEqual([1, 8, 15, 22, 29]);
    expect(labelIndices("day", new Array(7).fill(0), 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(labelIndices("day", [], 7)).toEqual([]);
  });
  it("names hours, midnights and days", () => {
    const options = { locale: "en-US", timeZone: "UTC" };
    expect(plain(bucketLabel("2026-11-09T14:00:00.000Z", "hour", "axis", options))).toBe("2 PM");
    expect(bucketLabel("2026-11-09T00:00:00.000Z", "hour", "axis", options)).toBe("Nov 9");
    expect(bucketLabel("2026-11-09T00:00:00.000Z", "day", "axis", options)).toBe("Nov 9");
    expect(bucketLabel("2026-11-09T00:00:00.000Z", "day", "full", options)).toBe("Mon, Nov 9");
    expect(plain(bucketLabel("2026-11-09T14:00:00.000Z", "hour", "full", options))).toBe("Mon, Nov 9, 2:00 PM");
  });
  it("reads the hour on the given clock", () => {
    expect(bucketHour("2026-11-09T14:00:00.000Z", "UTC")).toBe(14);
    expect(bucketHour("2026-11-09T14:00:00.000Z", "Asia/Kolkata")).toBe(19);
    expect(bucketHour("2026-11-09T23:30:00.000Z", "Asia/Tokyo")).toBe(8);
  });
  it("names a bucket by the clock it was cut on, not the viewer's", () => {
    // A day the server made in UTC starts at 00:00Z: in New York that instant is still the day before.
    const start = "2026-11-09T00:00:00.000Z";
    expect(bucketLabel(start, "day", "full", { locale: "en-US", timeZone: "UTC" })).toBe("Mon, Nov 9");
    expect(bucketLabel(start, "day", "full", { locale: "en-US", timeZone: "America/New_York" })).toBe("Sun, Nov 8");
    // A half-hour zone's hours start at :30 UTC and are still round hours there.
    expect(plain(bucketLabel("2026-11-09T13:30:00.000Z", "hour", "axis", { locale: "en-US", timeZone: "Asia/Kolkata" }))).toBe("7 PM");
  });
  it("only labels with a time zone the browser knows", () => {
    expect(usableTimeZone("UTC")).toBe("UTC");
    expect(usableTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(usableTimeZone("Mars/Olympus_Mons")).toBeUndefined();
    expect(usableTimeZone("")).toBeUndefined();
    expect(usableTimeZone(null)).toBeUndefined();
    expect(typeof viewerTimeZone()).toBe("string");
  });
  it("estimates mono label widths", () => {
    expect(textWidth("Nov 9")).toBeCloseTo(5 * 10.5 * 0.62, 5);
  });
});

describe("label density at real widths", () => {
  // A 360px phone leaves a plot about 248px wide; a 1440px desktop about 994px. TimeBars keeps an 8px gap.
  const options = { locale: "en-US", timeZone: "UTC" };
  const startsFor = (bucket: "hour" | "day", count: number, last: string) =>
    Array.from({ length: count }, (_, index) => new Date(Date.parse(last) - (count - 1 - index) * (bucket === "hour" ? 3_600_000 : 86_400_000)).toISOString());
  const axis = (bucket: "hour" | "day", count: number, plot: number, last = "2026-11-09T00:00:00.000Z") => {
    const starts = startsFor(bucket, count, last);
    const hours = starts.map(start => bucketHour(start, "UTC"));
    const marks = (step: number) => {
      const indices = labelIndices(bucket, hours, step);
      const texts = axisLabels(starts, indices, bucket, options);
      return indices.map((index, position) => ({ index, text: plain(texts[position]), width: textWidth(texts[position]) }));
    };
    // As TimeBars lays it out: a 40px gutter, the plot, 2px to the svg's edge.
    const slot = plot / count;
    const centre = (mark: { index: number; width: number }) => labelCentre(mark.index, mark.width, 40, slot, 40 + plot + 2);
    const step = fitStep(bucket === "hour" ? HOUR_STEPS : DAY_STEPS, 8, marks, centre);
    return { step, texts: marks(step).map(mark => mark.text), bar: barWidth(slot) };
  };
  it("labels every day of a week on a phone, across a month change too", () => {
    expect(axis("day", 7, 248).texts).toEqual(["Nov 3", "4", "5", "6", "7", "8", "9"]);
    expect(axis("day", 7, 248, "2026-11-02T00:00:00.000Z").texts).toEqual(["Oct 27", "28", "29", "30", "31", "Nov 1", "2"]);
  });
  it("thins longer ranges to a handful of labels on a phone, today always among them", () => {
    for (const [bucket, count] of [["day", 30], ["day", 90], ["hour", 24]] as const) {
      const { texts } = axis(bucket, count, 248);
      expect(texts.length).toBeGreaterThanOrEqual(3);
      expect(texts.length).toBeLessThanOrEqual(8);
    }
    expect(axis("day", 30, 248).texts.at(-1)).toBe("9");
    // Midnight is named by its date.
    expect(axis("hour", 24, 248, "2026-11-09T13:00:00.000Z").texts).toContain("Nov 9");
  });
  it("labels more often on a desktop, but never more than a dozen, with bars at most 24px", () => {
    expect(axis("day", 30, 994).step).toBe(3);
    expect(axis("hour", 24, 994).step).toBe(2);
    expect(axis("day", 7, 994).bar).toBe(24);
  });
});
