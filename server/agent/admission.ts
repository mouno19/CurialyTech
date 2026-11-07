import type { CreditBalance } from "@shared/credits";
import { assertCanStart, CreditError } from "../credits";
import { cloudSandboxReady } from "./sandbox";
import { activeRunsOf } from "./store";

// Who may start a run now. Shared by the routes that start runs and by the follow-up queue, which
// starts a waiting message later, when the run before it has ended.

// Starting a run is serialized per account, so "one run at a time" holds for simultaneous starts.
const startChains = new Map<string, Promise<unknown>>();
export function oneAtATime<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = startChains.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  startChains.set(userId, next);
  void next.finally(() => { if (startChains.get(userId) === next) startChains.delete(userId); }).catch(() => undefined);
  return next;
}

export type AdmissionRefusal = { status: number; error: string; code: string; credits?: CreditBalance };

/**
 * Free accounts: their commands run only in a cloud sandbox of their own (never on this server, where
 * tasks would share one user), with credits to start, one run at a time. The operator is not limited.
 * Returns why a run can't start now, or null.
 */
export async function admissionRefusal(user: { id: string; role: string }): Promise<AdmissionRefusal | null> {
  if (user.role === "admin") return null;
  if (!cloudSandboxReady()) return { status: 503, error: "Tasks can't start right now: the command sandbox isn't available. Try again later.", code: "sandbox_unavailable" };
  if (await activeRunsOf(user.id) > 0) return { status: 429, error: "You already have a task running. Wait for it to finish (or stop it) before starting another.", code: "busy" };
  try {
    await assertCanStart(user.id);
    return null;
  } catch (error) {
    if (error instanceof CreditError) return { status: 402, error: error.message, code: error.code, credits: error.balance };
    throw error;
  }
}
