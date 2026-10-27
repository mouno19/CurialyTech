import { EventEmitter } from "node:events";
import type { AgentEvent, AgentEventBody } from "@shared/agent";
import { isDeterministicDataError } from "../db/json";
import { insertEvents, lastSeq } from "./store";

// Token-level deltas arrive dozens of times per second. They are merged per block over a short
// window so the persisted log (and SSE replay) stays compact while the live view still updates
// several times a second. Committed events are kept in memory for the life of the run (so live
// SSE replay never waits on the database) and written to Tiger in batches.
//
// One channel serves one run. At the end of a run the runner seals it (late emits are dropped),
// drains it, writes the terminal status/done events itself (atomically with the row, see
// lifecycle.transitionTask) and publishes them here, then closes the channel.
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

export class TaskChannel {
  private _seq: number;
  private pending: { key: string; body: DeltaBody } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private unwritten: AgentEvent[] = [];
  private writer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private _sealed = false;
  private _closed = false;
  private droppedAfterSeal = 0;
  readonly history: AgentEvent[] = [];
  readonly emitter = new EventEmitter();

  constructor(readonly taskId: string, startSeq: number, readonly runId?: string) {
    this._seq = startSeq;
    this.emitter.setMaxListeners(50);
  }

  /** The last sequence number handed out (persisted or not). */
  get seq() {
    return this._seq;
  }

  get sealed() {
    return this._sealed;
  }

  get closed() {
    return this._closed;
  }

  emit(body: AgentEventBody & { agent?: string }) {
    if (this._sealed) {
      // The run is over; anything still emitting belongs to a step that outlived it.
      if (this.droppedAfterSeal++ === 0) console.warn(`[bus] ${this.taskId}: dropped ${body.type} emitted after the run ended`);
      return;
    }
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
    const event: AgentEvent = { ...body, seq: ++this._seq, ts: new Date().toISOString() } as AgentEvent;
    this.remember(event);
    this.unwritten.push(event);
    this.writer ??= setTimeout(() => void this.write(), WRITE_MS);
    this.emitter.emit("event", event);
  }

  /** History is a bounded window; SSE replays anything older from the database. */
  private remember(event: AgentEvent) {
    this.history.push(event);
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY + 5000);
  }

  private write() {
    this.writer = null;
    const batch = this.unwritten.splice(0, this.unwritten.length);
    if (!batch.length) return this.writing;
    this.writing = this.writing.then(() => this.persist(batch));
    return this.writing;
  }

  private async persist(batch: AgentEvent[]) {
    for (let attempt = 1; ; attempt++) {
      try {
        for (let index = 0; index < batch.length; index += 400) await insertEvents(this.taskId, batch.slice(index, index + 400), this.runId);
        return;
      } catch (error) {
        if (isDeterministicDataError(error)) {
          // One bad event must not take the rest of the batch with it: insert row by row.
          let lost = 0;
          for (const event of batch) await insertEvents(this.taskId, [event], this.runId).catch(() => { lost++; });
          if (lost) console.error(`[bus] ${this.taskId}: ${lost} event(s) could not be stored:`, error instanceof Error ? error.message : error);
          return;
        }
        if (attempt >= 4) {
          console.error(`[bus] dropped ${batch.length} events for ${this.taskId}:`, error instanceof Error ? error.message : error);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  /** Flush deltas and wait until every committed event is in the database. */
  async drain() {
    this.flushDelta();
    if (this.writer) clearTimeout(this.writer);
    await this.write();
  }

  /** Stop accepting events (the run has ended); pending deltas are committed first. */
  seal() {
    this.flushDelta();
    this._sealed = true;
  }

  /** Deliver events that are already persisted (the terminal pair written with the status). */
  publish(events: AgentEvent[]) {
    for (const event of events) {
      if (event.seq > this._seq) this._seq = event.seq;
      this.remember(event);
      this.emitter.emit("event", event);
    }
  }

  /** Drain, detach from the registry (if still current) and end every SSE stream on it. */
  async close() {
    if (this._closed) return;
    this.seal();
    await this.drain();
    this._closed = true;
    lastClosedSeq.set(this.taskId, Math.max(lastClosedSeq.get(this.taskId) ?? 0, this._seq));
    if (channels.get(this.taskId) === this) channels.delete(this.taskId);
    this.emitter.emit("closed");
  }
}

const channels = new Map<string, TaskChannel>();
const opening = new Map<string, Promise<TaskChannel>>();
/** Highest seq a closed channel handed out: a dropped batch must never let the next run reuse it. */
const lastClosedSeq = new Map<string, number>();

/** The task's open channel, or a new one continuing after every sequence number already used. */
export function openChannel(taskId: string, runId?: string): Promise<TaskChannel> {
  const existing = channels.get(taskId);
  if (existing && !existing.sealed) return Promise.resolve(existing);
  const pending = opening.get(taskId);
  if (pending) return pending;
  const created = lastSeq(taskId).then(dbSeq => {
    const channel = new TaskChannel(taskId, Math.max(dbSeq, lastClosedSeq.get(taskId) ?? 0, existing?.seq ?? 0), runId);
    channels.set(taskId, channel);
    return channel;
  }).finally(() => opening.delete(taskId));
  opening.set(taskId, created);
  return created;
}

export function liveChannel(taskId: string) {
  return channels.get(taskId);
}

export async function closeChannel(taskId: string) {
  await channels.get(taskId)?.close();
}

export function isLive(taskId: string) {
  return channels.has(taskId);
}

export type Emit = (body: AgentEventBody) => void;
