import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTaskSummary } from "@shared/agent";
import { agentApi, ApiError, errorMessage, type TaskDetail } from "@/lib/api";

export type TaskRow = { detail: TaskDetail; at: number };

/**
 * The stored task row (GET /tasks/:id): the authority once a run's stream has ended. `at` is when
 * it was read, so it can be weighed against newer knowledge (a sync message, a done event).
 */
export function useTaskRow(id: string) {
  const [row, setRow] = useState<TaskRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    if (!id) return Promise.resolve();
    // Stamped with the request time: an answer that was already on its way when an action changed
    // the task must not count as newer than that action.
    const asked = Date.now();
    inflight.current ??= agentApi
      .task(id)
      .then(detail => {
        if (!alive.current) return;
        setRow({ detail, at: asked });
        setError(null);
      })
      .catch(failure => {
        if (!alive.current) return;
        if (failure instanceof ApiError && failure.status === 404) setMissing(true);
        else setError(errorMessage(failure, "Couldn't load the task."));
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** A row someone else already fetched (the stream's reconnect check). */
  const accept = useCallback((detail: TaskDetail) => {
    if (alive.current) setRow({ detail, at: Date.now() });
  }, []);

  /** Local knowledge after an action (export, repo link) until the next fetch. */
  const patch = useCallback((changes: Partial<AgentTaskSummary>) => {
    setRow(current => (current ? { ...current, detail: { ...current.detail, task: { ...current.detail.task, ...changes } } } : current));
  }, []);

  return { row, error, missing, reload, accept, patch };
}

/** Run `task` every `ms` while enabled and the tab is visible; once more when the tab comes back. */
export function usePoll(task: () => unknown, ms: number, enabled: boolean) {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
      timer = setTimeout(tick, ms);
    };
    timer = setTimeout(tick, ms);
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}
