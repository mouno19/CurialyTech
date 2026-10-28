import type { ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/** Marginalia-style section marker: "§ 02 ── How it works". */
export function SectionLabel({ index, children, tone = "ink", className }: { index: string; children: ReactNode; tone?: "ink" | "paper"; className?: string }) {
  return (
    <p className={className ? `lp-label ${className}` : "lp-label"} data-tone={tone}>
      <span className="lp-label-index">§ {index}</span>
      <span className="lp-label-rule" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Same-page anchors scroll smoothly (instantly under reduced motion) and keep the URL hash. */
export function scrollToAnchor(href: string) {
  const target = document.getElementById(href.replace(/^#/, ""));
  if (!target) return false;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  window.history.replaceState(null, "", href);
  // Move focus for keyboard and screen-reader users without a second jump.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return true;
}
