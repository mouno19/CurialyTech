import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, Camera, CircleX, ExternalLink, Globe, RefreshCw, Rocket, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { TaskStatus } from "@shared/agent";
import type { DeploymentState } from "@shared/taskStatus";
import { MediaImage } from "@/components/MediaImage";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconButton } from "@/components/common/IconButton";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { useCountdown } from "@/components/common/useCountdown";
import { agentApi, errorMessage, formatBytes, type DeploymentView, type PreviewReady, type ScreenshotResult } from "@/lib/api";
import { useScrollMemory } from "@/lib/useStickToBottom";
import { deploymentName, formatClock, fullDate, plural } from "./format";
import { effectiveDeploymentState, type DeploymentsData, type WorkspacePreviewData } from "./usePreviewData";

export type DeployAction = { disabledReason: string | null; busy: boolean; onOpen: () => void };

type Props = {
  taskId: string;
  status: TaskStatus | null;
  active: boolean;
  preview: WorkspacePreviewData;
  deployments: DeploymentsData;
  deploy: DeployAction | null;
};

export function PreviewPanel({ taskId, status, active, preview, deployments, deploy }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  useScrollMemory(scroller);
  const { refresh, checkedAt } = preview;
  // Opening the tab re-checks a stale answer (a build may have appeared since).
  useEffect(() => {
    if (checkedAt && Date.now() - checkedAt > 15_000) void refresh();
  }, [refresh, checkedAt]);

  return (
    <div className="panel-scroll" ref={scroller}>
      <div className="panel-body preview-panel">
        <section className="preview-section" aria-labelledby="workspace-preview-title">
          <div className="section-head">
            <h3 id="workspace-preview-title" className="section-title">Workspace preview</h3>
          </div>
          <WorkspacePreview taskId={taskId} status={status} active={active} preview={preview} />
        </section>
        <section className="preview-section" aria-labelledby="live-previews-title">
          <div className="section-head">
            <h3 id="live-previews-title" className="section-title">Live previews</h3>
            {deploy && (
              <Button size="sm" icon={Rocket} busy={deploy.busy} aria-disabled={deploy.disabledReason ? true : undefined} title={deploy.disabledReason ?? undefined} onClick={deploy.onOpen}>
                {deploy.busy ? "Starting…" : "Deploy live preview"}
              </Button>
            )}
          </div>
          <p className="section-sub">A temporary public site on this domain, removed automatically after about 2 hours.</p>
          {deploy?.disabledReason && <p className="field-hint">{deploy.disabledReason}</p>}
          <Deployments data={deployments} />
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Workspace preview: checking, available, archived (with or without a build), none yet, running, error
// ---------------------------------------------------------------------------------------------

function WorkspacePreview({ taskId, status, active, preview }: { taskId: string; status: TaskStatus | null; active: boolean; preview: WorkspacePreviewData }) {
  const { state } = preview;
  if (state.phase === "checking") {
    return (
      <div className="preview-skeleton" role="status">
        <span className="skeleton skeleton-block" aria-hidden="true" />
        <span className="sr-only">Checking the workspace for a preview…</span>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <StateNotice variant="error" size="sm" title="Couldn't check for a preview" actions={<Button size="sm" icon={RefreshCw} busy={preview.refreshing} onClick={() => void preview.refresh()}>Try again</Button>}>
        {state.message}
      </StateNotice>
    );
  }
  if (state.phase === "ready") return <ReadyPreview taskId={taskId} info={state.info} active={active} preview={preview} />;

  const { info } = state;
  const restore = (
    <Button variant="primary" size="sm" icon={ArchiveRestore} busy={preview.restoring} aria-disabled={!info.restorable || undefined} title={info.restorable ? undefined : "The task is running; its workspace is already live."} onClick={() => void preview.restore()}>
      {preview.restoring ? "Restoring…" : "Restore workspace"}
    </Button>
  );
  const restoreError = preview.restoreError && <p className="notice" data-tone="danger" role="alert"><TriangleAlert size={14} aria-hidden="true" /><span className="notice-body">{preview.restoreError}</span></p>;
  if (info.running || active) {
    return (
      <StateNotice variant="info" size="sm" icon={Globe} title="The agent is still working">
        A preview appears here when the run builds a site (an index.html in dist/, build/, out/, public/ or the workspace root).
      </StateNotice>
    );
  }
  if (info.archived && info.build) {
    return (
      <>
        <StateNotice variant="unavailable" size="sm" title="This workspace is archived" actions={restore}>
          Its built site is kept in the archive: <code>{info.build.dir === "." ? "workspace root" : info.build.dir}</code> ({plural(info.build.fileCount, "file")}{info.build.bytes ? `, ${formatBytes(info.build.bytes)}` : ""}). Restore the workspace to preview it.
        </StateNotice>
        {restoreError}
      </>
    );
  }
  if (info.archived) {
    return (
      <>
        <StateNotice variant="unavailable" size="sm" title="No built site was kept" actions={restore}>
          No built site was kept in the archive; restore the workspace and ask the agent to rebuild.
        </StateNotice>
        {restoreError}
      </>
    );
  }
  return (
    <StateNotice variant="empty" size="sm" icon={Globe} title="No web build yet">
      {status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted"
        ? "This run did not leave a site to show (an index.html in dist/, build/, out/, public/ or the workspace root). Ask for a build in a follow-up."
        : "When the agent builds a site (an index.html in dist/, build/, out/, public/ or the workspace root), it shows up here."}
    </StateNotice>
  );
}

type FrameState = "checking" | "loading" | "loaded" | { error: number };

function ReadyPreview({ taskId, info, active, preview }: { taskId: string; info: PreviewReady; active: boolean; preview: WorkspacePreviewData }) {
  const [reload, setReload] = useState(0);
  const [frame, setFrame] = useState<FrameState>("checking");
  const [shot, setShot] = useState<ScreenshotResult | null>(null);
  const [shooting, setShooting] = useState(false);

  // The frame cannot report HTTP errors: check the address first (same origin, no storage I/O).
  useEffect(() => {
    let cancelled = false;
    setFrame("checking");
    fetch(info.url, { method: "HEAD", credentials: "same-origin", cache: "no-store" }).then(
      response => !cancelled && setFrame(response.ok ? "loading" : { error: response.status }),
      () => !cancelled && setFrame({ error: 0 }),
    );
    return () => {
      cancelled = true;
    };
  }, [info.url, reload]);

  const reloadAll = async () => {
    await preview.refresh();
    setReload(value => value + 1);
  };

  const capture = async () => {
    setShooting(true);
    try {
      setShot(await agentApi.previewScreenshot(taskId));
    } catch (failure) {
      toast.error("Couldn't capture the preview.", { description: errorMessage(failure) });
    } finally {
      setShooting(false);
    }
  };

  const failed = typeof frame === "object";
  return (
    <div className="preview-ready">
      <div className="preview-bar">
        <span className="chip" data-tone="success">Available</span>
        <span className="preview-dir mono" title={info.dir}>{info.dir === "." ? "workspace root" : `${info.dir}/`}</span>
        <span className="spacer" />
        <IconButton size="sm" label="Reload the preview" icon={RefreshCw} busy={preview.refreshing} onClick={() => void reloadAll()} />
        <a className="btn sm" href={info.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open in new tab</a>
      </div>
      {info.warnings.length > 0 && (
        <p className="notice" data-tone="warning">
          <TriangleAlert size={14} aria-hidden="true" />
          <span className="notice-body">index.html loads assets from absolute paths ({info.warnings.join(", ")}), which don't load in the preview. Ask the agent to build with relative paths (for Vite: <code>base: "./"</code>).</span>
        </p>
      )}
      {failed ? (
        <StateNotice variant="error" size="sm" title="The preview didn't load" actions={<Button size="sm" icon={RefreshCw} busy={preview.refreshing} onClick={() => void reloadAll()}>Reload</Button>}>
          {frame.error === 403 ? "The preview link expired. Reload to get a new one." : frame.error === 404 ? "The build is no longer in the workspace." : frame.error === 0 ? "Couldn't reach the server." : `The preview answered with an error (${frame.error}).`}
        </StateNotice>
      ) : (
        <div className="preview-frame-wrap" data-loaded={frame === "loaded" || undefined}>
          {frame !== "loaded" && <span className="skeleton preview-frame-skeleton" aria-hidden="true" />}
          {frame !== "checking" && (
            <iframe
              key={`${info.url}#${reload}`}
              className="preview-frame"
              src={info.url}
              title="Workspace preview"
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
              onLoad={() => setFrame("loaded")}
            />
          )}
          {frame !== "loaded" && <span className="sr-only" role="status">Loading the preview…</span>}
        </div>
      )}
      <div className="preview-foot">
        <p className="field-hint">Sandboxed: the page runs in an isolated origin (no cookies or local storage). Deploy a live preview for a full-fidelity public address.</p>
        <Button size="sm" variant="ghost" icon={Camera} busy={shooting} aria-disabled={active || undefined} title={active ? "Available when the run finishes (the agent is using the browser)" : undefined} onClick={() => void capture()}>
          {shooting ? "Capturing…" : "Capture screenshot"}
        </Button>
      </div>
      {shot && (
        <figure className="tl media preview-shot">
          {shot.image ? <MediaImage src={shot.image} alt="Screenshot of the workspace preview" /> : <p className="faint">No image was captured.</p>}
          <figcaption>
            <Camera size={12} aria-hidden="true" /> HTTP {shot.status ?? "?"} · {shot.title || "untitled"} · {shot.consoleErrors.length ? plural(shot.consoleErrors.length, "console error") : "no console errors"}
          </figcaption>
          {shot.consoleErrors.length > 0 && <pre className="kv panel-ink" tabIndex={0}>{shot.consoleErrors.join("\n")}</pre>}
        </figure>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Deployments: one row per deploy, state from the server and the clock
// ---------------------------------------------------------------------------------------------

const STATE_LABEL: Record<DeploymentState, string> = { creating: "Creating", building: "Building", live: "Live", failed: "Failed", expired: "Expired", removed: "Taken down", interrupted: "Stopped" };
const STATE_TONE: Record<DeploymentState, string> = { creating: "progress", building: "progress", live: "success", failed: "danger", expired: "neutral", removed: "neutral", interrupted: "neutral" };
const REMOVED_WHY: Record<string, string> = { user: "taken down by you", expired: "expired", interrupted: "its run ended before it was live", cancelled: "the deploy was cancelled", failed: "the failed deploy was cleaned up" };

function Deployments({ data }: { data: DeploymentsData }) {
  const [takeDown, setTakeDown] = useState<DeploymentView | null>(null);
  if (data.list === null) {
    if (data.error) {
      return (
        <StateNotice variant="error" size="sm" title="Couldn't load the live previews" actions={<Button size="sm" icon={RefreshCw} busy={data.loading} onClick={() => void data.refresh()}>Try again</Button>}>
          {data.error}
        </StateNotice>
      );
    }
    return (
      <div className="deploy-skeleton" role="status">
        <span className="skeleton skeleton-text" aria-hidden="true" />
        <span className="sr-only">Loading the live previews…</span>
      </div>
    );
  }
  if (!data.list.length) return <p className="deploy-empty">No live previews yet.</p>;
  const rows = [...data.list].reverse();
  const newestLive = rows.find(row => effectiveDeploymentState(row, data.now) === "live");
  return (
    <>
      {data.error && <p className="notice" data-tone="warning"><TriangleAlert size={14} aria-hidden="true" /><span className="notice-body">Couldn't refresh the previews: {data.error}</span></p>}
      <ul className="deploy-list">
        {rows.map(row => <DeploymentRow key={row.id} row={row} now={data.now} showFrame={row === newestLive} onTakeDown={() => setTakeDown(row)} />)}
      </ul>
      <ConfirmDialog
        open={takeDown !== null}
        onOpenChange={open => !open && setTakeDown(null)}
        title="Take this preview down?"
        confirmLabel="Take down"
        busyLabel="Taking down…"
        tone="danger"
        onConfirm={async () => {
          if (!takeDown) return;
          await data.remove(takeDown.id);
          toast.success("The preview was taken down.");
        }}
      >
        The public address stops working and its temporary repository is deleted. The workspace is not changed.
      </ConfirmDialog>
    </>
  );
}

function DeploymentRow({ row, now, showFrame, onTakeDown }: { row: DeploymentView; now: number; showFrame: boolean; onTakeDown: () => void }) {
  const expires = Date.parse(row.expiresAt);
  const left = useCountdown(row.state === "live" && Number.isFinite(expires) ? expires : null, 30_000);
  const state = row.state === "live" && left === 0 && Number.isFinite(expires) ? "expired" : effectiveDeploymentState(row, now);
  const name = deploymentName(row.url);
  const minutes = Math.ceil(left / 60);
  const when = (() => {
    switch (state) {
      case "live": return `Removed automatically at ${formatClock(row.expiresAt)}${minutes > 0 ? ` (in ${plural(minutes, "minute")})` : ""}`;
      case "creating":
      case "building": return `Started ${formatClock(row.createdAt)}`;
      case "failed": return `Failed · started ${formatClock(row.createdAt)}`;
      case "expired": return `Expired ${formatClock(row.removedAt ?? row.expiresAt)}`;
      case "removed": return `Taken down ${formatClock(row.removedAt)}${row.removedReason && REMOVED_WHY[row.removedReason] ? ` · ${REMOVED_WHY[row.removedReason]}` : ""}`;
      case "interrupted": return `Stopped ${formatClock(row.removedAt ?? row.createdAt)} · its run ended before it was live`;
    }
  })();
  const target = row.target.kind === "temp_repo" ? `Built from a temporary private repository${row.target.repo ? ` (${row.target.repo})` : ""}` : `Built from ${row.target.repo ?? "your repository"}`;
  return (
    <li className="deploy-row" data-state={state}>
      <div className="deploy-row-head">
        <span className="status-badge" data-tone={STATE_TONE[state]} data-size="sm">
          {state === "creating" || state === "building" ? <Spinner size={11} /> : state === "failed" ? <CircleX size={12} aria-hidden="true" /> : state === "live" ? <span className="status-dot" aria-hidden="true" /> : null}
          {STATE_LABEL[state]}
        </span>
        {state === "live" && name && <span className="deploy-name mono" title={name}>{name}</span>}
        <span className="spacer" />
        {state === "live" && (row.openUrl ?? row.url) && <a className="btn sm" href={row.openUrl ?? row.url ?? undefined} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open</a>}
        {state === "live" && row.canRemove && <Button size="sm" variant="danger" onClick={onTakeDown}>Take down</Button>}
      </div>
      <p className="deploy-when"><time dateTime={row.createdAt} title={fullDate(row.createdAt)}>{when}</time></p>
      {(state === "failed" || state === "creating" || state === "building") && row.detail && <p className="deploy-detail" data-tone={state === "failed" ? "danger" : undefined}>{row.detail}</p>}
      <p className="deploy-target">{target}</p>
      {showFrame && state === "live" && (row.openUrl ?? row.url) && <DeployFrame url={(row.openUrl ?? row.url)!} />}
    </li>
  );
}

function DeployFrame({ url }: { url: string }) {
  const [phase, setPhase] = useState<"loading" | "loaded" | "slow">("loading");
  const [key, setKey] = useState(0);
  useEffect(() => {
    setPhase("loading");
    const timer = setTimeout(() => setPhase(current => (current === "loading" ? "slow" : current)), 25_000);
    return () => clearTimeout(timer);
  }, [url, key]);
  return (
    <div className="preview-frame-wrap" data-loaded={phase === "loaded" || undefined}>
      {phase !== "loaded" && <span className="skeleton preview-frame-skeleton" aria-hidden="true" />}
      <iframe key={key} className="preview-frame" src={url} title="Live preview" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerPolicy="no-referrer" onLoad={() => setPhase("loaded")} />
      {phase === "slow" && (
        <div className="preview-frame-note notice" data-tone="warning">
          <TriangleAlert size={14} aria-hidden="true" />
          <span className="notice-body">The preview is taking a while to load. A free preview can need a minute to wake up.</span>
          <span className="notice-actions"><Button size="sm" icon={RefreshCw} onClick={() => setKey(value => value + 1)}>Reload</Button></span>
        </div>
      )}
    </div>
  );
}
