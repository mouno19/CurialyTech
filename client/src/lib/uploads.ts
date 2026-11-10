// Many files at once, kindly: uploads run a few at a time in the order they were picked, and wait
// (instead of failing) while the server says this account already has its uploads in flight.

/** Runs at most `size` tasks at once, in the order they were queued. */
export function limiter(size: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    while (active < size && waiting.length) {
      active++;
      waiting.shift()!();
    }
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        let started: Promise<T>;
        try {
          started = task();
        } catch (error) {
          started = Promise.reject(error);
        }
        started.then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

const abortError = () => new DOMException("Cancelled", "AbortError");

/** Waits `ms`, or rejects with AbortError as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Runs `attempt` again while it fails with a "busy" answer: `busyFor` returns how long the server
 * asked to wait (ms), or null for any other failure (thrown as is). Gives up after `patienceMs`.
 */
export async function whileBusy<T>(
  attempt: () => Promise<T>,
  busyFor: (error: unknown) => number | null,
  opts: { patienceMs?: number; signal?: AbortSignal; onWait?: () => void; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<T> {
  const { patienceMs = 120_000, signal, onWait, wait = sleep } = opts;
  let waited = 0;
  for (let round = 0; ; round++) {
    if (signal?.aborted) throw abortError();
    try {
      return await attempt();
    } catch (error) {
      const asked = busyFor(error);
      if (asked === null || waited >= patienceMs) throw error;
      // A little more each time (and a little jitter), so tabs waiting on each other don't collide.
      const pause = Math.min(10_000, Math.max(500, asked) + round * 250 + Math.floor(Math.random() * 250));
      onWait?.();
      await wait(pause, signal);
      waited += pause;
    }
  }
}
