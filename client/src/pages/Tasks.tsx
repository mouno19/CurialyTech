import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, CircleSlash, ListTodo, Loader2, Plus, XCircle } from "lucide-react";
import { getModel, PHASES, type AgentTaskSummary, type TaskStatus } from "@shared/agent";
import { AppShell, EmptyState } from "@/components/shell/AppShell";
import { agentApi, formatDuration, formatTokens, relativeTime } from "@/lib/api";

export function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === "completed") return <CheckCircle2 size={16} color="var(--mint)" />;
  if (status === "failed") return <XCircle size={16} color="var(--red)" />;
  if (status === "cancelled") return <CircleSlash size={16} color="var(--amber)" />;
  return <Loader2 size={16} className="spin" color="var(--violet)" />;
}

const FILTERS = ["all", "running", "completed", "failed", "cancelled"] as const;

export default function Tasks() {
  const [tasks, setTasks] = useState<AgentTaskSummary[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => agentApi.tasks().then(data => alive && setTasks(data.tasks)).catch(() => alive && setTasks([]));
    load();
    const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const visible = (tasks ?? []).filter(task => (filter === "all" || task.status === filter || (filter === "running" && task.status === "queued")) && task.prompt.toLowerCase().includes(query.toLowerCase()));

  return (
    <AppShell title="Live Tasks" actions={<Link href="/" className="btn primary sm"><Plus size={13} /> New task</Link>}>
      <div className="page">
        <div className="row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
          <div className="segmented">
            {FILTERS.map(item => <button key={item} className={filter === item ? "on" : ""} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
          </div>
          <input className="input" style={{ maxWidth: 280, height: 30 }} placeholder="Filter by prompt…" value={query} onChange={event => setQuery(event.target.value)} />
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 12 }}>Auto-refreshing every 3s</span>
        </div>
        <div className="card">
          {tasks === null ? <div className="empty">Loading…</div> : visible.length === 0 ? (
            <EmptyState icon={ListTodo} title={tasks.length ? "No tasks match" : "No tasks yet"}>{tasks.length ? "Try another filter." : "Start one from the dashboard."}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th /><th>Task</th><th>Phase</th><th>Model</th><th>Mode</th><th>Files</th><th>Tokens</th><th>Duration</th><th>Started</th></tr></thead>
                <tbody>
                  {visible.map(task => {
                    const duration = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
                    return (
                      <tr key={task.id}>
                        <td><TaskStatusIcon status={task.status} /></td>
                        <td style={{ maxWidth: 420 }}><Link href={`/tasks/${task.id}`} className="truncate" style={{ display: "block" }}>{task.prompt}</Link>{task.error && <div className="faint truncate" style={{ fontSize: 11.5 }}>{task.error}</div>}</td>
                        <td>{task.phase ? <span className="chip">{PHASES.find(phase => phase.id === task.phase)?.label}</span> : <span className="faint">—</span>}</td>
                        <td className="num">{getModel(task.model)?.label ?? task.model}</td>
                        <td>{task.team ? <span className="chip violet">Dev Team</span> : task.mode}</td>
                        <td className="num">{task.filesChanged}</td>
                        <td className="num">{formatTokens(task.usage.inputTokens + task.usage.outputTokens)}{task.usage.thinkingTokens ? ` (${formatTokens(task.usage.thinkingTokens)} think)` : ""}</td>
                        <td className="num">{task.status === "running" ? "running" : formatDuration(duration)}</td>
                        <td className="faint" style={{ whiteSpace: "nowrap" }}>{relativeTime(task.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
