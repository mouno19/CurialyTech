// The Curialy mark (an opening curly brace holding a vermilion spark), the wordmark, and the
// loading mark. Colours come from CSS variables (styles in shell.css "Brand"), so they follow the tokens.

export const MARK_BRACE = "M14.5 7.5c-2.7 0-3.8 1.3-3.8 3.7v2.1c0 1.7-.8 2.5-2.5 2.7 1.7.2 2.5 1 2.5 2.7v2.1c0 2.4 1.1 3.7 3.8 3.7";

type MarkProps = {
  size?: number;
  /** ink: ink square, paper brace (default). paper: for dark backgrounds. */
  tone?: "ink" | "paper";
  /** Accessible name for standalone use; without it the mark is decorative (aria-hidden). */
  title?: string;
  /** Pulse the spark (loading). Static under prefers-reduced-motion. */
  pulse?: boolean;
  className?: string;
};

export function CurialyMark({ size = 28, tone = "ink", title, pulse, className }: MarkProps) {
  return (
    <svg
      className={className ? `curialy-mark ${className}` : "curialy-mark"}
      data-scheme={tone}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect className="mark-ground" width="32" height="32" rx="7" />
      <path className="mark-brace" d={MARK_BRACE} fill="none" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="mark-spark" data-pulse={pulse || undefined} cx="20.5" cy="16" r="3.4" />
    </svg>
  );
}

/** Kept for older imports (`BrandMark` from AppShell). */
export const BrandMark = CurialyMark;

type WordmarkProps = {
  size?: "sm" | "lg";
  tone?: "ink" | "paper";
  /** Show the mark before the word (default true). */
  mark?: boolean;
  className?: string;
};

/** Lowercase serif "curialy" with a raised mono "ai". The logotype is exempt from text contrast rules. */
export function Wordmark({ size = "sm", tone = "ink", mark = true, className }: WordmarkProps) {
  return (
    <span className={className ? `wordmark ${className}` : "wordmark"} data-size={size} data-scheme={tone}>
      {mark && <CurialyMark size={size === "lg" ? 52 : 28} tone={tone} />}
      <span className="wordmark-word">
        <span className="wordmark-name">curialy</span>
        <span className="wordmark-ai">ai</span>
      </span>
    </span>
  );
}

/** The mark with a gently pulsing spark, announced as a status. Static under reduced motion. */
export function LoadingMark({ size = 40, label = "Loading…", showLabel = false }: { size?: number; label?: string; showLabel?: boolean }) {
  return (
    <span className="loading-mark" role="status">
      <CurialyMark size={size} pulse />
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
    </span>
  );
}
