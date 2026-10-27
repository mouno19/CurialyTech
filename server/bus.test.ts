import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../shared/agent";

// The per-run event channel: sequence numbers are never reused, nothing is accepted after the run
// ended, and events written by the lifecycle (the terminal pair) are delivered without re-writing.

const store = vi.hoisted(() => ({
  inserted: [] as { taskId: string; events: AgentEvent[]; runId?: string }[],
  dbSeq: 0,
  insertEvents: async (_taskId: string, _events: AgentEvent[], _runId?: string): Promise<number> => 0,
}));
vi.mock("./agent/store", () => ({
  insertEvents: vi.fn((taskId: string, events: AgentEvent[], runId?: string) => {
    store.inserted.push({ taskId, events, runId });
    return store.insertEvents(taskId, events, runId);
  }),
  lastSeq: vi.fn(async () => store.dbSeq),
}));

const { openChannel, liveChannel, isLive } = await import("./agent/bus");
const { lastSeq } = await import("./agent/store");

let n = 0;
const nextTask = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const insertedFor = (task: string) => store.inserted.filter(batch => batch.taskId === task);

beforeEach(() => {
  store.inserted.length = 0;
  store.dbSeq = 0;
  store.insertEvents = async (_taskId, events) => events.length;
  vi.mocked(lastSeq).mockClear();
});

describe("openChannel", () => {
  it("continues after the database's last event", async () => {
    const task = nextTask();
    store.dbSeq = 41;
    const channel = await openChannel(task, "run-a");
    channel.emit({ type: "status", status: "running" });
    expect(channel.history.map(event => event.seq)).toEqual([42]);
    await channel.close();
  });

  it("never reuses a sequence number, even when the database is behind", async () => {
    const task = nextTask();
    store.dbSeq = 5;
    const first = await openChannel(task, "run-a");
    for (let i = 0; i < 3; i++) first.emit({ type: "notice", level: "info", message: `m${i}` });
    expect(first.seq).toBe(8);
    // Those events never reached the database (a dropped batch, say): it still reports 5.
    store.insertEvents = async () => 0;
    await first.close();
    const second = await openChannel(task, "run-b");
    expect(second).not.toBe(first);
    second.emit({ type: "status", status: "queued" });
    expect(second.history.map(event => event.seq)).toEqual([9]);
  });

  it("hands out the open channel, and one lookup for concurrent opens", async () => {
    const task = nextTask();
    const [a, b] = await Promise.all([openChannel(task, "run-a"), openChannel(task, "run-a")]);
    expect(a).toBe(b);
    expect(await openChannel(task)).toBe(a);
    expect(lastSeq).toHaveBeenCalledTimes(1);
    expect(liveChannel(task)).toBe(a);
    expect(isLive(task)).toBe(true);
  });

  it("opens a fresh channel once the previous run sealed its own, continuing its numbers", async () => {
    const task = nextTask();
    const old = await openChannel(task, "run-a");
    old.emit({ type: "status", status: "running" });
    old.seal();
    const fresh = await openChannel(task, "run-b");
    expect(fresh).not.toBe(old);
    expect(fresh.seq).toBe(old.seq);
    await old.close();
    // The old channel closing late does not unregister its successor.
    expect(liveChannel(task)).toBe(fresh);
  });
});

describe("TaskChannel", () => {
  it("drops events emitted after the run was sealed", async () => {
    const task = nextTask();
    const channel = await openChannel(task, "run-a");
    const seen: AgentEvent[] = [];
    channel.emitter.on("event", event => seen.push(event));
    channel.emit({ type: "status", status: "running" });
    channel.emit({ type: "text_delta", blockId: "b1", text: "Hel" });
    channel.seal(); // pending deltas are committed first
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    channel.emit({ type: "tool_result", callId: "c1", ok: true, summary: "late", durationMs: 1 });
    channel.emit({ type: "text_delta", blockId: "b1", text: "lo" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(seen.map(event => [event.seq, event.type])).toEqual([[1, "status"], [2, "text_delta"]]);
    expect(channel.seq).toBe(2);
    await channel.drain();
    expect(insertedFor(task).flatMap(batch => batch.events.map(event => event.seq))).toEqual([1, 2]);
  });

  it("delivers published (already persisted) events to listeners without writing them again", async () => {
    const task = nextTask();
    const channel = await openChannel(task, "run-a");
    channel.emit({ type: "status", status: "running" });
    channel.seal();
    await channel.drain();
    const seen: AgentEvent[] = [];
    channel.emitter.on("event", event => seen.push(event));
    const ts = new Date().toISOString();
    channel.publish([{ type: "status", status: "completed", seq: 5, ts }, { type: "done", status: "completed", answer: "Done.", seq: 6, ts }] as AgentEvent[]);
    expect(seen.map(event => event.seq)).toEqual([5, 6]);
    expect(channel.seq).toBe(6);
    expect(channel.history.at(-1)).toMatchObject({ type: "done", seq: 6 });
    const closed = vi.fn();
    channel.emitter.on("closed", closed);
    await channel.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(insertedFor(task).flatMap(batch => batch.events.map(event => event.seq))).toEqual([1]);
    expect(isLive(task)).toBe(false);
    // The next run starts after the published terminal events.
    expect((await openChannel(task, "run-b")).seq).toBe(6);
  });

  it("merges token deltas of one block and writes batches fenced by the run", async () => {
    const task = nextTask();
    const channel = await openChannel(task, "run-a");
    for (const text of ["Hel", "lo", ", world"]) channel.emit({ type: "text_delta", blockId: "b1", text });
    channel.emit({ type: "text_delta", blockId: "b2", text: "other" });
    channel.emit({ type: "text_end", blockId: "b2" });
    await channel.drain();
    const events = insertedFor(task).flatMap(batch => batch.events);
    expect(events.map(event => [event.seq, event.type, (event as { text?: string }).text])).toEqual([[1, "text_delta", "Hello, world"], [2, "text_delta", "other"], [3, "text_end", undefined]]);
    expect(insertedFor(task).every(batch => batch.runId === "run-a")).toBe(true);
  });

  it("stores the rest of a batch when one event is rejected as bad data", async () => {
    const task = nextTask();
    const channel = await openChannel(task, "run-a");
    store.insertEvents = async (_taskId, events) => {
      if (events.some(event => event.type === "notice" && event.message === "bad")) throw Object.assign(new Error("unsupported Unicode escape sequence"), { code: "22P05" });
      return events.length;
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const message of ["a", "bad", "c"]) channel.emit({ type: "notice", level: "info", message });
    await channel.drain();
    error.mockRestore();
    const stored = insertedFor(task).filter(batch => batch.events.length === 1).map(batch => (batch.events[0] as { message: string }).message);
    expect(stored).toEqual(["a", "bad", "c"]); // retried one by one: a and c land, only "bad" is lost
  });
});
