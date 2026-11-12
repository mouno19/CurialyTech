import { useEffect, useSyncExternalStore } from "react";
import type { SupportThreadDetail, SupportThreadSummary } from "@shared/support";
import { api } from "./api";

export const supportApi = {
  unread: () => api<{ unread: number }>("/api/support/unread"),
  threads: () => api<{ threads: SupportThreadSummary[]; unread: number }>("/api/support/threads"),
  thread: (id: string) => api<{ thread: SupportThreadDetail; unread: number }>(`/api/support/threads/${id}`),
  start: (body: { subject: string; body: string }) => api<{ thread: SupportThreadDetail; unread: number }>("/api/support/threads", { method: "POST", json: body }),
  send: (id: string, body: string) => api<{ thread: SupportThreadDetail; unread: number }>(`/api/support/threads/${id}/messages`, { method: "POST", json: { body } }),
  close: (id: string) => api<{ thread: SupportThreadDetail; unread: number }>(`/api/support/threads/${id}/close`, { method: "POST", json: {} }),
};

let unread = 0;
const listeners = new Set<() => void>();
function setUnread(next: number) {
  if (next === unread) return;
  unread = next;
  listeners.forEach(listener => listener());
}

/** The sidebar badge and the page share one count. */
export function publishSupportUnread(next: number) {
  setUnread(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSupportUnread() {
  const count = useSyncExternalStore(subscribe, () => unread, () => 0);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      supportApi.unread().then(result => { if (live) setUnread(result.unread); }, () => undefined);
    };
    load();
    const timer = setInterval(load, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return count;
}
