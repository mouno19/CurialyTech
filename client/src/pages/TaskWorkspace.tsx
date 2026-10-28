import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import * as Tabs from "@radix-ui/react-tabs";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { CircleStop, FolderGit2, Link2, MessagesSquare, Rocket, RotateCcw, SquareTerminal, Trash2, TriangleAlert, Upload, Workflow } from "lucide-react";
import type { StatusReason } from "@shared/agent";
import { deriveTaskStatus, isActiveStatus, isFinalStatus, isRetryable, outcomeIssues, statusLabel } from "@shared/taskStatus";
import { RepoSelector } from "@/components/RepoSelector";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Conversation, type LatestOutcome, type PendingMessage } from "@/components/task/Conversation";
import { ExportDialog } from "@/components/task/ExportDialog";
import { FollowUpComposer } from "@/components/task/FollowUpComposer";
import { Inspector, InspectorRail, inspectorCounts } from "@/components/task/Inspector";
import { TaskHeader } from "@/components/task/TaskHeader";
import { newClientId, plural, prefs } from "@/components/task/format";
import { useAnnouncer } from "@/components/task/useAnnouncer";
import { useDeployments, useWorkspacePreview } from "@/components/task/usePreviewData";
import { usePoll, useTaskRow } from "@/components/task/useTaskRow";
import { toast } from "sonner";
import { agentApi, ApiError, errorMessage, type ExportResult } from "@/lib/api";
import { useGitHub } from "@/lib/appStatus";
import { useIsDesktop } from "@/lib/breakpoints";
import { conversationRuns, freshestStatus, initialInspectorTab, isReplayed, latestRun, useTaskStream, type InspectorTab, type StatusSnapshot, type TimelineItem } from "@/lib/taskStream";
import type { PendingAttachment } from "@/lib/useAttachments";
import { useStickToBottom } from "@/lib/useStickToBottom";

const firstLine = (text: string) => text.split("\n").find(line => line.trim())?.trim() || "Task";

/** Where a failed or interrupted run stopped: its last error, else its last failed step, else its last step. */
function stopEntryKey(items: TimelineItem[], run: number) {
  let failedTool: string | null = null;
  let last: string | null = null;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.run < run) break;
    if (item.run !== run || item.kind === "user" || item.kind === "text") continue;
    if (item.kind === "notice" && item.level === "error") return item.key;
    if (!failedTool && item.kind === "tool" && item.result && !item.result.ok && !item.result.settled) failedTool = item.key;
    last ??= item.key;
  }
  return failedTool ?? last;
}

export default function TaskWorkspace({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const desktop = useIsDesktop();
  const { status: github } = useGitHub();
  const { announce, region } = useAnnouncer();
  const [generation, setGeneration] = useState(0);
  const reconnectedAt = useRef(0);
  const reconnect = useCallback(() => {
    reconnectedAt.current = Date.now();
    setGeneration(value => value + 1);
  }, []);

  const row = useTaskRow(id);
  const { state: s, settle } = useTaskStream(id, generation, { onRow: row.accept });
  const task = row.row?.detail.task ?? null;
  const run = latestRun(s);
  const [actionSnap, setActionSnap] = useState<StatusSnapshot | null>(null);

  // ---- One status for the whole page: the live stream while it is live, else the newest row knowledge ----
  const snapshot = freshestStatus(
    task && row.row ? { status: task.status, reason: task.statusReason ?? null, at: row.row.at } : null,
    s.sync?.status ? { status: s.sync.status, reason: s.sync.statusReason, at: s.sync.at } : null,
    run?.end && !run.end.synthetic ? { status: run.end.status, reason: run.end.reason ?? null, at: run.end.receivedAt } : null,
    actionSnap,
  );
  // After a follow-up, retry or deploy the stream still shows the previous run's final status until
  // the new run's first events arrive: newer knowledge of an active run wins over it.
  const streamStale = Boolean(run?.end && snapshot && snapshot.at > run.end.receivedAt && isActiveStatus(snapshot.status));
  const streamStatus = streamStale ? null : s.status;
  const status = deriveTaskStatus({ streamStatus, streamLive: s.live && !streamStale, streamEnded: s.ended, rowStatus: snapshot?.status ?? null });
  const reason: StatusReason | null = s.live && !streamStale && status === s.status ? s.statusReason : snapshot?.status === status ? snapshot.reason ?? null : status === streamStatus ? s.statusReason : null;
  const active = isActiveStatus(status);
  const streaming = active && s.connected;

  // The row is re-read every 5 s while a run is active and not streamed live, and when the stream's view changes.
  usePoll(row.reload, 5000, active && !s.live);
  const { reload } = row;
  useEffect(() => {
    void reload();
  }, [s.status, s.ended, reload]);

  // A fresh row says a run is active but this page's stream has ended: follow the run.
  useEffect(() => {
    if (!row.row || s.missing || s.connected || !s.ended || Date.now() - reconnectedAt.current < 4000) return;
    if (isActiveStatus(row.row.detail.task.status) && row.row.at > (s.endedAt ?? 0)) reconnect();
  }, [row.row, s.missing, s.connected, s.ended, s.endedAt, reconnect]);

  // The row says the run is over but its log never got a done event: nothing may keep looking live.
  // Durations end when the row says the run stopped, not when this page was opened.
  useEffect(() => {
    if (!s.ended || s.connected || !run || run.end || !isFinalStatus(status)) return;
    const stored = row.row?.detail.task;
    settle(status!, reason, stored ? Date.parse(stored.finishedAt ?? stored.statusChangedAt ?? stored.updatedAt) : undefined);
  }, [s.ended, s.connected, run, status, reason, settle, row.row]);

  // ---- Conversation ----
  const views = useMemo(() => conversationRuns({ runs: s.runs, items: s.items }), [s.runs, s.items]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const echoed = useMemo(() => {
    const ids = new Set<string>();
    for (const item of s.items) if (item.kind === "user" && item.clientMessageId) ids.add(item.clientMessageId);
    return ids;
  }, [s.items]);
  const shownPending = useMemo(() => pending.filter(message => !echoed.has(message.clientMessageId)), [pending, echoed]);
  useEffect(() => {
    if (shownPending.length !== pending.length) setPending(shownPending);
  }, [shownPending, pending.length]);

  // The scroller remounts when the layout switches at 1024px: track the element so following and
  // the "Jump to latest" state move to the new one.
  const convoRef = useRef<HTMLDivElement | null>(null);
  const [convoEl, setConvoEl] = useState<HTMLDivElement | null>(null);
  const bindConvo = useCallback((element: HTMLDivElement | null) => {
    convoRef.current = element;
    setConvoEl(element);
  }, []);
  const convoCount = useMemo(() => views.reduce((count, view) => count + view.entries.length + (view.user ? 1 : 0) + (view.divider ? 1 : 0) + (view.run.end ? 1 : 0), 0) + shownPending.length, [views, shownPending.length]);
  const convo = useStickToBottom(convoRef, { count: convoCount, element: convoEl });
  const { stickNext } = convo;

  // ---- Inspector tab and panes ----
  const [tab, setTab] = useState<InspectorTab>("activity");
  const userPicked = useRef(false);
  const decided = useRef(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const onTab = useCallback((next: InspectorTab, byUser: boolean) => {
    if (byUser) userPicked.current = true;
    setTab(next);
  }, []);
  const paneKey = `curialy.task.${id}.pane`;
  const [pane, setPaneState] = useState<"chat" | "inspector">(() => (prefs.session(paneKey) === "inspector" ? "inspector" : "chat"));
  const setPane = useCallback((next: "chat" | "inspector") => {
    setPaneState(next);
    prefs.setSession(paneKey, next);
  }, [paneKey]);
  const inspectorPanel = useRef<ImperativePanelHandle>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const expandInspector = useCallback((next?: InspectorTab) => {
    inspectorPanel.current?.expand();
    if (next) onTab(next, true);
  }, [onTab]);

  // ---- Preview data (also decides the first tab) ----
  const deployKey = `${s.deployments.map(deployment => `${deployment.id}:${deployment.status}`).join(",")}|${s.ended ? 1 : 0}`;
  const deployments = useDeployments(id, deployKey);
  const preview = useWorkspacePreview(id, `${s.previewSeq}|${s.ended ? 1 : 0}|${isFinalStatus(status) ? status : "active"}`);
  const counts = inspectorCounts(s, deployments.live.length);

  const replayed = isReplayed(s);
  const stopKey = useMemo(() => (run ? stopEntryKey(s.items, run.index) : null), [s.items, run]);
  useEffect(() => {
    if (decided.current || userPicked.current || !status || !replayed) return;
    if (status === "completed" && ((deployments.list === null && !deployments.error) || preview.state.phase === "checking")) return;
    decided.current = true;
    setTab(initialInspectorTab({ status, liveDeployment: deployments.live.length > 0, previewAvailable: preview.state.phase === "ready" }));
    if ((status === "failed" || status === "interrupted") && stopKey) setFocusKey(stopKey);
  }, [status, replayed, deployments.list, deployments.error, deployments.live.length, preview.state.phase, stopKey]);

  // New preview events (never replayed history) bring the Preview tab forward on desktop, unless the reader chose a tab.
  const liveDeploySeq = s.deployments.reduce((max, deployment) => (deployment.status === "live" ? Math.max(max, deployment.seq) : max), 0);
  useEffect(() => {
    if (!desktop || userPicked.current || s.replayMark === null) return;
    if (Math.max(s.previewSeq, liveDeploySeq) > s.replayMark) {
      decided.current = true;
      setTab("preview");
    }
  }, [desktop, s.previewSeq, liveDeploySeq, s.replayMark]);

  // Opening a finished task: a long answer is shown from its start, not from its last line.
  const positioned = useRef(false);
  const { reveal } = convo;
  useEffect(() => {
    // Decided once, when the page has caught up: only a task that was already finished when opened
    // is shown from its answer; a run finishing while someone reads never moves them.
    if (positioned.current || !replayed || !status) return;
    positioned.current = true;
    if (isActiveStatus(status)) return;
    const scroller = convoRef.current;
    const card = scroller?.querySelector<HTMLElement>(".outcome[data-latest]");
    if (scroller && card && scroller.clientHeight > 0 && card.offsetHeight > scroller.clientHeight * 0.7) reveal(card);
  }, [replayed, status, reveal]);

  const viewLogs = useCallback(() => {
    userPicked.current = true;
    setTab("activity");
    if (!desktop) setPane("inspector");
    else if (collapsed) inspectorPanel.current?.expand();
    if (stopKey) setFocusKey(stopKey);
  }, [desktop, collapsed, stopKey, setPane]);
  const onFocused = useCallback(() => setFocusKey(null), []);

  // ---- Milestones for assistive tech (live events only, never the replayed history) ----
  const announced = useRef({ run: 0, end: 0 });
  useEffect(() => {
    const mark = s.replayMark;
    if (mark === null || !run) return;
    if (run.seq > mark && run.seq > announced.current.run) {
      announced.current.run = run.seq;
      announce(run.trigger === "retry" ? `Retry started, attempt ${run.attempt}` : run.trigger === "deploy" ? "Deploy started" : "Run started");
    }
    const end = run.end;
    if (end && !end.synthetic && end.seq > mark && end.seq > announced.current.end) {
      announced.current.end = end.seq;
      if (end.status === "completed") announce(outcomeIssues(end.outcome).length ? "Run completed with issues" : "Answer ready");
      else if (end.status === "failed") announce(`Run failed${end.error ? `: ${end.error.slice(0, 160)}` : ""}`);
      else announce(end.status === "cancelled" ? "Run cancelled" : "Run interrupted");
    }
  }, [run, s.replayMark, announce]);

  // ---- Actions ----
  const runId = task?.runId ?? run?.runId ?? null;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (cancelBusy && status && !isActiveStatus(status)) setCancelBusy(false);
  }, [cancelBusy, status]);

  const confirmCancel = async () => {
    announce("Stopping the run…");
    setCancelBusy(true);
    try {
      const result = await agentApi.cancel(id, runId);
      setActionSnap({ status: result.status, reason: result.statusReason ?? null, at: Date.now() });
      if (result.status !== "cancelling") {
        setCancelBusy(false);
        toast(result.status === "cancelled" ? "Run cancelled. Files written so far are kept." : `The run had already ended: ${statusLabel(result.status)}.`);
      }
    } catch (failure) {
      setCancelBusy(false);
      throw failure;
    }
  };

  const retry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const started = await agentApi.retry(id, runId);
      setActionSnap({ status: "queued", at: Date.now() });
      stickNext();
      reconnect();
      toast(`Retry started · attempt ${started.attempt}`);
    } catch (failure) {
      toast.error("Couldn't retry the run.", { description: errorMessage(failure) });
    } finally {
      setRetrying(false);
    }
  }, [retrying, id, runId, stickNext, reconnect]);

  const retryClick = useCallback(() => void retry(), [retry]);
  const openDeploy = useCallback(() => setDeployOpen(true), []);

  const confirmDeploy = async () => {
    setDeploying(true);
    try {
      await agentApi.deploy(id, runId);
      setActionSnap({ status: "queued", at: Date.now() });
      stickNext();
      reconnect();
      onTab("preview", true);
      toast("Deploy started. The preview appears in the Preview tab when it is live.");
    } finally {
      setDeploying(false);
    }
  };

  const confirmDelete = async () => {
    const result = await agentApi.remove(id);
    const done = [result.previewsRemoved ? `${plural(result.previewsRemoved, "preview")} taken down` : "", result.filesRemoved ? `${plural(result.filesRemoved, "stored file")} removed` : ""].filter(Boolean).join(" · ");
    const kept = result.filesKept ? `${plural(result.filesKept, "stored file")} could not be removed.` : "";
    toast.success("Task deleted", { description: [done, kept].filter(Boolean).join(". ") || undefined });
    navigate("/tasks");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
      announce("Link copied");
    } catch {
      toast.error("Couldn't copy the link: the browser blocked clipboard access.");
    }
  };

  const sendFollowUp = useCallback(async (text: string, files: PendingAttachment[]) => {
    const clientMessageId = newClientId();
    stickNext();
    setPending(list => [...list, { clientMessageId, text, attachments: files.map(file => ({ mediaId: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, path: file.filename })) }]);
    try {
      await agentApi.followUp(id, text, files.map(file => file.id), { clientMessageId, expectedRunId: runId });
      setActionSnap({ status: "queued", at: Date.now() });
      reconnect();
    } catch (failure) {
      setPending(list => list.filter(message => message.clientMessageId !== clientMessageId));
      // The task moved on (another tab, a run that started meanwhile): show what it is now.
      if (failure instanceof ApiError && failure.status === 409) void reload();
      throw failure;
    }
  }, [id, runId, stickNext, reconnect, reload]);

  const onExported = (result: ExportResult) => {
    row.patch({ githubRepo: result.repo, githubRepoUrl: result.url, githubPushedAt: new Date().toISOString(), ...(task?.githubMode ? {} : { githubMode: "export" as const }) });
    void row.reload();
  };

  const linkRepo = async (fullName: string, branch: string) => {
    setLinking(fullName);
    try {
      const result = await agentApi.linkRepo(id, fullName, branch);
      row.patch({ githubRepo: result.repo, githubRepoUrl: result.url, githubMode: "linked", githubBranch: result.branch });
      toast.success(`Linked ${result.repo} (${result.branch})`, { description: `${plural(result.files, "file")} fetched into the workspace. Nothing was pushed.` });
      void row.reload();
    } catch (failure) {
      toast.error("Couldn't link the repository.", { description: errorMessage(failure) });
    } finally {
      setLinking(null);
    }
  };

  // ---- Topbar ----
  const agentTask = task?.mode === "agent";
  const caps = deployments.capabilities;
  const deployReason = !agentTask ? null
    : active ? "Wait for the run to finish."
      : !caps ? (deployments.error ? "Couldn't check whether live previews are available." : "Checking whether live previews are available…")
        : !caps.configured ? "Live previews aren't set up on this server."
          : !caps.github ? "Connect GitHub to deploy: previews are built from a temporary private repository in your account."
            : null;
  const deployAction = agentTask ? { disabledReason: deployReason, busy: deploying, onOpen: () => setDeployOpen(true) } : null;

  // A deploy run can't be retried (the server refuses: a retry has no deploy permission); its
  // primary action is a new, confirmed deploy instead.
  const redeploy = agentTask && isRetryable(status) && run?.trigger === "deploy";
  const actions: TopbarAction[] = [];
  if (active) {
    actions.push({ id: "cancel", label: cancelBusy || status === "cancelling" ? "Cancelling…" : "Cancel", icon: CircleStop, priority: "primary", tone: "danger", busy: cancelBusy || status === "cancelling", title: "Stop this run", onSelect: () => setCancelOpen(true) });
  } else if (redeploy) {
    actions.push({ id: "redeploy", label: deploying ? "Deploying…" : "Deploy again", icon: Rocket, priority: "primary", tone: "accent", busy: deploying, disabled: Boolean(deployReason), title: deployReason ?? "Start a new live preview", onSelect: () => setDeployOpen(true) });
  } else if (isRetryable(status)) {
    actions.push({ id: "retry", label: retrying ? "Retrying…" : "Retry", icon: RotateCcw, priority: "primary", tone: "accent", busy: retrying, title: "Run it again from where it stopped", onSelect: () => void retry() });
  }
  if (agentTask && task) {
    const label = task.githubRepo ? "Push" : "Export";
    if (!github) actions.push({ id: "export", label, icon: Upload, priority: "secondary", disabled: true, title: "Checking the GitHub connection…" });
    else if (!github.configured) actions.push({ id: "export", label, icon: Upload, priority: "secondary", disabled: true, title: "GitHub isn't set up on this server." });
    else if (!github.connected) actions.push({ id: "export", label: "Connect GitHub", icon: Upload, priority: "secondary", href: "/api/auth/github/start", title: "Connect GitHub to export or push this workspace" });
    else {
      const blocked = active ? "Wait for the run to finish." : !task.githubRepo && task.filesChanged === 0 ? "No files to export yet." : null;
      const title = task.githubMode === "linked" ? `Push the workspace changes to a branch of ${task.githubRepo}` : task.githubRepo ? `Push the latest files to ${task.githubRepo}` : "Create a GitHub repository with these files";
      actions.push({ id: "export", label, icon: Upload, priority: "secondary", disabled: Boolean(blocked), title: blocked ?? title, onSelect: () => setExportOpen(true) });
    }
    if (!redeploy) actions.push({ id: "deploy", label: deploying ? "Deploying…" : "Deploy", icon: Rocket, priority: "secondary", busy: deploying, disabled: Boolean(deployReason), title: deployReason ?? "Deploy a temporary live preview", onSelect: () => setDeployOpen(true) });
  }
  actions.push({ id: "workspace", label: "Workspace", icon: SquareTerminal, priority: "secondary", href: `/sandbox?task=${encodeURIComponent(id)}`, title: "Open the files in the Code Sandbox" });
  if (task?.githubRepoUrl) actions.push({ id: "repo", label: "Open repository", icon: FolderGit2, priority: "overflow", href: task.githubRepoUrl, title: task.githubRepo });
  actions.push({ id: "copy", label: "Copy link", icon: Link2, priority: "overflow", immediate: true, onSelect: () => void copyLink() });
  actions.push({ id: "delete", label: "Delete task", icon: Trash2, priority: "overflow", tone: "danger", disabled: active, title: active ? "Cancel the run first" : "Removes the workspace, stored files and live previews", onSelect: () => setDeleteOpen(true) });

  const latestOutcome = useMemo<LatestOutcome>(() => ({
    status,
    reason,
    error: task?.error ?? null,
    endedAt: (run?.end && !run.end.synthetic ? run.end.ts : null) ?? task?.finishedAt ?? task?.statusChangedAt ?? null,
    outcome: run?.end?.outcome ?? task?.outcome ?? null,
    rowAnswer: task?.answer ?? null,
  }), [status, reason, task, run?.end]);

  if (row.missing || s.missing) {
    return (
      <AppShell title="Task not found" crumb="Live Tasks" crumbHref="/tasks">
        <div className="page">
          <StateNotice variant="empty" size="lg" title="This task doesn't exist" actions={<Link href="/tasks" className="btn primary">Back to Live Tasks</Link>}>
            It may have been deleted, or the link is incomplete.
          </StateNotice>
        </div>
      </AppShell>
    );
  }

  const changedAt = (run?.end && !run.end.synthetic ? run.end.ts : null) ?? task?.statusChangedAt ?? task?.finishedAt ?? null;
  const canLink = agentTask && github?.connected && !task?.githubRepo && !active;
  const header = (
    <>
      <TaskHeader task={task} status={status} reason={reason} outcome={latestOutcome.outcome} changedAt={changedAt} model={s.model ?? task?.model ?? null}>
        {linking ? (
          <span className="chip"><Spinner size={11} /> <span className="truncate">Linking {linking}…</span></span>
        ) : canLink ? (
          <span className="task-link-repo"><RepoSelector value={null} disabled={active} onChange={repo => repo && void linkRepo(repo.full_name, repo.default_branch)} /></span>
        ) : null}
      </TaskHeader>
      {row.error && !task && (
        <div className="notice task-load-error" data-tone="danger" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <div className="notice-body"><strong className="notice-title">Couldn't load the task</strong><p>{row.error}</p></div>
          <div className="notice-actions"><Button size="sm" onClick={() => void row.reload()}>Try again</Button></div>
        </div>
      )}
    </>
  );

  const conversation = (
    <Conversation
      taskId={id}
      task={task}
      state={s}
      views={views}
      latest={latestOutcome}
      active={active}
      streaming={streaming}
      pending={shownPending}
      header={header}
      composer={<FollowUpComposer status={status} onSend={sendFollowUp} redeploy={redeploy} />}
      scrollRef={bindConvo}
      stick={convo}
      onRetry={redeploy ? openDeploy : retryClick}
      retrying={redeploy ? deploying : retrying}
      retryDisabled={redeploy ? deployReason : null}
      retryAs={redeploy ? "deploy" : "retry"}
      onViewLogs={viewLogs}
      onCopied={announce}
    />
  );

  const inspectorVisible = desktop ? !collapsed : pane === "inspector";
  const inspector = (
    <section id="inspector-panel" className="inspector-pane" aria-label="Inspector">
      <Inspector
        taskId={id}
        task={task}
        state={s}
        status={status}
        active={active}
        streaming={streaming}
        tab={tab}
        onTab={onTab}
        counts={counts}
        focusKey={focusKey}
        onFocused={onFocused}
        visible={inspectorVisible}
        preview={preview}
        deployments={deployments}
        deploy={deployAction}
        onCollapse={desktop ? () => inspectorPanel.current?.collapse() : undefined}
        collapsed={desktop && collapsed}
      />
    </section>
  );

  const login = github?.login ?? "your-account";
  return (
    <AppShell title={task ? firstLine(task.prompt) : "Task"} crumb="Live Tasks" crumbHref="/tasks" titleAddon={status ? <StatusBadge status={status} outcome={latestOutcome.outcome} reason={reason} size="sm" /> : undefined} topbarActions={actions}>
      {region}
      {desktop ? (
        <div className="task-workspace" data-layout="split" data-dragging={dragging || undefined} data-collapsed={collapsed || undefined}>
          <PanelGroup direction="horizontal" autoSaveId="curialy.task.split" className="task-split">
            <Panel id="conversation" order={1} minSize={34} defaultSize={56} className="split-panel">
              {conversation}
            </Panel>
            <PanelResizeHandle className="split-handle" onDragging={setDragging} aria-label="Resize the inspector" />
            <Panel id="inspector" order={2} ref={inspectorPanel} collapsible collapsedSize={0} minSize={26} defaultSize={44} onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)} className="split-panel">
              {inspector}
            </Panel>
          </PanelGroup>
          {collapsed && <InspectorRail counts={counts} onExpand={expandInspector} />}
        </div>
      ) : (
        <Tabs.Root className="task-workspace" data-layout="tabs" value={pane} onValueChange={value => setPane(value === "inspector" ? "inspector" : "chat")}>
          <Tabs.List className="pane-switch" aria-label="Task view">
            <Tabs.Trigger value="chat" className="pane-tab">
              <MessagesSquare size={15} aria-hidden="true" />
              Conversation
            </Tabs.Trigger>
            <Tabs.Trigger value="inspector" className="pane-tab">
              <Workflow size={15} aria-hidden="true" />
              Inspector
              {active && <span className="dot" data-tone="progress" data-live={streaming ? "" : undefined} aria-hidden="true" />}
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="chat" forceMount hidden={pane !== "chat"} className="pane-panel">
            {conversation}
          </Tabs.Content>
          <Tabs.Content value="inspector" forceMount hidden={pane !== "inspector"} className="pane-panel">
            {inspector}
          </Tabs.Content>
        </Tabs.Root>
      )}

      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Stop this run?" confirmLabel="Stop run" busyLabel="Cancelling…" cancelLabel="Keep running" tone="danger" onConfirm={confirmCancel}>
        Files written so far are kept. Nothing is published, pushed or deployed.
      </ConfirmDialog>
      <ConfirmDialog open={deployOpen} onOpenChange={setDeployOpen} title="Deploy a live preview?" confirmLabel="Deploy preview" busyLabel="Starting…" onConfirm={confirmDeploy} confirmDisabled={Boolean(deployReason)}>
        Creates a temporary private repository <strong className="mono break-anywhere">{login}/curialy-preview-…</strong> in your GitHub account and a public preview URL that is removed after about 2 hours. Your own repositories are not changed.
      </ConfirmDialog>
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete this task?" confirmLabel="Delete task" busyLabel="Deleting…" tone="danger" onConfirm={confirmDelete} confirmDisabled={active}>
        <p>This permanently removes:</p>
        <ul className="confirm-list">
          <li>the workspace files</li>
          <li>files this task stored (screenshots and attachments it produced)</li>
          <li>live previews (taken down now)</li>
          <li>the conversation and its log</li>
        </ul>
        <p>Files you uploaded stay in the Media Vault. Repositories on GitHub are not changed.</p>
      </ConfirmDialog>
      {agentTask && <ExportDialog open={exportOpen} onOpenChange={setExportOpen} taskId={id} onExported={onExported} />}
    </AppShell>
  );
}
