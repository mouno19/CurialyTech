import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { usePrefersReducedMotion } from "./breakpoints";

// JS-driven motion for the reference design's live elements: scroll reveals, typing prompts,
// counters, a scroll-linked spine, swaps and presence. Everything renders its final state under the
// system's reduced-motion setting and does no work while hidden. The math lives in pure functions.

/** Reduced motion: the system setting. */
export function useReducedMotion() {
  return usePrefersReducedMotion();
}

/** The same, outside React (event handlers choosing between smooth and instant scrolling). */
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Pure helpers ----

/** Progress of a target through the viewport between "start at `from`" and "end at `to`" (0..1). */
export function scrollProgress(top: number, height: number, viewport: number, from = 0.75, to = 0.6) {
  const span = viewport * (from - to) + height;
  if (span <= 0) return top < viewport * to ? 1 : 0;
  return Math.min(1, Math.max(0, (viewport * from - top) / span));
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export type TypewriterState = { line: number; chars: number; deleting: boolean };

/** One step of the typing loop: the next state and how long to wait before the step after it. */
export function typewriterStep(state: TypewriterState, lines: readonly string[], jitter = 0.5): { state: TypewriterState; wait: number } {
  const current = lines[state.line] ?? "";
  if (!state.deleting) {
    const chars = Math.min(current.length, state.chars + 1);
    if (chars >= current.length) return { state: { ...state, chars, deleting: true }, wait: 2200 };
    return { state: { ...state, chars }, wait: 26 + jitter * 38 };
  }
  const chars = state.chars - 3;
  if (chars <= 0) return { state: { line: (state.line + 1) % Math.max(1, lines.length), chars: 0, deleting: false }, wait: 380 };
  return { state: { ...state, chars }, wait: 14 };
}

// ---- Shared observer for reveals ----

let revealObserver: IntersectionObserver | null = null;
function observeReveal(element: Element) {
  if (typeof IntersectionObserver === "undefined") {
    element.setAttribute("data-inview", "");
    return () => undefined;
  }
  revealObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.setAttribute("data-inview", "");
      revealObserver?.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -60px 0px" });
  revealObserver.observe(element);
  return () => revealObserver?.unobserve(element);
}

/** Callback ref: the element fades and lifts into place once, when it scrolls into view. */
export function useRevealRef<T extends Element>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((element: T | null) => {
    cleanup.current?.();
    cleanup.current = element ? observeReveal(element) : null;
  }, []);
}

// ---- Visibility ----

/** Whether the element is (partly) on screen and the page is visible. */
export function useInView(ref: RefObject<Element | null>, rootMargin = "0px") {
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return inView && visible;
}

// ---- Typing prompts ----

/** Types and deletes example lines in a loop while `active`; under reduced motion, the first line. */
export function useTypewriter(lines: readonly string[], active: boolean) {
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  useEffect(() => {
    if (reduce || !active || lines.length === 0) return;
    let state: TypewriterState = { line: 0, chars: 0, deleting: false };
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = typewriterStep(state, lines, Math.random());
      state = next.state;
      setText((lines[state.line] ?? "").slice(0, state.chars));
      timer = setTimeout(tick, next.wait);
    };
    setText("");
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [active, lines, reduce]);
  return reduce ? lines[0] ?? "" : text;
}

// ---- Counters ----

/** Counts up to `value` the first time it is known (once per mount); later changes show at once. */
export function useCountUp(value: number | null | undefined, duration = 900) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<number | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (value === null || value === undefined) return;
    if (done.current || reduce || value === 0) {
      done.current = true;
      setShown(value);
      return;
    }
    done.current = true;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / duration;
      setShown(t >= 1 ? value : Math.round(easeOutCubic(t) * value));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduce]);
  return value === null || value === undefined ? value : shown ?? (reduce ? value : 0);
}

// ---- Scroll-linked progress ----

/**
 * Writes `--progress` (0..1, spring-smoothed) on `output` as `target` passes through the window's
 * viewport; no re-renders. Under reduced motion the spine is simply full.
 */
export function useScrollProgress(target: RefObject<Element | null>, output: RefObject<HTMLElement | null>, from = 0.75, to = 0.6) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const element = target.current;
    const out = output.current;
    if (!element || !out) return;
    if (reduce) {
      out.style.setProperty("--progress", "1");
      return;
    }
    let current = 0;
    let goal = 0;
    let frame = 0;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      goal = scrollProgress(rect.top, rect.height, window.innerHeight, from, to);
      if (!frame) frame = requestAnimationFrame(animate);
    };
    const animate = () => {
      current += (goal - current) * 0.16;
      if (Math.abs(goal - current) < 0.001) current = goal;
      out.style.setProperty("--progress", current.toFixed(4));
      frame = current === goal ? 0 : requestAnimationFrame(animate);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
    };
  }, [target, output, from, to, reduce]);
}

/** True once the window has scrolled past `threshold` px (sticky headers that gain a surface). */
export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

// ---- Presence ----

/**
 * Content keyed by `key` that leaves before the next one enters (the reference's
 * AnimatePresence mode="wait"): render `shown`, and mark the element data-leaving={leaving}.
 */
export function useSwap<K>(key: K, leaveMs = 220) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(key);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    // Back on the shown key before the swap finished (e.g. Right then Left within the leave time):
    // stop leaving, so the panel rises back in instead of staying faded out.
    if (key === shown) {
      setLeaving(false);
      return;
    }
    if (reduce) {
      setShown(key);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setShown(key);
      setLeaving(false);
    }, leaveMs);
    return () => clearTimeout(timer);
  }, [key, shown, leaveMs, reduce]);
  return { shown, leaving };
}

/**
 * Mount/unmount with transitions: `mounted` stays true while closing; `open` turns on the frame
 * after mounting (so a CSS transition runs) and off before unmounting.
 */
export function usePresence(present: boolean, exitMs = 450) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(present);
  const [open, setOpen] = useState(present);
  useLayoutEffect(() => {
    if (present) {
      setMounted(true);
      if (reduce) {
        setOpen(true);
        return;
      }
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setOpen(true)); });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setOpen(false);
    if (reduce) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [present, exitMs, reduce]);
  return { mounted, open };
}
