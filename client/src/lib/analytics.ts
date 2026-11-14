import type { PageHit } from "@shared/analytics";

// Page views for the operator's Analytics page: the path, where a visit came from (its referrer,
// campaign or referral code, on its first page only), the time zone (for the country), the
// language, and how long the page stayed visible. No cookie: the server keeps no IP address, and a
// browser that asks not to be tracked (Do Not Track, Global Privacy Control) sends nothing.

const SEEN_KEY = "curialy.seen.v1";

/** Read once per page load: the first visit of this browser counts as new. */
const returning = (() => {
  try {
    const seen = localStorage.getItem(SEEN_KEY) === "1";
    localStorage.setItem(SEEN_KEY, "1");
    return seen;
  } catch {
    return false;
  }
})();

let current: { viewId: string; visibleMs: number; since: number | null } | null = null;
let entrySent = false;

function optedOut() {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
  } catch {
    return false;
  }
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function post(path: string, body: unknown, beacon = false) {
  const text = JSON.stringify(body);
  try {
    if (beacon && navigator.sendBeacon?.(path, new Blob([text], { type: "application/json" }))) return;
    void fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: text, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    // Never in the page's way.
  }
}

/** Report how long the current page was visible. */
function leave() {
  if (!current) return;
  const ms = Math.round(current.visibleMs + (current.since !== null ? Date.now() - current.since : 0));
  post("/api/analytics/leave", { viewId: current.viewId, ms }, true);
  current = null;
}

/** A page opened (the first one of a load is the visit's entry). */
export function trackPage(path: string) {
  if (optedOut()) return;
  leave();
  const viewId = newId();
  current = { viewId, visibleMs: 0, since: document.visibilityState === "visible" ? Date.now() : null };
  const entry = !entrySent;
  entrySent = true;
  const params = new URLSearchParams(window.location.search);
  let timeZone: string | undefined;
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* left out */ }
  const hit: PageHit = {
    viewId, path, entry, timeZone, language: navigator.language, returning, width: window.innerWidth,
    ...(entry ? { referrer: document.referrer, utmSource: params.get("utm_source"), utmMedium: params.get("utm_medium"), utmCampaign: params.get("utm_campaign"), ref: params.get("ref") } : {}),
  };
  post("/api/analytics/hit", hit);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!current) return;
    if (document.visibilityState === "hidden") {
      if (current.since !== null) current.visibleMs += Date.now() - current.since;
      current.since = null;
    } else if (current.since === null) {
      current.since = Date.now();
    }
  });
  window.addEventListener("pagehide", leave);
}
