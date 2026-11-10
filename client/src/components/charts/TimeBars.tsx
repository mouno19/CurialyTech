import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { StateNotice } from "@/components/common/StateNotice";
import {
  axisLabels, barWidth, bucketHour, bucketLabel, DAY_STEPS, fitStep, HOUR_STEPS, labelCentre, labelIndices, roundedTop, stackSegments, stackTotals, textWidth, usableTimeZone, yDomain,
  type AxisMark, type Segment,
} from "./scale";
import type { ChartSeries, TimeBarsProps } from "./types";

// Bars over time, drawn in SVG from the kit's tokens: a bar per bucket, the series stacked
// bottom-up with a surface gap between them, a few round ticks on hairlines. Pointer, touch and the
// arrow keys show a bucket's values; the table under the chart has every number.

/** Under the plot, inside `height`: the time labels. */
const AXIS_BAND = 22;
/** Over the top gridline: room for the highest bar's label. */
const HEADROOM = 18;
/** The surface gap between stacked segments. */
const GAP = 2;
/** Space between neighbouring time labels (textWidth reads a little wide, so the real gap is larger). */
const LABEL_GAP = 8;

/** The element's width in whole pixels, kept current as it resizes (0 until measured). */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** A value as a bar: missing, negative or invalid values are zero. */
const amount = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** Do two label boxes [left, top, right, bottom] overlap? */
const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

type Bar = { x: number; segments: (Segment | null)[]; top: number };

/** One bar: its segments as rectangles, the top one with the rounded data end. */
function BarShape({ bar, width, series }: { bar: Bar; width: number; series: ChartSeries[] }) {
  return (
    <>
      {bar.segments.map((segment, index) => {
        if (!segment) return null;
        const { key, tone } = series[index];
        return index === bar.top
          ? <path key={key} className="chart-seg" data-hue={tone} d={roundedTop(bar.x, segment.y, width, segment.height)} />
          : <rect key={key} className="chart-seg" data-hue={tone} x={bar.x} y={segment.y} width={width} height={segment.height} />;
      })}
    </>
  );
}

export function TimeBars({ data, series, bucket, format, ariaLabel, height = 180, reference, timeZone }: TimeBarsProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useWidth(frameRef);
  const tableId = useId();
  // Labels on the clock the buckets were cut on (a report the server made in UTC starts its days at 00:00Z).
  const zone = usableTimeZone(timeZone);
  const clock = useMemo((): { timeZone?: string } => (zone ? { timeZone: zone } : {}), [zone]);
  // The bucket under the pointer or finger, and the keyboard's (shown while focus is visible).
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const rows = useMemo(() => data.map(entry => series.map(item => amount(entry.values[item.key]))), [data, series]);
  const totals = useMemo(() => stackTotals(rows), [rows]);
  const peak = totals.reduce((best, total, index) => (total > totals[best] ? index : best), 0);
  const dataMax = totals[peak] ?? 0;
  const empty = !(dataMax > 0);
  const unit = bucket === "hour" ? "hour" : "day";
  const integer = rows.every(values => values.every(value => Number.isInteger(value)));
  const domain = useMemo(
    () => yDomain(dataMax, reference?.value, height - AXIS_BAND - HEADROOM < 120 ? 3 : 4, integer, format),
    [dataMax, reference?.value, height, integer, format],
  );

  const layout = useMemo(() => {
    if (empty || width <= 0) return null;
    // The y labels sit in a gutter as wide as the widest of them.
    const left = Math.ceil(Math.max(...domain.ticks.map(tick => textWidth(format(tick))))) + 10;
    const right = Math.max(left + 1, width - 2);
    const top = HEADROOM;
    const bottom = Math.max(top + 1, height - AXIS_BAND);
    const slot = (right - left) / data.length;
    const bar = barWidth(slot);
    const perUnit = (bottom - top) / domain.max;
    const y = (value: number) => bottom - value * perUnit;
    const bars: Bar[] = rows.map((values, index) => {
      const segments = stackSegments(values, perUnit, bottom, GAP);
      return { x: left + index * slot + (slot - bar) / 2, segments, top: segments.findLastIndex(segment => segment !== null) };
    });
    // As many time labels as fit without touching, on round hours or counted back from today.
    const starts = data.map(entry => entry.start);
    const hours = starts.map(start => (bucket === "hour" ? bucketHour(start, clock.timeZone) : 0));
    const marks = (step: number) => {
      const indices = labelIndices(bucket, hours, step);
      const texts = axisLabels(starts, indices, bucket, clock);
      return indices.map((index, position) => ({ index, text: texts[position], width: textWidth(texts[position]) }));
    };
    const centre = (mark: AxisMark) => labelCentre(mark.index, mark.width, left, slot, width);
    const times = marks(fitStep(bucket === "hour" ? HOUR_STEPS : DAY_STEPS, LABEL_GAP, marks, centre)).map(mark => ({ ...mark, x: centre(mark) }));
    return { left, right, top, bottom, slot, bar, y, bars, times };
  }, [empty, width, height, rows, data, bucket, domain, format, clock]);

  const barMarks = useMemo(() => {
    if (!layout) return null;
    return layout.bars.map((bar, index) => (
      <g key={data[index].start} className="chart-bar" style={{ "--i": Math.min(index, 40) } as CSSProperties}>
        <BarShape bar={bar} width={layout.bar} series={series} />
      </g>
    ));
  }, [layout, data, series]);

  // What a screen reader hears on the chart; the table carries the rest.
  const summary = useMemo(() => {
    if (empty) return "";
    const sums = series.map((_, column) => rows.reduce((sum, values) => sum + values[column], 0));
    const grand = sums.reduce((sum, value) => sum + value, 0);
    const parts = [series.length > 1 ? `${series.map((item, column) => `${item.label} ${format(sums[column])}`).join(", ")}; total ${format(grand)}.` : `Total ${format(grand)}.`];
    parts.push(`Highest: ${bucketLabel(data[peak].start, bucket, "full", clock)}, ${format(dataMax)}.`);
    if (reference) parts.push(domain.referenceDrawn ? `Dashed line: ${reference.label}.` : `${reference.label}: above every bar.`);
    parts.push(`The table after the chart lists every ${unit}.`);
    return parts.join(" ");
  }, [empty, series, rows, format, data, peak, bucket, dataMax, reference, domain.referenceDrawn, unit, clock]);

  // A new range starts without a highlighted bar (keyed on the range, not on the array: callers
  // may build `data` afresh on every render).
  const rangeKey = data.length ? `${data[0].start}|${data[data.length - 1].start}|${data.length}` : "";
  useEffect(() => {
    setHover(null);
    setCursor(current => (current === null ? null : Math.max(0, Math.min(current, data.length - 1))));
  }, [rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tap shows a bar until the next tap anywhere else.
  useEffect(() => {
    if (hover === null) return;
    const away = (event: globalThis.PointerEvent) => {
      if (!plotRef.current?.contains(event.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hover]);

  const indexAt = (clientX: number) => {
    const plot = plotRef.current;
    if (!plot || !layout) return null;
    const x = clientX - plot.getBoundingClientRect().left;
    if (x < layout.left - 6) return null;
    return Math.min(data.length - 1, Math.max(0, Math.floor((x - layout.left) / layout.slot)));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => setHover(indexAt(event.clientX));
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") setHover(indexAt(event.clientX));
  };
  // A finger lifting leaves the bar shown (touch has no hover to end).
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") setHover(null);
  };
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    let visible = true;
    try { visible = event.currentTarget.matches(":focus-visible"); } catch { /* older engines: treat focus as visible */ }
    if (visible) setCursor(current => current ?? data.length - 1);
  };
  const onBlur = () => {
    setCursor(null);
    setHover(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = data.length - 1;
    if (event.key === "Escape") {
      if (cursor === null && hover === null) return;
      // Inside a dialog, the first Esc only hides the readout.
      event.preventDefault();
      event.stopPropagation();
      setCursor(null);
      setHover(null);
      return;
    }
    const from = cursor ?? last;
    const next = event.key === "ArrowLeft" ? from - 1 : event.key === "ArrowRight" ? from + 1 : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setHover(null);
    setCursor(Math.max(0, Math.min(last, next)));
  };

  const active = hover ?? cursor;
  const shown = layout && active !== null && active < data.length ? active : null;

  let referenceMark: ReactNode = null;
  let referenceBox: number[] | null = null;
  if (layout && reference) {
    if (domain.referenceDrawn) {
      const lineY = Math.round(layout.y(reference.value)) + 0.5;
      const textY = lineY - 16 < 0 ? lineY + 13 : lineY - 5;
      referenceBox = [layout.right - textWidth(reference.label), textY - 10, layout.right, textY + 2];
      referenceMark = (
        <g className="chart-ref">
          <line x1={layout.left} x2={layout.right} y1={lineY} y2={lineY} />
          <text x={layout.right} y={textY} textAnchor="end">{reference.label}</text>
        </g>
      );
    } else {
      const text = `↑ ${reference.label}`;
      referenceBox = [layout.right - textWidth(text), 1, layout.right, 13];
      referenceMark = <g className="chart-ref"><text x={layout.right} y={11} textAnchor="end">{text}</text></g>;
    }
  }

  // The one direct label: the highest bar's total, unless it would sit on the reference's label.
  let peakMark: ReactNode = null;
  if (layout) {
    const text = format(dataMax);
    const half = textWidth(text) / 2;
    const bar = layout.bars[peak];
    const x = Math.min(Math.max(bar.x + layout.bar / 2, layout.left + half), width - half);
    const y = layout.y(dataMax) - 6;
    if (!referenceBox || !overlaps([x - half, y - 10, x + half, y + 2], referenceBox)) peakMark = <text className="chart-peak" x={x} y={y} textAnchor="middle">{text}</text>;
  }

  let tip: ReactNode = null;
  if (layout && shown !== null) {
    const bar = layout.bars[shown];
    // Beside the bar, on the side with more room, so it never covers the bar it describes.
    const toLeft = bar.x + layout.bar / 2 > width / 2;
    const style: CSSProperties = toLeft
      ? { right: width - bar.x + 8, maxWidth: Math.max(120, bar.x - 12) }
      : { left: bar.x + layout.bar + 8, maxWidth: Math.max(120, width - bar.x - layout.bar - 12) };
    tip = (
      <div className="chart-tip" style={style} aria-hidden="true">
        <p className="chart-tip-time">{bucketLabel(data[shown].start, bucket, "full", clock)}</p>
        <ul className="chart-tip-rows">
          {/* Top segment first, as the stack reads. */}
          {series.map((item, column) => ({ item, value: rows[shown][column] })).reverse().map(({ item, value }) => (
            <li key={item.key}><span className="chart-key" data-hue={item.tone} /><strong>{format(value)}</strong><span>{item.label}</span></li>
          ))}
          {series.length > 1 && <li className="chart-tip-rule" />}
          {series.length > 1 && <li className="chart-tip-total"><span /><strong>{format(totals[shown])}</strong><span>Total</span></li>}
        </ul>
      </div>
    );
  }

  return (
    <figure className="chart" aria-label={ariaLabel}>
      {series.length > 1 && !empty && (
        <ul className="chart-legend">
          {series.map(item => <li key={item.key}><span className="chart-swatch" data-hue={item.tone} aria-hidden="true" />{item.label}</li>)}
        </ul>
      )}
      <div ref={frameRef} className="chart-frame">
        {empty ? (
          <div className="chart-empty" style={{ minHeight: height }}>
            <StateNotice variant="empty" size="sm" title="Nothing in this range">
              {data.length ? `All ${data.length} ${unit}s are at zero.` : "There is no data for this range."}
            </StateNotice>
          </div>
        ) : (
          <div
            ref={plotRef}
            className="chart-plot"
            style={{ height }}
            tabIndex={0}
            role="img"
            aria-roledescription="chart"
            aria-label={summary}
            data-active={shown !== null || undefined}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerLeave={onPointerLeave}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          >
            {layout && (
              <svg className="chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" style={{ "--chart-base": `${layout.bottom}px` } as CSSProperties}>
                <g className="chart-grid">
                  {domain.ticks.map(tick => {
                    const y = Math.round(layout.y(tick)) + 0.5;
                    return <line key={tick} className={tick === 0 ? "chart-baseline" : undefined} x1={layout.left} x2={layout.right} y1={y} y2={y} />;
                  })}
                </g>
                <g className="chart-axis">
                  {domain.ticks.map(tick => <text key={tick} x={layout.left - 8} y={layout.y(tick)} dy="0.32em" textAnchor="end">{format(tick)}</text>)}
                  {layout.times.map(time => <text key={time.index} x={time.x} y={layout.bottom + 15} textAnchor="middle">{time.text}</text>)}
                </g>
                {shown !== null && <rect className="chart-wash" x={layout.left + shown * layout.slot} y={layout.top - 6} width={layout.slot} height={layout.bottom - layout.top + 6} rx={3} />}
                <g className="chart-bars">{barMarks}</g>
                {/* The highlighted bar again, at full strength over the dimmed ones. */}
                {shown !== null && <g className="chart-lift"><BarShape bar={layout.bars[shown]} width={layout.bar} series={series} /></g>}
                {referenceMark}
                {peakMark}
              </svg>
            )}
            {tip}
          </div>
        )}
      </div>
      {!empty && (
        <details className="chart-table">
          <summary>Show as a table</summary>
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby={tableId}>
            <table className="data-table">
              <caption id={tableId} className="sr-only">{ariaLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">{bucket === "hour" ? "Hour" : "Day"}</th>
                  {series.map(item => <th key={item.key} scope="col" className="chart-num">{item.label}</th>)}
                  {series.length > 1 && <th scope="col" className="chart-num">Total</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((entry, index) => (
                  <tr key={entry.start}>
                    <th scope="row">{bucketLabel(entry.start, bucket, "full", clock)}</th>
                    {rows[index].map((value, column) => <td key={series[column].key} className="num chart-num">{format(value)}</td>)}
                    {series.length > 1 && <td className="num chart-num">{format(totals[index])}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reference && <p className="chart-table-note">Reference: {reference.label}</p>}
        </details>
      )}
    </figure>
  );
}
