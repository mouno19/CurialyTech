import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainCheck } from "./chains";
import { addOrder, addUser, fake, resetFake } from "./fake-db";

// The watcher: what each check result does to an order (backoff, the 30-minute and 60-minute
// limits, a reorg, verification with and without auto-apply), that a check claims its order before
// asking the network, that a stale answer changes nothing, and that ticks never overlap.

vi.mock("../db/pg", async () => (await import("./fake-db")).pgModule());
const chain = vi.hoisted(() => ({ results: [] as any[], calls: [] as any[], onCall: null as null | (() => void | Promise<void>) }));
vi.mock("./chains", async importOriginal => ({
  ...(await importOriginal<typeof import("./chains")>()),
  verifyPayment: vi.fn(async (input: unknown) => {
    chain.calls.push(input);
    await chain.onCall?.();
    return chain.results.shift() ?? { state: "not_found" };
  }),
}));
vi.mock("./prices", () => ({ quoteUsd: vi.fn(async () => 3000) }));
const alerts = vi.hoisted(() => [] as { code: string; why: string; status: string }[]);
vi.mock("./notify", () => ({ alertsConfigured: () => false, notifyOrder: vi.fn(async (order: any, why: string) => { alerts.push({ code: order.code, why, status: order.status }); }) }));

const EVM = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";
const HASH = `0x${"ab".repeat(32)}`;
const MINUTE = 60_000;

const orders = await import("./orders");
const watcher = await import("./watcher");
const { resetBillingSettings } = await import("./settings");

beforeAll(() => {
  vi.stubEnv("PAY_EVM_ADDRESS", EVM);
  vi.stubEnv("PAY_SOLANA_ADDRESS", "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i");
});
beforeEach(() => {
  resetFake();
  resetBillingSettings();
  chain.results.length = 0;
  chain.calls.length = 0;
  chain.onCall = null;
  alerts.length = 0;
  addUser({ id: "u1", login: "ada" });
});
afterEach(() => {
  expect(fake.unexpected).toEqual([]);
  vi.useRealTimers();
});

const found = (state: "confirming" | "confirmed", confirmations: number, required = 20): ChainCheck => ({ state, confirmations, required, from: "0xpayer", receivedUnits: 2_003_700_000_000_000_000n, blockTime: new Date() });
const ctx = (patch: Partial<Parameters<typeof orders.decide>[0]> = {}) => ({ status: "pending" as const, network: "bnb" as const, checkCount: 1, submittedAt: Date.now(), confirmingSince: null, autoVerify: true, paidElsewhere: false, now: Date.now(), ...patch });

describe("the rules", () => {
  it("keeps looking with a backoff of 10, 20, 40, then 60 seconds", () => {
    expect([1, 2, 3, 4, 9].map(checkCount => orders.decide(ctx({ checkCount }), { state: "not_found" }).nextCheckSeconds)).toEqual([10, 20, 40, 60, 60]);
    expect(orders.decide(ctx(), { state: "not_found" })).toMatchObject({ status: "pending", detail: "Not on the network yet: a new transaction can take a minute to show up.", alert: null });
    expect(orders.decide(ctx(), { state: "seen" })).toMatchObject({ status: "pending", detail: "Seen on the network, waiting for a block." });
    // An outage says nothing new: the detail stays.
    expect(orders.decide(ctx(), { state: "unavailable" })).toMatchObject({ status: "pending", detail: undefined });
  });

  it("hands an order to the operator 30 minutes after its hash was submitted", () => {
    const late = ctx({ submittedAt: Date.now() - 31 * MINUTE });
    expect(orders.decide(late, { state: "not_found" })).toMatchObject({ status: "review", detail: "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.", alert: "review", nextCheckSeconds: null });
    expect(orders.decide(late, { state: "unavailable" })).toMatchObject({ status: "review", detail: "The network couldn't be reached to check this payment.", alert: "review" });
    expect(orders.decide(late, { state: "seen" })).toMatchObject({ status: "review", alert: "review" });
    expect(orders.decide(ctx({ submittedAt: Date.now() - 29 * MINUTE }), { state: "not_found" }).status).toBe("pending");
  });

  it("follows confirmations (faster checks while confirming), and sends a mismatch to review with its reason", () => {
    expect(orders.decide(ctx(), found("confirming", 7))).toMatchObject({ status: "confirming", detail: "7 of 20 confirmations", nextCheckSeconds: 10, chain: { confirmations: 7, required: 20, from: "0xpayer" } });
    expect(orders.decide(ctx({ network: "solana" }), found("confirming", 0, 1))).toMatchObject({ status: "confirming", detail: "Confirmed; waiting for the network to finalize it.", nextCheckSeconds: 15 });
    const reason = "This transaction sent 1.5 USDT to the Curialy wallet; this order expects exactly 2.0037 USDT.";
    expect(orders.decide(ctx(), { state: "mismatch", reason, receivedUnits: 1_500_000_000_000_000_000n })).toMatchObject({ status: "review", detail: reason, alert: "review", chain: { receivedUnits: 1_500_000_000_000_000_000n } });
  });

  it("sends a confirming order back to pending when its transaction leaves its block, and to review after 60 minutes", () => {
    const confirming = ctx({ status: "confirming", confirmingSince: Date.now() - 10 * MINUTE });
    expect(orders.decide(confirming, { state: "not_found" })).toMatchObject({ status: "pending", chain: { confirmations: null }, note: "The transaction left its block; looking for it again." });
    expect(orders.decide(confirming, { state: "seen" }).status).toBe("pending");
    // An outage while confirming: keep confirming.
    expect(orders.decide(confirming, { state: "unavailable" })).toMatchObject({ status: "confirming", nextCheckSeconds: 10 });
    const stuck = ctx({ status: "confirming", confirmingSince: Date.now() - 61 * MINUTE });
    expect(orders.decide(stuck, found("confirming", 19))).toMatchObject({ status: "review", detail: "Still not final after 60 minutes (19 of 20 confirmations).", alert: "review" });
    expect(orders.decide(stuck, { state: "unavailable" }).status).toBe("review");
  });

  it("applies a verified payment by itself only with auto-verify on", () => {
    expect(orders.decide(ctx(), found("confirmed", 20))).toMatchObject({ status: "completed", apply: true, verified: true, alert: "completed" });
    expect(orders.decide(ctx({ autoVerify: false }), found("confirmed", 20))).toMatchObject({ status: "review", apply: false, verified: true, detail: "Verified on-chain: waiting for the operator.", alert: "review" });
  });
});

/** A submitted order, due now, with a customer submission event at `submittedAt`. */
function submitted(patch: Record<string, unknown> = {}, submittedAt = new Date()) {
  const row = addOrder({
    user_id: "u1", network: "bnb", coin: "USDT", pay_address: EVM, expected_amount: "2.0037", expected_units: "2003700000000000000", quoted_at: new Date(Date.now() - 5 * MINUTE),
    tx_hash: HASH, status: "pending", status_detail: "Not on the network yet: a new transaction can take a minute to show up.", submitted_at: submittedAt, next_check_at: new Date(Date.now() - 1000), ...patch,
  });
  fake.events.push({ id: fake.events.length + 1, order_id: row.id, from_status: "awaiting_payment", to_status: "pending", actor: "customer", actor_id: "u1", note: "Transaction hash submitted", created_at: submittedAt });
  return row;
}

describe("checking", () => {
  it("claims each due order before asking the network, then moves it on", async () => {
    const due = submitted();
    const later = submitted({ tx_hash: `0x${"cd".repeat(32)}`, next_check_at: new Date(Date.now() + 30_000) });
    const review = submitted({ tx_hash: `0x${"ef".repeat(32)}`, status: "review" });
    chain.onCall = () => {
      // While the network is asked, the order is already scheduled again: nobody else checks it now.
      expect(due.next_check_at.getTime()).toBeGreaterThan(Date.now());
      expect(due.check_count).toBe(1);
    };
    chain.results.push(found("confirming", 5));
    expect(await watcher.checkDuePayments()).toBe(1);
    expect(chain.calls).toEqual([expect.objectContaining({ txHash: HASH, wallet: EVM, expectedUnits: 2_003_700_000_000_000_000n, notBefore: new Date(due.quoted_at.getTime() - 5 * MINUTE), notAfter: new Date(due.expires_at.getTime() + 15 * MINUTE) })]);
    expect(due).toMatchObject({ status: "confirming", status_detail: "5 of 20 confirmations", confirmations: 5, required_confirmations: 20, tx_from: "0xpayer", received_units: "2003700000000000000" });
    expect((due.next_check_at.getTime() - Date.now()) / 1000).toBeCloseTo(10, 0);
    expect(fake.events.at(-1)).toMatchObject({ from_status: "pending", to_status: "confirming", actor: "system", note: "5 of 20 confirmations" });
    expect([later.status, review.status, later.check_count, review.check_count]).toEqual(["pending", "review", 0, 0]);
    // Not due again yet.
    expect(await orders.runCheck(due.id)).toBeNull();
  });

  it("completes and applies a verified payment, and alerts once committed", async () => {
    const order = submitted({ status: "confirming" });
    // The second provider agrees.
    chain.results.push(found("confirmed", 20), found("confirmed", 21));
    await watcher.checkDuePayments();
    expect(chain.calls).toHaveLength(2);
    expect(order).toMatchObject({ status: "completed", applied_detail: { planId: "pro", effect: "start" }, confirmations: 20, next_check_at: null });
    expect(order.chain_verified_at).toBeInstanceOf(Date);
    expect(fake.users.get("u1")!.plan_id).toBe("pro");
    expect(fake.events.at(-1)).toMatchObject({ from_status: "confirming", to_status: "completed", actor: "system", note: "Verified on-chain and applied." });
    expect(alerts).toEqual([{ code: order.code, why: "completed", status: "completed" }]);
  });

  it("leaves a verified payment for the operator with auto-verify off", async () => {
    fake.settings.set("billing", { autoVerify: false });
    const order = submitted();
    chain.results.push(found("confirmed", 25), found("confirmed", 25));
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "review", status_detail: "Verified on-chain: waiting for the operator.", applied_at: null });
    expect(order.chain_verified_at).toBeInstanceOf(Date);
    expect(fake.users.get("u1")!.plan_id).toBeNull();
    expect(alerts).toEqual([{ code: order.code, why: "review", status: "review" }]);
  });

  it("credits nothing on one provider's word: a second one must agree first", async () => {
    const order = submitted({ status: "confirming" });
    // The second provider hasn't seen the transaction yet: it keeps confirming.
    chain.results.push(found("confirmed", 20), { state: "not_found" });
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "confirming", status_detail: "Confirmed; double-checking it with a second network provider.", applied_at: null });
    expect(fake.users.get("u1")!.plan_id).toBeNull();
    // A provider that sees another amount in the block: the operator decides.
    order.next_check_at = new Date(Date.now() - 1000);
    chain.results.push(found("confirmed", 21), { ...found("confirmed", 21), receivedUnits: 1n });
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "review", status_detail: "Two network providers disagree about this transaction, so it is checked by hand.", applied_at: null });
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });

  it("sends a match to review when its transaction already paid another order", async () => {
    addOrder({ user_id: "u2", network: "bnb", coin: "USDT", tx_hash: HASH, status: "completed", expected_units: "1" });
    const order = submitted({ status: "confirming" });
    chain.results.push(found("confirmed", 20), found("confirmed", 20));
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "review", status_detail: "This transaction already paid another order.", applied_at: null });
  });

  it("escalates a hash nobody can find after 30 minutes, counted from its latest submission", async () => {
    const order = submitted({}, new Date(Date.now() - 45 * MINUTE));
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "review", status_detail: "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.", next_check_at: null });
    expect(alerts).toEqual([{ code: order.code, why: "review", status: "review" }]);
    // The payer corrects the hash: a fresh 30 minutes (submitted_at stays the first time).
    await orders.submitHash("u1", order.code, `0x${"12".repeat(32)}`);
    await vi.waitFor(() => expect(chain.calls).toHaveLength(2));
    await vi.waitFor(() => expect(order.check_count).toBe(1));
    expect(order).toMatchObject({ status: "pending", status_detail: "Not on the network yet: a new transaction can take a minute to show up." });
  });

  it("sends a confirming order whose transaction left its block back to pending, and a stuck one to review", async () => {
    const order = submitted({ status: "confirming", confirmations: 4 });
    fake.events.push({ id: fake.events.length + 1, order_id: order.id, from_status: "pending", to_status: "confirming", actor: "system", actor_id: null, note: "1 of 20 confirmations", created_at: new Date(Date.now() - 2 * MINUTE) });
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "pending", confirmations: null });
    expect(fake.events.at(-1)).toMatchObject({ from_status: "confirming", to_status: "pending" });
    const stuck = submitted({ status: "confirming", tx_hash: `0x${"34".repeat(32)}` });
    fake.events.push({ id: fake.events.length + 1, order_id: stuck.id, from_status: "pending", to_status: "confirming", actor: "system", actor_id: null, note: "1 of 20 confirmations", created_at: new Date(Date.now() - 61 * MINUTE) });
    chain.results.push(found("confirming", 12));
    await watcher.checkDuePayments();
    expect(stuck).toMatchObject({ status: "review", status_detail: "Still not final after 60 minutes (12 of 20 confirmations)." });
  });

  it("drops an answer about a hash the payer replaced while the network was asked", async () => {
    const order = submitted();
    chain.onCall = () => {
      order.tx_hash = `0x${"56".repeat(32)}`;
    };
    chain.results.push(found("confirmed", 20));
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "pending", applied_at: null });
    expect(fake.users.get("u1")!.plan_id).toBeNull();
    expect(alerts).toEqual([]);
  });

  it("stores what a mismatch found and alerts the operator", async () => {
    const order = submitted();
    const blockTime = new Date(Date.now() - MINUTE);
    chain.results.push({ state: "mismatch", reason: "This transaction arrived after the payment window closed.", from: "0xlate", receivedUnits: 2_003_700_000_000_000_000n, blockTime });
    await watcher.checkDuePayments();
    expect(order).toMatchObject({ status: "review", status_detail: "This transaction arrived after the payment window closed.", tx_from: "0xlate", received_units: "2003700000000000000", tx_block_time: blockTime });
    expect(alerts.map(alert => alert.why)).toEqual(["review"]);
  });
});

describe("the loop", () => {
  it("never runs two ticks at once, sweeps expired orders every minute, and stops", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const stale = addOrder({ user_id: "u1", expires_at: new Date(Date.now() - 1000) });
    submitted();
    let release!: () => void;
    chain.onCall = () => new Promise<void>(resolve => { release = resolve; });
    const stop = watcher.startPaymentWatcher();
    // The first sweep runs at start.
    await vi.waitFor(() => expect(stale.status).toBe("expired"));
    const ticks = () => fake.statements.filter(text => text.startsWith("SELECT id FROM curialy.payment_orders WHERE status IN ('pending', 'confirming')")).length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chain.calls).toHaveLength(1);
    expect(ticks()).toBe(1);
    // The check hangs: later ticks don't start (they would find nothing due anyway: the order is claimed).
    await vi.advanceTimersByTimeAsync(15_000);
    expect(chain.calls).toHaveLength(1);
    expect(ticks()).toBe(1);
    release();
    chain.onCall = null;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ticks()).toBe(2);
    const late = addOrder({ user_id: "u1", expires_at: new Date(Date.now() + 30_000) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(late.status).toBe("expired");
    stop();
    const after = addOrder({ user_id: "u1", expires_at: new Date(Date.now() - 1000) });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(after.status).toBe("awaiting_payment");
  });

  it("backs off while the database can't be reached, then carries on", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const due = "SELECT id FROM curialy.payment_orders WHERE status IN ('pending', 'confirming')";
    const ticks = () => fake.statements.filter(text => text.startsWith(due)).length;
    fake.failing = text => text.startsWith(due);
    const stop = watcher.startPaymentWatcher();
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ticks()).toBe(1);
      expect(error).toHaveBeenCalledWith("[Curialy Billing] Payment checks paused:", "Connection terminated unexpectedly");
      // Paused for 10 seconds: the next tick is skipped.
      fake.failing = null;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ticks()).toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ticks()).toBe(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ticks()).toBe(3);
    } finally {
      stop();
      error.mockRestore();
    }
  });

  it("leaves payments to the primary instance", () => {
    vi.stubEnv("AGENT_INSTANCE_ROLE", "replica");
    try {
      const stale = addOrder({ user_id: "u1", expires_at: new Date(Date.now() - 1000) });
      watcher.startPaymentWatcher()();
      expect(stale.status).toBe("awaiting_payment");
    } finally {
      vi.stubEnv("AGENT_INSTANCE_ROLE", "primary");
    }
  });
});
