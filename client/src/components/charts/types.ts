// The charts' props, as CLIENT-CONTRACT.md defines them.

/**
 * Series colours (usage.css maps them to tokens). Checked with the dataviz validator on the card
 * surface for stacked neighbours, colour-blind and full-colour vision: ink sits next to any tone;
 * accent and slate pair, and so do slate and ochre; never stack accent next to moss or ochre, or
 * moss next to slate (they merge for red-green colour blindness). One series: ink. The part that
 * matters and the rest: accent on slate.
 */
export type ChartTone = "ink" | "accent" | "moss" | "ochre" | "slate";
export type ChartSeries = { key: string; label: string; tone: ChartTone };

/** Bars over time: one bar per bucket, series stacked bottom-up in the order given. */
export type TimeBarsProps = {
  data: { start: string; values: Record<string, number> }[]; // one entry per bucket, oldest first (ISO starts)
  series: ChartSeries[];
  bucket: "hour" | "day";
  format: (value: number) => string;                          // axis labels and tooltips
  ariaLabel: string;                                          // e.g. "Credits used per day, last 30 days"
  height?: number;                                            // px, default 180 (the time labels included)
  /** Optional dashed line (e.g. the allowance). Over 4x the highest bar it is noted at the top instead, so the bars stay readable. */
  reference?: { value: number; label: string };
  /** The zone the buckets were made in (a usage report's timeZone): labels read its clock. The viewer's own when left out or unknown. */
  timeZone?: string;
};

/** Ranked horizontal bars (e.g. spend by model). */
export type RankBarsProps = {
  items: { key: string; label: string; value: number; detail?: string }[];
  format: (value: number) => string;
  ariaLabel: string;
};
