import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Markdown } from "@/components/Markdown";
import { ArrowUp, Bot, Brain, CircleStop, Copy, ExternalLink, FileDiff, Loader2, RefreshCcw, Rocket, ScrollText, SquareTerminal, Trash2, User, Workflow } from "lucide-react";
import { getModel, type AgentTaskSummary } from "@shared/agent";
import { AppShell, EmptyState } from "@/components/shell/AppShell";
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
  const messages = state.items.filter((item): item is Extract<TimelineItem, { kind: "user" | "text" }> => item.kind === "user" || item.kind === "text");
  const lastText = [...messages].reverse().find(item => item.kind === "text");
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

function Deck({ state, task }: { state: StreamState; task: AgentTaskSummary | null }) {
  const [tab, setTab] = useState<DeckTab>("activity");
  const sum = totals(state.usage);
  const usageByTurn = useMemo(() => new Map<number, TurnUsage>(state.usage.map((turn, index) => [index + 1, turn])), [state.usage]);
  const activity = state.items.filter(item => item.kind !== "user" && item.kind !== "text");
  const thinking = state.items.filter((item): item is Extract<TimelineItem, { kind: "thinking" }> => item.kind === "thinking");
  const tools = state.items.filter((item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool" && ["run_command", "verify", "manus", "delegate_research", "browse", "deploy_preview"].includes(item.name));
  const live = [...state.deployments].reverse().find(deployment => deployment.status === "live" && deployment.url);
  const latestDeploy = state.deployments[state.deployments.length - 1];
  const [frameKey, setFrameKey] = useState(0);
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
    { id: "preview", label: "Preview", icon: Rocket, count: state.deployments.length },
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
              {activity.map(item => <TimelineEntry key={`${item.kind}-${item.id}`} item={item} usageByTurn={usageByTurn} />)}
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
          {tab === "preview" && (latestDeploy ? (
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
          ) : <EmptyState icon={Rocket} title="No live preview yet">Press Deploy (or ask the agent to deploy) to publish this workspace to a temporary Render URL.</EmptyState>)}
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
      {task?.mode === "agent" && (
        <button className="btn sm" disabled={running || deploying} title="Publish this workspace as a temporary Render preview" onClick={() => {
          setDeploying(true);
          void agentApi.followUp(id, "Deploy this project as a temporary live preview with deploy_preview (choose static or node and the right build/start commands from the files), then open the URL with browse to confirm it renders, and report the link.")
            .then(() => setGeneration(value => value + 1))
            .catch(error => alert(error instanceof Error ? error.message : "Deploy failed to start"))
            .finally(() => setDeploying(false));
        }}><Rocket size={13} /> Deploy</button>
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
          <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>{mobilePane === "chat" ? conversation : <Deck state={state} task={task} />}</div>
        </div>
      ) : (
        <div className="workspace">
          <PanelGroup direction="horizontal" autoSaveId="curialy-task-split">
            <Panel defaultSize={44} minSize={28}>{conversation}</Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel defaultSize={56} minSize={30}><Deck state={state} task={task} /></Panel>
          </PanelGroup>
        </div>
      )}
    </AppShell>
  );
}
