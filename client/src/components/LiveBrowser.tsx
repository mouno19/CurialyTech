import { useEffect, useState } from "react";
import { ChevronDown, Globe, Lock, RotateCcw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { Spinner } from "@/components/common/Spinner";
import { agentApi, ApiError, errorMessage, formatDuration } from "@/lib/api";
import type { BrowserState } from "@/lib/taskStream";
import { displayAddress, plural } from "@/components/task/format";

// Curialy Live Browser. A "live" event alone is never trusted: the live view is shown only while
// the event says live, the run is active, the stream is connected and the server confirms the
// session (GET /browser/:sid), which is also the only place the view address comes from.

const REASON_TEXT: Record<string, string> = {
  done: "Finished",
  agent: "Closed by the agent",
  idle: "Closed after being idle",
  cancelled: "Stopped: the run was cancelled",
  interrupted: "Stopped: the run was interrupted",
  failed: "Stopped: the run failed",
  disconnected: "The connection to the browser was lost",
};

type Remote =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "live"; viewer: string; title: string; url: string }
  | { phase: "ended" }
  | { phase: "error"; message: string };

type Props = {
  taskId: string;
  browser: BrowserState;
  /** The derived task status is active. */
  taskActive: boolean;
  /** The event stream is connected. */
  streamConnected: boolean;
  /** Activity timeline: status line only, never the view. */
  compact?: boolean;
};

export function LiveBrowser({ taskId, browser, taskActive, streamConnected, compact = false }: Props) {
  const [open, setOpen] = useState(true);
  const [remote, setRemote] = useState<Remote>({ phase: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [gone, setGone] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const eventLive = browser.status === "live" && !gone;
  const check = eventLive && taskActive && streamConnected && browser.viewer && !compact && Boolean(taskId);

  useEffect(() => {
    if (!check) {
      setRemote({ phase: "idle" });
      return;
    }
    let cancelled = false;
    setRemote({ phase: "checking" });
    agentApi.browserStatus(taskId, browser.sessionId, true).then(
      status => {
        if (cancelled) return;
        setFrameLoaded(false);
        setRemote(status.status === "live" && status.viewer ? { phase: "live", viewer: status.viewer, title: status.title, url: status.url } : { phase: "ended" });
      },
      failure => !cancelled && setRemote({ phase: "error", message: errorMessage(failure, "Couldn't reach the browser session.") }),
    );
    return () => {
      cancelled = true;
    };
  }, [check, taskId, browser.sessionId, attempt]);

  const reconnect = async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      const status = await agentApi.browserReconnect(taskId, browser.sessionId);
      if (status.status === "live") setAttempt(value => value + 1);
      else setGone(true);
    } catch (failure) {
      toast.error(failure instanceof ApiError && failure.status === 429 ? "Wait a few seconds before reconnecting again." : errorMessage(failure, "Couldn't reconnect to the browser."));
    } finally {
      setReconnecting(false);
    }
  };

  const address = displayAddress(remote.phase === "live" && remote.url ? remote.url : browser.url);
  // The compact line never claims "live": only the confirmed view in the conversation does.
  const state: "connecting" | "live" | "browsing" | "disconnected" | "ended" = !eventLive || !taskActive
    ? "ended"
    : !streamConnected || remote.phase === "ended" || remote.phase === "error"
      ? "disconnected"
      : compact ? "browsing" : remote.phase === "live" ? "live" : "connecting";

  if (state === "ended") {
    const duration = browser.endedAt ? Date.parse(browser.endedAt) - Date.parse(browser.startedAt) : 0;
    const reason = REASON_TEXT[browser.reason ?? (taskActive ? "" : "done")] ?? "Session ended";
    return (
      <section className="live-browser" data-state="ended" aria-label="Live browser session (ended)">
        <div className="lb-bar">
          <Globe size={14} aria-hidden="true" />
          <span className="lb-title">Live Browser</span>
          <span className="lb-state">Session ended</span>
        </div>
        <p className="lb-summary">
          {reason} · {plural(browser.actions, "action")}{duration > 0 ? ` · ${formatDuration(duration)}` : ""}
          {address && <> · last page <span className="lb-url" title={address}>{address}</span></>}
        </p>
      </section>
    );
  }

  return (
    <section className="live-browser" data-state={state} aria-label="Live browser session">
      <div className="lb-bar">
        {!compact && state === "live" && <IconButton size="sm" label={open ? "Hide the live view" : "Show the live view"} icon={ChevronDown} aria-expanded={open} onClick={() => setOpen(value => !value)} />}
        {state === "live" ? (
          <span className="lb-live"><span className="lb-dot" aria-hidden="true" />Live</span>
        ) : state === "browsing" ? (
          <span className="lb-state"><Globe size={13} aria-hidden="true" /> Browsing</span>
        ) : state === "connecting" ? (
          <span className="lb-state"><Spinner size={13} /> Connecting…</span>
        ) : (
          <span className="lb-state" data-tone="warning"><Unplug size={13} aria-hidden="true" /> Disconnected</span>
        )}
        <span className="lb-title hide-phone">Live Browser</span>
        <div className="lb-address" title={address || undefined}>
          <Lock size={11} aria-hidden="true" />
          <span className="truncate">{address || "Starting…"}</span>
        </div>
      </div>
      <p className="lb-status">{state === "disconnected" ? (streamConnected ? "The live view is not reachable right now." : "Lost the connection to this run; reconnecting…") : browser.detail || "Browser session started"}</p>
      {state === "disconnected" && !compact && (
        <div className="lb-disconnected">
          <p>Last action: {browser.detail || browser.action || "none yet"}{address ? <> on <span className="lb-url">{address}</span></> : null}.</p>
          <Button size="sm" icon={RotateCcw} busy={reconnecting} onClick={() => void reconnect()}>{reconnecting ? "Reconnecting…" : "Reconnect"}</Button>
        </div>
      )}
      {state === "live" && remote.phase === "live" && open && (
        <div className="lb-frame-wrap" data-loaded={frameLoaded || undefined}>
          {!frameLoaded && <span className="skeleton lb-skeleton" aria-hidden="true" />}
          <iframe key={remote.viewer} className="lb-frame" src={remote.viewer} title="Live view of the agent's browser" allow="clipboard-read; clipboard-write" referrerPolicy="no-referrer" onLoad={() => setFrameLoaded(true)} />
        </div>
      )}
    </section>
  );
}
