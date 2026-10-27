import { useEffect, useState } from "react";

/**
 * Whole seconds left until `until` (epoch ms), re-rendering every `stepMs` and exactly at the
 * deadline; 0 once it has passed or when `until` is null. Display only: never hang network calls
 * off it. For expiry checks use a long step, e.g. useCountdown(expiresAt, 30_000).
 */
export function useCountdown(until: number | null | undefined, stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = until - current;
      if (left > 0) timer = setTimeout(tick, Math.min(stepMs, left % stepMs || stepMs));
    };
    tick();
    return () => clearTimeout(timer);
  }, [until, stepMs]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
