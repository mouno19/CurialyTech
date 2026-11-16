import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { coinOn, DEFAULT_BILLING_SETTINGS } from "@shared/billing";
import { DEFAULT_CREDIT_SETTINGS } from "@shared/credits";
import { addOrder, addUser, fake, orderByCode, resetFake } from "./fake-db";

// Orders, where the money is: prices come from the server, every issued amount is unique on its
// network and coin, a transaction pays one order, an order is applied once, and an account only ever
// reaches its own orders. The database is an in-memory stand-in; the chain and prices are scripted.

vi.mock("../db/pg", async () => (await import("./fake-db")).pgModule());
const chain = vi.hoisted(() => ({ results: [] as any[], calls: [] as any[] }));
vi.mock("./chains", async importOriginal => ({
  ...(await importOriginal<typeof import("./chains")>()),
  verifyPayment: vi.fn(async (input: unknown) => {
    chain.calls.push(input);
    return chain.results.shift() ?? { state: "not_found" };
  }),
}));
const prices = vi.hoisted(() => ({ quote: 3000 as number | null }));
vi.mock("./prices", () => ({ quoteUsd: vi.fn(async () => prices.quote) }));
const alerts = vi.hoisted(() => [] as { code: string; why: string; status: string }[]);
vi.mock("./notify", () => ({ alertsConfigured: () => true, notifyOrder: vi.fn(async (order: any, why: string) => { alerts.push({ code: order.code, why, status: order.status }); }) }));

const EVM = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";
const SOLANA = "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i";
const HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;
const DAY = 86_400_000;
const MAX_OPEN = 5;

const orders = await import("./orders");
const { resetBillingSettings } = await import("./settings");
const { balanceOf } = await import("../credits");
/** Credit settings with a free allowance of 60 per window, so the end of every plan shows. */
const CREDIT_SETTINGS = { ...DEFAULT_CREDIT_SETTINGS, creditsPerWindow: 60 };

beforeAll(() => {
  vi.stubEnv("PAY_EVM_ADDRESS", EVM.toLowerCase());
  vi.stubEnv("PAY_SOLANA_ADDRESS", SOLANA);
});
beforeEach(() => {
  resetFake();
  resetBillingSettings();
  chain.results.length = 0;
  chain.calls.length = 0;
  alerts.length = 0;
  prices.quote = 3000;
  addUser({ id: "u1", login: "ada" });
  addUser({ id: "u2", login: "grace" });
  addUser({ id: "admin", role: "admin", login: "mouno19" });
});
// Checks started in the background finish before the next test resets the tables, and every
// statement sent was one the stand-in knows.
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fake.unexpected).toEqual([]);
});

const expectError = async (work: Promise<unknown>, status: number, code: string) => {
  await expect(work).rejects.toMatchObject({ status, code });
};
/** An order with payment details issued now (BNB Chain USDT unless told otherwise). */
const withDetails = (patch: Record<string, unknown> = {}) => addOrder({
  user_id: "u1", network: "bnb", coin: "USDT", pay_address: EVM, expected_amount: "2.0037", expected_units: "2003700000000000000", quoted_at: new Date(), ...patch,
});

describe("placing an order", () => {
  it("prices plans with the plan discount and credits a top-up at 100 times the payment, whatever the client sent", async () => {
    const plan = await orders.createOrder("u1", { kind: "plan", planId: "max", priceUsd: 0.01 } as any);
    expect(plan.created).toBe(true);
    expect(plan.order).toMatchObject({ kind: "plan", planId: "max", title: "Max · 30 days", listUsd: 80, discountPercent: 90, priceUsd: 8, creditUsd: null, status: "awaiting_payment", network: null, submitUntil: null });
    expect(plan.order.code).toMatch(/^CUR-[0-9A-HJKMNP-TV-Z]{8}$/);
    const topUp = await orders.createOrder("u1", { kind: "api", amountUsd: 25 });
    expect(topUp.order).toMatchObject({ kind: "api", planId: null, title: "API balance · $2500", listUsd: 25, discountPercent: 0, priceUsd: 25, creditUsd: 2500 });
    expect(fake.events.map(event => [event.to_status, event.actor, event.actor_id, event.note])).toEqual([["awaiting_payment", "customer", "u1", "Order created"], ["awaiting_payment", "customer", "u1", "Order created"]]);
    // An offer that has ended, or one for the API only, leaves plans at list price.
    resetBillingSettings();
    fake.settings.set("billing", { discount: { ...DEFAULT_BILLING_SETTINGS.discount, endsAt: new Date(Date.now() - 1000).toISOString() } });
    expect((await orders.createOrder("u2", { kind: "plan", planId: "pro" })).order).toMatchObject({ priceUsd: 20, discountPercent: 0 });
  });

  it("refuses top-ups outside whole dollars from $5 to $1,000", async () => {
    for (const amountUsd of [4, 1001, 5.5, Number.NaN]) await expectError(orders.createOrder("u1", { kind: "api", amountUsd }), 400, "invalid_amount");
    await expectError(orders.createOrder("u1", { kind: "plan", planId: "ultra" as any }), 400, "invalid_plan");
    expect(fake.orders).toEqual([]);
  });

  it("gives a double click the same order, and a different item a new one", async () => {
    const first = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    const again = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    expect(again).toMatchObject({ created: false, order: { code: first.order.code } });
    expect((await orders.createOrder("u1", { kind: "plan", planId: "max" })).created).toBe(true);
    expect((await orders.createOrder("u1", { kind: "api", amountUsd: 10 })).created).toBe(true);
    expect((await orders.createOrder("u1", { kind: "api", amountUsd: 10 })).created).toBe(false);
    // Once its payment details are issued, the same item is a new order.
    orderByCode(first.order.code).network = "bnb";
    expect((await orders.createOrder("u1", { kind: "plan", planId: "pro" })).created).toBe(true);
    expect(fake.locks.every(key => key.startsWith("curialy-orders:u1"))).toBe(true);
  });

  it("allows at most five orders awaiting payment (expired ones don't count)", async () => {
    for (const amountUsd of [5, 6, 7, 8, 9]) await orders.createOrder("u1", { kind: "api", amountUsd });
    await expectError(orders.createOrder("u1", { kind: "api", amountUsd: 10 }), 409, "too_many_orders");
    fake.orders[0].expires_at = new Date(Date.now() - 1000);
    expect((await orders.createOrder("u1", { kind: "api", amountUsd: 10 })).created).toBe(true);
    // Another account has its own five.
    expect((await orders.createOrder("u2", { kind: "api", amountUsd: 5 })).created).toBe(true);
  });

  it("refuses new orders while payments are paused, or when no wallet is configured", async () => {
    fake.settings.set("billing", { paymentsOpen: false });
    await expectError(orders.createOrder("u1", { kind: "plan", planId: "pro" }), 503, "payments_closed");
    fake.settings.delete("billing");
    resetBillingSettings();
    // A wrong checksum (the last letter's case) and no Solana wallet: nothing can be paid.
    vi.stubEnv("PAY_EVM_ADDRESS", "0x6FD853FE610A76b20E1B02751bc5eD3716D3894B");
    vi.stubEnv("PAY_SOLANA_ADDRESS", "");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expectError(orders.createOrder("u1", { kind: "plan", planId: "pro" }), 503, "payments_closed");
      expect(JSON.stringify(errors.mock.calls)).not.toContain("6FD853");
    } finally {
      vi.stubEnv("PAY_EVM_ADDRESS", EVM.toLowerCase());
      vi.stubEnv("PAY_SOLANA_ADDRESS", SOLANA);
      vi.restoreAllMocks();
      resetBillingSettings();
    }
  });
});

describe("an account's own orders only", () => {
  it("answers someone else's code exactly like an unknown one, for every action", async () => {
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    const unknown = await orders.getOwnOrder("u2", "CUR-00000000").catch(error => error);
    const theirs = await orders.getOwnOrder("u2", order.code).catch(error => error);
    expect([theirs.status, theirs.code, theirs.message]).toEqual([unknown.status, unknown.code, unknown.message]);
    expect(theirs).toMatchObject({ status: 404, code: "not_found", message: "No order with that code on this account." });
    await expectError(orders.chooseMethod("u2", order.code, "bnb", "USDT"), 404, "not_found");
    orderByCode(order.code).network = "bnb";
    await expectError(orders.submitHash("u2", order.code, HASH), 404, "not_found");
    expect(await orders.listOwnOrders("u2")).toEqual([]);
    // The owner finds it however the code is typed.
    expect((await orders.getOwnOrder("u1", order.code.toLowerCase().replace("cur-", " "))).code).toBe(order.code);
  });
});

describe("payment details", () => {
  it("issue the wallet, a unique exact amount and a fresh window, once", async () => {
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    orderByCode(order.code).expires_at = new Date(Date.now() + 60_000);
    const issued = await orders.chooseMethod("u1", order.code, "bnb", "USDT");
    expect(issued).toMatchObject({ network: "bnb", coin: "USDT", payAddress: EVM, quoteUsdPrice: null, status: "awaiting_payment" });
    expect(issued.expectedAmount).toMatch(/^2\.00(0[1-9]|[1-9]\d?)$/);
    const row = orderByCode(order.code);
    // Base units at the token's 18 decimals on BNB Chain, from the same amount.
    expect(BigInt(row.expected_units)).toBe(BigInt(Math.round(Number(issued.expectedAmount) * 10_000)) * 10n ** 14n);
    expect(Date.parse(issued.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(issued.submitUntil).toBe(new Date(Date.parse(issued.expiresAt) + DAY).toISOString());
    expect(fake.locks).toContain("curialy-pay:bnb:USDT");
    expect(fake.events.at(-1)).toMatchObject({ actor: "customer", note: `Payment details issued: exactly ${issued.expectedAmount} USDT on BNB Chain.` });
    // The same choice again is the same order; another one is refused.
    const events = fake.events.length;
    expect(await orders.chooseMethod("u1", order.code, "bnb", "USDT")).toMatchObject({ expectedAmount: issued.expectedAmount });
    expect(fake.events).toHaveLength(events);
    await expectError(orders.chooseMethod("u1", order.code, "ethereum", "USDT"), 409, "details_locked");
    await expectError(orders.chooseMethod("u1", order.code, "bnb", "BNB"), 409, "details_locked");
  });

  it("never hands out an amount another open or recent order on the network and coin has", async () => {
    // 98 of the 99 suffixes on $2.00 USDT (Ethereum) are taken by other orders: the last one is left.
    for (let k = 1; k <= 99; k++) if (k !== 42) addOrder({ user_id: "u2", network: "ethereum", coin: "USDT", expected_units: String(2_000_000 + k * 100), status: k % 2 ? "awaiting_payment" : "review", quoted_at: new Date(Date.now() - 3 * DAY) });
    // Old, closed orders free their amounts; another coin or network doesn't count.
    addOrder({ user_id: "u2", network: "ethereum", coin: "USDT", expected_units: "2004200", status: "expired", quoted_at: new Date(Date.now() - 3 * DAY) });
    addOrder({ user_id: "u2", network: "ethereum", coin: "USDC", expected_units: "2004200", status: "awaiting_payment", quoted_at: new Date() });
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    expect((await orders.chooseMethod("u1", order.code, "ethereum", "USDT")).expectedAmount).toBe("2.0042");
    // Now all 99 are taken: six decimals.
    const next = await orders.createOrder("u1", { kind: "plan", planId: "max" });
    orderByCode(next.order.code).price_usd = "2.00";
    await orders.chooseMethod("u1", next.order.code, "ethereum", "USDT");
    const suffix = BigInt(orderByCode(next.order.code).expected_units) - 2_000_000n;
    expect(suffix >= 1n && suffix <= 9_999n && suffix % 100n !== 0n).toBe(true);
    const units = fake.orders.filter(row => row.network === "ethereum" && row.coin === "USDT" && OPEN.includes(row.status)).map(row => row.expected_units);
    expect(new Set(units).size).toBe(units.length);
  });

  it("price the network's own coin live, and refuse it without a reliable quote", async () => {
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    prices.quote = 150;
    const issued = await orders.chooseMethod("u1", order.code, "solana", "SOL");
    // $2 at $150 is 0.01333...: rounded up at 6 decimals, plus the order's own last digits.
    expect(issued).toMatchObject({ payAddress: SOLANA, quoteUsdPrice: 150 });
    const units = BigInt(orderByCode(order.code).expected_units);
    expect(units % 1000n).toBe(0n);
    expect(units / 1000n - 13_334n).toBeGreaterThanOrEqual(1n);
    expect(units / 1000n - 13_334n).toBeLessThanOrEqual(99n);
    expect(issued.expectedAmount).toBe((Number(units) / 1e9).toString());
    const next = await orders.createOrder("u1", { kind: "plan", planId: "max" });
    prices.quote = null;
    await expectError(orders.chooseMethod("u1", next.order.code, "ethereum", "ETH"), 503, "no_quote");
    expect(orderByCode(next.order.code).network).toBeNull();
    // Stablecoins don't need a quote.
    expect((await orders.chooseMethod("u1", next.order.code, "ethereum", "USDC")).coin).toBe("USDC");
  });

  it("are refused for a coin that isn't offered, an expired order or one no longer awaiting payment", async () => {
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    await expectError(orders.chooseMethod("u1", order.code, "bnb", "SOL"), 400, "method_unavailable");
    await expectError(orders.chooseMethod("u1", order.code, "avalanche", "USDT"), 400, "method_unavailable");
    orderByCode(order.code).expires_at = new Date(Date.now() - 1000);
    await expectError(orders.chooseMethod("u1", order.code, "bnb", "USDT"), 409, "order_expired");
    orderByCode(order.code).status = "rejected";
    await expectError(orders.chooseMethod("u1", order.code, "bnb", "USDT"), 409, "order_closed");
  });
});

const OPEN = ["awaiting_payment", "pending", "confirming", "review"];

describe("amounts", () => {
  const pickFirst = () => 0;
  const usdt6 = { coin: "USDT" as const, kind: "stablecoin" as const, decimals: 6 };
  const usdt18 = coinOn("bnb", "USDT")!;

  it("add a suffix of 0.0001 to 0.0099 to a stablecoin price, never the round price", () => {
    expect(orders.allocateUnits(usdt6, 200, null, new Set(), pickFirst)).toBe(2_000_100n);
    expect(orders.allocateUnits(usdt6, 200, null, new Set(), count => count - 1)).toBe(2_009_900n);
    expect(orders.allocateUnits(usdt18, 200, null, new Set(), pickFirst)).toBe(2_000_100_000_000_000_000n);
    for (let i = 0; i < 200; i++) {
      const units = orders.allocateUnits(usdt6, 800, null, new Set())!;
      expect(units - 8_000_000n).toBeGreaterThanOrEqual(100n);
      expect(units - 8_000_000n).toBeLessThanOrEqual(9_900n);
      expect((units - 8_000_000n) % 100n).toBe(0n);
    }
  });

  it("skip amounts that are taken, then fall back to six decimals, then give up", () => {
    const first = new Set(Array.from({ length: 99 }, (_, k) => String(2_000_000 + (k + 1) * 100)));
    expect(orders.allocateUnits(usdt6, 200, null, new Set([...first].filter(units => units !== "2003700")), pickFirst)).toBe(2_003_700n);
    // All 99 taken: k × 0.000001, never a multiple of 100 (those are the first tier).
    expect(orders.allocateUnits(usdt6, 200, null, first, pickFirst)).toBe(2_000_001n);
    expect(orders.allocateUnits(usdt6, 200, null, new Set([...first, "2000001"]), pickFirst)).toBe(2_000_002n);
    const tier2 = Array.from({ length: 9999 }, (_, k) => k + 1).filter(k => k % 100).map(k => String(2_000_000 + k));
    expect(orders.allocateUnits(usdt6, 200, null, new Set([...first, ...tier2.slice(0, -1)]), pickFirst)).toBe(2_009_999n);
    expect(orders.allocateUnits(usdt6, 200, null, new Set([...first, ...tier2]), pickFirst)).toBeNull();
  });

  it("round a native amount up at the coin's quote decimals and keep it in base units", () => {
    // ETH (7 decimals quoted, 18 on-chain): $2 at $3000 is 0.00066666...: 6667, plus k.
    expect(orders.allocateUnits(coinOn("ethereum", "ETH")!, 200, 3000, new Set(), pickFirst)).toBe(6_668n * 10n ** 11n);
    // $8 at $3456.78: 23142.98... rounds up to 23143.
    expect(orders.allocateUnits(coinOn("bnb", "BNB")!, 800, 3456.78, new Set(), pickFirst)).toBe(23_144n * 10n ** 11n);
    // POL (3 decimals): exactly 8 POL at $0.25 still gets its own last digit.
    expect(orders.allocateUnits(coinOn("polygon", "POL")!, 200, 0.25, new Set(), pickFirst)).toBe(8_001n * 10n ** 15n);
    // SOL (6 decimals quoted, 9 on-chain).
    expect(orders.allocateUnits(coinOn("solana", "SOL")!, 200, 150, new Set(), pickFirst)).toBe(13_335n * 1000n);
    // 1..99 taken: 100..999.
    const taken = new Set(Array.from({ length: 99 }, (_, k) => String((13_334n + BigInt(k + 1)) * 1000n)));
    expect(orders.allocateUnits(coinOn("solana", "SOL")!, 200, 150, taken, pickFirst)).toBe((13_334n + 100n) * 1000n);
    expect(orders.allocateUnits(coinOn("solana", "SOL")!, 200, null, new Set(), pickFirst)).toBeNull();
  });
});

describe("submitting a transaction", () => {
  it("needs payment details and a hash that fits the network", async () => {
    const bare = addOrder({ user_id: "u1" });
    await expectError(orders.submitHash("u1", bare.code, HASH), 409, "no_details");
    const order = withDetails();
    await expectError(orders.submitHash("u1", order.code, "0x1234"), 400, "invalid_hash");
    await expectError(orders.submitHash("u1", order.code, "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW"), 400, "invalid_hash");
    expect(order.status).toBe("awaiting_payment");
  });

  it("starts checking at once, takes the same hash twice as once, and lets the payer correct a pending hash", async () => {
    const order = withDetails();
    const pending = await orders.submitHash("u1", order.code, `  ${HASH.toUpperCase().replace("0X", "0x")} `);
    expect(pending).toMatchObject({ status: "pending", txHash: HASH, statusDetail: "Not on the network yet: a new transaction can take a minute to show up.", explorerUrl: `https://bscscan.com/tx/${HASH}` });
    expect(order).toMatchObject({ tx_hash: HASH, check_count: expect.any(Number) });
    expect(order.submitted_at).toBeInstanceOf(Date);
    await vi.waitFor(() => expect(chain.calls).toHaveLength(1));
    expect(chain.calls[0]).toMatchObject({ network: "bnb", coin: "USDT", txHash: HASH, wallet: EVM, expectedUnits: 2_003_700_000_000_000_000n });
    const events = fake.events.length;
    await orders.submitHash("u1", order.code, HASH);
    expect(fake.events).toHaveLength(events);
    const firstSubmitted = order.submitted_at;
    expect((await orders.submitHash("u1", order.code, OTHER_HASH)).txHash).toBe(OTHER_HASH);
    // The replaced hash stays on record.
    expect(fake.events.at(-1)).toMatchObject({ from_status: "pending", to_status: "pending", note: "Transaction hash replaced (was 0xabababab…ababab)" });
    expect(order.submitted_at).toBe(firstSubmitted);
  });

  it("refuses a confirming, completed or rejected order, and takes a new hash for one in review", async () => {
    const order = withDetails({ tx_hash: HASH, status: "confirming" });
    await expectError(orders.submitHash("u1", order.code, OTHER_HASH), 409, "already_confirming");
    order.status = "completed";
    await expectError(orders.submitHash("u1", order.code, OTHER_HASH), 409, "order_completed");
    order.status = "rejected";
    await expectError(orders.submitHash("u1", order.code, OTHER_HASH), 409, "order_rejected");
    order.status = "review";
    order.status_detail = "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.";
    expect(await orders.submitHash("u1", order.code, OTHER_HASH)).toMatchObject({ status: "pending", txHash: OTHER_HASH, statusDetail: "Not on the network yet: a new transaction can take a minute to show up." });
    expect(order).toMatchObject({ check_count: expect.any(Number), confirmations: null, received_units: null });
  });

  it("takes a hash for a day after the details expire, and not after", async () => {
    const order = withDetails({ status: "expired", expires_at: new Date(Date.now() - 23 * 3_600_000) });
    expect((await orders.getOwnOrder("u1", order.code)).submitUntil).toBe(new Date(order.expires_at.getTime() + DAY).toISOString());
    expect((await orders.submitHash("u1", order.code, HASH)).status).toBe("pending");
    const late = withDetails({ status: "expired", expires_at: new Date(Date.now() - 25 * 3_600_000), expected_units: "2003800000000000000" });
    expect((await orders.getOwnOrder("u1", late.code)).submitUntil).toBeNull();
    await expectError(orders.submitHash("u1", late.code, OTHER_HASH), 409, "order_expired");
    // Still awaiting payment (the sweep hasn't run): the same day applies.
    const stale = withDetails({ expires_at: new Date(Date.now() - 25 * 3_600_000), expected_units: "2003900000000000000" });
    await expectError(orders.submitHash("u1", stale.code, OTHER_HASH), 409, "order_expired");
  });

  it("lets one transaction pay one order: only an order it paid holds it, so a hash pasted first blocks nobody", async () => {
    // Someone watching the wallet pasted the payer's hash first; their check didn't match, and the real payer can still submit it.
    withDetails({ user_id: "u2", tx_hash: HASH, status: "review" });
    const order = withDetails({ expected_units: "2003800000000000000" });
    expect((await orders.submitHash("u1", order.code, HASH)).status).toBe("pending");
    // A transaction that paid an order (confirming or completed) pays no other.
    withDetails({ user_id: "u2", tx_hash: OTHER_HASH, status: "completed", expected_units: "2003900000000000000" });
    const another = withDetails({ expected_units: "2004000000000000000" });
    const error = await orders.submitHash("u1", another.code, OTHER_HASH).catch(caught => caught);
    expect(error).toMatchObject({ status: 409, code: "hash_used", message: "This transaction already paid another order." });
    expect(another.tx_hash).toBeNull();
    // On another network the same hash is another transaction.
    const polygon = withDetails({ network: "polygon", expected_units: "2003800" });
    expect((await orders.submitHash("u1", polygon.code, OTHER_HASH)).status).toBe("pending");
  });

  it("won't let the operator complete a second order with a transaction that already paid one", async () => {
    withDetails({ user_id: "u2", tx_hash: HASH, status: "completed" });
    const order = withDetails({ tx_hash: HASH, status: "review", expected_units: "2003800000000000000" });
    await expectError(orders.approveOrder(order.code, "admin", ""), 409, "hash_used");
    expect(order.status).toBe("review");
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });
});

describe("applying an order", () => {
  const paid = (patch: Record<string, unknown> = {}) => withDetails({ tx_hash: HASH, status: "confirming", ...patch });
  const daysFromNow = (iso: string | Date) => (new Date(iso).getTime() - Date.now()) / DAY;

  it("starts a plan with its allowance, once, however often it is applied", async () => {
    const order = paid();
    expect(await orders.applyOrder(order.id, "system")).toBe(true);
    expect(await orders.applyOrder(order.id, "system")).toBe(false);
    const user = fake.users.get("u1")!;
    expect(user).toMatchObject({ plan_id: "pro", plan_credits_per_window: 6000 });
    expect(daysFromNow(user.plan_expires_at!)).toBeCloseTo(30, 3);
    expect(order).toMatchObject({ status: "completed", status_detail: null, applied_detail: { planId: "pro", effect: "start" } });
    expect(order.completed_at).toBeInstanceOf(Date);
    expect(fake.creditEvents).toEqual([{ user_id: "u1", kind: "plan", amount: 0, detail: expect.stringMatching(new RegExp(`^Pro plan until \\d{1,2} [A-Z][a-z]{2} \\d{4} \\(order ${order.code}\\)$`)), created_by: null }]);
    expect(fake.events.filter(event => event.to_status === "completed")).toHaveLength(1);
    const view = await orders.getOwnOrder("u1", order.code);
    expect(view.applied).toEqual({ planId: "pro", planExpiresAt: user.plan_expires_at!.toISOString(), effect: "start" });
  });

  it("extends the same plan from its end, and restarts one that has ended", async () => {
    const user = fake.users.get("u1")!;
    // An account from before plans ran side by side: its plan is in the single-plan columns only.
    Object.assign(user, { plan_id: "pro", plan_expires_at: new Date(Date.now() + 10 * DAY), plan_credits_per_window: 6000 });
    const extend = paid();
    await orders.applyOrder(extend.id, "system");
    expect(daysFromNow(user.pro_expires_at!)).toBeCloseTo(40, 3);
    expect(user).toMatchObject({ pro_credits_per_window: 6000, plan_id: "pro", max_expires_at: null });
    expect(daysFromNow(user.plan_expires_at!)).toBeCloseTo(40, 3);
    expect(extend.applied_detail).toMatchObject({ planId: "pro", effect: "extend" });
    // An ended plan is no plan: a new one starts now.
    Object.assign(user, { pro_expires_at: new Date(Date.now() - DAY), plan_id: null, plan_expires_at: null });
    const restart = paid({ tx_hash: OTHER_HASH, expected_units: "2003800000000000000" });
    await orders.applyOrder(restart.id, "system");
    expect(daysFromNow(user.pro_expires_at!)).toBeCloseTo(30, 3);
    expect(restart.applied_detail.effect).toBe("start");
  });

  it("runs Max alongside Pro: neither is converted, and the allowances add up until each ends", async () => {
    const user = fake.users.get("u1")!;
    const balance = (now = Date.now()) => balanceOf({ id: "u1", role: "user", credit_allowance: null, bonus_credits: "0", window_started_at: null, window_used: "0", ...user }, CREDIT_SETTINGS, now, DEFAULT_BILLING_SETTINGS.plans);
    // 1. Pro (6,000 credits per window).
    await orders.applyOrder(paid().id, "system");
    expect(balance()).toMatchObject({ allowance: 6000, plan: { id: "pro" } });
    // 10 days later Pro has 20 left.
    Object.assign(user, { pro_expires_at: new Date(Date.now() + 20 * DAY), plan_expires_at: new Date(Date.now() + 20 * DAY) });
    // 2. Max bought on top: it starts now for its own 30 days, and Pro keeps its 20.
    const max = paid({ plan_id: "max", list_usd: "80.00", price_usd: "8.00", tx_hash: OTHER_HASH, expected_units: "8003700000000000000" });
    await orders.applyOrder(max.id, "system");
    expect(daysFromNow(user.pro_expires_at!)).toBeCloseTo(20, 3);
    expect(daysFromNow(user.max_expires_at!)).toBeCloseTo(30, 3);
    expect(user).toMatchObject({ pro_credits_per_window: 6000, max_credits_per_window: 30000 });
    expect(max.applied_detail).toMatchObject({ planId: "max", effect: "concurrent" });
    // The single-plan columns follow the highest plan, for an older build.
    expect(user).toMatchObject({ plan_id: "max", plan_credits_per_window: 30000 });
    // The account's history says Max runs alongside Pro.
    expect(fake.creditEvents.at(-1)!.detail).toMatch(new RegExp(`^Max plan until \\d{1,2} [A-Z][a-z]{2} \\d{4}, alongside Pro until \\d{1,2} [A-Z][a-z]{2} \\d{4} \\(order ${max.code}\\)$`));
    // 3. Both active: 6,000 + 30,000.
    expect(balance()).toMatchObject({ allowance: 36_000, remaining: 36_000, plan: { id: "max" }, plans: [{ id: "pro", creditsPerWindow: 6000 }, { id: "max", creditsPerWindow: 30_000 }] });
    // 4. Pro ends first: Max carries on alone.
    expect(balance(Date.now() + 21 * DAY)).toMatchObject({ allowance: 30_000, plan: { id: "max" }, plans: [{ id: "max" }] });
    // 5. Max ends too: back to the free tier (60 per window in these settings).
    expect(balance(Date.now() + 31 * DAY)).toMatchObject({ allowance: CREDIT_SETTINGS.creditsPerWindow, plan: null, plans: [] });
    // Buying Pro again while both run extends Pro only.
    const morePro = paid({ tx_hash: `0x${"ef".repeat(32)}`, expected_units: "2003900000000000000" });
    await orders.applyOrder(morePro.id, "system");
    expect(daysFromNow(user.pro_expires_at!)).toBeCloseTo(50, 3);
    expect(daysFromNow(user.max_expires_at!)).toBeCloseTo(30, 3);
    expect(morePro.applied_detail).toMatchObject({ planId: "pro", effect: "extend" });
  });

  it("runs Pro alongside Max the other way round, with the allowance Max was sold with", async () => {
    const user = fake.users.get("u1")!;
    Object.assign(user, { plan_id: "max", plan_expires_at: new Date(Date.now() + 5 * DAY), plan_credits_per_window: 25_000 });
    const pro = paid();
    await orders.applyOrder(pro.id, "system");
    expect(pro.applied_detail).toMatchObject({ planId: "pro", effect: "concurrent" });
    expect(daysFromNow(user.pro_expires_at!)).toBeCloseTo(30, 3);
    // Max (still from the single-plan columns) keeps its end and its allowance.
    expect(user).toMatchObject({ plan_id: "max", plan_credits_per_window: 25_000, pro_credits_per_window: 6000 });
    expect(daysFromNow(user.plan_expires_at!)).toBeCloseTo(5, 3);
    const row = { id: "u1", role: "user", credit_allowance: null, bonus_credits: "0", window_started_at: null, window_used: "0", ...user };
    expect(balanceOf(row, CREDIT_SETTINGS, Date.now(), DEFAULT_BILLING_SETTINGS.plans).allowance).toBe(31_000);
    // Max ends: the single-plan columns would name a plan that ended, so they move to Pro on the next change.
    expect(balanceOf(row, CREDIT_SETTINGS, Date.now() + 6 * DAY, DEFAULT_BILLING_SETTINGS.plans)).toMatchObject({ allowance: 6000, plan: { id: "pro" } });
  });

  it("gives what the order sold, even when the operator changed the plan before it was paid", async () => {
    const placed = await orders.createOrder("u1", { kind: "plan", planId: "pro" });
    expect(orderByCode(placed.order.code)).toMatchObject({ plan_days: 30, plan_credits_per_window: 6000 });
    fake.settings.set("billing", { plans: { pro: { name: "Pro", priceUsd: 20, creditsPerWindow: 4000, days: 7 } } });
    resetBillingSettings();
    const order = Object.assign(orderByCode(placed.order.code), { network: "bnb", coin: "USDT", pay_address: EVM, expected_units: "2003700000000000000", quoted_at: new Date(), tx_hash: HASH, status: "confirming" });
    await orders.applyOrder(order.id, "system");
    expect(fake.users.get("u1")).toMatchObject({ plan_id: "pro", plan_credits_per_window: 6000 });
    expect(daysFromNow(fake.users.get("u1")!.plan_expires_at!)).toBeCloseTo(30, 3);
  });

  it("adds a top-up to the API balance once, with a ledger entry", async () => {
    fake.users.get("u1")!.api_balance_micros = "1500000";
    const order = paid({ kind: "api", plan_id: null, list_usd: "25.00", discount_percent: 0, price_usd: "25.00", credit_usd: "25.00" });
    await orders.applyOrder(order.id, "system");
    await orders.applyOrder(order.id, "system");
    expect(fake.users.get("u1")!.api_balance_micros).toBe("26500000");
    expect(fake.ledger).toEqual([expect.objectContaining({ user_id: "u1", kind: "topup", amount_micros: "25000000", balance_after_micros: "26500000", order_id: order.id, created_by: null })]);
    expect(order.applied_detail).toEqual({ apiBalanceAddedUsd: 25 });
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });
});

describe("the operator", () => {
  it("approves an order whatever the chain said (once), audited with the operator's id", async () => {
    const order = withDetails({ tx_hash: HASH, status: "review", status_detail: "This transaction sent 1.5 USDT to the Curialy wallet; this order expects exactly 2.0037 USDT." });
    const approved = await orders.approveOrder(order.code, "admin", "Paid the difference by a second transfer");
    expect(approved).toMatchObject({ status: "completed", statusDetail: null, adminNote: "Paid the difference by a second transfer", user: { id: "u1", login: "ada" } });
    expect(fake.events.at(-1)).toMatchObject({ from_status: "review", to_status: "completed", actor: "admin", actor_id: "admin", note: "Paid the difference by a second transfer" });
    await expectError(orders.approveOrder(order.code, "admin", ""), 409, "order_completed");
    expect(fake.creditEvents).toHaveLength(1);
    // The payer sees the order completed, not the operator's note.
    const view = await orders.getOwnOrder("u1", order.code);
    expect(view.events.at(-1)).toMatchObject({ status: "completed", actor: "admin", note: null });
  });

  it("rejects with a reason the payer sees, never a completed order", async () => {
    const order = withDetails({ tx_hash: HASH, status: "review" });
    await expectError(orders.rejectOrder(order.code, "admin", "  "), 400, "note_required");
    const rejected = await orders.rejectOrder(order.code, "admin", "This transaction paid another order's amount.");
    expect(rejected).toMatchObject({ status: "rejected", statusDetail: "This transaction paid another order's amount.", adminNote: "This transaction paid another order's amount." });
    expect((await orders.getOwnOrder("u1", order.code)).statusDetail).toBe("This transaction paid another order's amount.");
    const done = withDetails({ status: "completed", tx_hash: OTHER_HASH, expected_units: "2003800000000000000" });
    await expectError(orders.rejectOrder(done.code, "admin", "no"), 409, "order_completed");
    await expectError(orders.rejectOrder("CUR-ZZZZZZZZ", "admin", "no"), 404, "not_found");
  });

  it("can keep a rejection reason off the payer's page", async () => {
    const order = withDetails({ tx_hash: HASH, status: "review" });
    const rejected = await orders.rejectOrder(order.code, "admin", "The hash is a known fake.", false);
    expect(rejected).toMatchObject({ status: "rejected", statusDetail: "This payment was rejected.", adminNote: "The hash is a known fake." });
    expect((await orders.getOwnOrder("u1", order.code)).statusDetail).toBe("This payment was rejected.");
  });

  it("disapproves a completed payment, undoes the plan it started, and can apply it again", async () => {
    const order = withDetails({ tx_hash: HASH, status: "review" });
    await orders.approveOrder(order.code, "admin", "");
    expect(fake.users.get("u1")!.plan_id).toBe("pro");
    await expectError(orders.disapproveOrder(order.code, "admin", "  "), 400, "note_required");
    const undone = await orders.disapproveOrder(order.code, "admin", "The transaction was not a real payment.");
    expect(undone.undo).toBe("removed");
    expect(undone.order).toMatchObject({ status: "rejected", statusDetail: "The transaction was not a real payment.", adminNote: "The transaction was not a real payment.", applied: null });
    expect(fake.users.get("u1")).toMatchObject({ plan_id: null, plan_expires_at: null, plan_credits_per_window: null });
    expect((await orders.getOwnOrder("u1", order.code)).statusDetail).toBe("The transaction was not a real payment.");
    expect(fake.creditEvents.at(-1)?.detail).toContain("removed");
    // A mistaken disapproval can be approved again: the payment is applied once more.
    const again = await orders.approveOrder(order.code, "admin", "It was real after all");
    expect(again.status).toBe("completed");
    expect(fake.users.get("u1")!.plan_id).toBe("pro");
  });

  it("shortens a plan this payment extended, and leaves a plan that was changed afterwards", async () => {
    const first = withDetails({ tx_hash: HASH, status: "review" });
    await orders.approveOrder(first.code, "admin", "");
    const second = withDetails({ tx_hash: OTHER_HASH, status: "review", expected_units: "2003800000000000000" });
    await orders.approveOrder(second.code, "admin", "");
    const extended = fake.users.get("u1")!.plan_expires_at!.getTime();
    const shortened = await orders.disapproveOrder(second.code, "admin", "The second payment was fake.");
    expect(shortened.undo).toBe("shortened");
    expect(fake.users.get("u1")!.plan_id).toBe("pro");
    expect(extended - fake.users.get("u1")!.plan_expires_at!.getTime()).toBe(30 * DAY);
    // A later change to the plan (a different expiry) is not wiped by disapproving the older payment.
    const later = new Date(Date.now() + 200 * DAY);
    fake.users.get("u1")!.plan_expires_at = later;
    const left = await orders.disapproveOrder(first.code, "admin", "This one was fake too.");
    expect(left.undo).toBe("unchanged");
    expect(fake.users.get("u1")!.plan_id).toBe("pro");
    expect(fake.users.get("u1")!.plan_expires_at).toBe(later);
  });

  it("takes back only the plan a disapproved payment started, leaving the plan running alongside it", async () => {
    const pro = withDetails({ tx_hash: HASH, status: "review" });
    await orders.approveOrder(pro.code, "admin", "");
    const max = withDetails({ plan_id: "max", list_usd: "80.00", price_usd: "8.00", tx_hash: OTHER_HASH, status: "review", expected_units: "8003700000000000000" });
    await orders.approveOrder(max.code, "admin", "");
    const user = fake.users.get("u1")!;
    const proEnd = user.pro_expires_at!.getTime();
    expect(user).toMatchObject({ plan_id: "max", max_credits_per_window: 30000 });
    const undone = await orders.disapproveOrder(max.code, "admin", "Chargeback");
    expect(undone.undo).toBe("removed");
    expect(user).toMatchObject({ max_expires_at: null, max_credits_per_window: null, plan_id: "pro", plan_credits_per_window: 6000 });
    expect(user.pro_expires_at!.getTime()).toBe(proEnd);
    expect(fake.creditEvents.at(-1)!.detail).toBe(`Max plan removed: order ${max.code} was disapproved`);
  });

  it("shortens a plan by every month a disapproved order paid for", async () => {
    Object.assign(fake.users.get("u1")!, { pro_expires_at: new Date(Date.now() + 10 * DAY), pro_credits_per_window: 6000, plan_id: "pro", plan_expires_at: new Date(Date.now() + 10 * DAY) });
    // Three months as sold: plan_days is all 90 of them.
    const order = withDetails({ tx_hash: HASH, status: "review", plan_days: 90, plan_months: 3, list_usd: "60.00", price_usd: "6.00" });
    await orders.approveOrder(order.code, "admin", "");
    expect((fake.users.get("u1")!.pro_expires_at!.getTime() - Date.now()) / DAY).toBeCloseTo(100, 3);
    expect((await orders.disapproveOrder(order.code, "admin", "Fake")).undo).toBe("shortened");
    expect((fake.users.get("u1")!.pro_expires_at!.getTime() - Date.now()) / DAY).toBeCloseTo(10, 3);
  });

  it("removes API balance a disapproved top-up added, and not below zero", async () => {
    const order = withDetails({ kind: "api", plan_id: null, list_usd: "25.00", discount_percent: 0, price_usd: "25.00", credit_usd: "25.00", tx_hash: HASH, status: "review" });
    await orders.approveOrder(order.code, "admin", "");
    fake.users.get("u1")!.api_balance_micros = "5000000";
    const undone = await orders.disapproveOrder(order.code, "admin", "Not a payment for this account.", false);
    expect(undone.undo).toBe("balance");
    expect(undone.order.statusDetail).toBe("This payment was disapproved.");
    expect(undone.order.adminNote).toBe("Not a payment for this account.");
    expect((await orders.getOwnOrder("u1", order.code)).statusDetail).toBe("This payment was disapproved.");
    expect(fake.users.get("u1")!.api_balance_micros).toBe("0");
    expect(fake.ledger.at(-1)).toMatchObject({ kind: "adjust", amount_micros: "-5000000", balance_after_micros: "0", note: `disapproved order ${order.code}` });
    await expectError(orders.disapproveOrder(order.code, "admin", "again"), 409, "not_completed");
  });

  it("rechecks an order on demand, and not a completed one or one without a hash", async () => {
    const order = withDetails({ tx_hash: HASH, status: "review", status_detail: "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.", next_check_at: null });
    chain.results.push({ state: "confirming", confirmations: 3, required: 20, from: "0xabc", receivedUnits: 2_003_700_000_000_000_000n, blockTime: new Date() });
    const checked = await orders.recheckOrder(order.code, "admin");
    expect(checked).toMatchObject({ status: "confirming", statusDetail: "3 of 20 confirmations", confirmations: 3, requiredConfirmations: 20, txFrom: "0xabc", receivedAmount: "2.0037" });
    expect(fake.events.at(-1)).toMatchObject({ from_status: "review", to_status: "confirming", actor: "admin", actor_id: "admin" });
    // The operator asked: no alert for what they are looking at.
    expect(alerts).toEqual([]);
    await expectError(orders.recheckOrder(withDetails({ expected_units: "2003800000000000000" }).code, "admin"), 409, "no_hash");
    await expectError(orders.recheckOrder(withDetails({ status: "completed", tx_hash: OTHER_HASH, expected_units: "2003900000000000000" }).code, "admin"), 409, "order_completed");
  });

  it("gives, extends and ends plans, keeping the note out of the account's own history", async () => {
    await orders.grantPlan("u1", "pro", 10, "Thanks for the bug report", "admin");
    const user = fake.users.get("u1")!;
    expect(user).toMatchObject({ plan_id: "pro", plan_credits_per_window: 6000 });
    expect((user.plan_expires_at!.getTime() - Date.now()) / DAY).toBeCloseTo(10, 3);
    expect(fake.creditEvents.at(-1)).toMatchObject({ kind: "plan", created_by: "admin", detail: expect.stringMatching(/^Pro plan until .* \(given by the operator\) · note: Thanks for the bug report$/) });
    // Max for 30 days on top of 10 Pro days: like a purchase, Max runs alongside and Pro keeps its days.
    await orders.grantPlan("u1", "max", 30, "", "admin");
    expect(user.plan_id).toBe("max");
    expect((user.max_expires_at!.getTime() - Date.now()) / DAY).toBeCloseTo(30, 3);
    expect((user.pro_expires_at!.getTime() - Date.now()) / DAY).toBeCloseTo(10, 3);
    expect(fake.creditEvents.at(-1)!.detail).toMatch(/^Max plan until .*, alongside Pro until .* \(given by the operator\)$/);
    await expectError(orders.grantPlan("u1", "pro", 0, "", "admin"), 400, "invalid_days");
    await expectError(orders.grantPlan("nobody", "pro", 5, "", "admin"), 404, "not_found");
    // Ending one plan leaves the other running.
    await orders.endPlan("u1", "", "admin", "pro");
    expect(user).toMatchObject({ pro_expires_at: null, plan_id: "max" });
    expect(fake.creditEvents.at(-1)!.detail).toBe("Pro plan ended by the operator");
    await expectError(orders.endPlan("u1", "", "admin", "pro"), 409, "no_plan");
    await orders.endPlan("u1", "Refunded", "admin");
    expect(user).toMatchObject({ max_expires_at: null, plan_id: null, plan_expires_at: null });
    expect(fake.creditEvents.at(-1)!.detail).toBe("Max plan ended by the operator · note: Refunded");
    await expectError(orders.endPlan("u1", "", "admin"), 409, "no_plan");
  });

  it("adjusts an API balance, never below zero, and records what was actually applied", async () => {
    await orders.adjustApiBalance("u1", 5, "Welcome credit", "admin");
    expect(fake.users.get("u1")!.api_balance_micros).toBe("5000000");
    await orders.adjustApiBalance("u1", -12.5, "Chargeback", "admin");
    expect(fake.users.get("u1")!.api_balance_micros).toBe("0");
    expect(fake.ledger.map(entry => [entry.kind, entry.amount_micros, entry.balance_after_micros, entry.note, entry.created_by])).toEqual([
      ["grant", "5000000", "5000000", "Welcome credit", "admin"], ["adjust", "-5000000", "0", "Chargeback", "admin"],
    ]);
    for (const amount of [0, 10_000.01, Number.NaN, 0.0000001]) await expectError(orders.adjustApiBalance("u1", amount, "", "admin"), 400, "invalid_amount");
    const billing = await orders.accountBilling("u1");
    expect(billing.ledger.map(entry => [entry.kind, entry.amountUsd, entry.balanceAfterUsd])).toEqual([["adjust", -5, 0], ["grant", 5, 5]]);
  });

  it("lists orders needing attention and finds one by code, login or hash", async () => {
    withDetails({ tx_hash: HASH, status: "review" });
    withDetails({ user_id: "u2", status: "completed", tx_hash: OTHER_HASH, expected_units: "2003800000000000000", completed_at: new Date() });
    addOrder({ user_id: "u2" });
    expect((await orders.listAdminOrders({ status: "attention", q: "", offset: 0 })).orders.map(order => order.status)).toEqual(["review"]);
    expect((await orders.listAdminOrders({ status: "all", q: "grace", offset: 0 })).orders).toHaveLength(2);
    expect((await orders.listAdminOrders({ status: "all", q: OTHER_HASH.slice(0, 12), offset: 0 })).orders.map(order => order.status)).toEqual(["completed"]);
    for (let i = 0; i < 50; i++) addOrder({ user_id: "u1" });
    expect(await orders.listAdminOrders({ status: "awaiting_payment", q: "", offset: 0 })).toMatchObject({ more: true });
    const overview = await orders.billingOverview();
    expect(overview.counts).toEqual({ awaiting_payment: 51, pending: 0, confirming: 0, review: 1, completed: 1, rejected: 0, expired: 0 });
    expect(overview.revenue).toEqual({ last7dUsd: 2, last30dUsd: 2, totalUsd: 2 });
    expect(overview.wallets).toEqual({ evm: EVM, solana: SOLANA, ton: null });
  });
});

describe("review fixes", () => {
  it("counts every order still in progress toward the cap, however it got there", async () => {
    // Five orders moved on by pasted hashes still hold their amounts: a sixth is refused.
    for (let index = 0; index < MAX_OPEN; index++) withDetails({ status: index % 2 ? "pending" : "review", tx_hash: `0x${String(index).repeat(64).slice(0, 64)}`, expected_units: `20037${index}0000000000000` });
    await expectError(orders.createOrder("u1", { kind: "plan", planId: "pro" }), 409, "too_many_orders");
    // A finished one frees its place.
    fake.orders[0].status = "rejected";
    expect((await orders.createOrder("u1", { kind: "plan", planId: "pro" })).created).toBe(true);
  });

  it("won't let a late hash bring an expired order back past the cap", async () => {
    for (let index = 0; index < MAX_OPEN; index++) withDetails({ status: "review", tx_hash: `0x${String(index + 1).repeat(64).slice(0, 64)}`, expected_units: `20038${index}0000000000000` });
    const late = withDetails({ status: "expired", expires_at: new Date(Date.now() - 3_600_000), expected_units: "2003900000000000000" });
    await expectError(orders.submitHash("u1", late.code, HASH), 409, "too_many_orders");
    expect(late.tx_hash).toBeNull();
  });

  it("refuses to approve a transaction that sent exactly what another unpaid order expects", async () => {
    // The real payer's order (no hash pasted yet) and the order someone pasted its hash into.
    const rightful = withDetails({ user_id: "u2", expected_units: "25004100000000000000", quoted_at: new Date(Date.now() - 10 * 60_000) });
    const squatter = withDetails({ tx_hash: HASH, status: "review", expected_units: "25008700000000000000", received_units: "25004100000000000000", tx_block_time: new Date(Date.now() - 5 * 60_000) });
    const error = await orders.approveOrder(squatter.code, "admin", "").catch(caught => caught);
    expect(error).toMatchObject({ status: 409, code: "belongs_elsewhere" });
    expect(error.message).toContain(rightful.code);
    expect(squatter.status).toBe("review");
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });

  it("lets a verified order waiting for the operator keep its transaction", async () => {
    withDetails({ user_id: "u2", tx_hash: HASH, status: "review", chain_verified_at: new Date() });
    const order = withDetails({ expected_units: "2003800000000000000" });
    await expectError(orders.submitHash("u1", order.code, HASH), 409, "hash_used");
    const squatted = withDetails({ tx_hash: HASH, status: "review", expected_units: "2003900000000000000" });
    await expectError(orders.approveOrder(squatted.code, "admin", ""), 409, "hash_used");
  });

  it("never lowers a paid allowance when the operator gives days of the same plan", async () => {
    Object.assign(fake.users.get("u1")!, { plan_id: "max", plan_expires_at: new Date(Date.now() + 19 * DAY), plan_credits_per_window: 30_000 });
    fake.settings.set("billing", { plans: { max: { name: "Max", priceUsd: 80, creditsPerWindow: 20_000, days: 30 } } });
    resetBillingSettings();
    await orders.grantPlan("u1", "max", 7, "thanks", "admin");
    expect(fake.users.get("u1")).toMatchObject({ plan_id: "max", plan_credits_per_window: 30_000, max_credits_per_window: 30_000 });
    // Pro given alongside doesn't touch Max's allowance.
    await orders.grantPlan("u1", "pro", 7, "thanks", "admin");
    expect(fake.users.get("u1")).toMatchObject({ plan_id: "max", plan_credits_per_window: 30_000, max_credits_per_window: 30_000, pro_credits_per_window: 6000 });
  });

  it("drops a forced check's answer when the operator rejected the order while it was asked", async () => {
    const order = withDetails({ tx_hash: HASH, status: "review", submitted_at: new Date() });
    chain.results.push({ state: "confirmed", confirmations: 25, required: 20, from: "0xpayer", receivedUnits: 2_003_700_000_000_000_000n, blockTime: new Date() });
    const checking = orders.recheckOrder(order.code, "admin");
    await orders.rejectOrder(order.code, "admin", "Chargeback on the exchange");
    await checking;
    expect(order.status).toBe("rejected");
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });
});

describe("paying ahead", () => {
  it("prices several months at today's offer, each one a period, and names it by its months", async () => {
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro", months: 3 });
    expect(order).toMatchObject({ title: "Pro · 3 months", listUsd: 60, discountPercent: 90, priceUsd: 6, planDays: 90, planMonths: 3, planCreditsPerWindow: 6000 });
    // One month is the plain order it always was.
    const single = await orders.createOrder("u1", { kind: "plan", planId: "max" });
    expect(single.order).toMatchObject({ title: "Max · 30 days", listUsd: 80, priceUsd: 8, planDays: 30, planMonths: 1 });
    for (const months of [0, 7, 1.5]) await expectError(orders.createOrder("u1", { kind: "plan", planId: "pro", months }), 400, "invalid_months");
  });

  it("keeps a plan from running more than six months ahead, counting orders not paid yet", async () => {
    Object.assign(fake.users.get("u1")!, { plan_id: "pro", plan_expires_at: new Date(Date.now() + 120 * DAY), plan_credits_per_window: 6000 });
    // 120 days left: two more months fit (180), three don't.
    await expectError(orders.createOrder("u1", { kind: "plan", planId: "pro", months: 3 }), 409, "prepay_limit");
    await orders.createOrder("u1", { kind: "plan", planId: "pro", months: 2 });
    // That order counts while it waits for payment: nothing more fits now.
    const error = await orders.createOrder("u1", { kind: "plan", planId: "pro", months: 1 }).catch(caught => caught);
    expect(error).toMatchObject({ status: 409, code: "prepay_limit" });
    expect(error.message).toMatch(/already paid 6 months ahead/);
    expect(await orders.prepayLimits("u1")).toEqual({ pro: 0, max: expect.any(Number) });
  });

  it("gives each plan its own six months: Pro paid ahead doesn't stop Max", async () => {
    Object.assign(fake.users.get("u1")!, { pro_expires_at: new Date(Date.now() + 175 * DAY), pro_credits_per_window: 6000 });
    await expectError(orders.createOrder("u1", { kind: "plan", planId: "pro" }), 409, "prepay_limit");
    expect(await orders.prepayLimits("u1")).toEqual({ pro: 0, max: 6 });
    expect((await orders.createOrder("u1", { kind: "plan", planId: "max", months: 6 })).created).toBe(true);
    expect(await orders.prepayLimits("u1")).toEqual({ pro: 0, max: 0 });
  });

  it("applies every month it paid for", async () => {
    const { order } = await orders.createOrder("u1", { kind: "plan", planId: "pro", months: 4 });
    const row = Object.assign(orderByCode(order.code), { network: "bnb", coin: "USDT", pay_address: EVM, expected_units: "8003700000000000000", quoted_at: new Date(), tx_hash: HASH, status: "confirming" });
    await orders.applyOrder(row.id, "system");
    const user = fake.users.get("u1")!;
    expect(user).toMatchObject({ plan_id: "pro", plan_credits_per_window: 6000 });
    expect((user.plan_expires_at!.getTime() - Date.now()) / DAY).toBeCloseTo(120, 3);
  });
});

describe("expiry", () => {
  it("expires orders awaiting payment past their window, with an event, and nothing else", async () => {
    const stale = addOrder({ user_id: "u1", expires_at: new Date(Date.now() - 1000) });
    const fresh = addOrder({ user_id: "u1" });
    const pending = withDetails({ status: "pending", tx_hash: HASH, expires_at: new Date(Date.now() - 1000) });
    expect(await orders.expireOrders()).toBe(1);
    expect([stale.status, fresh.status, pending.status]).toEqual(["expired", "awaiting_payment", "pending"]);
    expect(fake.events).toEqual([expect.objectContaining({ order_id: stale.id, from_status: "awaiting_payment", to_status: "expired", actor: "system", note: "Expired without a payment" })]);
  });
});

describe("TON payments", () => {
  const TON = "UQDxb2OlXXDbw-I1_SlBJZ0irOUN9qD3tsM_bVWy4-Xgm9QZ";
  /** What the payer pasted (the transfer's first transaction), and the transaction that received each payment. */
  const PASTED = "11".repeat(32);
  const MINE = "22".repeat(32);
  const tonOrder = (patch: Record<string, unknown> = {}) => withDetails({
    network: "ton", coin: "USDT", pay_address: TON, expected_amount: "2.0037", expected_units: "2003700", tx_hash: PASTED, status: "pending", submitted_at: new Date(), next_check_at: new Date(0), ...patch,
  });
  const received = (txHash: string, units = 2_003_700n) => ({ state: "confirmed", confirmations: 1, required: 1, from: "0:payer", receivedUnits: units, blockTime: new Date(), txHash });

  beforeAll(() => vi.stubEnv("PAY_TON_ADDRESS", TON));

  it("keeps the transaction that received the payment, whichever hash of the transfer was pasted", async () => {
    const order = tonOrder();
    chain.results.push(received(MINE), received(MINE));
    await orders.runCheck(order.id);
    expect(chain.calls.map(call => call.txHash)).toEqual([PASTED, PASTED]);
    expect(order).toMatchObject({ status: "completed", tx_hash: MINE, received_units: "2003700" });
    expect(fake.events.find(event => event.order_id === order.id && event.note?.startsWith("Transaction hash set"))?.note).toBe("Transaction hash set to the transaction that received the payment (was 1111111111…111111)");
    expect(fake.users.get("u1")!.plan_id).not.toBeNull();
  });

  it("won't let a second order take that payment by another of its hashes", async () => {
    tonOrder({ user_id: "u2", tx_hash: MINE, status: "completed" });
    const second = tonOrder({ expected_units: "2003800", tx_hash: "33".repeat(32) });
    chain.results.push(received(MINE, 2_003_800n), received(MINE, 2_003_800n));
    await orders.runCheck(second.id);
    expect(second).toMatchObject({ status: "review", status_detail: "This transaction already paid another order.", tx_hash: "33".repeat(32) });
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });

  it("sends a payment two providers trace to different transactions to the operator", async () => {
    const order = tonOrder();
    chain.results.push(received(MINE), received("44".repeat(32)));
    await orders.runCheck(order.id);
    expect(order).toMatchObject({ status: "review", status_detail: "Two network providers disagree about this transaction, so it is checked by hand." });
    expect(fake.users.get("u1")!.plan_id).toBeNull();
  });
});
