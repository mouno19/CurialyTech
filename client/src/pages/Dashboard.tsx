import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ListTodo } from "lucide-react";
import { getModel, type AgentTaskSummary, type CreateTaskRequest } from "@shared/agent";
import { AppShell, EmptyState } from "@/components/shell/AppShell";
import { OmniComposer } from "@/components/composer/OmniComposer";
import { agentApi, formatTokens, relativeTime } from "@/lib/api";
import { TaskStatusIcon } from "./Tasks";

const QUICK = [
  "Create a TypeScript CLI that converts CSV to JSON, with vitest tests and a check script.",
  "Write a Python module for rate limiting (token bucket) with pytest tests.",
  "Scaffold an Express + zod REST API with typed handlers and passing tsc --noEmit.",
  "Explain the trade-offs between SSE and WebSockets for streaming agent logs.",
];

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [tasks, setTasks] = useState<AgentTaskSummary[] | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof agentApi.stats>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number }>();
  const [githubNotice] = useState(() => new URLSearchParams(window.location.search).get("github"));
  useEffect(() => { if (githubNotice) window.history.replaceState(null, "", "/"); }, [githubNotice]);

  useEffect(() => {
    agentApi.tasks().then(data => setTasks(data.tasks)).catch(() => setTasks([]));
    agentApi.stats().then(setStats).catch(() => undefined);
  }, []);

  const start = async (request: CreateTaskRequest) => {
    setBusy(true);
    try {
      const { taskId } = await agentApi.create(request);
      navigate(`/tasks/${taskId}`);
    } finally {
      setBusy(false);
    }
  };

  const tokens = tasks?.reduce((sum, task) => sum + task.usage.inputTokens + task.usage.outputTokens, 0) ?? 0;
  const successRate = stats && stats.completed + stats.failed > 0 ? Math.round((stats.completed / (stats.completed + stats.failed)) * 100) : null;

  return (
    <AppShell title="Workspace Dashboard">
      <div className="page">
        <div className="page-narrow">
          {githubNotice && (
            <div className={`alert ${githubNotice === "connected" ? "info" : "warn"}`} style={{ marginTop: 20 }}>
              {githubNotice === "connected" ? "GitHub connected. Completed agent projects can now be exported to your account and deployed from your repos."
                : githubNotice === "access_denied" ? "GitHub authorization was cancelled."
                : githubNotice === "missing_repo_scope" ? "GitHub did not grant the repo scope, which is required to create repositories. Try connecting again and approve all requested permissions."
                : githubNotice === "state_mismatch" ? "The GitHub sign-in link expired or did not match this browser. Start Connect GitHub again."
                : `GitHub connection failed (${githubNotice}). Check the server log and try again.`}
            </div>
          )}
          <section className="hero">
            <span className="eyebrow">Autonomous agent workspace</span>
            <h2>Bring the messy part. <em>Watch every step.</em></h2>
            <p>The agent plans, reasons, edits files, runs typechecks and tests in an isolated sandbox, and heals its own failures. Its thinking, terminal output and diffs stream live.</p>
          </section>
          <OmniComposer onSubmit={start} busy={busy} autoFocus seed={seed} />
          <div className="quick">
            {QUICK.map(text => <button key={text} type="button" onClick={() => setSeed({ text, nonce: Date.now() })}>{text.length > 64 ? `${text.slice(0, 62)}…` : text}</button>)}
          </div>

          <div className="grid grid-4" style={{ marginTop: 32 }}>
            <div className="card stat"><div className="label">Tasks run</div><div className="value">{stats?.total ?? "—"}</div></div>
            <div className="card stat"><div className="label">Success rate</div><div className="value">{successRate === null ? "—" : `${successRate}%`}</div></div>
            <div className="card stat"><div className="label">Files changed</div><div className="value">{stats?.filesChanged ?? "—"}</div></div>
            <div className="card stat"><div className="label">Tokens (recent)</div><div className="value">{tasks ? formatTokens(tokens) : "—"}</div></div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>Recent tasks</h2>
              <Link href="/tasks" className="btn ghost sm">All tasks <ArrowRight size={13} /></Link>
            </div>
            {tasks === null && <div className="empty">Loading…</div>}
            {tasks?.length === 0 && <EmptyState icon={ListTodo} title="No tasks yet">Describe something above to start the first run.</EmptyState>}
            {tasks?.slice(0, 8).map(task => (
              <Link key={task.id} href={`/tasks/${task.id}`} className="task-row">
                <TaskStatusIcon status={task.status} />
                <div style={{ minWidth: 0 }}>
                  <div className="prompt truncate">{task.prompt}</div>
                  <div className="meta"><span>{getModel(task.model)?.label ?? task.model}</span><span>{task.mode}</span>{task.filesChanged > 0 && <span>{task.filesChanged} files</span>}</div>
                </div>
                <span className="chip mono">{formatTokens(task.usage.inputTokens + task.usage.outputTokens)} tok</span>
                <span className="faint" style={{ fontSize: 11.5 }}>{relativeTime(task.createdAt)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
