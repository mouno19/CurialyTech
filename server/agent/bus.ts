import { EventEmitter } from "node:events";
import type { AgentEvent, AgentEventBody } from "@shared/agent";
import { appendEvent, lastSeq } from "./store";

// Token-level deltas arrive dozens of times per second. They are merged per block
// over a short window so the persisted log (and SSE replay) stays compact while the
// live view still updates several times a second.
const FLUSH_MS = 90;
type DeltaBody = Extract<AgentEventBody, { type: "thinking_delta" | "text_delta" | "tool_input_delta" | "tool_output" }>;

function deltaKey(body: AgentEventBody): string | null {
  switch (body.type) {
    case "thinking_delta":
    case "text_delta":
      return `${body.type}:${body.blockId}`;
    case "tool_input_delta":
      return `${body.type}:${body.callId}`;
    case "tool_output":
      return `${body.type}:${body.callId}:${body.stream}`;
    default:
      return null;
  }
}

function mergeDelta(into: DeltaBody, next: DeltaBody): DeltaBody {
  if (into.type === "thinking_delta" && next.type === "thinking_delta") return { ...into, text: into.text + next.text };
  if (into.type === "text_delta" && next.type === "text_delta") return { ...into, text: into.text + next.text };
  if (into.type === "tool_input_delta" && next.type === "tool_input_delta") return { ...into, partial: into.partial + next.partial };
  if (into.type === "tool_output" && next.type === "tool_output") return { ...into, chunk: into.chunk + next.chunk };
  return next;
}

class TaskChannel {
  private seq: number;
  private pending: { key: string; body: DeltaBody } | null = null;
  private timer: NodeJS.Timeout | null = null;
  readonly emitter = new EventEmitter();

  constructor(readonly taskId: string) {
    this.seq = lastSeq(taskId);
    this.emitter.setMaxListeners(50);
  }

  emit(body: AgentEventBody) {
    const key = deltaKey(body);
    if (key && this.pending?.key === key) {
      this.pending.body = mergeDelta(this.pending.body, body as DeltaBody);
      return;
    }
    this.flush();
    if (key) {
      this.pending = { key, body: body as DeltaBody };
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
      return;
    }
    this.commit(body);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) this.commit(pending.body);
  }

  private commit(body: AgentEventBody) {
    const event: AgentEvent = { ...body, seq: ++this.seq, ts: new Date().toISOString() };
    appendEvent(this.taskId, event.seq, body, event.ts);
    this.emitter.emit("event", event);
  }
}

const channels = new Map<string, TaskChannel>();

export function channel(taskId: string) {
  let existing = channels.get(taskId);
  if (!existing) {
    existing = new TaskChannel(taskId);
    channels.set(taskId, existing);
  }
  return existing;
}

export function closeChannel(taskId: string) {
  const existing = channels.get(taskId);
  if (!existing) return;
  existing.flush();
  existing.emitter.emit("closed");
  channels.delete(taskId);
}

export function isLive(taskId: string) {
  return channels.has(taskId);
}

export type Emit = (body: AgentEventBody) => void;
