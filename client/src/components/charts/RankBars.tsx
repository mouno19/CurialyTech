import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import type { RankBarsProps } from "./types";

// Ranked horizontal bars (spend by model, say), largest first. Every label, value and detail is
// text beside its bar, so the list itself is what a screen reader or keyboard reaches: nothing
// is only in a tooltip, and the bars are decoration on top.

/** Rows shown before "Show all". */
const SHOWN = 8;

export function RankBars({ items, format, ariaLabel }: RankBarsProps) {
  const [all, setAll] = useState(false);
  // Array sort is stable: ties keep the caller's order.
  const ranked = useMemo(
    () => items.map(item => ({ ...item, value: Number.isFinite(item.value) && item.value > 0 ? item.value : 0 })).sort((a, b) => b.value - a.value),
    [items],
  );
  const top = ranked[0]?.value ?? 0;
  if (!(top > 0)) {
    return (
      <figure className="chart rank" aria-label={ariaLabel}>
        <StateNotice variant="empty" size="sm" title="Nothing to show">Every entry is at zero.</StateNotice>
      </figure>
    );
  }
  const shown = all ? ranked : ranked.slice(0, SHOWN);
  return (
    <figure className="chart rank" aria-label={ariaLabel}>
      <ol className="rank-list">
        {shown.map(item => (
          <li key={item.key} className="rank-item">
            <span className="rank-label">{item.label}</span>
            <span className="rank-value">{format(item.value)}</span>
            <span className="rank-track" aria-hidden="true">
              {item.value > 0 && <span className="rank-bar" style={{ "--share": `${(item.value / top) * 100}%` } as CSSProperties} />}
            </span>
            {item.detail && <span className="rank-detail">{item.detail}</span>}
          </li>
        ))}
      </ol>
      {ranked.length > SHOWN && (
        <Button variant="link" size="sm" className="rank-more" aria-expanded={all} onClick={() => setAll(open => !open)}>
          {all ? "Show fewer" : `Show all ${ranked.length}`}
        </Button>
      )}
    </figure>
  );
}
