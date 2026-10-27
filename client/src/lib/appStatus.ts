import { useSyncExternalStore } from "react";
import { agentApi, ApiError, errorMessage, type GitHubStatus, type HealthResponse, type ProviderProbe } from "./api";
import { mediaHealth } from "./mediaHealth";

/**
 * App-wide status stores shared by every mount. AppShell remounts on each page, so these must
 * not refetch on navigation: data is cached here, polling continues across remounts.
 */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch: Partial<T>) {
      value = { ...value, ...patch };
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Health: GET /api/agent/health. 30 s while healthy; 5, 10, 20 ... 300 s while something is
// degraded; paused while the tab is hidden. Problems that need an operator (storage "not set up",
// "not configured") are not transient and do not speed polling up.
// ---------------------------------------------------------------------------------------------

export type HealthSnapshot = {
  providers: ProviderProbe[] | null; // null until the first answer
  activeTasks: number;
  error: string | null; // the last check failed (network or server)
  checkedAt: number | null;
  checking: boolean;
};

const HEALTHY_MS = 30_000;
const DEGRADED_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
const STOP_GRACE_MS = 15_000;

const health = createStore<HealthSnapshot>({ providers: null, activeTasks: 0, error: null, checkedAt: null, checking: false });
let degradedStreak = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let healthSubscribers = 0;
let unauthorized = false;

/** Needs an operator (setup or configuration), so polling faster would not help. */
export function needsOperator(probe: ProviderProbe) {
  return !probe.configured || /not set up|not configured|an operator needs/i.test(probe.detail);
}
export const isTransientIssue = (probe: ProviderProbe) => probe.configured && !probe.ok && !needsOperator(probe);

const nextDelay = () => (degradedStreak === 0 ? HEALTHY_MS : DEGRADED_MS[Math.min(degradedStreak, DEGRADED_MS.length) - 1]);
const polling = () => healthSubscribers > 0 && !unauthorized && document.visibilityState !== "hidden";

function schedule() {
  clearTimeout(timer);
  if (!polling()) return;
  const due = (health.get().checkedAt ?? 0) + nextDelay();
  timer = setTimeout(() => void checkHealth(), Math.max(0, due - Date.now()));
}

function apply(data: HealthResponse) {
  health.set({ providers: data.providers, activeTasks: data.activeTasks, error: null, checkedAt: Date.now(), checking: false });
  degradedStreak = data.providers.some(isTransientIssue) ? degradedStreak + 1 : 0;
  // The storage probe answers from the server's memory: free information for the media store.
  const vault = data.providers.find(probe => probe.id === "vault");
  if (vault) mediaHealth.observe({ ok: vault.ok, detail: vault.ok ? undefined : vault.detail });
}

/** Run a check now (deduped with one in flight). deep=true asks the server for live end-to-end probes. */
export function checkHealth(deep = false): Promise<void> {
  if (inflight && !deep) return inflight;
  health.set({ checking: true });
  const run = agentApi
    .health(deep)
    .then(apply, error => {
      if (error instanceof ApiError && error.status === 401) unauthorized = true;
      health.set({ error: errorMessage(error, "Status check failed."), checkedAt: Date.now(), checking: false });
      degradedStreak += 1;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
      schedule();
    });
  inflight = run;
  return run;
}

function onVisibility() {
  if (document.visibilityState === "hidden") clearTimeout(timer);
  else schedule();
}

function subscribeHealth(listener: () => void) {
  const unsubscribe = health.subscribe(listener);
  healthSubscribers += 1;
  if (healthSubscribers === 1) {
    clearTimeout(stopTimer);
    unauthorized = false;
    document.addEventListener("visibilitychange", onVisibility);
    // Fetches at once only when there is no fresh answer (a remount within the interval does not refetch).
    if (!inflight) schedule();
  }
  return () => {
    unsubscribe();
    healthSubscribers -= 1;
    if (healthSubscribers === 0) {
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        if (healthSubscribers > 0) return;
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
      }, STOP_GRACE_MS);
    }
  };
}

export type HealthTone = "success" | "warning" | "danger" | "neutral";
export type HealthSummary = {
  /** Configured services that answered ok / configured services. */
  ok: number;
  total: number;
  tone: HealthTone;
  /** "9/10 systems ok", "Checking systems…", "Status unavailable" */
  label: string;
  /** Configured services that are not ok. */
  issues: ProviderProbe[];
};

const CRITICAL = new Set(["core", "data"]);

export function summarizeHealth(snapshot: Pick<HealthSnapshot, "providers" | "error">): HealthSummary {
  const { providers, error } = snapshot;
  if (!providers) return { ok: 0, total: 0, tone: "neutral", label: error ? "Status unavailable" : "Checking systems…", issues: [] };
  const configured = providers.filter(probe => probe.configured);
  const issues = configured.filter(probe => !probe.ok);
  const ok = configured.length - issues.length;
  const tone: HealthTone = !configured.length ? "neutral" : issues.some(probe => CRITICAL.has(probe.id)) ? "danger" : issues.length ? "warning" : "success";
  return { ok, total: configured.length, tone, label: configured.length ? `${ok}/${configured.length} systems ok` : "No systems configured", issues };
}

/** Non-React access (subscribing starts polling, like a mounted useHealth). */
export const healthStatus = { get: health.get, subscribe: subscribeHealth, check: checkHealth };

export function useHealth() {
  const snapshot = useSyncExternalStore(subscribeHealth, health.get, health.get);
  return { ...snapshot, summary: summarizeHealth(snapshot), refresh: checkHealth };
}

// ---------------------------------------------------------------------------------------------
// GitHub connection: fetched once and cached; refresh() after connecting/disconnecting.
// ---------------------------------------------------------------------------------------------

export type GitHubSnapshot = { status: GitHubStatus | null; loading: boolean; error: string | null; loadedAt: number | null };

const GITHUB_STALE_MS = 5 * 60_000;
const github = createStore<GitHubSnapshot>({ status: null, loading: false, error: null, loadedAt: null });
let githubInflight: Promise<GitHubStatus | null> | null = null;

export function refreshGitHub(): Promise<GitHubStatus | null> {
  githubInflight ??= (async () => {
    github.set({ loading: true });
    try {
      const status = await agentApi.github();
      github.set({ status, loading: false, error: null, loadedAt: Date.now() });
      return status;
    } catch (error) {
      github.set({ loading: false, error: errorMessage(error, "Could not check GitHub."), loadedAt: Date.now() });
      return github.get().status;
    } finally {
      githubInflight = null;
    }
  })();
  return githubInflight;
}

function subscribeGitHub(listener: () => void) {
  const unsubscribe = github.subscribe(listener);
  const { loadedAt } = github.get();
  if (!githubInflight && (!loadedAt || Date.now() - loadedAt > GITHUB_STALE_MS)) void refreshGitHub();
  return unsubscribe;
}

export const githubStatus = { get: github.get, subscribe: subscribeGitHub, refresh: refreshGitHub };

/** { status, loading, error, refresh }. status is null while loading or when the check failed. */
export function useGitHub() {
  const snapshot = useSyncExternalStore(subscribeGitHub, github.get, github.get);
  return { ...snapshot, refresh: refreshGitHub };
}
