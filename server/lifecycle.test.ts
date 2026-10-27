import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lifecycle SQL against a scripted database: each statement is answered by a handler chosen from its
// text, and every call is recorded so the tests can check what would have been written.

type Call = { text: string; values: unknown[] };
const db = vi.hoisted(() => ({ calls: [] as Call[], handler: (_call: Call): unknown => ({ rows: [], rowCount: 0 }) }));

vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    const call = { text, values };
    db.calls.push(call);
    return db.handler(call);
  }),
  heartbeatQuery: vi.fn(async (text: string, values: unknown[] = []) => {
    const call = { text, values };
    db.calls.push(call);
    return db.handler(call);
  }),
}));

const lifecycle = await import("./agent/lifecycle");
const { judgeStaleness, terminalEvents, reconcileStaleTasks, repairEventLogs, transitionTask, claimNextRun, appendLoggedEvents, renewLeases, parseWorkerId, WORKER_ID, LEASE_SECONDS } = lifecycle;
const { LEGACY_RESTART_ERROR } = await import("../shared/taskStatus");

const HOST = os.hostname();
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RUN = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The JSON events array a transition or repair statement would insert. */
function eventsOf(call: Call) {
  const index = /jsonb_array_elements\(\$(\d+)::jsonb\)/.exec(call.text)?.[1];
  return index ? JSON.parse(call.values[Number(index) - 1] as string) : null;
}
const transitions = () => db.calls.filter(call => call.text.includes("WITH moved AS"));
const isTransition = (call: Call) => call.text.includes("WITH moved AS");

beforeEach(() => {
  db.calls.length = 0;
  db.handler = () => ({ rows: [], rowCount: 0 });
});

describe("judgeStaleness", () => {
  const self = `${HOST}:4242:00ff00ff`;
  const alive = () => true;
  const dead = () => false;

  it("reclaims pre-lease rows only on the primary", () => {
    expect(judgeStaleness({ workerId: null, leaseLive: false }, self, alive, true)).toEqual({ stale: true, reason: "server_restart" });
    expect(judgeStaleness({ workerId: null, leaseLive: false }, self, alive, false)).toEqual({ stale: false });
  });

  it("knows its own rows that it no longer runs are lost", () => {
    expect(judgeStaleness({ workerId: self, leaseLive: true }, self, alive, true)).toEqual({ stale: true, reason: "worker_lost" });
  });

  it("on the same host, trusts the process table", () => {
    expect(judgeStaleness({ workerId: `${HOST}:999:abcd`, leaseLive: true }, self, dead, true)).toEqual({ stale: true, reason: "server_restart" });
    // Same pid with another nonce: a previous boot of this process.
    expect(judgeStaleness({ workerId: `${HOST}:4242:abcd`, leaseLive: true }, self, alive, true)).toEqual({ stale: true, reason: "server_restart" });
    expect(judgeStaleness({ workerId: `${HOST}:999:abcd`, leaseLive: true, leaseExpiredFor: null }, self, alive, true)).toEqual({ stale: false });
    // An alive owner that missed a renewal or two fences itself; it is given time.
    expect(judgeStaleness({ workerId: `${HOST}:999:abcd`, leaseLive: false, leaseExpiredFor: 30 }, self, alive, true)).toEqual({ stale: false });
    expect(judgeStaleness({ workerId: `${HOST}:999:abcd`, leaseLive: false, leaseExpiredFor: 2 * LEASE_SECONDS }, self, alive, true)).toEqual({ stale: false });
    expect(judgeStaleness({ workerId: `${HOST}:999:abcd`, leaseLive: false, leaseExpiredFor: 2 * LEASE_SECONDS + 1 }, self, alive, true)).toEqual({ stale: true, reason: "lease_expired" });
  });

  it("on another host, trusts the lease", () => {
    expect(judgeStaleness({ workerId: "other-box:999:abcd", leaseLive: true }, self, dead, true)).toEqual({ stale: false });
    expect(judgeStaleness({ workerId: "other-box:999:abcd", leaseLive: false, leaseExpiredFor: 1 }, self, alive, true)).toEqual({ stale: true, reason: "lease_expired" });
    expect(judgeStaleness({ workerId: "garbage", leaseLive: true }, self, dead, true)).toEqual({ stale: false });
    expect(judgeStaleness({ workerId: "garbage", leaseLive: false }, self, alive, true)).toEqual({ stale: true, reason: "lease_expired" });
  });

  it("parses worker ids whose host name contains colons", () => {
    expect(parseWorkerId("fe80::1:123:0a0b")).toEqual({ host: "fe80::1", pid: 123, nonce: "0a0b" });
    expect(parseWorkerId(null)).toBeNull();
    expect(parseWorkerId(WORKER_ID)).toMatchObject({ host: HOST, pid: process.pid });
  });
});

describe("terminalEvents", () => {
  it("is a status + done pair, done last, answer empty unless given", () => {
    expect(terminalEvents("interrupted", { reason: "server_restart" })).toEqual([
      { type: "status", status: "interrupted", reason: "server_restart" },
      { type: "done", status: "interrupted", answer: "", reason: "server_restart" },
    ]);
    expect(terminalEvents("failed", { reason: "error", error: "Boom" })[1]).toEqual({ type: "done", status: "failed", answer: "", reason: "error", error: "Boom" });
    expect(terminalEvents("completed", { answer: "Done.", outcome: { verification: "passed" } })).toEqual([
      { type: "status", status: "completed" },
      { type: "done", status: "completed", answer: "Done.", outcome: { verification: "passed" } },
    ]);
  });
});

describe("transitionTask", () => {
  it("is conditional on the source statuses and the run, and returns the events it inserted", async () => {
    db.handler = call => (isTransition(call)
      ? { rows: [{ moved: "1", inserted: [{ seq: 41, ts: "2026-10-27T10:00:00.5+00:00", data: { type: "status", status: "failed", reason: "error" } }, { seq: 42, ts: "2026-10-27T10:00:00.5+00:00", data: { type: "done", status: "failed", answer: "", error: "x\u0000y" } }] }] }
      : { rows: [] });
    const result = await transitionTask(ID(1), RUN(1), "failed", { reason: "error", error: "x\u0000y", outcome: { verification: "failed" }, events: terminalEvents("failed", { reason: "error", error: "x\u0000y" }), baseSeq: 40.7 });
    expect(result.applied).toBe(true);
    expect(result.events.map(event => [event.seq, event.type, event.ts])).toEqual([[41, "status", "2026-10-27T10:00:00.500Z"], [42, "done", "2026-10-27T10:00:00.500Z"]]);
    const [call] = transitions();
    expect(call.text).toContain("WHERE id = $1 AND status = ANY($3::text[]) AND run_id IS NOT DISTINCT FROM $4::uuid");
    expect(call.values.slice(0, 4)).toEqual([ID(1), "failed", ["queued", "running", "cancelling"], RUN(1)]);
    // A final status releases the run and the lease in the same statement.
    expect(call.text).toMatch(/finished_at = now\(\), worker_id = NULL, lease_expires_at = NULL/);
    // Neither the text columns nor jsonb ever see a NUL byte.
    expect(JSON.stringify(call.values)).not.toContain("\\u0000");
    expect(call.values).toContain("xy");
    expect(eventsOf(call)).toEqual(terminalEvents("failed", { reason: "error", error: "xy" }));
    expect(call.values).toContain(40);
  });

  it("stores a completed run's answer even when the model emitted NUL bytes or lone surrogates", async () => {
    db.handler = () => ({ rows: [{ moved: "1", inserted: [] }] });
    await transitionTask(ID(1), RUN(1), "completed", { answer: "Done\u0000 \uD800!", error: null, events: terminalEvents("completed", { answer: "Done\u0000 \uD800!" }) });
    const [call] = transitions();
    expect(call.values).toContain("Done �!");
    expect(call.values).toContain(null); // error cleared
    expect(eventsOf(call)[1].answer).toBe("Done �!");
  });

  it("reports a transition that another writer won as not applied", async () => {
    db.handler = () => ({ rows: [{ moved: "0", inserted: null }] });
    const result = await transitionTask(ID(2), null, "cancelling", { from: ["running"], reason: "user_cancel" });
    expect(result).toEqual({ applied: false, events: [] });
    const [call] = transitions();
    expect(call.text).toContain("cancel_requested_at = COALESCE(cancel_requested_at, now())");
    expect(call.text).not.toContain("finished_at");
    expect(eventsOf(call)).toEqual([]);
  });
});

describe("claimNextRun", () => {
  it("starts a new attempt only from a final row, fenced by the run the client saw", async () => {
    db.handler = () => ({ rows: [{ attempt: 3 }] });
    expect(await claimNextRun(ID(3), { runId: RUN(9), reason: "retry", expectedRunId: RUN(2) })).toEqual({ runId: RUN(9), attempt: 3 });
    const [call] = db.calls;
    expect(call.text).toMatch(/SET status = 'queued', run_id = \$2, attempt = attempt \+ 1, worker_id = \$3/);
    expect(call.text).toContain("WHERE id = $1 AND status = ANY($5::text[]) AND run_id IS NOT DISTINCT FROM $6::uuid");
    expect(call.values).toEqual([ID(3), RUN(9), WORKER_ID, "retry", ["completed", "failed", "cancelled", "interrupted"], RUN(2)]);

    db.calls.length = 0;
    db.handler = () => ({ rows: [] });
    expect(await claimNextRun(ID(3), { runId: RUN(10), reason: "follow_up" })).toBeNull();
    expect(db.calls[0].text).not.toContain("IS NOT DISTINCT FROM");
  });
});

describe("appendLoggedEvents", () => {
  it("retries a sequence collision and gives up on anything else", async () => {
    let attempts = 0;
    db.handler = () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return { rows: [{ seq: 8, created_at: new Date("2026-10-27T10:00:00Z"), data: { type: "notice", level: "info", message: "b" } }, { seq: 7, created_at: new Date("2026-10-27T10:00:00Z"), data: { type: "notice", level: "info", message: "a" } }] };
    };
    const events = await appendLoggedEvents(ID(4), [{ type: "notice", level: "info", message: "a" }, { type: "notice", level: "info", message: "b" }]);
    expect(attempts).toBe(3);
    expect(events.map(event => event.seq)).toEqual([7, 8]);
    db.handler = () => { throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" }); };
    await expect(appendLoggedEvents(ID(4), [{ type: "notice", level: "info", message: "c" }])).rejects.toThrow("connection reset");
    db.calls.length = 0;
    expect(await appendLoggedEvents(ID(4), [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});

describe("renewLeases", () => {
  it("renews only this worker's active runs and reports what it still owns", async () => {
    db.handler = () => ({ rows: [{ id: ID(5), run_id: RUN(5), status: "cancelling", cancel_requested: true }] });
    const owned = await renewLeases([{ taskId: ID(5), runId: RUN(5) }, { taskId: ID(6), runId: RUN(6) }]);
    expect(owned).toEqual([{ taskId: ID(5), runId: RUN(5), status: "cancelling", cancelRequested: true }]);
    expect(db.calls[0].values).toEqual([WORKER_ID, [ID(5), ID(6)], [RUN(5), RUN(6)], ["queued", "running", "cancelling"]]);
    db.calls.length = 0;
    expect(await renewLeases([])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});

type ActiveRow = { id: string; status: string; run_id: string | null; attempt: number; worker_id: string | null; lease_live: boolean; lease_expired_for: number | null; cancel_requested: boolean };
const active = (n: number, patch: Partial<ActiveRow> = {}): ActiveRow => ({ id: ID(n), status: "running", run_id: RUN(n), attempt: 1, worker_id: null, lease_live: false, lease_expired_for: null, cancel_requested: false, ...patch });

/** A database holding the given active rows and browser sessions; transitions apply unless listed in `lost`. */
function scriptDb(rows: ActiveRow[], sessions: Record<string, { sid: string; last: string }[]> = {}, lost: string[] = []) {
  db.handler = call => {
    if (call.text.includes("FROM curialy.chat_sessions WHERE status = ANY($1::text[])")) return { rows };
    if (call.text.includes("type = 'browser_session' GROUP BY 1")) return { rows: sessions[call.values[0] as string] ?? [] };
    if (isTransition(call)) {
      const applied = !lost.includes(call.values[0] as string);
      return { rows: [{ moved: applied ? "1" : "0", inserted: applied ? eventsOf(call).map((data: unknown, index: number) => ({ seq: 100 + index, ts: new Date().toISOString(), data })) : null }] };
    }
    throw new Error(`unexpected statement: ${call.text.slice(0, 80)}`);
  };
}

describe("reconcileStaleTasks", () => {
  it("interrupts runs whose worker is gone, with their terminal events, and leaves live and local runs alone", async () => {
    scriptDb([
      active(1), // pre-lease row: the previous process ran it
      active(2), // run by this process
      active(3, { worker_id: "other-box:12:abcd", lease_live: true }), // another live instance
      active(4, { worker_id: "other-box:12:abcd", lease_live: false, lease_expired_for: 5 }), // that instance died
      active(5, { status: "queued", run_id: null }),
    ], { [ID(1)]: [{ sid: "s-live", last: "live" }, { sid: "s-ended", last: "ended" }] });

    const recovered = await reconcileStaleTasks(taskId => taskId === ID(2));

    expect(recovered).toEqual([
      { taskId: ID(1), status: "interrupted", reason: "server_restart" },
      { taskId: ID(4), status: "interrupted", reason: "lease_expired" },
      { taskId: ID(5), status: "interrupted", reason: "server_restart" },
    ]);
    const moved = transitions();
    expect(moved.map(call => call.values[0])).toEqual([ID(1), ID(4), ID(5)]);
    // Conditional on the status and run the reconciler saw.
    expect(moved[0].values.slice(1, 4)).toEqual(["interrupted", ["running"], RUN(1)]);
    expect(moved[2].values.slice(1, 4)).toEqual(["interrupted", ["queued"], null]);
    // The open live view is closed in the log before the terminal pair; the ended one is not repeated.
    expect(eventsOf(moved[0])).toEqual([
      { type: "browser_session", sessionId: "s-live", status: "ended", liveUrl: null, replayUrl: "", reason: "interrupted" },
      { type: "status", status: "interrupted", reason: "server_restart" },
      { type: "done", status: "interrupted", answer: "", reason: "server_restart" },
    ]);
    expect(eventsOf(moved[1]).map((event: { type: string }) => event.type)).toEqual(["status", "done"]);
  });

  it("finishes a requested cancel as cancelled", async () => {
    scriptDb([
      active(6, { status: "cancelling", worker_id: "other-box:12:abcd", lease_expired_for: 60 }),
      active(7, { cancel_requested: true }),
    ]);
    const recovered = await reconcileStaleTasks(() => false);
    expect(recovered).toEqual([{ taskId: ID(6), status: "cancelled", reason: "user_cancel" }, { taskId: ID(7), status: "cancelled", reason: "user_cancel" }]);
    const [first, second] = transitions();
    expect(first.values.slice(1, 3)).toEqual(["cancelled", ["cancelling"]]);
    expect(eventsOf(first).at(-1)).toEqual({ type: "done", status: "cancelled", answer: "", reason: "user_cancel" });
    expect(second.values.slice(1, 3)).toEqual(["cancelled", ["running"]]);
  });

  it("counts a row only when its conditional update moved it", async () => {
    scriptDb([active(8), active(9)], {}, [ID(8)]);
    expect(await reconcileStaleTasks(() => false)).toEqual([{ taskId: ID(9), status: "interrupted", reason: "server_restart" }]);
    expect(transitions()).toHaveLength(2);
  });

  it("still settles a row when its browser sessions cannot be read", async () => {
    scriptDb([active(10)]);
    const base = db.handler;
    db.handler = call => {
      if (call.text.includes("type = 'browser_session'")) throw new Error("timeout");
      return base(call);
    };
    expect(await reconcileStaleTasks(() => false)).toHaveLength(1);
    expect(eventsOf(transitions()[0]).map((event: { type: string }) => event.type)).toEqual(["status", "done"]);
  });
});

describe("repairEventLogs", () => {
  type FinalRow = { id: string; status: string; shown: string; run_id: string | null; status_reason: string | null; error: string | null };
  function scriptRepair(rows: FinalRow[], unchanged: string[] = []) {
    db.handler = call => {
      if (call.text.includes("AS shown")) return { rows };
      if (call.text.includes("type = 'browser_session' GROUP BY 1")) return { rows: [] };
      if (call.text.includes("WITH s AS (SELECT 1")) return { rowCount: unchanged.includes(call.values[0] as string) ? 0 : eventsOf(call).length, rows: [] };
      throw new Error(`unexpected statement: ${call.text.slice(0, 80)}`);
    };
  }

  it("compares each log with the status the row is shown as, so a legacy row is repaired once", async () => {
    scriptRepair([]);
    await repairEventLogs();
    const select = db.calls[0];
    const shown = `CASE WHEN s.status = 'failed' AND s.error = '${LEGACY_RESTART_ERROR}' THEN 'interrupted' ELSE s.status END`;
    expect(select.text).toContain(`${shown} AS shown`);
    // The log's last terminal event is compared with the mapped status, not the raw 'failed'.
    expect(select.text.replace(/\s+/g, " ")).toContain(`), '') <> ${shown}`);
  });

  it("appends the terminal pair the row implies, conditionally, and reports how many logs it fixed", async () => {
    scriptRepair([
      { id: ID(11), status: "failed", shown: "interrupted", run_id: null, status_reason: null, error: LEGACY_RESTART_ERROR },
      { id: ID(12), status: "failed", shown: "failed", run_id: RUN(12), status_reason: "error", error: "Boom" },
      { id: ID(13), status: "cancelled", shown: "cancelled", run_id: RUN(13), status_reason: "user_cancel", error: null },
    ], [ID(13)]);
    expect(await repairEventLogs()).toBe(2);
    const inserts = db.calls.filter(call => call.text.includes("WITH s AS (SELECT 1"));
    expect(inserts).toHaveLength(3);
    // Only while the row is still in the state that was read (a new run may have started).
    expect(inserts[0].text).toContain("WHERE id = $1 AND status = $2 AND run_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE");
    expect(inserts[0].values.slice(0, 3)).toEqual([ID(11), "failed", null]);
    expect(eventsOf(inserts[0])).toEqual(terminalEvents("interrupted", { reason: "server_restart" }));
    expect(eventsOf(inserts[1])).toEqual(terminalEvents("failed", { reason: "error", error: "Boom" }));
    expect(eventsOf(inserts[2])).toEqual(terminalEvents("cancelled", { reason: "user_cancel" }));
  });

  it("keeps going when one repair fails", async () => {
    scriptRepair([{ id: ID(14), status: "completed", shown: "completed", run_id: null, status_reason: null, error: null }, { id: ID(15), status: "completed", shown: "completed", run_id: null, status_reason: null, error: null }]);
    const base = db.handler;
    db.handler = call => {
      if (call.text.includes("WITH s AS (SELECT 1") && call.values[0] === ID(14)) throw new Error("deadlock detected");
      return base(call);
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await repairEventLogs()).toBe(1);
  });
});

describe("replica instances", () => {
  it("never reclaim pre-lease rows and never repair logs", async () => {
    vi.resetModules();
    vi.stubEnv("AGENT_INSTANCE_ROLE", "replica");
    try {
      const replica = await import("./agent/lifecycle");
      expect(replica.IS_PRIMARY).toBe(false);
      scriptDb([active(16), active(17, { worker_id: "other-box:12:abcd", lease_live: false, lease_expired_for: 5 })]);
      expect(await replica.reconcileStaleTasks(() => false)).toEqual([{ taskId: ID(17), status: "interrupted", reason: "lease_expired" }]);
      db.calls.length = 0;
      expect(await replica.repairEventLogs()).toBe(0);
      expect(db.calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
