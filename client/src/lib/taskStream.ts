import { useEffect, useReducer, useRef } from "react";
import { PHASES, type AgentEvent, type PhaseId, type PhaseState, type PlanStep, type TaskStatus } from "@shared/agent";

export type FileChange = Extract<AgentEvent, { type: "file_change" }>;
export type OutputSegment = { stream: "stdout" | "stderr"; text: string };

export type TimelineItem =
  | { kind: "user"; id: string; text: string; ts: string }
  | { kind: "thinking"; id: string; text: string; ts: string; ms?: number; done: boolean; turn: number }
  | { kind: "text"; id: string; text: string; ts: string; done: boolean }
  | { kind: "tool"; id: string; name: string; ts: string; inputPartial: string; input?: Record<string, unknown>; output: OutputSegment[]; result?: { ok: boolean; summary: string; exitCode?: number | null; durationMs: number }; changes: FileChange[] }
  | { kind: "dispatch"; id: string; ts: string; model: string; provider: string; reason: string }
  | { kind: "verify"; id: string; ts: string; iteration: number; commands: string[]; results: Extract<AgentEvent, { type: "verify_result" }>[] }
  | { kind: "heal"; id: string; ts: string; iteration: number; reason: string; model: string }
  | { kind: "external"; id: string; ts: string; status: string; detail: string; url?: string }
  | { kind: "notice"; id: string; ts: string; level: "info" | "warn" | "error"; message: string }
  | { kind: "repo"; id: string; ts: string; label: string; detail: string; url: string }
  | { kind: "browser"; id: string; ts: string }
  | { kind: "media"; id: string; ts: string; mediaId: string | null; filename: string; mimeType: string; caption: string; src: string };

export type BrowserState = { sessionId: string; status: "live" | "ended"; liveUrl: string | null; replayUrl: string; url: string; action: string; detail: string; actions: number; startedAt: string; endedAt?: string; reason?: string };

export type DeploymentState = { id: string; status: string; url?: string; detail: string; expiresAt?: string; updatedAt: string };

export type TurnUsage = Extract<AgentEvent, { type: "usage" }>;

export type StreamState = {
  items: TimelineItem[];
  phases: Record<PhaseId, { state: PhaseState; note?: string; since?: string }>;
  plan: PlanStep[];
  changes: FileChange[];
  usage: TurnUsage[];
  deployments: DeploymentState[];
  browsers: Record<string, BrowserState>;
  status: TaskStatus | null;
  model: string | null;
  answer: string;
  events: AgentEvent[];
  lastSeq: number;
  connected: boolean;
  ended: boolean;
};

const initialPhases = () => Object.fromEntries(PHASES.map(phase => [phase.id, { state: "pending" as PhaseState }])) as StreamState["phases"];

export const initialStreamState = (): StreamState => ({
  items: [], phases: initialPhases(), plan: [], changes: [], usage: [], deployments: [], browsers: {}, status: null, model: null, answer: "", events: [], lastSeq: 0, connected: false, ended: false,
});

type Action = { type: "events"; events: AgentEvent[] } | { type: "connected"; value: boolean } | { type: "ended" } | { type: "reset" };

const MAX_RAW_EVENTS = 4000;

function apply(state: StreamState, event: AgentEvent) {
  const items = state.items;
  const find = <K extends TimelineItem["kind"]>(kind: K, id: string) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === kind && item.id === id) return { index: i, item: item as Extract<TimelineItem, { kind: K }> };
    }
    return null;
  };
  const replace = (index: number, item: TimelineItem) => { items[index] = item; };

  switch (event.type) {
    case "user_message":
      items.push({ kind: "user", id: `u${event.seq}`, text: event.text, ts: event.ts });
      break;
    case "status":
      state.status = event.status;
      break;
    case "phase":
      state.phases = { ...state.phases, [event.phase]: { state: event.state, note: event.note, since: event.ts } };
      break;
    case "dispatch":
      state.model = event.model;
      items.push({ kind: "dispatch", id: `d${event.seq}`, ts: event.ts, model: event.model, provider: event.provider, reason: event.reason });
      break;
    case "thinking_start": {
      const turn = state.usage.length + 1;
      items.push({ kind: "thinking", id: event.blockId, text: "", ts: event.ts, done: false, turn });
      break;
    }
    case "thinking_delta": {
      const found = find("thinking", event.blockId);
      if (found) replace(found.index, { ...found.item, text: found.item.text + event.text });
      break;
    }
    case "thinking_end": {
      const found = find("thinking", event.blockId);
      if (found) replace(found.index, { ...found.item, done: true, ms: event.ms });
      break;
    }
    case "text_start":
      items.push({ kind: "text", id: event.blockId, text: "", ts: event.ts, done: false });
      break;
    case "text_delta": {
      const found = find("text", event.blockId);
      if (found) replace(found.index, { ...found.item, text: found.item.text + event.text });
      break;
    }
    case "text_end": {
      const found = find("text", event.blockId);
      if (found) replace(found.index, { ...found.item, done: true });
      break;
    }
    case "tool_start":
      items.push({ kind: "tool", id: event.callId, name: event.name, ts: event.ts, inputPartial: "", output: [], changes: [] });
      break;
    case "tool_input_delta": {
      const found = find("tool", event.callId);
      if (found) replace(found.index, { ...found.item, inputPartial: found.item.inputPartial + event.partial });
      break;
    }
    case "tool_call": {
      const found = find("tool", event.callId);
      if (found) replace(found.index, { ...found.item, input: event.input });
      else items.push({ kind: "tool", id: event.callId, name: event.name, ts: event.ts, inputPartial: "", input: event.input, output: [], changes: [] });
      break;
    }
    case "tool_output": {
      const found = find("tool", event.callId);
      if (!found) break;
      const output = found.item.output.slice();
      const last = output[output.length - 1];
      if (last && last.stream === event.stream) output[output.length - 1] = { ...last, text: last.text + event.chunk };
      else output.push({ stream: event.stream, text: event.chunk });
      replace(found.index, { ...found.item, output });
      break;
    }
    case "tool_result": {
      const found = find("tool", event.callId);
      if (found) replace(found.index, { ...found.item, result: { ok: event.ok, summary: event.summary, exitCode: event.exitCode, durationMs: event.durationMs } });
      break;
    }
    case "file_change": {
      state.changes = [...state.changes, event];
      const found = find("tool", event.callId);
      if (found) replace(found.index, { ...found.item, changes: [...found.item.changes, event] });
      break;
    }
    case "plan":
      state.plan = event.steps;
      break;
    case "verify_start":
      items.push({ kind: "verify", id: `v${event.iteration}-${event.seq}`, ts: event.ts, iteration: event.iteration, commands: event.commands, results: [] });
      break;
    case "verify_result": {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === "verify" && item.iteration === event.iteration) {
          replace(i, { ...item, results: [...item.results, event] });
          break;
        }
      }
      break;
    }
    case "heal":
      items.push({ kind: "heal", id: `h${event.seq}`, ts: event.ts, iteration: event.iteration, reason: event.reason, model: event.model });
      break;
    case "usage":
      state.usage = [...state.usage, event];
      break;
    case "external":
      items.push({ kind: "external", id: `x${event.seq}`, ts: event.ts, status: event.status, detail: event.detail, url: event.url });
      break;
    case "notice":
      items.push({ kind: "notice", id: `n${event.seq}`, ts: event.ts, level: event.level, message: event.message });
      break;
    case "error":
      items.push({ kind: "notice", id: `e${event.seq}`, ts: event.ts, level: "error", message: event.message });
      break;
    case "done":
      state.status = event.status;
      if (event.answer) state.answer = event.answer;
      break;
    case "browser_session": {
      const current = state.browsers[event.sessionId];
      if (event.status === "live") {
        state.browsers = { ...state.browsers, [event.sessionId]: { sessionId: event.sessionId, status: "live", liveUrl: event.liveUrl, replayUrl: event.replayUrl, url: "about:blank", action: "open", detail: "Browser session started", actions: 0, startedAt: event.ts } };
        items.push({ kind: "browser", id: event.sessionId, ts: event.ts });
      } else if (current) {
        state.browsers = { ...state.browsers, [event.sessionId]: { ...current, status: "ended", liveUrl: null, endedAt: event.ts, reason: event.reason, detail: "Browsing finished" } };
      }
      break;
    }
    case "browser_action": {
      const current = state.browsers[event.sessionId];
      if (current) state.browsers = { ...state.browsers, [event.sessionId]: { ...current, url: event.url || current.url, action: event.action, detail: event.detail, actions: current.actions + 1 } };
      break;
    }
    case "repo":
      items.push({ kind: "repo", id: `r${event.seq}`, ts: event.ts, label: `Cloned ${event.fullName}`, detail: `branch ${event.branch} @ ${event.baseSha.slice(0, 7)} → ${event.repoPath === "." ? "workspace root" : `${event.repoPath}/`}`, url: event.url });
      break;
    case "repo_push":
      items.push({ kind: "repo", id: `r${event.seq}`, ts: event.ts, label: `Pushed ${event.commitSha.slice(0, 7)} → ${event.branch}`, detail: `${event.changed} changed, ${event.deleted} deleted · ${event.fullName}`, url: event.commitUrl });
      break;
    case "repo_pr":
      items.push({ kind: "repo", id: `r${event.seq}`, ts: event.ts, label: `Opened PR #${event.number}`, detail: `${event.head} → ${event.base} · ${event.fullName}`, url: event.url });
      break;
    case "media":
      items.push({ kind: "media", id: `m${event.seq}`, ts: event.ts, mediaId: event.mediaId, filename: event.filename, mimeType: event.mimeType, caption: event.caption, src: event.mediaId ? `/api/agent/media/${event.mediaId}` : event.inlineDataUrl ?? "" });
      break;
    case "deployment": {
      // Progress events are keyed by the tool call until Render returns a deployment id; merge them.
      const current = state.deployments[state.deployments.length - 1];
      const next: DeploymentState = { id: event.deploymentId, status: event.status, url: event.url ?? current?.url, detail: event.detail, expiresAt: event.expiresAt ?? current?.expiresAt, updatedAt: event.ts };
      state.deployments = current && current.status !== "live" && current.status !== "failed" ? [...state.deployments.slice(0, -1), next] : [...state.deployments, next];
      break;
    }
    case "turn_start":
      break;
  }
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case "reset":
      return initialStreamState();
    case "connected":
      return { ...state, connected: action.value };
    case "ended":
      return { ...state, ended: true, connected: false };
    case "events": {
      const fresh = action.events.filter(event => event.seq > state.lastSeq);
      if (!fresh.length) return state;
      const next: StreamState = { ...state, items: state.items.slice(), ended: false };
      for (const event of fresh) apply(next, event);
      next.lastSeq = fresh[fresh.length - 1].seq;
      const events = state.events.concat(fresh);
      next.events = events.length > MAX_RAW_EVENTS ? events.slice(events.length - MAX_RAW_EVENTS) : events;
      return next;
    }
  }
}

/** Subscribe to a task's event stream; reconnects with the last sequence number after drops. */
export function useTaskStream(taskId: string | undefined, generation = 0) {
  const [state, dispatch] = useReducer(reducer, undefined, initialStreamState);
  const lastSeq = useRef(0);
  lastSeq.current = state.lastSeq;

  useEffect(() => {
    dispatch({ type: "reset" });
    lastSeq.current = 0;
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let pending: AgentEvent[] = [];
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pending.length) dispatch({ type: "events", events: pending });
      pending = [];
    };
    const connect = () => {
      source = new EventSource(`/api/agent/tasks/${taskId}/events?after=${lastSeq.current}`, { withCredentials: true });
      source.onopen = () => dispatch({ type: "connected", value: true });
      source.onmessage = message => {
        pending.push(JSON.parse(message.data) as AgentEvent);
        frame ??= requestAnimationFrame(flush);
      };
      source.addEventListener("end", () => {
        flush();
        source?.close();
        dispatch({ type: "ended" });
      });
      source.onerror = () => {
        source?.close();
        dispatch({ type: "connected", value: false });
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [taskId, generation]);

  return state;
}

export function totals(usage: TurnUsage[]) {
  return usage.reduce((sum, turn) => ({ input: sum.input + turn.inputTokens, output: sum.output + turn.outputTokens, thinking: sum.thinking + turn.thinkingTokens, cache: sum.cache + turn.cacheReadTokens }), { input: 0, output: 0, thinking: 0, cache: 0 });
}
