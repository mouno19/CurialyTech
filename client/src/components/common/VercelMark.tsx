import { cx } from "./cx";

/** The Vercel mark (decorative; pair it with text or an aria-label on the control). */
export function VercelMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx("vercel-mark", className)} width={size} height={size} viewBox="0 0 76 65" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}
