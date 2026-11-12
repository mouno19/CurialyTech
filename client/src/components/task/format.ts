import type { StatusReason } from "@shared/agent";
import { isVendorUrl, maskPreviewToken } from "@/lib/taskStream";

/** Tab and badge counts: tabular, capped. */
export const capCount = (count: number) => (count > 999 ? "999+" : String(count));

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "14:32" today, "Oct 26, 14:32" otherwise; null for a missing or invalid time. */
export function formatClock(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay(date, new Date()) ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export const fullDate = (value: string | number) => new Date(value).toLocaleString();

/** Why a run was interrupted, as the end of a sentence ("Interrupted — the server restarted while this ran"). */
export function interruptedCause(reason: StatusReason | null | undefined) {
  if (reason === "server_restart") return "the server restarted while this ran";
  if (reason === "worker_lost") return "the worker running it stopped unexpectedly";
  if (reason === "lease_expired") return "the worker running it stopped responding";
  return "it stopped before it could finish";
}

/**
 * A preview site's name without the hosting provider's domain ("curialy-preview-8de5e53e"):
 * the public address is a vendor host, which the UI never prints.
 */
export function deploymentName(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (/^\/p\/[^/]+/.test(parsed.pathname)) return parsed.host;
    return isVendorUrl(url) ? parsed.hostname.split(".")[0] : parsed.hostname;
  } catch {
    return null;
  }
}

/** The page a browser session is on, safe to print (preview tokens masked, vendor pages hidden). */
export function displayAddress(url: string) {
  if (!url || url === "about:blank") return "";
  if (isVendorUrl(url)) return "a Curialy service page";
  return maskPreviewToken(url).replace(/^https?:\/\//, "");
}

export function newClientId() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* insecure context: fall through */
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Per-viewer preferences: storage can be missing or throw (private windows); never required. */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* the choice lasts for this page */
    }
  },
  session(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setSession(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* the choice lasts for this page */
    }
  },
};
