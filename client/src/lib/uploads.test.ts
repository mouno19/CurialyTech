import { describe, expect, it } from "vitest";
import { limiter, whileBusy } from "./uploads";

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("limiter", () => {
  it("runs two at a time, in the order they were queued, and moves on after a failure too", async () => {
    const run = limiter(2);
    const gates = [0, 1, 2, 3].map(() => deferred());
    const started: number[] = [];
    const results = Promise.allSettled(gates.map((gate, index) => run(async () => { started.push(index); await gate.promise; return index; })));
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1].reject(new Error("upload failed"));
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    gates[2].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[3].resolve();
    expect(await results).toEqual([
      { status: "fulfilled", value: 0 },
      { status: "rejected", reason: new Error("upload failed") },
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 3 },
    ]);
  });

  it("frees the slot of a task that throws before it returns a promise", async () => {
    const run = limiter(1);
    await expect(run(() => { throw new Error("bad file"); })).rejects.toThrow("bad file");
    expect(await run(async () => "next")).toBe("next");
  });
});

describe("whileBusy", () => {
  const busy = Object.assign(new Error("Wait for your other uploads to finish."), { busy: true });
  const busyFor = (error: unknown) => ((error as { busy?: boolean }).busy ? 2000 : null);

  it("tries again after the wait the server asked for, and says it is waiting", async () => {
    const answers: unknown[] = [busy, busy, "stored"];
    const waits: number[] = [];
    let waiting = 0;
    const result = await whileBusy(async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    }, busyFor, { wait: async ms => { waits.push(ms); }, onWait: () => { waiting++; } });
    expect(result).toBe("stored");
    expect(waiting).toBe(2);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
    expect(waits[1]).toBeGreaterThan(waits[0] - 250); // a little longer each round (jitter aside)
  });

  it("passes any other failure straight on, and gives up once its patience is spent", async () => {
    await expect(whileBusy(async () => { throw new Error("Larger than 25 MB"); }, busyFor, { wait: async () => undefined })).rejects.toThrow("Larger than 25 MB");
    let attempts = 0;
    await expect(whileBusy(async () => { attempts++; throw busy; }, busyFor, { patienceMs: 5000, wait: async () => undefined })).rejects.toBe(busy);
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThan(5);
  });

  it("stops at once when cancelled, while waiting or before starting", async () => {
    const controller = new AbortController();
    const waiting = whileBusy(async () => { throw busy; }, busyFor, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    let called = false;
    await expect(whileBusy(async () => { called = true; }, busyFor, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });
});
