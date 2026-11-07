import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  PHASES, type AgentEvent, type GeneratedSummary, type PhaseId, type PhaseState, type PlanStep, type RunOutcome, type RunTrigger, type StatusReason,
  type TaskStatus, type TeamRole,
} from "@shared/agent";
import { isActiveStatus } from "@shared/taskStatus";
import { agentApi, ApiError, type TaskDetail } from "@/lib/api";

// One task's event log, folded into what the workspace renders. The reducer is pure (tested in
// taskStream.test.ts); the hook owns the SSE connection: sync/reset, dedupe, batching, backoff.

export type FileChange = Extract<AgentEvent, { type: "file_change" }>;
export type VerifyResult = Extract<AgentEvent, { type: "verify_result" }>;
export type TurnUsage = Extract<AgentEvent, { type: "usage" }>;
export type Attachment = Extract<AgentEvent, { type: "artifacts" }>["files"][number];
export type UserAttachment = NonNullable<Extract<AgentEvent, { type: "user_message" }>["attachments"]>[number];
export type OutputSegment = { stream: "stdout" | "stderr"; text: string };
/** settled: no result ever arrived, the run ended without it ("stopped") or its worker went away ("interrupted"). */
export type ToolResult = { ok: boolean; summary: string; exitCode?: number | null; durationMs: number; settled?: "stopped" | "interrupted" };

/** key: unique per item (React key); id: the block/call id events refer to; run: index into StreamState.runs. */
type ItemBase = { key: string; id: string; seq: number; ts: string; run: number; agent?: TeamRole };
export type TimelineItem = ItemBase & (
  | { kind: "run"; runId: string | null; attempt: number; trigger: RunTrigger }
  /** system: sent on the user's behalf by an action (Deploy), shown as a divider, not as a bubble. */
  | { kind: "user"; text: string; attachments?: UserAttachment[]; clientMessageId?: string; system?: boolean }
  | { kind: "thinking"; text: string; ms?: number; done: boolean; turn: number }
  | { kind: "text"; text: string; done: boolean }
  | { kind: "tool"; name: string; inputPartial: string; input?: Record<string, unknown>; output: OutputSegment[]; outputBytes: number; result?: ToolResult; changes: FileChange[] }
  | { kind: "dispatch"; model: string; provider: string; reason: string }
  | { kind: "verify"; iteration: number; commands: string[]; results: VerifyResult[] }
  | { kind: "heal"; iteration: number; reason: string; model: string }
  | { kind: "recovery"; failure: string; action: string; detail: string; attempt: number; delayMs?: number; model?: string }
  | { kind: "external"; status: string; detail: string }
  | { kind: "notice"; level: "info" | "warn" | "error"; message: string }
  | { kind: "repo"; action: "clone" | "push" | "pr"; label: string; detail: string; url: string }
  | { kind: "browser"; sessionId: string }
  | { kind: "attachments"; files: Attachment[]; auto: boolean; more: number; skipped: string[]; generated?: GeneratedSummary; partial?: boolean }
  | { kind: "media"; mediaId: string | null; filename: string; mimeType: string; caption: string; inlineDataUrl?: string; unavailable: boolean }
  | { kind: "handoff"; from: TeamRole; to: TeamRole | "user"; handoff: "plan" | "review" | "fixes" | "report"; title: string; content: string; round?: number }
);
export type ItemOf<K extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: K }>;

/** How a run ended. synthetic: the log has no done event; the stored row said the run is over. */
export type RunEnd = { status: TaskStatus; answer: string; reason?: StatusReason; error?: string; outcome?: RunOutcome; seq: number; ts: string; receivedAt: number; synthetic?: boolean };
/** Things a run did outside the workspace (they stay done even if the run is cancelled). */
export type RunEffect = { kind: "push" | "pr" | "deploy"; key: string; label: string; url?: string; seq: number };
export type RunInfo = {
  index: number;
  /** null: an older log without run_start (the segment was opened by a user message). */
  runId: string | null;
  attempt: number;
  trigger: RunTrigger;
  seq: number;
  ts: string;
  status: TaskStatus | null;
  reason: StatusReason | null;
  end?: RunEnd;
  errors: string[];
  effects: RunEffect[];
  hasUser: boolean;
};

export type BrowserState = {
  sessionId: string;
  status: "live" | "ended";
  /** The server can hand out a live view for this session (fetched on demand, never from the log). */
  viewer: boolean;
  url: string;
  title: string;
  action: string;
  detail: string;
  actions: number;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  run: number;
};

export type TeamMemberStatus = "waiting" | "working" | "done" | "failed" | "stopped";
export type TeamMemberState = { status: TeamMemberStatus; model: string; activity: string; updatedAt: string };

export type StreamDeploymentStatus = "creating" | "building" | "live" | "failed" | "expired" | "removed" | "interrupted";
/** One entry per deploy; aliases are the other ids older logs used for it (the tool call id). */
export type StreamDeployment = { id: string; aliases: string[]; callId?: string; status: StreamDeploymentStatus; url?: string; detail: string; expiresAt?: string; run: number; startedAt: string; updatedAt: string; seq: number };

export type PhaseInfo = { state: PhaseState; note?: string; since?: string };
export type SyncInfo = { maxSeq: number; status: TaskStatus | null; statusReason: StatusReason | null; runId: string | null; live: boolean; at: number };

export type StreamState = {
  items: TimelineItem[];
  runs: RunInfo[];
  phases: Record<PhaseId, PhaseInfo>;
  plan: PlanStep[];
  changes: FileChange[];
  usage: TurnUsage[];
  deployments: StreamDeployment[];
  browsers: Record<string, BrowserState>;
  team: Partial<Record<TeamRole, TeamMemberState>>;
  status: TaskStatus | null;
  statusReason: StatusReason | null;
  model: string | null;
  /** seq of the newest preview event (0: none). */
  previewSeq: number;
  /** The newest events, for the raw log (capped); eventCount counts all of them. */
  events: AgentEvent[];
  eventCount: number;
  lastSeq: number;
  /** The server's newest seq when this page first connected: anything above it arrived live. */
  replayMark: number | null;
  /** The SSE connection is open. */
  connected: boolean;
  /** Open, and the server streams a live run (sync.live). Replays of finished runs are not live. */
  live: boolean;
  ended: boolean;
  endedAt: number | null;
  missing: boolean;
  sync: SyncInfo | null;
  /** The stored status the server reported when this connection opened (sync message). */
  syncedStatus: TaskStatus | null;
};

export type StreamAction =
  | { type: "reset" }
  | { type: "events"; events: AgentEvent[]; at: number }
  | { type: "open" }
  | { type: "sync"; sync: SyncInfo }
  | { type: "ended"; at: number }
  | { type: "disconnected" }
  | { type: "missing" }
  | { type: "settle"; status: TaskStatus; reason?: StatusReason | null; at: number };

const MAX_RAW_EVENTS = 4000;
const MAX_TOOL_OUTPUT = 256 * 1024;

export const initialPhases = () => Object.fromEntries(PHASES.map(phase => [phase.id, { state: "pending" as PhaseState }])) as Record<PhaseId, PhaseInfo>;

export const initialStreamState = (): StreamState => ({
  items: [], runs: [], phases: initialPhases(), plan: [], changes: [], usage: [], deployments: [], browsers: {}, team: {},
  status: null, statusReason: null, model: null, previewSeq: 0, events: [], eventCount: 0, lastSeq: 0, replayMark: null,
  connected: false, live: false, ended: false, endedAt: null, missing: false, sync: null, syncedStatus: null,
});

// ---------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------

/** The old Deploy button sent this as a follow-up; it is an action, not something the user wrote. */
const LEGACY_DEPLOY_PROMPT = /^Deploy this project as a temporary live preview with deploy_preview/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const elapsed = (from: string, to: string) => {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

function currentRun(state: StreamState): RunInfo | undefined {
  return state.runs[state.runs.length - 1];
}

function patchRun(state: StreamState, patch: Partial<RunInfo> | ((run: RunInfo) => Partial<RunInfo>)) {
  const index = state.runs.length - 1;
  if (index < 0) return;
  const run = state.runs[index];
  state.runs[index] = { ...run, ...(typeof patch === "function" ? patch(run) : patch) };
}

function findItem<K extends TimelineItem["kind"]>(state: StreamState, kind: K, id: string): { index: number; item: ItemOf<K> } | null {
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index];
    if (item.kind === kind && item.id === id) return { index, item: item as ItemOf<K> };
  }
  return null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewItem = DistributiveOmit<TimelineItem, "key" | "seq" | "ts" | "run" | "agent">;

function push(state: StreamState, event: AgentEvent, item: NewItem, key = `${item.kind}:${event.seq}`) {
  state.items.push({ ...item, key, seq: event.seq, ts: event.ts, run: Math.max(0, state.runs.length - 1) } as TimelineItem);
}

function stoppedNote(status: TaskStatus) {
  if (status === "cancelled") return "Stopped: the run was cancelled";
  if (status === "interrupted") return "Stopped: the run was interrupted";
  return "Stopped: the run failed";
}

/**
 * No run is executing once a run has ended (done) or a newer one starts: nothing it showed may
 * keep looking live. Tools without a result, open text and thinking, active phases, live browser
 * sessions, working team members and unfinished deploys are closed with a truthful label.
 */
function settleOpen(state: StreamState, status: TaskStatus, ts: string) {
  const completed = status === "completed";
  const settled: ToolResult["settled"] = status === "interrupted" ? "interrupted" : "stopped";
  for (let index = 0; index < state.items.length; index++) {
    const item = state.items[index];
    if (item.kind === "tool" && !item.result) {
      state.items[index] = { ...item, result: { ok: false, summary: settled === "interrupted" ? "Interrupted" : "Stopped", durationMs: elapsed(item.ts, ts), settled } };
    } else if (item.kind === "thinking" && !item.done) {
      state.items[index] = { ...item, done: true, ms: item.ms ?? elapsed(item.ts, ts) };
    } else if (item.kind === "text" && !item.done) {
      state.items[index] = { ...item, done: true };
    }
  }
  let phases: StreamState["phases"] | null = null;
  for (const phase of PHASES) {
    const current = state.phases[phase.id];
    if (current.state !== "active") continue;
    phases ??= { ...state.phases };
    phases[phase.id] = completed ? { ...current, state: "done" } : { state: "failed", note: stoppedNote(status), since: ts };
  }
  if (phases) state.phases = phases;
  const reason = completed ? "done" : status;
  if (Object.values(state.browsers).some(browser => browser.status === "live")) {
    const browsers: Record<string, BrowserState> = {};
    for (const [id, browser] of Object.entries(state.browsers)) browsers[id] = browser.status === "live" ? { ...browser, status: "ended", endedAt: ts, reason } : browser;
    state.browsers = browsers;
  }
  if (Object.values(state.team).some(member => member?.status === "working")) {
    const team: StreamState["team"] = {};
    for (const [role, member] of Object.entries(state.team) as [TeamRole, TeamMemberState | undefined][]) {
      if (!member || member.status !== "working") team[role] = member;
      else if (completed) team[role] = { ...member, status: "done", updatedAt: ts };
      else team[role] = { ...member, status: status === "failed" ? "failed" : "stopped", activity: stoppedNote(status), updatedAt: ts };
    }
    state.team = team;
  }
  if (state.deployments.some(deployment => deployment.status === "creating" || deployment.status === "building")) {
    state.deployments = state.deployments.map(deployment => (deployment.status === "creating" || deployment.status === "building" ? { ...deployment, status: "interrupted", detail: "The deploy stopped when its run ended.", updatedAt: ts } : deployment));
  }
}

function openRun(state: StreamState, event: AgentEvent, run: { runId: string | null; attempt: number; trigger: RunTrigger }) {
  const previous = currentRun(state);
  // A newer run started: whatever the previous one left open never finished.
  if (previous && !previous.end) settleOpen(state, "interrupted", event.ts);
  state.runs.push({ index: state.runs.length, ...run, seq: event.seq, ts: event.ts, status: null, reason: null, errors: [], effects: [], hasUser: false });
  state.phases = initialPhases();
  state.plan = [];
}

/** Older logs have no run_start: the first event opens the initial run. */
function ensureRun(state: StreamState, event: AgentEvent) {
  if (!state.runs.length && event.type !== "run_start") openRun(state, event, { runId: null, attempt: 1, trigger: "prompt" });
}

function addEffect(state: StreamState, effect: RunEffect) {
  patchRun(state, run => (run.effects.some(existing => existing.key === effect.key) ? {} : { effects: [...run.effects, effect] }));
}

/**
 * One entry per deploy. New logs key every event by the deployment row id (with callId); older
 * logs keyed progress by the tool call id and only the live event by the row id, so entries are
 * also matched by call id and url, and an id-less live event joins the unfinished deploy of its run.
 */
export function mergeDeployment(list: StreamDeployment[], event: Extract<AgentEvent, { type: "deployment" }>, run: number): StreamDeployment[] {
  const status: StreamDeploymentStatus = event.status === "deleted" ? "removed" : event.status;
  const keys = [event.deploymentId, event.callId].filter((key): key is string => Boolean(key));
  let index = list.findIndex(entry => keys.some(key => entry.id === key || entry.aliases.includes(key) || entry.callId === key) || Boolean(event.url && entry.url === event.url));
  if (index < 0 && UUID.test(event.deploymentId)) {
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (entry.run === run && !UUID.test(entry.id) && (entry.status === "creating" || entry.status === "building")) {
        index = i;
        break;
      }
    }
  }
  const previous = index >= 0 ? list[index] : undefined;
  const id = UUID.test(event.deploymentId) ? event.deploymentId : previous?.id ?? event.deploymentId;
  const aliases = Array.from(new Set([...(previous?.aliases ?? []), previous?.id, event.deploymentId, event.callId].filter((key): key is string => Boolean(key) && key !== id)));
  const next: StreamDeployment = {
    id, aliases, callId: event.callId ?? previous?.callId, status, url: event.url ?? previous?.url, detail: event.detail || previous?.detail || "",
    expiresAt: event.expiresAt ?? previous?.expiresAt, run: previous?.run ?? run, startedAt: previous?.startedAt ?? event.ts, updatedAt: event.ts, seq: event.seq,
  };
  if (!previous) return [...list, next];
  const copy = list.slice();
  copy[index] = next;
  return copy;
}

function appendOutput(item: ItemOf<"tool">, stream: "stdout" | "stderr", chunk: string): ItemOf<"tool"> {
  let output = item.output.slice();
  const last = output[output.length - 1];
  if (last && last.stream === stream) output[output.length - 1] = { ...last, text: last.text + chunk };
  else output.push({ stream, text: chunk });
  let bytes = item.outputBytes + chunk.length;
  // Very chatty commands: keep the tail (what matters for a failure) and say what was dropped.
  if (bytes > MAX_TOOL_OUTPUT) {
    let excess = bytes - MAX_TOOL_OUTPUT;
    while (excess > 0 && output.length > 1) {
      excess -= output[0].text.length;
      output = output.slice(1);
    }
    if (excess > 0) output[0] = { ...output[0], text: output[0].text.slice(excess) };
    output = [{ stream: "stdout", text: "… earlier output trimmed …\n" }, ...output.filter(segment => !segment.text.startsWith("… earlier output trimmed"))];
    bytes = output.reduce((sum, segment) => sum + segment.text.length, 0);
  }
  return { ...item, output, outputBytes: bytes };
}

function apply(state: StreamState, event: AgentEvent, at: number) {
  ensureRun(state, event);
  const runIndex = Math.max(0, state.runs.length - 1);
  switch (event.type) {
    case "run_start":
      openRun(state, event, { runId: event.runId, attempt: event.attempt, trigger: event.trigger });
      push(state, event, { kind: "run", id: event.runId, runId: event.runId, attempt: event.attempt, trigger: event.trigger });
      break;
    case "user_message": {
      let run = currentRun(state);
      if (!run || run.end || run.hasUser) {
        openRun(state, event, { runId: null, attempt: 1, trigger: state.runs.length ? "follow_up" : "prompt" });
        run = currentRun(state)!;
      }
      const system = run.trigger === "deploy" || run.trigger === "retry" || LEGACY_DEPLOY_PROMPT.test(event.text);
      if (system && run.runId === null && LEGACY_DEPLOY_PROMPT.test(event.text)) patchRun(state, { trigger: "deploy" });
      patchRun(state, { hasUser: true });
      push(state, event, { kind: "user", id: `u${event.seq}`, text: event.text, attachments: event.attachments, clientMessageId: event.clientMessageId, ...(system ? { system: true } : {}) });
      break;
    }
    case "status":
      state.status = event.status;
      state.statusReason = event.reason ?? null;
      patchRun(state, { status: event.status, reason: event.reason ?? null });
      break;
    case "done": {
      state.status = event.status;
      state.statusReason = event.reason ?? null;
      const end: RunEnd = { status: event.status, answer: event.answer ?? "", reason: event.reason, error: event.error, outcome: event.outcome, seq: event.seq, ts: event.ts, receivedAt: at };
      patchRun(state, { status: event.status, reason: event.reason ?? null, end });
      settleOpen(state, event.status, event.ts);
      break;
    }
    case "phase":
      state.phases = { ...state.phases, [event.phase]: { state: event.state, note: event.note, since: event.ts } };
      break;
    case "dispatch":
      state.model = event.model;
      push(state, event, { kind: "dispatch", id: `d${event.seq}`, model: event.model, provider: event.provider, reason: event.reason });
      break;
    case "turn_start":
      break;
    case "thinking_start": {
      const found = findItem(state, "thinking", event.blockId);
      if (!found || found.item.done || found.item.run !== runIndex) push(state, event, { kind: "thinking", id: event.blockId, text: "", done: false, turn: state.usage.length + 1 });
      break;
    }
    case "thinking_delta": {
      const found = findItem(state, "thinking", event.blockId);
      if (found) state.items[found.index] = { ...found.item, text: found.item.text + event.text };
      else push(state, event, { kind: "thinking", id: event.blockId, text: event.text, done: false, turn: state.usage.length + 1 });
      break;
    }
    case "thinking_end": {
      const found = findItem(state, "thinking", event.blockId);
      if (found) state.items[found.index] = { ...found.item, done: true, ms: event.ms };
      break;
    }
    case "text_start": {
      const found = findItem(state, "text", event.blockId);
      if (!found || found.item.done || found.item.run !== runIndex) push(state, event, { kind: "text", id: event.blockId, text: "", done: false });
      break;
    }
    case "text_delta": {
      const found = findItem(state, "text", event.blockId);
      if (found) state.items[found.index] = { ...found.item, text: found.item.text + event.text };
      else push(state, event, { kind: "text", id: event.blockId, text: event.text, done: false });
      break;
    }
    case "text_end": {
      const found = findItem(state, "text", event.blockId);
      if (found) state.items[found.index] = { ...found.item, done: true };
      break;
    }
    case "tool_start": {
      const found = findItem(state, "tool", event.callId);
      if (!found || found.item.result) push(state, event, { kind: "tool", id: event.callId, name: event.name, inputPartial: "", output: [], outputBytes: 0, changes: [] });
      break;
    }
    case "tool_input_delta": {
      const found = findItem(state, "tool", event.callId);
      if (found) state.items[found.index] = { ...found.item, inputPartial: found.item.inputPartial + event.partial };
      break;
    }
    case "tool_call": {
      const found = findItem(state, "tool", event.callId);
      if (found && !found.item.result) state.items[found.index] = { ...found.item, name: event.name || found.item.name, input: event.input };
      else push(state, event, { kind: "tool", id: event.callId, name: event.name, inputPartial: "", input: event.input, output: [], outputBytes: 0, changes: [] });
      break;
    }
    case "tool_output": {
      const found = findItem(state, "tool", event.callId);
      if (found) state.items[found.index] = appendOutput(found.item, event.stream, event.chunk);
      break;
    }
    case "tool_result": {
      const found = findItem(state, "tool", event.callId);
      if (found) state.items[found.index] = { ...found.item, result: { ok: event.ok, summary: event.summary, exitCode: event.exitCode, durationMs: event.durationMs } };
      break;
    }
    case "file_change": {
      state.changes = [...state.changes, event];
      const found = findItem(state, "tool", event.callId);
      if (found) state.items[found.index] = { ...found.item, changes: [...found.item.changes, event] };
      break;
    }
    case "plan":
      state.plan = event.steps;
      break;
    case "verify_start":
      push(state, event, { kind: "verify", id: `v${event.iteration}`, iteration: event.iteration, commands: event.commands, results: [] });
      break;
    case "verify_result":
      for (let index = state.items.length - 1; index >= 0; index--) {
        const item = state.items[index];
        if (item.kind === "verify" && item.iteration === event.iteration) {
          state.items[index] = { ...item, results: [...item.results, event] };
          break;
        }
      }
      break;
    case "heal":
      push(state, event, { kind: "heal", id: `h${event.seq}`, iteration: event.iteration, reason: event.reason, model: event.model });
      break;
    case "recovery":
      push(state, event, { kind: "recovery", id: `rc${event.seq}`, failure: event.kind, action: event.action, detail: event.detail, attempt: event.attempt, delayMs: event.delayMs, model: event.model });
      break;
    case "usage":
      state.usage = [...state.usage, event];
      break;
    case "external":
      push(state, event, { kind: "external", id: `x${event.seq}`, status: event.status, detail: event.detail });
      break;
    case "notice":
      push(state, event, { kind: "notice", id: `n${event.seq}`, level: event.level, message: event.message });
      break;
    case "error":
      push(state, event, { kind: "notice", id: `e${event.seq}`, level: "error", message: event.message });
      patchRun(state, run => ({ errors: [...run.errors, event.message] }));
      break;
    case "media":
      push(state, event, { kind: "media", id: `m${event.seq}`, mediaId: event.mediaId, filename: event.filename, mimeType: event.mimeType, caption: event.caption, inlineDataUrl: event.inlineDataUrl, unavailable: Boolean(event.unavailable) });
      break;
    case "deployment":
      state.deployments = mergeDeployment(state.deployments, event, runIndex);
      if (event.status === "live") {
        const entry = state.deployments.find(deployment => deployment.id === event.deploymentId || deployment.aliases.includes(event.deploymentId));
        addEffect(state, { kind: "deploy", key: `deploy:${entry?.id ?? event.deploymentId}`, label: "Deployed a live preview", url: event.url, seq: event.seq });
      }
      break;
    case "artifacts":
      push(state, event, { kind: "attachments", id: `a${event.seq}`, files: event.files, auto: event.auto, more: event.more, skipped: event.skipped, generated: event.generated, partial: event.partial });
      break;
    case "browser_session": {
      // Never read liveUrl/replayUrl: older logs carry tokenised vendor URLs. The view is fetched on demand.
      const current = state.browsers[event.sessionId];
      if (event.status === "live") {
        state.browsers = {
          ...state.browsers,
          [event.sessionId]: current
            ? { ...current, status: "live", viewer: event.viewer ?? current.viewer, endedAt: undefined, reason: undefined }
            : { sessionId: event.sessionId, status: "live", viewer: event.viewer !== false, url: "", title: "", action: "open", detail: "Browser session started", actions: 0, startedAt: event.ts, run: runIndex },
        };
        if (!current) push(state, event, { kind: "browser", id: event.sessionId, sessionId: event.sessionId });
      } else {
        const base: BrowserState = current ?? { sessionId: event.sessionId, status: "ended", viewer: false, url: "", title: "", action: "", detail: "", actions: 0, startedAt: event.ts, run: runIndex };
        state.browsers = { ...state.browsers, [event.sessionId]: { ...base, status: "ended", endedAt: event.ts, reason: event.reason ?? base.reason } };
        if (!current) push(state, event, { kind: "browser", id: event.sessionId, sessionId: event.sessionId });
      }
      break;
    }
    case "browser_action": {
      const current = state.browsers[event.sessionId];
      if (current) state.browsers = { ...state.browsers, [event.sessionId]: { ...current, url: event.url || current.url, title: event.title || current.title, action: event.action, detail: event.detail, actions: current.actions + 1 } };
      break;
    }
    case "preview":
      state.previewSeq = event.seq;
      break;
    case "repo":
      push(state, event, { kind: "repo", id: `r${event.seq}`, action: "clone", label: `Cloned ${event.fullName}`, detail: `${event.branch} @ ${event.baseSha.slice(0, 7)} → ${event.repoPath === "." ? "workspace root" : `${event.repoPath}/`}`, url: event.url });
      break;
    case "repo_push":
      push(state, event, { kind: "repo", id: `r${event.seq}`, action: "push", label: `Pushed ${event.commitSha.slice(0, 7)} to ${event.branch}`, detail: `${event.changed} changed, ${event.deleted} deleted · ${event.fullName}`, url: event.commitUrl });
      addEffect(state, { kind: "push", key: `push:${event.commitSha}`, label: `Pushed ${event.commitSha.slice(0, 7)} to ${event.fullName} (${event.branch})`, url: event.commitUrl, seq: event.seq });
      break;
    case "repo_pr":
      push(state, event, { kind: "repo", id: `r${event.seq}`, action: "pr", label: `Opened pull request #${event.number}`, detail: `${event.head} → ${event.base} · ${event.fullName}`, url: event.url });
      addEffect(state, { kind: "pr", key: `pr:${event.fullName}#${event.number}`, label: `Opened pull request #${event.number} on ${event.fullName}`, url: event.url, seq: event.seq });
      break;
    case "team_agent":
      state.team = { ...state.team, [event.role]: { status: event.status, model: event.model, activity: event.activity, updatedAt: event.ts } };
      break;
    case "handoff":
      push(state, event, { kind: "handoff", id: `ho${event.seq}`, from: event.from, to: event.to, handoff: event.kind, title: event.title, content: event.content, round: event.round });
      break;
  }
}

function applyBatch(state: StreamState, events: AgentEvent[], at: number): StreamState {
  let next: StreamState | null = null;
  const fresh: AgentEvent[] = [];
  for (const event of events) {
    // Monotonic: a duplicate inside one batch (or across batches) never doubles text or cards.
    if (!event || typeof event.seq !== "number" || event.seq <= (next ?? state).lastSeq) continue;
    next ??= { ...state, items: state.items.slice(), runs: state.runs.slice() };
    const before = next.items.length;
    apply(next, event, at);
    if (event.agent) {
      for (let index = before; index < next.items.length; index++) next.items[index] = { ...next.items[index], agent: event.agent };
      // The "what is this member doing" line, from its own tool calls.
      const member = next.team[event.agent];
      if (event.type === "tool_call" && member && member.status === "working") {
        const input = event.input as Record<string, unknown>;
        const target = [input.command, input.path, input.url, input.pattern, input.repo].find(value => typeof value === "string") as string | undefined;
        next.team = { ...next.team, [event.agent]: { ...member, activity: `${event.name.replace(/_/g, " ")}${target ? `: ${target.slice(0, 80)}` : ""}`, updatedAt: event.ts } };
      }
    }
    next.lastSeq = event.seq;
    fresh.push(event);
  }
  if (!next) return state;
  const events2 = state.events.length + fresh.length > MAX_RAW_EVENTS ? state.events.concat(fresh).slice(-MAX_RAW_EVENTS) : state.events.concat(fresh);
  return { ...next, events: events2, eventCount: state.eventCount + fresh.length };
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "reset":
      return initialStreamState();
    case "events":
      return applyBatch(state, action.events, action.at);
    case "open":
      return { ...state, connected: true, live: false, ended: false, endedAt: null };
    case "sync":
      return { ...state, connected: true, sync: action.sync, syncedStatus: action.sync.status, live: action.sync.live, ended: false, endedAt: null, replayMark: state.replayMark ?? action.sync.maxSeq };
    case "ended":
      return { ...state, connected: false, live: false, ended: true, endedAt: action.at };
    case "disconnected":
      return state.connected || state.live ? { ...state, connected: false, live: false } : state;
    case "missing":
      return { ...state, connected: false, live: false, missing: true };
    case "settle": {
      // The stored row says the run is over but the log never got its done event (older logs).
      const run = currentRun(state);
      if (!run || run.end || isActiveStatus(action.status)) return state;
      const next: StreamState = { ...state, items: state.items.slice(), runs: state.runs.slice(), status: action.status, statusReason: action.reason ?? null };
      const ts = new Date(action.at).toISOString();
      patchRun(next, { status: action.status, reason: action.reason ?? null, end: { status: action.status, answer: "", reason: action.reason ?? undefined, seq: state.lastSeq, ts, receivedAt: action.at, synthetic: true } });
      settleOpen(next, action.status, ts);
      return next;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Derivations (pure; used by the workspace and the tests)
// ---------------------------------------------------------------------------------------------

export const latestRun = (state: Pick<StreamState, "runs">): RunInfo | null => state.runs[state.runs.length - 1] ?? null;

/** The history the server had when this connection opened has been applied (or the stream ended). */
export const isReplayed = (state: Pick<StreamState, "ended" | "sync" | "lastSeq">) => state.ended || (state.sync !== null && state.lastSeq >= state.sync.maxSeq);

export function totals(usage: TurnUsage[]) {
  return usage.reduce((sum, turn) => ({ input: sum.input + turn.inputTokens, output: sum.output + turn.outputTokens, thinking: sum.thinking + turn.thinkingTokens, cache: sum.cache + turn.cacheReadTokens }), { input: 0, output: 0, thinking: 0, cache: 0 });
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** What the conversation shows for one run. */
export type RunView = {
  run: RunInfo;
  /** Retry and deploy runs open with a divider chip instead of a (fake) user bubble. */
  divider: { trigger: "retry" | "deploy"; attempt: number; ts: string; key: string } | null;
  user: ItemOf<"user"> | null;
  texts: ItemOf<"text">[];
  /** Browser sessions, attachments and handoffs (team reports are the answer), in order. */
  cards: TimelineItem[];
  /** Everything above, in event order (an active run shows it as it happens). */
  entries: TimelineItem[];
  /** The answer of a completed run: done.answer, or the run's last message in older logs. */
  answer: string;
  /**
   * The text blocks the answer came from (not repeated as progress notes): the run's last message,
   * or its last few when a reply cut off by the output limit was continued in the next ones.
   */
  answerSources: ItemOf<"text">[];
  /** Assistant messages that are not the answer. */
  notes: ItemOf<"text">[];
};

export function conversationRuns(state: Pick<StreamState, "runs" | "items">): RunView[] {
  const views: RunView[] = state.runs.map(run => ({
    run,
    divider: run.trigger === "retry" || run.trigger === "deploy" ? { trigger: run.trigger, attempt: run.attempt, ts: run.ts, key: `divider:${run.seq}` } : null,
    user: null, texts: [], cards: [], entries: [], answer: "", answerSources: [], notes: [],
  }));
  for (const item of state.items) {
    const view = views[item.run];
    if (!view || item.kind === "run") continue;
    if (item.kind === "user") {
      if (item.system) continue;
      view.user ??= item;
      if (view.user !== item) view.entries.push(item);
    } else if (item.kind === "text") {
      view.texts.push(item);
      view.entries.push(item);
    } else if (item.kind === "browser" || item.kind === "attachments" || (item.kind === "handoff" && item.handoff !== "report")) {
      view.cards.push(item);
      view.entries.push(item);
    }
  }
  for (const view of views) {
    const end = view.run.end;
    const last = view.texts[view.texts.length - 1] ?? null;
    if (end?.status === "completed") {
      const given = end.answer?.trim() ? end.answer : "";
      view.answer = given || last?.text || "";
      view.answerSources = given ? answerSources(view.texts, given) : last ? [last] : [];
    }
    view.notes = view.texts.filter(text => !view.answerSources.includes(text) && text.text.trim());
  }
  return views;
}

/**
 * The text blocks `answer` was assembled from: the last one (the answer starts with it, and may add
 * a note), or the last few when a reply that hit the output limit was continued in the next ones
 * (the server joins them as they streamed: the answer holds all of them, whole). Failing that, one
 * earlier block the answer starts with: an answer accepted before a design check asked for another
 * look, whose later messages stay notes.
 */
function answerSources(texts: ItemOf<"text">[], answer: string) {
  const target = squash(answer);
  const bare = answer.replace(/\s+/g, "");
  const startsWith = (text: string) => {
    const squashed = squash(text);
    return Boolean(squashed) && target.startsWith(squashed.slice(0, 400));
  };
  const oldest = Math.max(0, texts.length - 8);
  for (let start = texts.length - 1; start >= oldest; start--) {
    const parts = texts.slice(start);
    const joined = parts.map(text => text.text).join("");
    if (parts.length === 1 ? startsWith(joined) : Boolean(joined.trim()) && bare.startsWith(joined.replace(/\s+/g, ""))) return parts;
  }
  for (let index = texts.length - 2; index >= 0; index--) if (startsWith(texts[index].text)) return [texts[index]];
  return [];
}

/**
 * The answer of a completed run whose log lacks it (no done event yet, or an older log): the stored
 * row's answer, else the run's last message. A run whose done carried an answer is left as it is.
 */
export function resolveAnswer(view: RunView, rowAnswer?: string | null): Pick<RunView, "answer" | "answerSources" | "notes"> {
  if (view.run.end?.answer?.trim()) return view;
  const last = view.texts[view.texts.length - 1] ?? null;
  const row = rowAnswer?.trim() ? rowAnswer : "";
  const answer = row || last?.text || "";
  const sources = row ? answerSources(view.texts, row) : last ? [last] : [];
  return { answer, answerSources: sources, notes: view.texts.filter(text => !sources.includes(text) && text.text.trim()) };
}

/** Pushes, pull requests and live deploys a run made (shown when it was cancelled: they still happened). */
export const runEffects = (run: RunInfo | null) => run?.effects ?? [];

/** The error to show for a failed run: done.error, else the run's last error event. */
export const runError = (run: RunInfo | null) => run?.end?.error || run?.errors[run.errors.length - 1] || null;

/** A status the client learned at some moment (row fetch, sync, a done event, an action response). */
export type StatusSnapshot = { status: TaskStatus; reason?: StatusReason | null; at: number };

/** The newest of several row-status snapshots (the stored row moves on; newer knowledge wins). */
export function freshestStatus(...snapshots: (StatusSnapshot | null | undefined)[]): StatusSnapshot | null {
  let best: StatusSnapshot | null = null;
  for (const snapshot of snapshots) if (snapshot && (!best || snapshot.at >= best.at)) best = snapshot;
  return best;
}

export type InspectorTab = "activity" | "terminal" | "changes" | "preview" | "raw";

/**
 * The Inspector tab to open with: what a reader most likely came for. Running → Activity; failed or
 * interrupted → Activity (the error); completed with a live preview or a workspace build → Preview.
 */
export function initialInspectorTab(input: { status: TaskStatus | null; liveDeployment: boolean; previewAvailable: boolean }): InspectorTab {
  if (input.status === "completed" && (input.liveDeployment || input.previewAvailable)) return "preview";
  return "activity";
}

/** Reconnect delay: 1 s doubling to 30 s, with ±25 % jitter so many tabs do not reconnect in step. */
export function reconnectDelay(attempt: number, random: () => number = Math.random) {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(Math.min(30_000, Math.max(1000, base * (0.75 + random() * 0.5))));
}

/**
 * Hosts of the platform's own vendors are never shown, linked as text or copied into the UI. The
 * bundle carries only FNV-1a hashes of their registrable domains (white-label: no vendor names in
 * the client), checked against the last two labels of a URL's host.
 */
const VENDOR_DOMAIN_HASHES = new Set([0x89f16f33, 0x84db9c7a, 0xce9c6599, 0x5fa45b64, 0x8d6221d4, 0x8feb80aa, 0x2821c035, 0x040dffd1, 0xeee06d07, 0xe8d03542, 0x62055b6d, 0x59a310c2]);
const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>)\]]+/gi;

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

export function isVendorUrl(url: string) {
  try {
    const labels = new URL(url).hostname.toLowerCase().split(".");
    return labels.length >= 2 && VENDOR_DOMAIN_HASHES.has(fnv1a(labels.slice(-2).join(".")));
  } catch {
    return false;
  }
}

/** Workspace preview links carry a short-lived token: show the path without it. */
export const maskPreviewToken = (text: string) => text.replace(/\/api\/workspace\/preview\/([^/\s?#]+)\/[^/\s?#]+/g, "/api/workspace/preview/$1/…");

/** Text from tool output, notices and the raw log, with vendor links hidden and preview tokens masked. */
export function scrubText(text: string) {
  return maskPreviewToken(text.replace(URL_IN_TEXT, url => (isVendorUrl(url) ? "[link hidden]" : url)));
}

// ---------------------------------------------------------------------------------------------
// The SSE connection
// ---------------------------------------------------------------------------------------------

export type StreamHandle = {
  state: StreamState;
  /** The stored row says the latest run is over but the log has no done event: close what it left open. */
  /** at: when the row says the run stopped (defaults to now). */
  settle: (status: TaskStatus, reason?: StatusReason | null, at?: number) => void;
};

type SyncPayload = { maxSeq?: number; status?: TaskStatus | null; statusReason?: StatusReason | null; runId?: string | null; live?: boolean };

/**
 * Subscribe to a task's event stream. The server's first message (sync) says how far its log
 * goes: a client that is ahead of it (it saw events the server never kept) starts over from 0.
 * Events are deduplicated by a high-water mark on receipt and batched per frame; on error the
 * hook checks the task once (404 stops, 401 signs out) and reconnects with backoff. A new
 * `generation` reconnects from the high-water mark (after a follow-up, retry or deploy).
 */
export function useTaskStream(taskId: string | undefined, generation = 0, opts: { onRow?: (detail: TaskDetail) => void } = {}): StreamHandle {
  const [state, dispatch] = useReducer(streamReducer, undefined, initialStreamState);
  const hwm = useRef(0);
  const owner = useRef<string | undefined>(undefined);
  const onRow = useRef(opts.onRow);
  onRow.current = opts.onRow;

  useEffect(() => {
    if (!taskId) return;
    if (owner.current !== taskId) {
      owner.current = taskId;
      hwm.current = 0;
      dispatch({ type: "reset" });
    }
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;
    let pending: AgentEvent[] = [];
    let cancelFrame: (() => void) | null = null;

    const flush = () => {
      cancelFrame?.();
      cancelFrame = null;
      if (!pending.length) return;
      const events = pending;
      pending = [];
      dispatch({ type: "events", events, at: Date.now() });
    };
    // One state update per frame while visible; a background tab (no frames) still catches up.
    const schedule = () => {
      if (cancelFrame) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        const handle = setTimeout(flush, 250);
        cancelFrame = () => clearTimeout(handle);
      } else {
        const handle = requestAnimationFrame(flush);
        cancelFrame = () => cancelAnimationFrame(handle);
      }
    };
    const retryLater = () => {
      if (closed) return;
      attempt += 1;
      timer = setTimeout(connect, reconnectDelay(attempt));
    };
    const connect = () => {
      timer = null;
      if (closed) return;
      const es = new EventSource(`/api/agent/tasks/${encodeURIComponent(taskId)}/events?after=${hwm.current}`, { withCredentials: true });
      source = es;
      es.onopen = () => dispatch({ type: "open" });
      es.addEventListener("sync", message => {
        let sync: SyncPayload = {};
        try {
          sync = JSON.parse((message as MessageEvent<string>).data) as SyncPayload;
        } catch {
          /* a malformed sync is treated as "no information" */
        }
        attempt = 0;
        const maxSeq = typeof sync.maxSeq === "number" ? sync.maxSeq : Number.POSITIVE_INFINITY;
        if (hwm.current > maxSeq) {
          // We saw events the server never persisted (its worker died first): start over.
          es.close();
          source = null;
          pending = [];
          cancelFrame?.();
          cancelFrame = null;
          hwm.current = 0;
          dispatch({ type: "reset" });
          connect();
          return;
        }
        dispatch({ type: "sync", sync: { maxSeq: Number.isFinite(maxSeq) ? maxSeq : hwm.current, status: sync.status ?? null, statusReason: sync.statusReason ?? null, runId: sync.runId ?? null, live: Boolean(sync.live), at: Date.now() } });
      });
      es.onmessage = message => {
        let event: AgentEvent;
        try {
          event = JSON.parse(message.data) as AgentEvent;
        } catch {
          return;
        }
        if (typeof event?.seq !== "number" || event.seq <= hwm.current) return;
        hwm.current = event.seq;
        pending.push(event);
        schedule();
      };
      es.addEventListener("end", () => {
        flush();
        es.close();
        if (source === es) source = null;
        dispatch({ type: "ended", at: Date.now() });
      });
      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        flush();
        dispatch({ type: "disconnected" });
        if (closed) return;
        // One look at the task decides: gone (stop), signed out (api() reports it), or reconnect later.
        agentApi.task(taskId).then(
          detail => {
            onRow.current?.(detail);
            retryLater();
          },
          error => {
            if (closed) return;
            if (error instanceof ApiError && error.status === 404) return dispatch({ type: "missing" });
            if (error instanceof ApiError && error.status === 401) return;
            retryLater();
          },
        );
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      if (timer) clearTimeout(timer);
      // Received events count against the high-water mark: apply them rather than drop them.
      flush();
    };
  }, [taskId, generation]);

  const settle = useCallback((status: TaskStatus, reason?: StatusReason | null, at?: number) => dispatch({ type: "settle", status, reason, at: at !== undefined && Number.isFinite(at) ? at : Date.now() }), []);
  return { state, settle };
}
