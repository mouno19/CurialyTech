import { cx } from "./cx";

/** A Canva mark (decorative; pair it with text or an aria-label on the control). */
export function CanvaMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx("canva-mark", className)} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" strokeWidth="1.4" />
      <path d="M10.6 5.7a3.4 3.4 0 1 0 0 4.6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
