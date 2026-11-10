import { query } from "../db/pg";
import { expireOrders, runCheck, watchInboxes } from "./orders";
import { walletConfig } from "./settings";

// The payment watcher: every few seconds it checks the submitted transactions that are due (one
// tick at a time, never overlapping), every 20 seconds it reads the receiving wallets for a payment
// nobody pasted a hash for, and every minute it expires orders nobody paid. Each order's own
// schedule (10, 20, 40, then 60 seconds; faster while confirming) lives on its row, so a restart
// picks up where the last process left off.

const TICK_MS = 5_000;
const SWEEP_MS = 60_000;
/** How often the receiving wallets are read for a payment nobody pasted a hash for. */
const INBOX_MS = 20_000;
/** Orders checked per tick, and at once (each check asks one network endpoint a few questions). */
const BATCH = 10;
const AT_ONCE = 4;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One tick: the due pending and confirming orders, oldest due first. Returns how many were checked. */
export async function checkDuePayments() {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM curialy.payment_orders WHERE status IN ('pending', 'confirming') AND next_check_at <= now() ORDER BY next_check_at LIMIT $1",
    [BATCH],
  );
  for (let start = 0; start < rows.length; start += AT_ONCE) {
    await Promise.all(rows.slice(start, start + AT_ONCE).map(row => runCheck(row.id).catch(error => console.error(`[Curialy Billing] Payment check ${row.id} failed:`, message(error)))));
  }
  return rows.length;
}

/**
 * Starts the loop and the expiry sweep; returns a function that stops both. A second instance on the
 * same database (AGENT_INSTANCE_ROLE=replica) leaves payments to the primary.
 */
export function startPaymentWatcher() {
  if ((process.env.AGENT_INSTANCE_ROLE ?? "primary") === "replica") return () => undefined;
  // Read the receiving wallets now: a missing or invalid one shows in the boot log.
  walletConfig();
  let busy = false;
  let stopped = false;
  let failures = 0;
  let pausedUntil = 0;
  let inboxAt = 0;
  const tick = async () => {
    if (busy || stopped || Date.now() < pausedUntil) return;
    busy = true;
    try {
      await checkDuePayments();
      if (Date.now() - inboxAt >= INBOX_MS) {
        inboxAt = Date.now();
        // A chain read failing leaves the pasted-hash checks running.
        await watchInboxes().catch(error => console.error("[Curialy Billing] Incoming payments:", message(error)));
      }
      failures = 0;
    } catch (error) {
      // The database is unreachable: back off (10 s, 20 s, ... up to a minute) instead of failing every tick.
      failures++;
      pausedUntil = Date.now() + Math.min(60_000, 5_000 * 2 ** failures);
      console.error("[Curialy Billing] Payment checks paused:", message(error));
    } finally {
      busy = false;
    }
  };
  const sweep = () => void expireOrders().catch(error => console.error("[Curialy Billing] Expiry sweep failed:", message(error)));
  const ticker = setInterval(() => void tick(), TICK_MS);
  const sweeper = setInterval(sweep, SWEEP_MS);
  ticker.unref();
  sweeper.unref();
  sweep();
  return () => {
    stopped = true;
    clearInterval(ticker);
    clearInterval(sweeper);
  };
}
