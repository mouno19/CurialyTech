// The dashboard composer's saved preferences (this browser) and unsent draft (this tab), shared
// with the homepage: a task typed there is waiting in the composer after signing in.

export const PREFS_KEY = "curialy.composer.v2";
export const DRAFT_KEY = "curialy.composer.draft";

export function readDraft() {
  try { return sessionStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; }
}

/** Whether the draft could be stored (private modes and blocked storage refuse). */
export function writeDraft(text: string) {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text);
    else sessionStorage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand a task to the workspace composer: the text as its draft, in Agent mode, solo or Dev Team.
 * False when this browser would not store it (the caller says so instead of "saved").
 */
export function handOffTask(text: string, team: boolean) {
  if (!writeDraft(text)) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...saved, mode: "agent", team }));
  } catch { /* the draft alone still arrives, in the composer's saved mode */ }
  return true;
}
