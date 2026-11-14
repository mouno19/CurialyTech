import type { SearchState } from "@/lib/taskStream";

// What the chat says about a web search (pure; tested in webSearch.test.ts). The stream gives the
// facts: the request is out, results are back, the model moved on, nothing matched, or the search
// did not run. "Finding relevant sources" is the same request taking longer than a moment.

export type SearchPhase = "searching" | "finding" | "reviewing" | "found" | "empty" | "unavailable" | "stopped";

/** After this long without results, the search is still out finding them. */
export const FINDING_AFTER_MS = 1500;

export function searchPhase(state: SearchState, elapsedMs: number): SearchPhase {
  if (state === "searching") return elapsedMs >= FINDING_AFTER_MS ? "finding" : "searching";
  return state;
}

export const SEARCH_LABELS: Record<SearchPhase, string> = {
  searching: "Searching the web…",
  finding: "Finding relevant sources…",
  reviewing: "Reviewing sources…",
  found: "Sources found",
  empty: "No relevant sources found",
  unavailable: "Web search unavailable",
  stopped: "Search stopped",
};

/** The search is still going (the indicator moves). */
export const searchActive = (phase: SearchPhase) => phase === "searching" || phase === "finding" || phase === "reviewing";

/** One line for screen readers when the state changes. */
export function searchAnnouncement(phase: SearchPhase, count: number, reason?: string) {
  const sources = `${count} ${count === 1 ? "source" : "sources"}`;
  if (phase === "reviewing") return `Reviewing ${sources}.`;
  if (phase === "found") return `Sources found: ${sources}.`;
  if (phase === "unavailable") return `Web search unavailable${reason ? `: ${reason}` : ""}.`;
  return SEARCH_LABELS[phase];
}

/** The letter that stands for a site: "nodejs.org" N, "en.wikipedia.org" W, "docs.github.com" G. */
export function monogram(domain: string) {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  const name = labels.length > 2 && /^(www\d?|m|en|docs|blog|news|developer|developers|support|help|api)$/.test(labels[0]) ? labels[1] : labels[0] ?? "";
  return (name.match(/[a-z0-9]/)?.[0] ?? "•").toUpperCase();
}

/** "Nov 12, 2026" for a YYYY-MM-DD publication date (the day as published, in no time zone). */
export function sourceDate(day: string) {
  const at = Date.parse(`${day}T12:00:00Z`);
  return Number.isNaN(at) ? day : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "0.8 s", "3 s", "1 min 4 s". */
export function searchDuration(ms: number) {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
