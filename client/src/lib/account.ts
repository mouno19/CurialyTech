import { useEffect, useSyncExternalStore } from "react";
import { accountApi, type AccountInfo } from "./api";

// The signed-in account and its credits, shared by the sidebar meter, the composer and the
// dashboard. Refreshed every minute while the page is visible, and right after anything that spends
// or adds credits (a task starts or ends, a code is redeemed).

type State = { info: AccountInfo | null; error: string | null; loading: boolean };
let state: State = { info: null, error: null, loading: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
};

let inflight: Promise<void> | null = null;
export function refreshAccount() {
  inflight ??= (async () => {
    set({ loading: true });
    try {
      set({ info: await accountApi.get(), error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Couldn't load your account." });
    } finally {
      set({ loading: false });
      inflight = null;
    }
  })();
  return inflight;
}

let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshAccount();
    timer = setInterval(() => { if (document.visibilityState === "visible") void refreshAccount(); }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useAccount() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  // Coming back to the tab shows current credits at once.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refreshAccount(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return snapshot;
}

/** "in 2 h 14 min" / "in 6 min" until an ISO time. */
export function untilText(iso: string, now = Date.now()) {
  const minutes = Math.max(1, Math.ceil((Date.parse(iso) - now) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

export const clockText = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
