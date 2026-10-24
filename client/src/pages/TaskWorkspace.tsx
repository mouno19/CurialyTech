import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Markdown } from "@/components/Markdown";
import { ArrowUp, Bot, Brain, CircleStop, Copy, ExternalLink, FileDiff, Globe, Loader2, RefreshCcw, Rocket, ScrollText, SquareTerminal, Trash2, User, Workflow } from "lucide-react";
import { getModel, type AgentTaskSummary } from "@shared/agent";
import { AppShell, EmptyState, GitHubMark, useGitHub } from "@/components/shell/AppShell";
import { RepoSelector } from "@/components/RepoSelector";
import { LiveBrowser } from "@/components/LiveBrowser";
import { DiffViewer } from "@/components/deck/DiffViewer";
import { PhaseStepper, PlanView, ThinkingBlock, TimelineEntry, ToolCard } from "@/components/deck/Timeline";
import { agentApi, formatTokens } from "@/lib/api";
import { totals, useTaskStream, type StreamState, type TimelineItem, type TurnUsage } from "@/lib/taskStream";

type DeckTab = "activity" | "thinking" | "terminal" | "changes" | "preview" | "raw";

function useNarrow() {
  const query = "(max-width: 860px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function StatusChip({ status, live }: { status: string | null; live?: boolean }) {
  const tone = status === "completed" ? "mint" : status === "failed" ? "red" : status === "cancelled" ? "amber" : "violet";
  return <span className={`chip ${tone}`}>{(status === "running" || live) && <span className="dot live" />}{status ?? "loading"}</span>;
}

function Conversation({ state, task }: { state: StreamState; task: AgentTaskSummary | null }) {
  const bottom = useRef<HTMLDivElement>(null);
  const messages = state.items.filter((item): item is Extract<TimelineItem, { kind: "user" | "text" | "browser" }> => item.kind === "user" || item.kind === "text" || item.kind === "browser");
  const lastText = [...messages].reverse().find((item): item is Extract<TimelineItem, { kind: "text" }> => item.kind === "text");
  const finished = state.status === "completed" || state.status === "failed" || state.status === "cancelled";
  const [copied, setCopied] = useState(false);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length, lastText?.text.length]);

  if (!messages.length && task) {
    messages.push({ kind: "user", id: "prompt", text: task.prompt, ts: task.createdAt });
  }
  return (
    <div className="convo">
      {messages.map(item => {
        if (item.kind === "user") return <div key={item.id} className="msg-user">{item.text}</div>;
        if (item.kind === "browser") return state.browsers[item.id] ? <LiveBrowser key={`b-${item.id}`} browser={state.browsers[item.id]} /> : null;
        const isFinal = finished && item === lastText;
        return (
          <div key={item.id} className={`msg-assistant${isFinal ? " msg-final" : " interim"}`}>
            {isFinal && (
              <div className="msg-label">
                <Bot size={13} /> Final output
                <span className="spacer" />
                <button className="icon-btn sm" title="Copy answer" onClick={() => { void navigator.clipboard.writeText(item.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}><Copy size={13} /></button>
                {copied && <span className="faint">Copied</span>}
              </div>
            )}
            <Markdown text={item.text || " "} />
            {!item.done && <span className="caret" />}
          </div>
        );
      })}
      {state.status === "running" && !messages.some(item => item.kind === "text" && !item.done) && (
        <div className="row faint" style={{ fontSize: 12.5 }}><Loader2 size={14} className="spin" /> Working — follow every step in the inspection deck.</div>
      )}
      {state.status === "failed" && task?.error && <div className="alert error">{task.error}</div>}
      <div ref={bottom} />
    </div>
  );
}

function FollowUp({ taskId, disabled, onSent }: { taskId: string; disabled: boolean; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim() || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await agentApi.followUp(taskId, text.trim());
      setText("");
      onSent();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="convo-foot">
      <div className="convo-foot-inner">
        <div className="composer compact">
          <textarea value={text} disabled={disabled} placeholder={disabled ? "The agent is working…" : "Follow up: ask for changes, fixes or explanations…"} onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
          <div className="composer-bar">
            <span className="composer-hint" style={{ marginLeft: 0 }}>Continues in the same workspace and conversation</span>
            <span className="spacer" />
            <button className="btn primary sm" onClick={() => void send()} disabled={disabled || busy || !text.trim()}>{busy ? <Loader2 size={13} className="spin" /> : <ArrowUp size={13} />} Send</button>
          </div>
        </div>
        {error && <div className="alert error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

function WorkspacePreview({ taskId, refreshKey, running }: { taskId: string; refreshKey: number; running: boolean }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof agentApi.preview>> | null>(null);
  const [frame, setFrame] = useState(0);
  const [shot, setShot] = useState<Awaited<ReturnType<typeof agentApi.previewScreenshot>> | null>(null);
  const [shooting, setShooting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { agentApi.preview(taskId).then(setInfo).catch(() => setInfo({ available: false })); }, [taskId, refreshKey]);
  if (!info) return <div className="faint" style={{ fontSize: 12 }}>Checking the workspace for a web build…</div>;
  if (!info.available) {
    return <EmptyState icon={Rocket} title="No web build in the workspace yet">When the agent builds a site (index.html in dist/, build/, out/, public/ or the root) it appears here. {info.workspace === false ? "This workspace is archived; send a follow-up to restore it." : ""}</EmptyState>;
  }
  const screenshot = async () => {
    setShooting(true);
    setError(null);
    try { setShot(await agentApi.previewScreenshot(taskId)); } catch (shotError) { setError(shotError instanceof Error ? shotError.message : "Screenshot failed"); } finally { setShooting(false); }
  };
  return (
    <>
      <div className="preview-bar">
        <span className="chip mint">workspace preview</span>
        <span className="mono faint" style={{ fontSize: 12 }}>{info.dir === "." ? "./" : `${info.dir}/`}</span>
        <span className="spacer" />
        <button className="icon-btn sm" title="Reload" onClick={() => { setFrame(value => value + 1); void agentApi.preview(taskId).then(setInfo); }}><RefreshCcw size={13} /></button>
        <a className="icon-btn sm" href={info.url} target="_blank" rel="noreferrer" title="Open in a new tab"><ExternalLink size={13} /></a>
        <button className="btn sm" disabled={shooting || running} onClick={() => void screenshot()} title="Render in a Browserbase cloud Chromium">{shooting ? <Loader2 size={13} className="spin" /> : <Globe size={13} />} Screenshot in Browserbase</button>
      </div>
      {info.warnings && info.warnings.length > 0 && <div className="alert warn">index.html uses absolute asset paths ({info.warnings.join(", ")}), which won't load in the preview. Ask the agent to build with relative paths (Vite: base: './').</div>}
      <iframe key={`${frame}-${refreshKey}`} className="preview-frame" src={info.url} title="Workspace preview" sandbox="allow-scripts allow-forms allow-popups allow-modals" />
      <div className="faint" style={{ fontSize: 11.5 }}>Sandboxed: the page runs with an isolated origin (no cookies or localStorage). Use Deploy for a full-fidelity public URL.</div>
      {error && <div className="alert error">{error}</div>}
      {shot && (
        <figure className="tl media">
          {shot.image && <a href={shot.image} target="_blank" rel="noreferrer"><img src={shot.image} alt="Browserbase screenshot" /></a>}
          <figcaption>
            <Globe size={12} /> HTTP {shot.status ?? "?"} · {shot.title || "untitled"} · {shot.consoleErrors.length ? `${shot.consoleErrors.length} console error(s)` : "no console errors"} ·{" "}
            <a href={shot.replayUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>session replay</a>
          </figcaption>
          {shot.consoleErrors.length > 0 && <div className="kv">{shot.consoleErrors.join("\n")}</div>}
        </figure>
      )}
    </>
  );
}

function Deck({ state, task, onDeploy, deploying }: { state: StreamState; task: AgentTaskSummary | null; onDeploy?: () => void; deploying?: boolean }) {
  const [tab, setTab] = useState<DeckTab>("activity");
  const sum = totals(state.usage);
  const usageByTurn = useMemo(() => new Map<number, TurnUsage>(state.usage.map((turn, index) => [index + 1, turn])), [state.usage]);
  const activity = state.items.filter(item => item.kind !== "user" && item.kind !== "text");
  const thinking = state.items.filter((item): item is Extract<TimelineItem, { kind: "thinking" }> => item.kind === "thinking");
  const tools = state.items.filter((item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool" && ["run_command", "verify", "manus", "delegate_research", "browse", "deploy_preview"].includes(item.name));
  const live = [...state.deployments].reverse().find(deployment => deployment.status === "live" && deployment.url);
  const latestDeploy = state.deployments[state.deployments.length - 1];
  const [frameKey, setFrameKey] = useState(0);
  // Re-check the workspace build whenever the agent opens a preview or changes files.
  const lastPreview = [...state.events].reverse().find(event => event.type === "preview");
  const previewKey = (lastPreview?.seq ?? 0) + state.changes.length * 100000 + (state.ended ? 1 : 0);
  useEffect(() => { if (lastPreview) setTab(current => (current === "activity" ? "preview" : current)); }, [lastPreview?.seq]);
  useEffect(() => { if (live) setTab(current => (current === "activity" ? "preview" : current)); }, [live?.url]);
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (follow.current && tab === "activity") bottom.current?.scrollIntoView({ block: "end" }); }, [state.lastSeq, tab]);

  const model = getModel(state.model ?? task?.model ?? "");
  const tabs: { id: DeckTab; label: string; icon: typeof Brain; count?: number }[] = [
    { id: "activity", label: "Activity", icon: Workflow, count: activity.length },
    { id: "thinking", label: "Thinking", icon: Brain, count: thinking.length },
    { id: "terminal", label: "Terminal", icon: SquareTerminal, count: tools.length },
    { id: "changes", label: "Changes", icon: FileDiff, count: state.changes.length },
    { id: "preview", label: "Preview", icon: Rocket, count: state.deployments.length || undefined },
    { id: "raw", label: "Raw log", icon: ScrollText, count: state.events.length },
  ];

  return (
    <div className="pane deck">
      <div className="deck-head">
        <PhaseStepper phases={state.phases} />
        <div className="metrics">
          <span>Model <b>{model?.label ?? state.model ?? "—"}</b></span>
          <span>Turns <b>{state.usage.length}</b></span>
          <span>In <b>{formatTokens(sum.input)}</b></span>
          <span>Out <b>{formatTokens(sum.output)}</b></span>
          <span>Thinking <b>{formatTokens(sum.thinking)}</b></span>
          <span>Files <b>{new Set(state.changes.map(change => change.path)).size}</b></span>
          <span className="row" style={{ gap: 5 }}><span className={`dot ${state.connected ? "ok" : state.ended ? "" : "warn"}`} />{state.connected ? "Live" : state.ended ? "Replay" : "Reconnecting"}</span>
        </div>
        <div className="deck-tabs" role="tablist">
          {tabs.map(item => (
            <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "on" : ""} onClick={() => setTab(item.id)}>
              <item.icon size={13} /> {item.label} {item.count ? <span className="count">{item.count}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="pane-scroll" ref={scroller} onScroll={event => {
        const element = event.currentTarget;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
      }}>
        <div className="deck-body">
          {tab === "activity" && (
            <>
              <PlanView steps={state.plan} />
              {activity.length === 0 && <EmptyState icon={Loader2} title="Waiting for the first event">The agent's thinking, tool calls and file changes will stream here live.</EmptyState>}
              {activity.map(item => <TimelineEntry key={`${item.kind}-${item.id}`} item={item} usageByTurn={usageByTurn} browsers={state.browsers} />)}
              <div ref={bottom} />
            </>
          )}
          {tab === "thinking" && (thinking.length ? thinking.map(item => <ThinkingBlock key={item.id} item={item} usage={usageByTurn.get(item.turn)} />) : <EmptyState icon={Brain} title="No thinking blocks yet">Models with adaptive thinking (Opus 5.5, Opus 5, Opus 4.6, Sonnet 4.6) stream their reasoning summary here.</EmptyState>)}
          {tab === "terminal" && (tools.length ? tools.map(item => <ToolCard key={item.id} item={item} />) : <EmptyState icon={SquareTerminal} title="No commands yet">Shell commands and verification runs stream stdout/stderr here.</EmptyState>)}
          {tab === "changes" && (state.changes.length ? (
            <>
              <div className="muted" style={{ fontSize: 12 }}>{state.changes.length} change{state.changes.length === 1 ? "" : "s"} across {new Set(state.changes.map(change => change.path)).size} file(s), in order applied.</div>
              {state.changes.map(change => <DiffViewer key={change.seq} change={change} />)}
            </>
          ) : <EmptyState icon={FileDiff} title="No file changes">Every file the agent creates, edits or deletes appears here as a diff.</EmptyState>)}
          {tab === "preview" && (
            <>
              <div className="eyebrow">Workspace preview</div>
              <WorkspacePreview taskId={task?.id ?? ""} refreshKey={previewKey} running={state.status === "running"} />
              <div className="row" style={{ marginTop: 14 }}>
                <span className="eyebrow">Live deployment (Render)</span>
                <span className="spacer" />
                {onDeploy && <button className="btn sm" disabled={state.status === "running" || deploying} onClick={onDeploy}><Rocket size={13} /> Deploy Live to Render</button>}
              </div>
              {latestDeploy ? (
            <>
              <div className="preview-bar">
                <span className={`chip ${latestDeploy.status === "live" ? "mint" : latestDeploy.status === "failed" ? "red" : "violet"}`}>{latestDeploy.status === "building" || latestDeploy.status === "creating" ? <Loader2 size={11} className="spin" /> : null}{latestDeploy.status}</span>
                {latestDeploy.url && <a className="mono truncate" style={{ fontSize: 12 }} href={latestDeploy.url} target="_blank" rel="noreferrer">{latestDeploy.url}</a>}
                <span className="spacer" />
                {live && <button className="icon-btn sm" title="Reload preview" onClick={() => setFrameKey(value => value + 1)}><RefreshCcw size={13} /></button>}
                {latestDeploy.url && <a className="icon-btn sm" href={latestDeploy.url} target="_blank" rel="noreferrer" title="Open in new tab"><ExternalLink size={13} /></a>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{latestDeploy.detail}{latestDeploy.expiresAt ? ` · auto-deletes ${new Date(latestDeploy.expiresAt).toLocaleTimeString()}` : ""}</div>
              {live ? <iframe key={frameKey} className="preview-frame" src={live.url} title="Live preview" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" /> : latestDeploy.status !== "failed" && <EmptyState icon={Loader2} title="Render is building">The preview appears here as soon as the deploy is live.</EmptyState>}
            </>
              ) : <div className="faint" style={{ fontSize: 12 }}>Not deployed. Deploy publishes this workspace to a temporary public *.onrender.com URL (needs GitHub connected).</div>}
            </>
          )}
          {tab === "raw" && (
            <div className="card raw">
              {state.events.map(event => {
                const { seq, ts, type, ...rest } = event;
                return (
                  <div key={seq} className="raw-row" title={JSON.stringify(rest)}>
                    <span className="faint">#{seq}</span>
                    <span className="faint">{new Date(ts).toLocaleTimeString()}</span>
                    <span className="t">{type}</span>
                    <span className="d">{JSON.stringify(rest).slice(0, 300)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaskWorkspace({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [task, setTask] = useState<AgentTaskSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [mobilePane, setMobilePane] = useState<"chat" | "deck">("deck");
  const [deploying, setDeploying] = useState(false);
  const deploy = () => {
    setDeploying(true);
    void agentApi.followUp(id, "Deploy this project as a temporary live preview with deploy_preview (choose static or node and the right build/start commands from the files), then open the URL with browse to confirm it renders, and report the link.")
      .then(() => setGeneration(value => value + 1))
      .catch(error => alert(error instanceof Error ? error.message : "Deploy failed to start"))
      .finally(() => setDeploying(false));
  };
  const [exporting, setExporting] = useState(false);
  const { status: github } = useGitHub();

  const [linking, setLinking] = useState<string | null>(null);
  const linkRepo = async (fullName: string, branch: string) => {
    setLinking(fullName);
    try {
      const result = await agentApi.linkRepo(id, fullName, branch);
      setTask(current => (current ? { ...current, githubRepo: result.repo, githubRepoUrl: result.url, githubMode: "linked", githubBranch: result.branch } : current));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not load the repository");
    } finally {
      setLinking(null);
    }
  };

  const exportToGithub = async () => {
    if (!task) return;
    let body: { repoName?: string; private: boolean; branch?: string } = { private: true };
    if (task.githubMode === "linked") {
      const branch = window.prompt(`Push workspace changes to which branch of ${task.githubRepo}?\n(Use a new branch name to keep ${task.githubBranch} untouched.)`, `curialy/${id.slice(0, 8)}`);
      if (!branch) return;
      body = { private: true, branch: branch.trim() };
    } else if (!task.githubRepo) {
      const suggested = `curialy-${task.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project"}`;
      const repoName = window.prompt("New GitHub repository name", suggested);
      if (!repoName) return;
      body = { repoName: repoName.trim(), private: window.confirm("Make the repository private?\n\nOK = private, Cancel = public") };
    }
    setExporting(true);
    try {
      const result = await agentApi.exportToGithub(id, body);
      if (result.nothingToPush) { alert("Nothing to push: the workspace matches the repository."); return; }
      setTask(current => (current ? { ...current, githubRepo: result.repo, githubRepoUrl: result.url, githubPushedAt: new Date().toISOString() } : current));
      window.open(result.commitUrl, "_blank", "noopener");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };
  const narrow = useNarrow();
  const state = useTaskStream(id, generation);

  useEffect(() => {
    let alive = true;
    agentApi.task(id).then(data => alive && setTask(data.task)).catch(() => alive && setMissing(true));
    return () => { alive = false; };
  }, [id, state.status, state.ended]);

  const status = state.status ?? task?.status ?? null;
  const running = status === "running" || status === "queued";

  const actions = (
    <>
      <StatusChip status={status} />
      {task?.githubRepoUrl ? (
        <a className={`chip ${task.githubMode === "linked" ? "violet" : ""} desktop-only`} href={task.githubRepoUrl} target="_blank" rel="noreferrer" title={task.githubPushedAt ? `Last pushed ${new Date(task.githubPushedAt).toLocaleString()}` : undefined}>
          <GitHubMark size={12} /> {task.githubMode === "linked" ? "Active Repo: " : ""}<span className="mono">{task.githubRepo}</span>{task.githubBranch ? ` (branch: ${task.githubBranch})` : ""}
        </a>
      ) : task?.mode === "agent" && github?.connected && (
        linking ? <span className="chip"><Loader2 size={11} className="spin" /> Loading {linking}…</span>
          : <span className="desktop-only"><RepoSelector value={null} compact openDown disabled={running} onChange={repo => { if (repo) void linkRepo(repo.full_name, repo.default_branch); }} /></span>
      )}
      {task?.mode === "agent" && (github?.connected ? (
        <button className="btn sm" disabled={running || exporting || (task.filesChanged === 0 && task.githubMode !== "linked")} title={task.githubMode === "linked" ? `Commit and push workspace changes to ${task.githubRepo}` : task.filesChanged === 0 ? "No files to export yet" : task.githubRepo ? `Push the latest files to ${task.githubRepo}` : "Create a repository in your GitHub account and push these files"} onClick={() => void exportToGithub()}>
          {exporting ? <Loader2 size={13} className="spin" /> : <GitHubMark size={13} />} {task.githubRepo ? "Push to GitHub" : "Export to GitHub"}
        </button>
      ) : github && (
        <a className="btn sm" href="/api/auth/github/start" title="Connect GitHub to export and deploy"><GitHubMark size={13} /> Connect GitHub</a>
      ))}
      {task?.mode === "agent" && (
        <button className="btn sm" disabled={running || deploying} title="Publish this workspace as a temporary Render preview" onClick={deploy}><Rocket size={13} /> Deploy</button>
      )}
      {running ? (
        <button className="btn danger sm" onClick={() => void agentApi.cancel(id)}><CircleStop size={13} /> Cancel</button>
      ) : (
        <button className="btn ghost sm" title="Delete task and workspace" onClick={() => { if (confirm("Delete this task and its workspace files?")) void agentApi.remove(id).then(() => navigate("/tasks")); }}><Trash2 size={13} /></button>
      )}
      <Link href={`/sandbox?task=${id}`} className="btn sm desktop-only"><SquareTerminal size={13} /> Workspace</Link>
    </>
  );

  if (missing) {
    return <AppShell title="Task not found" crumb="Live Tasks"><div className="page"><EmptyState title="This task does not exist">It may have been deleted. <Link href="/tasks" className="muted">Back to tasks</Link></EmptyState></div></AppShell>;
  }

  const conversation = (
    <div className="pane">
      <div className="pane-scroll"><Conversation state={state} task={task} /></div>
      <FollowUp taskId={id} disabled={running} onSent={() => setGeneration(value => value + 1)} />
    </div>
  );

  return (
    <AppShell title={task?.prompt.split("\n")[0].slice(0, 120) ?? "Task"} crumb="Live Tasks" actions={actions}>
      {narrow ? (
        <div className="workspace" style={{ flexDirection: "column" }}>
          <div className="segmented" style={{ margin: "10px 12px 0", alignSelf: "flex-start" }}>
            <button className={mobilePane === "chat" ? "on" : ""} onClick={() => setMobilePane("chat")}><User size={12} style={{ verticalAlign: -2 }} /> Conversation</button>
            <button className={mobilePane === "deck" ? "on" : ""} onClick={() => setMobilePane("deck")}><Workflow size={12} style={{ verticalAlign: -2 }} /> Inspector</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>{mobilePane === "chat" ? conversation : <Deck state={state} task={task} onDeploy={task?.mode === "agent" ? deploy : undefined} deploying={deploying} />}</div>
        </div>
      ) : (
        <div className="workspace">
          <PanelGroup direction="horizontal" autoSaveId="curialy-task-split">
            <Panel defaultSize={44} minSize={28}>{conversation}</Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel defaultSize={56} minSize={30}><Deck state={state} task={task} onDeploy={task?.mode === "agent" ? deploy : undefined} deploying={deploying} /></Panel>
          </PanelGroup>
        </div>
      )}
    </AppShell>
  );
}
