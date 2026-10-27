import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearch } from "wouter";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Plus, RefreshCw, RotateCcw, Search, TriangleAlert, X } from "lucide-react";
import { getModel, type AgentTaskSummary } from "@shared/agent";
import { displayState, isActiveStatus, outcomeIssues, statusReasonText } from "@shared/taskStatus";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { StateNotice } from "@/components/common/StateNotice";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { agentApi, errorMessage, formatTokens, relativeTime } from "@/lib/api";

// ---------------------------------------------------------------------------------------------
// Shared with the dashboard: the task list with honest polling, durations and status notes
// ---------------------------------------------------------------------------------------------

const POLL_MS = 5000;
const FOCUS_REFRESH_GAP_MS = 3000;

/**
 * GET /tasks, refreshed every 5 s only while a listed task is active and the tab is visible;
 * otherwise once when the tab regains focus. A failed refresh keeps the rows already shown.
 */
export function useTaskList() {
  const [tasks, setTasks] = useState<AgentTaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);
  const loadedAt = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    setRefreshing(true);
    const run = agentApi
      .tasks()
      .then(
        data => {
          if (!alive.current) return;
          setTasks(data.tasks);
          setError(null);
        },
        loadError => {
          if (alive.current) setError(errorMessage(loadError, "Couldn't load tasks."));
        },
      )
      .finally(() => {
        inflight.current = null;
        loadedAt.current = Date.now();
        if (alive.current) setRefreshing(false);
      });
    inflight.current = run;
    return run;
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const anyActive = tasks?.some(task => isActiveStatus(task.status)) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState !== "hidden") await refresh();
        tick();
      }, POLL_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, [anyActive, refresh]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === "hidden" || Date.now() - loadedAt.current < FOCUS_REFRESH_GAP_MS) return;
      void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);

  return { tasks, error, refreshing, refresh, polling: anyActive };
}

// One shared one-second ticker for every live duration on screen.
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
let tickNow = Date.now();
function subscribeTick(listener: () => void) {
  tickListeners.add(listener);
  if (!tickTimer) {
    tickNow = Date.now();
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      tickListeners.forEach(notify => notify());
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (!tickListeners.size && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
}
const useNow = () => useSyncExternalStore(subscribeTick, () => tickNow, () => tickNow);

/** "12s", "3m 05s", "1h 02m", "2d 4h". */
export function formatSpan(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const time = (value: string | undefined) => (value ? Date.parse(value) : NaN);

/** When the latest run started and ended (end null while it is still active). */
export function taskSpan(task: AgentTaskSummary): { start: number; end: number | null } {
  const start = Number.isFinite(time(task.startedAt)) ? time(task.startedAt) : time(task.createdAt);
  if (isActiveStatus(task.status)) return { start, end: null };
  const end = [task.finishedAt, task.statusChangedAt, task.updatedAt].map(time).find(Number.isFinite) ?? NaN;
  return { start, end };
}

/** Run time: live for active tasks, fixed once the run is over. */
export function TaskDuration({ task }: { task: AgentTaskSummary }) {
  const { start, end } = taskSpan(task);
  if (end === null) return <LiveSpan since={start} />;
  return <>{formatSpan(end - start)}</>;
}

function LiveSpan({ since }: { since: number }) {
  const now = useNow();
  return <span className="live-span">{formatSpan(Math.max(0, now - since))}</span>;
}

/** When the task reached its current status (for "Interrupted · 2h ago"). */
export function statusTime(task: AgentTaskSummary) {
  return task.statusChangedAt ?? task.finishedAt ?? task.updatedAt;
}

/** The line that explains a stopped, failed or imperfect run; null for a clean or running one. */
export function taskNote(task: AgentTaskSummary): string | null {
  if (task.status === "completed") {
    const issues = outcomeIssues(task.outcome);
    return issues.length ? issues.join(" · ") : null;
  }
  if (task.status === "failed") return firstLine(task.error) ?? statusReasonText(task.statusReason) ?? "The run stopped with an error";
  if (task.status === "interrupted") return statusReasonText(task.statusReason) ?? "The run stopped before it finished";
  if (task.status === "cancelled") return statusReasonText(task.statusReason) ?? "Cancelled";
  return null;
}

export function firstLine(text: string | null | undefined) {
  const line = text?.split("\n").map(part => part.trim()).find(Boolean);
  return line || null;
}

export const modelLabel = (task: AgentTaskSummary) => (task.model === "auto" ? "Auto" : getModel(task.model)?.label ?? task.model);
export const modeLabel = (task: AgentTaskSummary) => (task.team ? "Dev Team" : task.mode === "chat" ? "Chat" : "Agent");
export const tokenTotal = (task: AgentTaskSummary) => task.usage.inputTokens + task.usage.outputTokens;

const fullDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

export type TaskFilter = "all" | "active" | "completed" | "issues" | "failed" | "interrupted" | "cancelled";

const FILTERS: { id: TaskFilter; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "No tasks" },
  { id: "active", label: "Active", empty: "Nothing is running right now" },
  { id: "completed", label: "Completed", empty: "No clean completions" },
  { id: "issues", label: "With issues", empty: "No runs finished with issues" },
  { id: "failed", label: "Failed", empty: "No failed runs" },
  { id: "interrupted", label: "Interrupted", empty: "No interrupted runs" },
  { id: "cancelled", label: "Cancelled", empty: "No cancelled runs" },
];

/** Every task lands in exactly one group: completed means completed cleanly. */
export function taskGroup(task: AgentTaskSummary): Exclude<TaskFilter, "all"> {
  if (isActiveStatus(task.status)) return "active";
  const state = displayState(task.status, task.outcome);
  if (state === "success") return "completed";
  if (state === "issues") return "issues";
  if (state === "failed") return "failed";
  return task.status === "interrupted" ? "interrupted" : "cancelled";
}

const readFilter = (search: string): TaskFilter => {
  const value = new URLSearchParams(search).get("status");
  return FILTERS.some(item => item.id === value) ? (value as TaskFilter) : "all";
};

function matches(task: AgentTaskSummary, needle: string) {
  if (!needle) return true;
  return [task.prompt, modelLabel(task), task.githubRepo ?? "", task.id].some(value => value.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export default function Tasks() {
  const search = useSearch();
  const [filter, setFilter] = useState<TaskFilter>(() => readFilter(search));
  const [query, setQuery] = useState("");
  const { tasks, error, refreshing, refresh, polling } = useTaskList();
  // Background polls stay quiet; only a refresh the user asked for shows as busy.
  const [manual, setManual] = useState(false);
  const refreshNow = async () => {
    setManual(true);
    await refresh();
    setManual(false);
  };
  const filtersRef = useRef<HTMLDivElement>(null);
  useOverflowEdges(filtersRef);

  // Links such as /tasks?status=failed (dashboard numbers) pick the filter; picking one updates the URL.
  useEffect(() => setFilter(readFilter(search)), [search]);
  const choose = (next: TaskFilter) => {
    setFilter(next);
    window.history.replaceState(window.history.state, "", next === "all" ? "/tasks" : `/tasks?status=${next}`);
  };

  const counts = useMemo(() => {
    const result: Record<TaskFilter, number> = { all: 0, active: 0, completed: 0, issues: 0, failed: 0, interrupted: 0, cancelled: 0 };
    for (const task of tasks ?? []) {
      result.all += 1;
      result[taskGroup(task)] += 1;
    }
    return result;
  }, [tasks]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => (tasks ?? []).filter(task => (filter === "all" || taskGroup(task) === filter) && matches(task, needle)), [tasks, filter, needle]);
  const current = FILTERS.find(item => item.id === filter)!;
  const filtered = filter !== "all" || needle.length > 0;

  const actions: TopbarAction[] = [{ id: "new", label: "New task", icon: Plus, href: "/", priority: "primary", tone: "accent" }];

  return (
    <AppShell title="Live Tasks" topbarActions={actions}>
      <div className="page">
        <div className="page-wide">
          <header className="page-head tasks-head">
            <div>
              <span className="eyebrow">Runs</span>
              <h2 className="page-title">Live Tasks</h2>
              <p className="page-sub">
                {tasks === null ? "Every run, its status and how long it took." : `${counts.all} ${counts.all === 1 ? "task" : "tasks"}${counts.active ? ` · ${counts.active} active` : ""}`}
              </p>
            </div>
          </header>

          <div className="pg-toolbar">
            <div className="pg-filter-scroll" ref={filtersRef}>
              <ToggleGroup.Root type="single" className="segmented pg-filters" aria-label="Filter by status" value={filter} onValueChange={value => value && choose(value as TaskFilter)}>
                {FILTERS.map(item => (
                  <ToggleGroup.Item key={item.id} value={item.id} aria-label={tasks === null ? item.label : `${item.label}, ${counts[item.id]}`}>
                    {item.label}
                    <span className="pg-count" aria-hidden="true">{tasks === null ? "–" : counts[item.id]}</span>
                  </ToggleGroup.Item>
                ))}
              </ToggleGroup.Root>
            </div>
            <div className="input-wrap pg-search">
              <Search size={15} aria-hidden="true" />
              <label className="sr-only" htmlFor="task-search">Search tasks</label>
              <input id="task-search" className="input" type="search" placeholder="Search prompts, models, repositories" value={query} onChange={event => setQuery(event.target.value)} />
              {query && <IconButton className="input-end" size="sm" label="Clear search" icon={X} tooltip={false} onClick={() => setQuery("")} />}
            </div>
          </div>
          <div className="pg-statusline">
            <p role="status">
              {tasks === null ? "" : filtered ? `Showing ${visible.length} of ${counts.all}` : `${counts.all} ${counts.all === 1 ? "task" : "tasks"}, newest first`}
            </p>
            <span className="pg-refresh-note">
              {polling && <span className="dot" data-tone="progress" data-live="" aria-hidden="true" />}
              {polling ? "Updating every 5 s while tasks run" : "Updates when you come back to this tab"}
            </span>
            <IconButton size="sm" label="Refresh the list" icon={RefreshCw} busy={manual} onClick={() => void refreshNow()} />
          </div>

          {error && tasks !== null && (
            <div className="notice pg-notice" data-tone="danger" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body"><strong className="notice-title">Couldn't refresh the list</strong><p>{error} The rows below may be out of date.</p></div>
              <div className="notice-actions"><Button size="sm" icon={RotateCcw} busy={manual} onClick={() => void refreshNow()}>Try again</Button></div>
            </div>
          )}

          {tasks === null ? (
            error ? (
              <div className="card">
                <StateNotice variant="error" title="Couldn't load tasks" actions={<Button variant="primary" icon={RotateCcw} busy={refreshing} onClick={() => void refresh()}>Try again</Button>}>{error}</StateNotice>
              </div>
            ) : (
              <TaskSkeleton />
            )
          ) : tasks.length === 0 ? (
            <div className="card">
              <StateNotice variant="empty" icon="mark" size="lg" title="No tasks yet" actions={<Link href="/" className="btn primary"><Plus size={15} aria-hidden="true" /> New task</Link>}>
                Describe what to build or fix on the dashboard. Every run shows up here with its status, model and timing.
              </StateNotice>
            </div>
          ) : visible.length === 0 ? (
            <div className="card">
              <StateNotice variant="empty" title={needle ? `No tasks match “${query.trim()}”` : current.empty} actions={<Button onClick={() => { setQuery(""); choose("all"); }}>Show all tasks</Button>}>
                {needle ? "Try another word, or clear the search." : "Pick another status to see the rest."}
              </StateNotice>
            </div>
          ) : (
            <>
              <div className="card table-wrap tasks-table-card">
                <table className="data-table tasks-table">
                  <caption className="sr-only">Tasks, newest first</caption>
                  <colgroup>
                    <col />
                    <col className="tasks-col-status" />
                    <col className="tasks-col-model" />
                    <col className="tasks-col-files" />
                    <col className="tasks-col-tokens" />
                    <col className="tasks-col-duration" />
                    <col className="tasks-col-started" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">Status</th>
                      <th scope="col">Model</th>
                      <th scope="col" className="num">Files</th>
                      <th scope="col" className="num">Tokens</th>
                      <th scope="col" className="num">Duration</th>
                      <th scope="col">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(task => <TaskTableRow key={task.id} task={task} />)}
                  </tbody>
                </table>
              </div>
              <ul className="tasks-cards" aria-label="Tasks, newest first">
                {visible.map(task => <TaskCard key={task.id} task={task} />)}
              </ul>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function NoteLine({ task, className }: { task: AgentTaskSummary; className: string }) {
  const note = taskNote(task);
  if (!note) return null;
  const final = !isActiveStatus(task.status) && task.status !== "completed";
  return (
    <span className={className} data-group={taskGroup(task)} title={note}>
      {note}
      {final && <> · {relativeTime(statusTime(task))}</>}
    </span>
  );
}

function TaskTableRow({ task }: { task: AgentTaskSummary }) {
  const tags = [task.mode === "chat" ? "Chat" : null, task.team ? "Dev Team" : null, task.githubRepo ?? null].filter(Boolean) as string[];
  return (
    <tr className="tasks-row">
      <td className="tasks-cell-task">
        <Link href={`/tasks/${task.id}`} className="tasks-link" title={task.prompt}>
          <span className="clamp-2">{task.prompt}</span>
        </Link>
        {(tags.length > 0 || taskNote(task)) && (
          <span className="tasks-sub">
            {tags.map(tag => <span key={tag} className="tasks-tag">{tag}</span>)}
            <NoteLine task={task} className="tasks-note clamp-1" />
          </span>
        )}
      </td>
      <td><StatusBadge status={task.status} outcome={task.outcome} reason={task.statusReason} size="sm" /></td>
      <td className="tasks-model">{modelLabel(task)}</td>
      <td className="num">{task.filesChanged}</td>
      <td className="num">{formatTokens(tokenTotal(task))}</td>
      <td className="num"><TaskDuration task={task} /></td>
      <td className="tasks-started"><time dateTime={task.createdAt}>{relativeTime(task.createdAt)}</time></td>
    </tr>
  );
}

function TaskCard({ task }: { task: AgentTaskSummary }) {
  const thinking = task.usage.thinkingTokens;
  return (
    <li>
      <Link href={`/tasks/${task.id}`} className="card tasks-card" title={task.prompt}>
        <span className="tasks-card-top">
          <StatusBadge status={task.status} outcome={task.outcome} reason={task.statusReason} size="sm" />
          <time className="tasks-card-time" dateTime={task.createdAt} title={fullDate(task.createdAt)}>{relativeTime(task.createdAt)}</time>
        </span>
        <span className="tasks-card-prompt clamp-2">{task.prompt}</span>
        <NoteLine task={task} className="tasks-note clamp-2" />
        <span className="tasks-card-meta">
          <span>{modelLabel(task)}</span>
          <span>{modeLabel(task)}</span>
          {task.githubRepo && <span className="mono truncate">{task.githubRepo}</span>}
          <span>{task.filesChanged} {task.filesChanged === 1 ? "file" : "files"}</span>
          <span>{formatTokens(tokenTotal(task))} tokens{thinking ? ` (${formatTokens(thinking)} thinking)` : ""}</span>
          <span><TaskDuration task={task} /></span>
        </span>
      </Link>
    </li>
  );
}

/** Placeholder rows; `bare` drops the card frame when it sits inside one already. */
export function TaskSkeleton({ rows = 6, bare = false }: { rows?: number; bare?: boolean }) {
  return (
    <div className={bare ? "pg-skeleton" : "card pg-skeleton"}>
      <p className="sr-only" role="status">Loading tasks…</p>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="pg-skeleton-row" aria-hidden="true">
          <span className="skeleton pg-skeleton-badge" />
          <span className="pg-skeleton-lines">
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text" />
          </span>
        </div>
      ))}
    </div>
  );
}
