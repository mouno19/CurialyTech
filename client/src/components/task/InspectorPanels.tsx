import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, ChevronRight, X } from "lucide-react";
import type { AgentEvent } from "@shared/agent";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { StateNotice } from "@/components/common/StateNotice";
import { DiffViewer } from "@/components/deck/DiffViewer";
import { PlanView, TERMINAL_TOOLS, TimelineEntry, ToolCard } from "@/components/deck/Timeline";
import { isReplayed, scrubText, type FileChange, type ItemOf, type StreamState } from "@/lib/taskStream";
import { useScrollMemory, useStickToBottom } from "@/lib/useStickToBottom";
import { formatClock, plural, prefs } from "./format";
import { JumpToLatest } from "./JumpToLatest";

const THINKING_PREF = "curialy.activity.thinking";

type ActivityProps = {
  taskId: string;
  state: StreamState;
  streaming: boolean;
  taskActive: boolean;
  /** An entry to bring into view (the error of a failed run), then cleared. */
  focusKey: string | null;
  onFocused: () => void;
  /** The panel is on screen (a hidden panel cannot scroll yet). */
  visible: boolean;
};

/** Everything the agent did, in order, following the end while the reader is there. */
export function ActivityPanel({ taskId, state, streaming, taskActive, focusKey, onFocused, visible }: ActivityProps) {
  const [showThinking, setShowThinking] = useState(() => prefs.get(THINKING_PREF) !== "0");
  const items = useMemo(() => state.items.filter(item => item.kind !== "user" && item.kind !== "text" && (showThinking || item.kind !== "thinking")), [state.items, showThinking]);
  const thinking = useMemo(() => state.items.reduce((count, item) => count + (item.kind === "thinking" ? 1 : 0), 0), [state.items]);
  const usageByTurn = useMemo(() => new Map(state.usage.map((turn, index) => [index + 1, turn])), [state.usage]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(scroller, { count: items.length });

  const { reveal } = stick;
  useEffect(() => {
    const element = scroller.current;
    if (!focusKey || !visible || !element || element.clientHeight === 0) return;
    const target = element.querySelector<HTMLElement>(`[data-entry-key="${CSS.escape(focusKey)}"]`);
    if (!target) return;
    reveal(target);
    onFocused();
  }, [focusKey, visible, items.length, reveal, onFocused]);

  const toggleThinking = () => {
    setShowThinking(value => {
      prefs.set(THINKING_PREF, value ? "0" : "1");
      return !value;
    });
  };

  const loaded = isReplayed(state);
  return (
    <>
      <div className="panel-scroll" ref={scroller}>
        <div className="panel-body">
          <div className="panel-toolbar">
            <button type="button" className="toggle" aria-pressed={showThinking} onClick={toggleThinking} disabled={!thinking}>
              <Brain size={14} aria-hidden="true" />
              <span className="toggle-label">Show thinking</span>
            </button>
            <span className="panel-meta">
              {plural(items.length, "step")}
              {!showThinking && thinking > 0 ? ` · ${plural(thinking, "thinking block")} hidden` : ""}
            </span>
          </div>
          <PlanView steps={state.plan} live={streaming} />
          {items.length === 0 ? (
            !loaded ? <StateNotice variant="loading" size="sm" title="Loading the activity…" />
              : taskActive ? <StateNotice variant="loading" size="sm" title="Waiting for the first step">The agent's thinking, tool calls and file changes appear here as they happen.</StateNotice>
                : <StateNotice variant="empty" size="sm" title="No steps were recorded">This run did not record any activity.</StateNotice>
          ) : (
            items.map(item => (
              <TimelineEntry
                key={item.key}
                item={item}
                taskId={taskId}
                usage={item.kind === "thinking" ? usageByTurn.get(item.turn) : undefined}
                browser={item.kind === "browser" ? state.browsers[item.sessionId] : undefined}
                streaming={streaming}
                taskActive={taskActive}
                streamConnected={state.connected}
              />
            ))
          )}
        </div>
      </div>
      <JumpToLatest show={stick.showJump} unseen={stick.unseen} onJump={stick.jump} />
    </>
  );
}

/** Shell commands and verification runs with their output. */
export function TerminalPanel({ state, streaming }: { state: StreamState; streaming: boolean }) {
  const tools = useMemo(() => state.items.filter((item): item is ItemOf<"tool"> => item.kind === "tool" && TERMINAL_TOOLS.has(item.name)), [state.items]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(scroller, { count: tools.length });
  return (
    <>
      <div className="panel-scroll" ref={scroller}>
        <div className="panel-body">
          {tools.length === 0 ? (
            <StateNotice variant="empty" size="sm" title={streaming ? "No commands yet" : "No commands were run"}>Shell commands and verification runs show their output here.</StateNotice>
          ) : tools.map(tool => <ToolCard key={tool.key} item={tool} streaming={streaming} />)}
        </div>
      </div>
      <JumpToLatest show={stick.showJump} unseen={stick.unseen} onJump={stick.jump} />
    </>
  );
}

const MANY_CHANGES = 8;

/** Every file the agent created, edited or deleted, in the order applied. */
export function ChangesPanel({ changes }: { changes: FileChange[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  useScrollMemory(scroller);
  const files = useMemo(() => new Set(changes.map(change => change.path)).size, [changes]);
  return (
    <div className="panel-scroll" ref={scroller}>
      <div className="panel-body">
        {changes.length === 0 ? (
          <StateNotice variant="empty" size="sm" title="No file changes">Every file the agent creates, edits or deletes appears here as a diff.</StateNotice>
        ) : (
          <>
            <p className="panel-meta">{plural(changes.length, "change")} across {plural(files, "file")}, in the order applied{changes.length > MANY_CHANGES ? " (collapsed: open a file to see its diff)" : ""}.</p>
            {changes.map(change => <DiffViewer key={change.seq} change={change} defaultOpen={changes.length <= MANY_CHANGES} />)}
          </>
        )}
      </div>
    </div>
  );
}

const RAW_PAGE = 400;
const HIDDEN_FIELDS = new Set(["liveUrl", "replayUrl"]);

function rawData(event: AgentEvent) {
  const { seq: _seq, ts: _ts, type: _type, ...rest } = event as AgentEvent & Record<string, unknown>;
  const visible: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (!HIDDEN_FIELDS.has(key)) visible[key] = value;
  return visible;
}

function RawRow({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => rawData(event), [event]);
  const line = useMemo(() => scrubText(JSON.stringify(data)), [data]);
  return (
    <li className="raw-row" data-open={open || undefined}>
      <button type="button" className="raw-line" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <ChevronRight size={12} className="raw-chevron" aria-hidden="true" />
        <span className="raw-seq">#{event.seq}</span>
        <span className="raw-time">{formatClock(event.ts)}</span>
        <span className="raw-type" title={event.type}>{event.type}</span>
        <span className="raw-data">{line.slice(0, 300)}</span>
      </button>
      {open && <pre className="raw-json" tabIndex={0}>{scrubText(JSON.stringify(data, null, 2))}</pre>}
    </li>
  );
}

/** The event log as received (debug view). Vendor links and live-view addresses are never shown. */
export function RawLog({ events, total, onClose }: { events: AgentEvent[]; total: number; onClose: () => void }) {
  const [limit, setLimit] = useState(RAW_PAGE);
  const rows = events.slice(-limit);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollMemory(scroller);
  return (
    <div className="panel-scroll" ref={scroller}>
      <div className="panel-body">
        <div className="panel-toolbar">
          <span className="panel-meta">
            Raw log · {rows.length < total ? `the last ${rows.length} of ${total} events` : plural(total, "event")}
            {total > events.length ? ` (only the newest ${events.length} are kept on this page)` : ""}
          </span>
          <span className="spacer" />
          {rows.length < events.length && <Button size="sm" variant="ghost" onClick={() => setLimit(events.length)}>Show all {events.length}</Button>}
          <IconButton size="sm" label="Close the raw log" icon={X} onClick={onClose} />
        </div>
        {rows.length === 0 ? <StateNotice variant="empty" size="sm" title="No events yet" /> : (
          <ol className="raw panel-ink" aria-label="Events">
            {rows.map(event => <RawRow key={event.seq} event={event} />)}
          </ol>
        )}
      </div>
    </div>
  );
}
