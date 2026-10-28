import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { createElement } from "react";
import { useRevealRef } from "@/lib/motion";

type RevealTag = "div" | "li" | "section" | "header" | "figure" | "article" | "aside";

type RevealProps = HTMLAttributes<HTMLElement> & {
  as?: RevealTag;
  /** Seconds after it enters the viewport (the reference's unit). */
  delay?: number;
  /** How far it lifts, in px. */
  y?: number;
  children?: ReactNode;
};

/** Fades and lifts content into place once, when it scrolls into view (motion.css [data-reveal]). */
export function Reveal({ as = "div", delay = 0, y, style, children, ...rest }: RevealProps) {
  const ref = useRevealRef<HTMLElement>();
  const vars = { ...style, ...(delay ? { "--reveal-delay": `${Math.round(delay * 1000)}ms` } : {}), ...(y !== undefined ? { "--reveal-y": `${y}px` } : {}) } as CSSProperties;
  return createElement(as, { ...rest, ref, "data-reveal": "", style: vars }, children);
}
