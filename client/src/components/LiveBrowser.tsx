import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Globe, Lock, PlayCircle } from "lucide-react";
import type { BrowserState } from "@/lib/taskStream";
import { formatDuration } from "@/lib/api";

// Live view of the agent's Browserbase session. Rendering happens entirely in Browserbase's cloud;
// this is an iframe of its embeddable DevTools screencast. Once the session ends the view
// collapses into a link to the session replay.

const displayUrl = (url: string) => url.replace(/\/api\/workspace\/preview\/([^/]+)\/[^/?#]+/, "/api/workspace/preview/$1/…");

export function LiveBrowser({ browser, compact = false }: { browser: BrowserState; compact?: boolean }) {
  const [open, setOpen] = useState(true);
  const live = browser.status === "live" && browser.liveUrl;

  if (!live) {
    const duration = browser.endedAt ? new Date(browser.endedAt).getTime() - new Date(browser.startedAt).getTime() : 0;
    return (
      <div className="live-browser ended">
        <div className="lb-bar">
          <Globe size={14} className="faint" />
          <span className="lb-title">Browser session ended</span>
          <span className="faint truncate" style={{ fontSize: 12 }}>{browser.actions} action{browser.actions === 1 ? "" : "s"}{duration ? ` · ${formatDuration(duration)}` : ""} · last at {displayUrl(browser.url)}</span>
          <span className="spacer" />
          <a className="btn sm" href={browser.replayUrl} target="_blank" rel="noreferrer" title="Opens in Browserbase (requires a Browserbase login)"><PlayCircle size={13} /> View Session Replay &amp; Logs</a>
        </div>
      </div>
    );
  }

  return (
    <div className="live-browser">
      <div className="lb-bar">
        <button className="icon-btn sm" onClick={() => setOpen(value => !value)} aria-label={open ? "Collapse live view" : "Expand live view"}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <span className="lb-live"><span className="lb-dot" /> LIVE</span>
        <div className="lb-address" title={browser.url}><Lock size={11} className="faint" /><span className="truncate">{displayUrl(browser.url)}</span></div>
        <a className="icon-btn sm" href={browser.liveUrl!} target="_blank" rel="noreferrer" title="Open the live view in a new tab"><ExternalLink size={13} /></a>
      </div>
      <div className="lb-status">{browser.detail}</div>
      {open && !compact && <iframe className="lb-frame" src={browser.liveUrl!} title="Live cloud browser" allow="clipboard-read; clipboard-write" />}
    </div>
  );
}
