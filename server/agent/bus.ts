import { EventEmitter } from "node:events";
import type { AgentEvent, AgentEventBody } from "@shared/agent";
import { insertEvents, lastSeq } from "./store";

// Token-level deltas arrive dozens of times per second. They are merged per block over a short
// window so the persisted log (and SSE replay) stays compact while the live view still updates
// several times a second. Committed events are kept in memory for the life of the run (so live
// SSE replay never waits on the database) and written to Tiger in batches.
const FLUSH_MS = 90;
const WRITE_MS = 400;
const MAX_HISTORY = 50_000;

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
  private unwritten: AgentEvent[] = [];
  private writer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  readonly history: AgentEvent[] = [];
  readonly emitter = new EventEmitter();

  constructor(readonly taskId: string, startSeq: number) {
    this.seq = startSeq;
    this.emitter.setMaxListeners(50);
  }

  emit(body: AgentEventBody & { agent?: string }) {
    const key = deltaKey(body);
    if (key && this.pending?.key === key) {
      this.pending.body = mergeDelta(this.pending.body, body as DeltaBody);
      return;
    }
    this.flushDelta();
    if (key) {
      this.pending = { key, body: body as DeltaBody };
      this.timer = setTimeout(() => this.flushDelta(), FLUSH_MS);
      return;
    }
    this.commit(body);
  }

  flushDelta() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) this.commit(pending.body);
  }

  private commit(body: AgentEventBody) {
    const event: AgentEvent = { ...body, seq: ++this.seq, ts: new Date().toISOString() } as AgentEvent;
    if (this.history.length < MAX_HISTORY) this.history.push(event);
    this.unwritten.push(event);
    this.writer ??= setTimeout(() => void this.write(), WRITE_MS);
    this.emitter.emit("event", event);
  }

  private write() {
    this.writer = null;
    const batch = this.unwritten.splice(0, this.unwritten.length);
    if (!batch.length) return this.writing;
    this.writing = this.writing.then(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          for (let index = 0; index < batch.length; index += 400) await insertEvents(this.taskId, batch.slice(index, index + 400));
          return;
        } catch (error) {
          if (attempt >= 4) {
            console.error(`[bus] dropped ${batch.length} events for ${this.taskId}:`, error instanceof Error ? error.message : error);
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }
    });
    return this.writing;
  }

  /** Flush deltas and wait until every committed event is in the database. */
  async drain() {
    this.flushDelta();
    if (this.writer) clearTimeout(this.writer);
    await this.write();
  }
}

const channels = new Map<string, TaskChannel>();

export async function openChannel(taskId: string) {
  let existing = channels.get(taskId);
  if (!existing) {
    existing = new TaskChannel(taskId, await lastSeq(taskId));
    channels.set(taskId, existing);
  }
  return existing;
}

export function liveChannel(taskId: string) {
  return channels.get(taskId);
}

export async function closeChannel(taskId: string) {
  const existing = channels.get(taskId);
  if (!existing) return;
  await existing.drain();
  channels.delete(taskId);
  existing.emitter.emit("closed");
}

export function isLive(taskId: string) {
  return channels.has(taskId);
}

export type Emit = (body: AgentEventBody) => void;
