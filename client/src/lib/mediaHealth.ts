import { useSyncExternalStore } from "react";
import type { MediaHealth } from "./api";

/**
 * One shared view of file storage for every image and link on the page. While storage is
 * unavailable, MediaImage renders no <img src> at all, so 40 thumbnails cost 0 requests.
 * Nothing here retries on a timer: retry() runs only when the user asks (the countdown is
 * display-only), and recovery is also picked up from health answers the app already receives.
 * This module must not import api.ts at runtime (api.ts imports it).
 */
export type MediaHealthStatus = "unknown" | "ok" | "unavailable";
export type MediaHealthState = {
  status: MediaHealthStatus;
  /** Earliest time (ms) a retry may run; null when not waiting. */
  retryAt: number | null;
  /** Failed retries in a row (drives the backoff). */
  attempt: number;
  /** Bumped each time storage comes back: failed images reload. */
  generation: number;
  /** Neutral, user-facing reason from the server, if any. */
  detail: string | null;
  probing: boolean;
};

const BACKOFF_S = [5, 10, 20, 40, 60];
const REPORT_DEBOUNCE_MS = 150;
const REPORT_FRESH_MS = 3000;

let state: MediaHealthState = { status: "unknown", retryAt: null, attempt: 0, generation: 0, detail: null, probing: false };
const listeners = new Set<() => void>();

function set(patch: Partial<MediaHealthState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}

async function fetchHealth(probe: boolean): Promise<MediaHealth> {
  const response = await fetch(`/api/agent/media/health${probe ? "?probe=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`health ${response.status}`);
  return response.json();
}

/**
 * Storage is down: wait at least the server's Retry-After, and at least the current backoff step.
 * Passive observations of an outage already in progress (health polls, a 503 on some request) do
 * not move a running deadline, or the "Check again" button would never become available; only a
 * failed check (retry) starts a new, longer wait.
 */
function markUnavailable(retryAfter?: number | null, detail?: string | null, restart = false) {
  const ongoing = state.status === "unavailable" && state.retryAt !== null;
  if (ongoing && !restart) {
    if (detail && detail !== state.detail) set({ detail });
    return;
  }
  const waitS = Math.max(retryAfter ?? 0, BACKOFF_S[Math.min(state.attempt, BACKOFF_S.length - 1)]);
  set({ status: "unavailable", retryAt: Date.now() + waitS * 1000, detail: detail ?? state.detail });
}

function markOk() {
  if (state.status === "ok") return;
  // Only a recovery (unavailable -> ok) reloads failed images; unknown -> ok changes nothing on screen.
  set({ status: "ok", retryAt: null, attempt: 0, detail: null, generation: state.status === "unavailable" ? state.generation + 1 : state.generation });
}

/**
 * A health answer the app received anyway (the shell's health poll, GET /media). A recovery is
 * only taken once the backoff has passed, so a flapping store cannot cause reload storms.
 */
function observe(health: Pick<MediaHealth, "ok"> & Partial<Pick<MediaHealth, "retryAfter" | "detail">>) {
  if (!health.ok) return markUnavailable(health.retryAfter, health.detail);
  if (state.status === "unavailable" && state.retryAt && Date.now() < state.retryAt) return;
  markOk();
}

let report: Promise<MediaHealthState> | null = null;
let reportedAt = 0;

/**
 * An image failed and we do not know why yet. Debounced and single-flight: a burst of failures
 * (a grid of thumbnails) costs one GET /media/health. Resolves with the store state afterwards.
 */
function reportFailure(): Promise<MediaHealthState> {
  if (state.status === "unavailable") return Promise.resolve(state);
  if (state.status === "ok" && Date.now() - reportedAt < REPORT_FRESH_MS) return Promise.resolve(state);
  report ??= new Promise<MediaHealthState>(resolve => {
    setTimeout(() => {
      fetchHealth(false)
        .then(health => (health.ok ? markOk() : markUnavailable(health.retryAfter, health.detail)))
        .catch(() => undefined)
        .finally(() => {
          reportedAt = Date.now();
          report = null;
          resolve(state);
        });
    }, REPORT_DEBOUNCE_MS);
  });
  return report;
}

let probe: Promise<MediaHealthState> | null = null;

/** User-initiated retry: a no-op before retryAt, otherwise one real probe (GET /media/health?probe=1). */
function retry(): Promise<MediaHealthState> {
  if (state.status !== "unavailable") return Promise.resolve(state);
  if (state.retryAt && Date.now() < state.retryAt) return Promise.resolve(state);
  probe ??= (async () => {
    set({ probing: true });
    try {
      const health = await fetchHealth(true);
      if (health.ok) markOk();
      else {
        set({ attempt: state.attempt + 1 });
        markUnavailable(health.retryAfter, health.detail, true);
      }
    } catch {
      set({ attempt: state.attempt + 1 });
      markUnavailable(null, null, true);
    } finally {
      set({ probing: false });
      probe = null;
    }
    return state;
  })();
  return probe;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const mediaHealth = { get: () => state, subscribe, reportFailure, markUnavailable, markOk, observe, retry };

/** Same as mediaHealth.markUnavailable; named for callers outside the media code (api.ts). */
export const markStorageUnavailable = (retryAfter?: number | null) => markUnavailable(retryAfter);

export function useMediaHealth(): MediaHealthState {
  return useSyncExternalStore(subscribe, mediaHealth.get, mediaHealth.get);
}
