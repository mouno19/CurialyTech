import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Bot, Check, CircleX, Info, MessageSquare, RotateCcw, TriangleAlert, Unplug, X } from "lucide-react";
import type { AgentTaskSummary, CreateTaskRequest, TaskMode } from "@shared/agent";
import { isActiveStatus, outcomeIssues } from "@shared/taskStatus";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { StateNotice } from "@/components/common/StateNotice";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { OmniComposer, type ComposerSeed } from "@/components/composer/OmniComposer";
import { StarterTabs } from "@/components/StarterTabs";
import { prefersReducedMotion, useCountUp } from "@/lib/motion";
import type { StarterTask } from "@/lib/starterTasks";
import { agentApi, ApiError, formatTokens, relativeTime, type TaskStats } from "@/lib/api";
import { clockText, refreshAccount, untilText, useAccount } from "@/lib/account";
import { CreditsDialog, creditsLine, refillLine } from "@/components/shell/CreditsMeter";
import { MIN_CREDITS_TO_START, type CreditBalance } from "@shared/credits";
import { useHealth } from "@/lib/appStatus";
import { modeLabel, modelLabel, statusTime, TaskDuration, taskNote, TaskSkeleton, tokenTotal, useTaskList } from "./Tasks";

// Questions start in Chat mode, work in Agent mode.
const QUICK: { text: string; mode: TaskMode }[] = [
  { text: "Create a TypeScript CLI that converts CSV to JSON, with vitest tests and a check script.", mode: "agent" },
  { text: "Write a Python module for rate limiting (token bucket) with pytest tests.", mode: "agent" },
  { text: "Scaffold an Express + zod REST API with typed handlers and passing tsc --noEmit.", mode: "agent" },
  { text: "Explain the trade-offs between SSE and WebSockets for streaming agent logs.", mode: "chat" },
];

const GITHUB_NOTICES: Record<string, { tone: "success" | "warning"; text: string }> = {
  connected: { tone: "success", text: "GitHub connected. Tasks can now clone your repositories, and finished work can be exported to your account." },
  access_denied: { tone: "warning", text: "GitHub sign-in was cancelled, so nothing was connected." },
  missing_repo_scope: { tone: "warning", text: "GitHub didn't grant repository access, which Curialy needs to clone and create repositories. Connect again and approve every requested permission." },
  state_mismatch: { tone: "warning", text: "The GitHub sign-in link expired or was opened in another browser. Start Connect GitHub again from here." },
};

const RECENT = 6;
/** The composer's typing placeholder cycles through these while it is empty and not focused. */
const EXAMPLES = [
  "Build a landing page with a pricing table and a signup form, and make sure the build passes",
  "Find out why the checkout test fails and fix it with a regression test",
  "Migrate this Express API to TypeScript, one module at a time",
  "Explain how auth works in this repo, with file-and-line references",
];
/** The hero's staggered entrance (motion.css .m-rise). */
const step = (index: number) => ({ "--i": index, "--m-dur": "700ms", "--rise-y": "18px" }) as CSSProperties;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const count = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value >= 10_000 ? compact.format(value) : value.toLocaleString());

export default function Dashboard() {
  const [, navigate] = useLocation();
  const list = useTaskList();
  const { activeTasks, summary } = useHealth();
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const account = useAccount().info;
  const [seed, setSeed] = useState<ComposerSeed>();
  const [githubNotice, setGithubNotice] = useState(() => new URLSearchParams(window.location.search).get("github"));
  const quickRef = useRef<HTMLUListElement>(null);
  useOverflowEdges(quickRef, { revealSelected: false });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("github")) window.history.replaceState(null, "", "/");
  }, []);

  const loadStats = useCallback(() => agentApi.stats().then(data => { setStats(data); setStatsFailed(false); }, () => setStatsFailed(true)), []);
  useEffect(() => void loadStats(), [loadStats]);
  // A run that finished (or started) since the last refresh changes the totals too.
  const signature = list.tasks?.map(task => `${task.id}:${task.status}`).join("|") ?? null;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (seen.current !== null && seen.current !== signature) {
      void loadStats();
      void refreshAccount();
    }
    seen.current = signature;
  }, [signature, loadStats]);

  const start = async (request: CreateTaskRequest) => {
    setBusy(true);
    try {
      const { taskId } = await agentApi.create(request);
      void refreshAccount();
      navigate(`/tasks/${taskId}`);
    } catch (error) {
      // Out of credits: say when they refill (local time) and offer a plan or a promo code; the task stays in the composer.
      if (error instanceof ApiError && error.code === "no_credits") {
        void refreshAccount();
        setCreditsOpen(true);
        const balance = (error.data as { credits?: CreditBalance } | undefined)?.credits;
        // Extending a plan adds days, not credits: on the top plan only a promo code adds any before the refill.
        const more = balance?.plan?.id === "max" ? "a promo code adds credits now" : balance?.plan ? "a higher plan or a promo code adds credits now" : balance?.canEarn ? "the X rewards, a plan or a promo code add credits now" : "a plan or a promo code adds credits now";
        throw new Error(balance?.resetsAt
          ? `You're out of credits until ${clockText(balance.resetsAt)} (${untilText(balance.resetsAt)}). Your task stays here; ${more}.`
          : `Your account has no credits right now. Your task stays here; ${more}.`);
      }
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const focusComposer = () => document.getElementById("omni-prompt")?.focus();
  // The composer takes focus without scrolling, so bring it into view (no-op when already visible with "nearest").
  const revealComposer = (block: ScrollLogicalPosition) =>
    document.getElementById("omni-prompt")?.closest(".omni")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block });
  const pickStarter = (task: StarterTask) => {
    setSeed({ text: task.prompt, mode: "agent", team: task.team ?? false, nonce: Date.now() });
    revealComposer("center");
  };
  const notice = githubNotice ? GITHUB_NOTICES[githubNotice] ?? { tone: "warning" as const, text: `Connecting GitHub didn't work (${githubNotice}). Try Connect GitHub again; if it keeps failing, the server log has the details.` } : null;
  const inProgress = list.tasks ? list.tasks.filter(task => isActiveStatus(task.status)).length : activeTasks;

  return (
    <AppShell title="Workspace Dashboard">
      <div className="page">
        <div className="page-narrow">
          {notice && (
            <div className="notice dash-notice" data-tone={notice.tone} role="status">
              {notice.tone === "success" ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
              <div className="notice-body">{notice.text}</div>
              <IconButton size="sm" label="Dismiss" icon={X} tooltip={false} onClick={() => setGithubNotice(null)} />
            </div>
          )}

          <section className="dash-hero" aria-labelledby="dash-title" data-motion="parts">
            <div className="dash-hero-main">
              <p className="eyebrow dash-eyebrow m-rise" style={step(0)}><span className="dash-mark" aria-hidden="true">§</span>Autonomous agent workspace</p>
              <h2 id="dash-title" className="display dash-title m-rise" style={step(1)}>Bring the messy part. <em>Watch every step.</em></h2>
              <p className="dash-lede m-rise" style={step(2)}>
                Describe a task and the agent plans it, edits the files, and runs your checks and tests in a sandbox of its own, fixing what fails.
                Its reasoning, terminal output and diffs stream in while it works.
              </p>
            </div>
            <aside className="dash-margin m-rise" style={step(3)} aria-label="Right now">
              <p className="micro" data-accent="">Right now</p>
              <p className="dash-now">{inProgress > 0 && <span className="spark-dot" data-live="" aria-hidden="true" />}{inProgress ? `${inProgress} ${inProgress === 1 ? "task" : "tasks"} in progress` : "Nothing in progress"}</p>
              <p><Link href="/integrations" className="ink-link">{summary.label}</Link></p>
              {account && !account.credits.unlimited && (
                <p className="dash-credits">
                  <button type="button" className="ink-link" onClick={() => setCreditsOpen(true)}>{creditsLine(account.credits)}</button>
                  <span className="dash-credits-refill">{refillLine(account.credits)}</span>
                  {account.credits.available < MIN_CREDITS_TO_START && <Link href={account.credits.canEarn ? "/billing#rewards" : "/billing"} className="ink-link dash-credits-more">{account.credits.canEarn ? "Earn credits on X" : "Get more credits"}</Link>}
                </p>
              )}
            </aside>
          </section>
          {account && <CreditsDialog open={creditsOpen} onOpenChange={setCreditsOpen} credits={account.credits} />}

          <OmniComposer onSubmit={start} busy={busy} autoFocus seed={seed} examples={EXAMPLES} />

          <div className="dash-quick-wrap">
            <span className="micro dash-quick-label" id="dash-quick-label">Try</span>
            <ul className="dash-quick m-stagger" ref={quickRef} aria-labelledby="dash-quick-label" style={{ "--stagger": "50ms", "--m-delay": "120ms" } as CSSProperties}>
              {QUICK.map(item => (
                <li key={item.text}>
                  <button type="button" className="quick-chip" title={item.text} onClick={() => { setSeed({ text: item.text, mode: item.mode, nonce: Date.now() }); revealComposer("nearest"); }}>
                    {item.mode === "chat" ? <MessageSquare size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
                    <span className="clamp-1">{item.text}</span>
                    <span className="sr-only"> ({item.mode === "chat" ? "starts in Chat mode" : "starts in Agent mode"})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <StatsRow stats={stats} failed={statsFailed} tasks={list.tasks} tasksFailed={Boolean(list.error) && !list.tasks} onRetry={() => void loadStats()} />

          <section className="card dash-recent" aria-labelledby="dash-recent-title">
            <div className="card-head">
              <h2 id="dash-recent-title">Recent tasks</h2>
              <Link href="/tasks" className="btn ghost sm">All tasks <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
            {list.tasks === null ? (
              list.error ? (
                <StateNotice variant="error" size="sm" title="Couldn't load your tasks" actions={<Button size="sm" icon={RotateCcw} busy={list.refreshing} onClick={() => void list.refresh()}>Try again</Button>}>
                  {list.error}
                </StateNotice>
              ) : (
                <TaskSkeleton rows={3} bare />
              )
            ) : list.tasks.length === 0 ? (
              <StateNotice variant="empty" icon="mark" title="Describe what to build or fix" actions={<Button variant="primary" onClick={focusComposer}>Start a task</Button>}>
                Your tasks appear here with their status, model and timing. Each one runs in its own workspace, and you can follow every step as it happens.
              </StateNotice>
            ) : (
              <ul className="recent-list m-stagger" style={{ "--stagger": "45ms" } as CSSProperties}>
                {list.tasks.slice(0, RECENT).map(task => <RecentRow key={task.id} task={task} />)}
              </ul>
            )}
          </section>

          <section className="dash-starters" aria-labelledby="dash-starters-title">
            <div className="dash-starters-head">
              <p className="eyebrow dash-eyebrow"><span className="dash-mark" aria-hidden="true">§</span>Starter tasks</p>
              <h2 id="dash-starters-title" className="dash-starters-title">Not sure where to start? <em>Hand it one of these.</em></h2>
            </div>
            <StarterTabs size="md" idPrefix="dash-starter" useLabel="Put it in the composer" onUse={pickStarter} />
          </section>
        </div>
      </div>
    </AppShell>
  );
}

type Tile = { id: string; label: string; value: number | null | undefined; loading: boolean; icon?: LucideIcon; tone?: string; href: string; hint?: string };

function StatsRow({ stats, failed, tasks, tasksFailed, onRetry }: { stats: TaskStats | null; failed: boolean; tasks: AgentTaskSummary[] | null; tasksFailed: boolean; onRetry: () => void }) {
  const derived = useMemo(() => {
    if (!stats) return null;
    // The server counts issues over every task; older servers did not, so fall back to the list.
    const exact = typeof stats.completedWithIssues === "number";
    if (!exact && !tasks) return null;
    const withIssues = exact ? stats.completedWithIssues! : tasks!.filter(task => task.status === "completed" && outcomeIssues(task.outcome).length > 0).length;
    const clean = Math.max(0, stats.completed - withIssues);
    const finished = stats.completed + stats.failed;
    return { withIssues, clean, rate: finished > 0 ? Math.round((clean / finished) * 100) : null, partial: !exact && tasks && tasks.length < stats.total ? tasks.length : 0 };
  }, [stats, tasks]);

  if (failed && !stats) {
    return (
      <div className="notice dash-stats-error" data-tone="neutral" role="status">
        <Info size={16} aria-hidden="true" />
        <div className="notice-body">The task totals couldn't be loaded.</div>
        <div className="notice-actions"><Button size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button></div>
      </div>
    );
  }
  // An empty workspace has nothing to count: the recent-tasks card explains how to start.
  if (stats && stats.total === 0) return null;

  // Clean vs with-issues needs each run's outcome, which only the task list carries.
  const outcomesLoading = !derived && !tasksFailed;
  const tiles: Tile[] = [
    { id: "total", label: "Tasks", value: stats?.total, loading: !stats, href: "/tasks", hint: stats ? (stats.running ? `${stats.running} active now` : "None active now") : undefined },
    { id: "clean", label: "Completed cleanly", value: derived?.clean, loading: outcomesLoading, icon: Check, tone: "success", href: "/tasks?status=completed" },
    { id: "issues", label: "With issues", value: derived?.withIssues, loading: outcomesLoading, icon: TriangleAlert, tone: "warning", href: "/tasks?status=issues", hint: derived?.partial ? `In the latest ${derived.partial}` : undefined },
    { id: "failed", label: "Failed", value: stats?.failed, loading: !stats, icon: CircleX, tone: "danger", href: "/tasks?status=failed" },
    { id: "interrupted", label: "Interrupted", value: stats?.interrupted, loading: !stats, icon: Unplug, tone: "warning", href: "/tasks?status=interrupted" },
  ];
  const rate = derived?.rate ?? null;
  const rateHint = derived ? (rate === null ? "No finished runs yet" : "Clean completions out of completed and failed runs") : tasksFailed ? "Needs the task list, which didn't load" : "";

  return (
    <section className="dash-stats-wrap" aria-labelledby="dash-stats-title">
      <h2 id="dash-stats-title" className="sr-only">At a glance</h2>
      <div className="dash-stats" aria-busy={!stats || outcomesLoading || undefined}>
        {tiles.map(tile => (
          <Link key={tile.id} href={tile.href} className="dash-stat" data-tone={tile.tone}>
            <span className="dash-stat-label">
              {tile.icon && <tile.icon size={14} aria-hidden="true" />}
              {tile.label}
            </span>
            {tile.loading ? <span className="skeleton dash-stat-skeleton" aria-hidden="true" /> : <StatValue value={tile.value} />}
            {tile.hint && <span className="dash-stat-hint">{tile.hint}</span>}
          </Link>
        ))}
        <div className="dash-stat" data-static="">
          <span className="dash-stat-label">Success rate</span>
          {!stats || outcomesLoading ? <span className="skeleton dash-stat-skeleton" aria-hidden="true" /> : <StatValue value={rate} suffix="%" />}
          {rateHint && <span className="dash-stat-hint">{rateHint}</span>}
          {rate !== null && <span className="dash-meter" aria-hidden="true"><span style={{ width: `${rate}%` }} /></span>}
        </div>
      </div>
    </section>
  );
}

/** A tile's number counts up the first time it is known (static under reduced motion). */
function StatValue({ value, suffix = "" }: { value: number | null | undefined; suffix?: string }) {
  const shown = useCountUp(value);
  return <span className="dash-stat-value tabular">{shown === null || shown === undefined ? "—" : `${count(shown)}${suffix}`}</span>;
}

function RecentRow({ task }: { task: AgentTaskSummary }) {
  const note = taskNote(task);
  const stopped = task.status === "failed" || task.status === "interrupted" || task.status === "cancelled";
  return (
    <li>
      <Link href={`/tasks/${task.id}`} className="recent-row" title={task.prompt}>
        <span className="recent-status"><StatusBadge status={task.status} outcome={task.outcome} reason={task.statusReason} size="sm" /></span>
        <span className="recent-body">
          <span className="recent-prompt clamp-2">{task.prompt}</span>
          {note && <span className="recent-note clamp-1" data-tone={stopped ? "stopped" : "issues"}>{note}{stopped && ` · ${relativeTime(statusTime(task))}`}</span>}
          <span className="recent-meta">
            <span>{modelLabel(task)}</span>
            <span>{modeLabel(task)}</span>
            {task.filesChanged > 0 && <span>{task.filesChanged} {task.filesChanged === 1 ? "file" : "files"}</span>}
            <span>{formatTokens(tokenTotal(task))} tokens</span>
            <span><TaskDuration task={task} /></span>
          </span>
        </span>
        <time className="recent-time" dateTime={task.createdAt}>{relativeTime(task.createdAt)}</time>
      </Link>
    </li>
  );
}
