import { useSyncExternalStore } from "react";

/** One breakpoint scale for CSS and JS: phone < 640, tablet 640-1023, desktop >= 1024, wide >= 1440. */
export const BP = { tablet: 640, desktop: 1024, wide: 1440 } as const;

export const MQ = {
  phone: `(max-width: ${BP.tablet - 0.02}px)`,
  tablet: `(min-width: ${BP.tablet}px) and (max-width: ${BP.desktop - 0.02}px)`,
  belowDesktop: `(max-width: ${BP.desktop - 0.02}px)`,
  desktop: `(min-width: ${BP.desktop}px)`,
  wide: `(min-width: ${BP.wide}px)`,
  reducedMotion: "(prefers-reduced-motion: reduce)",
  coarsePointer: "(pointer: coarse)",
} as const;

const lists = new Map<string, MediaQueryList>();
function list(query: string) {
  let mql = lists.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    lists.set(query, mql);
  }
  return mql;
}

/** Live result of a media query, correct on the first render (no layout flash). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      const mql = list(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => list(query).matches,
    () => false,
  );
}

export const useIsPhone = () => useMediaQuery(MQ.phone);
export const useIsDesktop = () => useMediaQuery(MQ.desktop);
export const usePrefersReducedMotion = () => useMediaQuery(MQ.reducedMotion);
