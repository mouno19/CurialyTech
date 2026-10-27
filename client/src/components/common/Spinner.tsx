import { MARK_BRACE } from "@/components/brand/Logo";
import { cx } from "./cx";

/**
 * Inline busy indicator: the brand brace with a pulsing spark. Always pair it with text
 * ("Cancelling…"): under prefers-reduced-motion it is a static mark. With `label` it is also a
 * polite status announcement.
 */
export function Spinner({ size = 14, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <span className={cx("spinner", className)} role={label ? "status" : undefined}>
      <svg viewBox="5 5 22 22" width={size} height={size} aria-hidden="true" focusable="false">
        <path d={MARK_BRACE} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="spinner-spark" cx="20.5" cy="16" r="3.6" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
