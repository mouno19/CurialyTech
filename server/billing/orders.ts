import { randomBytes, randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import {
  API_TOPUP, coinOn, discountedUsd, discountPercent, explorerTxUrl, isPlanId, LATE_SUBMIT_HOURS, MAX_OPEN_ORDERS, MAX_PLAN_MONTHS, MICROS_PER_USD, networkInfo, normalizeOrderCode,
  normalizeTxHash, ORDER_TTL_MINUTES, PAYMENT_STATUS, planAfterPurchase, prepayableMonths, usdToMicros,
  type AdminAccountBilling, type AdminBillingOverview, type AdminPaymentOrder, type AdminWalletBalances, type CoinId, type CoinKind, type NetworkId, type PaymentEvent, type PaymentOrder,
  type PaymentStatus, type PlanConfig, type PlanEffect, type PlanId, type PlanState,
} from "@shared/billing";
import { activePlan, PLAN_NOTE_MARK } from "../credits";
import { db, query } from "../db/pg";
import { formatUnits, incomingPayments, verifyPayment, walletHoldings, type ChainCheck, type InboundPayment, type PaymentToVerify } from "./chains";
import { alertsConfigured, notifyOrder } from "./notify";
import { quoteUsd, type NativeCoin } from "./prices";
import { BillingError, getBillingSettings, offeredNetworks, walletConfig, walletFor } from "./settings";

// Orders paid in crypto, the CurialyTeam flow: an order (a plan or an API top-up, priced here, never
// by the client) → a network and coin → an exact amount to a fixed wallet → the payer's transaction
// hash → an on-chain check → applied. Each status change is made under a row lock and appended to
// payment_events; alerts go out once the change is committed.

type OrderRow = {
  id: string; code: string; user_id: string; kind: "plan" | "api"; plan_id: PlanId | null;
  /** A plan's days and allowance as sold (the operator may change the plan before the payment arrives), and how many periods it pays for. */
  plan_days: number | null; plan_credits_per_window: number | null; plan_months: number | null;
  list_usd: string; discount_percent: number; price_usd: string; credit_usd: string | null;
  network: NetworkId | null; coin: CoinId | null; pay_address: string | null;
  expected_amount: string | null; expected_units: string | null; quote_usd_price: string | null; quoted_at: Date | null;
  tx_hash: string | null; status: PaymentStatus; status_detail: string | null; confirmations: number | null; required_confirmations: number | null;
  tx_from: string | null; tx_block_time: Date | null; received_units: string | null; chain_verified_at: Date | null;
  check_count: number; next_check_at: Date | null; last_checked_at: Date | null; admin_note: string | null;
  expires_at: Date; submitted_at: Date | null; completed_at: Date | null; applied_at: Date | null; applied_detail: PaymentOrder["applied"];
  created_at: Date; updated_at: Date;
  /** Joined from the account (views only). */
  user_login?: string | null; user_name?: string;
};
type EventRow = { to_status: PaymentStatus; actor: PaymentEvent["actor"]; note: string | null; created_at: Date };
type UserRow = { id: string; plan_id: string | null; plan_expires_at: Date | null; plan_credits_per_window: number | null; api_balance_micros: string };
type Actor = { actor: PaymentEvent["actor"]; actorId: string | null };

const MINUTE = 60_000;
/** A submitted transaction that can't be found (or checked) for this long goes to the operator. */
const FIND_WINDOW_MS = 30 * MINUTE;
/** An order confirming for longer than this goes to the operator. */
const CONFIRM_WINDOW_MS = 60 * MINUTE;
/** A block may be stamped a little before the details were issued (clocks differ), and land a little after the window. */
const BEFORE_MARGIN_MS = 5 * MINUTE;
const AFTER_MARGIN_MS = 15 * MINUTE;
/** Native coins are quoted to this many decimals; the last digits make the amount the order's own. */
const QUOTE_DECIMALS: Record<NativeCoin, number> = { ETH: 7, BNB: 7, POL: 3, SOL: 6 };
const STILL_OPEN = "'awaiting_payment', 'pending', 'confirming', 'review'";

const notFound = () => new BillingError("No order with that code on this account.", "not_found", 404);
const tooManyOrders = () => conflict(`You already have ${MAX_OPEN_ORDERS} orders in progress. Pay or finish one, or wait for it to expire, before starting another.`, "too_many_orders");

/**
 * An account's orders still in progress: waiting for payment, being checked or waiting for the
 * operator. Each holds an exact amount, so they count however they got there (a pasted hash moves
 * an order on, it doesn't free a place).
 */
async function ordersInProgress(client: PoolClient, userId: string) {
  const { rows: [row] } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM curialy.payment_orders WHERE user_id = $1 AND (status IN ('pending', 'confirming', 'review') OR (status = 'awaiting_payment' AND expires_at > now()))",
    [userId],
  );
  return row.n;
}
const conflict = (message: string, code: string) => new BillingError(message, code, 409);

// ---- Money ----

/** Whole cents of a numeric(12,2) value ("2.00" → 200). */
const centsOf = (value: string | number) => Math.round(Number(value) * 100);
const usdText = (cents: number) => (cents / 100).toFixed(2);
const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/**
 * The exact amount an order pays, in the coin's smallest unit, unique among `taken` (the amounts of
 * other orders on the same network and coin): a transaction only pays the order that expects its
 * exact amount, so no two orders may expect the same one.
 * - Stablecoins: the price plus k × 0.0001 (k from 1 to 99: never the round price); when those are
 *   all taken, plus k × 0.000001 (k from 1 to 9999, not a multiple of 100).
 * - Native coins: ceil(price / quote) at the coin's quote decimals, plus k from 1 to 99 (then 100 to 999).
 * Null when every amount is taken.
 */
export function allocateUnits(
  coin: { coin: CoinId; kind: CoinKind; decimals: number }, priceCents: number, quoteUsd: number | null, taken: Set<string>, pick: (count: number) => number = randomInt,
): bigint | null {
  const free = (base: bigint, step: bigint, ks: number[]) => ks.filter(k => !taken.has((base + BigInt(k) * step).toString()));
  const choose = (base: bigint, step: bigint, ks: number[]) => (ks.length ? base + BigInt(ks[pick(ks.length)]) * step : null);
  if (coin.kind === "stablecoin") {
    // One token per dollar: cents at the token's decimals.
    const base = BigInt(priceCents) * 10n ** BigInt(coin.decimals - 2);
    const tenThousandth = 10n ** BigInt(coin.decimals - 4);
    const first = free(base, tenThousandth, range(1, 99));
    if (first.length) return choose(base, tenThousandth, first);
    const millionth = 10n ** BigInt(coin.decimals - 6);
    return choose(base, millionth, free(base, millionth, range(1, 9999).filter(k => k % 100 !== 0)));
  }
  if (quoteUsd === null || !(quoteUsd > 0)) return null;
  const decimals = QUOTE_DECIMALS[coin.coin as NativeCoin];
  if (decimals === undefined) return null;
  // ceil(cents / 100 / quote × 10^decimals), with the quote as an integer of 10^-8 dollars.
  const quote = BigInt(Math.round(quoteUsd * 1e8));
  const numerator = BigInt(priceCents) * 10n ** BigInt(6 + decimals);
  const base = (numerator + quote - 1n) / quote;
  const scale = 10n ** BigInt(coin.decimals - decimals);
  const scaled = (k: number) => ((base + BigInt(k)) * scale).toString();
  for (const ks of [range(1, 99), range(100, 999)]) {
    const open = ks.filter(k => !taken.has(scaled(k)));
    if (open.length) return (base + BigInt(open[pick(open.length)])) * scale;
  }
  return null;
}

// ---- Codes ----

// Crockford base32 (no I, L, O or U): a code read off a screen or a receipt can't be mistyped into another one.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const newOrderCode = () => `CUR-${Array.from(randomBytes(8), byte => CROCKFORD[byte & 31]).join("")}`;

// ---- Reading orders ----

const ORDER_SELECT = "SELECT o.*, u.login AS user_login, u.display_name AS user_name FROM curialy.payment_orders o JOIN curialy.users u ON u.id = o.user_id";

/** An order by its code; with `userId`, only that account's (someone else's is not found, like an unknown code). */
async function findOrder(code: string, userId?: string): Promise<OrderRow | null> {
  const normalized = normalizeOrderCode(code);
  if (!normalized) return null;
  const { rows } = await query<OrderRow>(`${ORDER_SELECT} WHERE o.code = $1${userId ? " AND o.user_id = $2" : ""}`, userId ? [normalized, userId] : [normalized]);
  return rows[0] ?? null;
}

async function orderById(id: string): Promise<OrderRow> {
  const { rows: [row] } = await query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!row) throw new Error("Order not found.");
  return row;
}

async function eventsOf(orderId: string) {
  const { rows } = await query<EventRow>("SELECT to_status, actor, note, created_at FROM curialy.payment_events WHERE order_id = $1 ORDER BY id", [orderId]);
  return rows;
}

// ---- Views ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "9 Dec 2026" (UTC). */
const dayOf = (iso: string) => {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

function titleOf(row: OrderRow, plans: Record<PlanId, PlanConfig>) {
  if (row.kind === "api") return `API balance · $${dollars(centsOf(row.credit_usd ?? row.list_usd))}`;
  const plan = row.plan_id ? plans[row.plan_id] : null;
  if (!plan) return "Plan";
  if ((row.plan_months ?? 1) > 1) return `${plan.name} · ${row.plan_months} months`;
  const days = row.plan_days ?? plan.days;
  return `${plan.name} · ${days} day${days === 1 ? "" : "s"}`;
}

const unitsText = (row: OrderRow, units: string | null) => {
  const coin = coinOn(row.network, row.coin);
  return coin && units !== null ? formatUnits(BigInt(units), coin.decimals) : null;
};

/** Until when a hash is still taken: a day past the payment window (a payer who sent it at the last minute can still paste it). */
function submitUntil(row: OrderRow, now = Date.now()) {
  if (!row.network) return null;
  if (row.status !== "awaiting_payment" && row.status !== "expired" && row.status !== "pending" && row.status !== "review") return null;
  const until = row.expires_at.getTime() + LATE_SUBMIT_HOURS * 3_600_000;
  return until > now ? new Date(until).toISOString() : null;
}

/** The payer's view. Like credit history, the account's own view leaves out the operator's notes. */
export function toOrderView(row: OrderRow, events: EventRow[], plans: Record<PlanId, PlanConfig>, forAdmin = false): PaymentOrder {
  return {
    code: row.code, kind: row.kind, planId: row.plan_id, planDays: row.plan_days, planCreditsPerWindow: row.plan_credits_per_window,
    planMonths: row.kind === "plan" ? row.plan_months ?? 1 : null, title: titleOf(row, plans),
    listUsd: Number(row.list_usd), discountPercent: row.discount_percent, priceUsd: Number(row.price_usd), creditUsd: row.credit_usd === null ? null : Number(row.credit_usd),
    network: row.network, coin: row.coin, payAddress: row.pay_address, expectedAmount: unitsText(row, row.expected_units),
    quoteUsdPrice: row.quote_usd_price === null ? null : Number(row.quote_usd_price), txHash: row.tx_hash, receivedAmount: unitsText(row, row.received_units),
    status: row.status, statusDetail: row.status_detail, confirmations: row.confirmations, requiredConfirmations: row.required_confirmations,
    createdAt: row.created_at.toISOString(), quotedAt: row.quoted_at?.toISOString() ?? null, expiresAt: row.expires_at.toISOString(), submitUntil: submitUntil(row),
    submittedAt: row.submitted_at?.toISOString() ?? null, completedAt: row.completed_at?.toISOString() ?? null, applied: row.applied_detail ?? null,
    explorerUrl: explorerTxUrl(row.network, row.tx_hash),
    events: events.map(event => ({ status: event.to_status, actor: event.actor, note: forAdmin || event.actor !== "admin" ? event.note : null, at: event.created_at.toISOString() })),
  };
}

export function toAdminOrderView(row: OrderRow, events: EventRow[], plans: Record<PlanId, PlanConfig>): AdminPaymentOrder {
  return {
    ...toOrderView(row, events, plans, true),
    user: { id: row.user_id, login: row.user_login ?? null, name: row.user_name ?? "" },
    adminNote: row.admin_note, txFrom: row.tx_from, txBlockTime: row.tx_block_time?.toISOString() ?? null,
    checkCount: row.check_count, lastCheckedAt: row.last_checked_at?.toISOString() ?? null, chainVerifiedAt: row.chain_verified_at?.toISOString() ?? null,
  };
}

async function customerView(id: string) {
  const [row, settings] = await Promise.all([orderById(id), getBillingSettings()]);
  return toOrderView(row, await eventsOf(id), settings.plans);
}

async function adminView(id: string) {
  const [row, settings] = await Promise.all([orderById(id), getBillingSettings()]);
  return toAdminOrderView(row, await eventsOf(id), settings.plans);
}

// ---- Writing ----

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockOrder(client: PoolClient, id: string): Promise<OrderRow | null> {
  const { rows } = await client.query<OrderRow>("SELECT * FROM curialy.payment_orders WHERE id = $1 FOR UPDATE", [id]);
  return rows[0] ?? null;
}

async function lockUser(client: PoolClient, id: string): Promise<UserRow> {
  const { rows: [user] } = await client.query<UserRow>("SELECT id, plan_id, plan_expires_at, plan_credits_per_window, api_balance_micros FROM curialy.users WHERE id = $1 FOR UPDATE", [id]);
  if (!user) throw new BillingError("Account not found.", "not_found", 404);
  return user;
}

const addEvent = (client: PoolClient, orderId: string, from: PaymentStatus | null, to: PaymentStatus, by: Actor, note: string | null) =>
  client.query("INSERT INTO curialy.payment_events (order_id, from_status, to_status, actor, actor_id, note) VALUES ($1, $2, $3, $4, $5, $6)", [orderId, from, to, by.actor, by.actorId, note]);

// ---- Placing an order ----

/** months: how many periods of the plan it pays for at once (1 when left out). */
export type NewOrder = { kind: "plan"; planId: PlanId; months?: number } | { kind: "api"; amountUsd: number };

/**
 * A new order, priced here: a plan at its price less the plan discount, a top-up at face value. A
 * double click gets the same order back (same item, no payment details yet, under 30 minutes old).
 */
export async function createOrder(userId: string, input: NewOrder): Promise<{ order: PaymentOrder; created: boolean }> {
  const settings = await getBillingSettings();
  if (!settings.paymentsOpen || offeredNetworks().length === 0) throw new BillingError("New payments are paused right now. Try again later.", "payments_closed", 503);
  let listCents: number;
  let percent = 0;
  let creditCents: number | null = null;
  const months = input.kind === "plan" ? input.months ?? 1 : null;
  if (input.kind === "plan") {
    if (!isPlanId(input.planId)) throw new BillingError("Choose Pro or Max.", "invalid_plan", 400);
    if (!Number.isInteger(months) || months! < 1 || months! > MAX_PLAN_MONTHS) throw new BillingError(`Choose from 1 to ${MAX_PLAN_MONTHS} months.`, "invalid_months", 400);
    // Paying ahead: each period at today's price and today's offer.
    listCents = centsOf(settings.plans[input.planId].priceUsd) * months!;
    percent = discountPercent(settings.discount, "plans");
  } else {
    if (!Number.isInteger(input.amountUsd) || input.amountUsd < API_TOPUP.minUsd || input.amountUsd > API_TOPUP.maxUsd) {
      throw new BillingError(`A top-up is a whole number of dollars from $${API_TOPUP.minUsd} to $${API_TOPUP.maxUsd.toLocaleString("en-US")}.`, "invalid_amount", 400);
    }
    // $1 paid is $1 of balance: top-ups are never discounted.
    listCents = input.amountUsd * 100;
    creditCents = listCents;
  }
  const priceCents = centsOf(discountedUsd(listCents / 100, percent));
  const planId = input.kind === "plan" ? input.planId : null;
  // What the plan gives, fixed on the order as it is sold.
  const planDays = planId ? settings.plans[planId].days * months! : null;
  const planCredits = planId ? settings.plans[planId].creditsPerWindow : null;
  const result = await transaction(async client => {
    // An account's orders are placed one at a time (double clicks, two tabs).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`curialy-orders:${userId}`]);
    const { rows: [same] } = await client.query<{ id: string }>(
      `SELECT id FROM curialy.payment_orders WHERE user_id = $1 AND status = 'awaiting_payment' AND network IS NULL AND kind = $2 AND plan_id IS NOT DISTINCT FROM $3
         AND list_usd = $4 AND price_usd = $5 AND plan_days IS NOT DISTINCT FROM $6 AND plan_credits_per_window IS NOT DISTINCT FROM $7
         AND plan_months IS NOT DISTINCT FROM $8 AND created_at > now() - interval '30 minutes' AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [userId, input.kind, planId, usdText(listCents), usdText(priceCents), planDays, planCredits, months],
    );
    if (same) return { id: same.id, created: false };
    if ((await ordersInProgress(client, userId)) >= MAX_OPEN_ORDERS) throw tooManyOrders();
    // A plan runs at most MAX_PLAN_MONTHS periods ahead, its open orders included (checked under this account's lock).
    if (planId) {
      const room = await prepayRoom(client, userId, planId, settings.plans);
      if (months! > room) {
        const name = settings.plans[planId].name;
        throw conflict(room === 0
          ? `Your plan is already paid ${MAX_PLAN_MONTHS} months ahead, counting orders you haven't paid yet. You can add more once it's closer.`
          : `You can pay for up to ${room} more month${room === 1 ? "" : "s"} of ${name} now: a plan runs at most ${MAX_PLAN_MONTHS} months ahead, counting orders you haven't paid yet.`, "prepay_limit");
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      // A code already in use leaves no row: try another.
      const { rows: [row] } = await client.query<{ id: string }>(
        `INSERT INTO curialy.payment_orders (code, user_id, kind, plan_id, list_usd, discount_percent, price_usd, credit_usd, expires_at, plan_days, plan_credits_per_window, plan_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9), $10, $11, $12) ON CONFLICT (code) DO NOTHING RETURNING id`,
        [newOrderCode(), userId, input.kind, planId, usdText(listCents), percent, usdText(priceCents), creditCents === null ? null : usdText(creditCents), ORDER_TTL_MINUTES, planDays, planCredits, months],
      );
      if (!row) continue;
      await addEvent(client, row.id, null, "awaiting_payment", { actor: "customer", actorId: userId }, "Order created");
      return { id: row.id, created: true };
    }
    throw new Error("Could not allocate an order code.");
  });
  return { order: await customerView(result.id), created: result.created };
}

export async function getOwnOrder(userId: string, code: string) {
  const row = await findOrder(code, userId);
  if (!row) throw notFound();
  return toOrderView(row, await eventsOf(row.id), (await getBillingSettings()).plans);
}

/** The account's 50 latest orders (without their events). */
export async function listOwnOrders(userId: string) {
  const [{ rows }, settings] = await Promise.all([query<OrderRow>(`${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [userId]), getBillingSettings()]);
  return rows.map(row => toOrderView(row, [], settings.plans));
}

// ---- Payment details ----

function assertCanIssue(row: OrderRow, now = Date.now()) {
  if (row.status !== "awaiting_payment") throw conflict("This order is no longer waiting for a payment.", "order_closed");
  if (row.expires_at.getTime() <= now) throw conflict("This order has expired. Start a new one.", "order_expired");
}

/**
 * Issues the payment details: the wallet (fixed on the order), a unique exact amount, and for a
 * network's own coin a live quote; all valid for ORDER_TTL_MINUTES. Asking again for the same
 * network and coin returns the order; another one is refused once they are issued.
 */
export async function chooseMethod(userId: string, code: string, networkId: string, coinId: string) {
  const order = await findOrder(code, userId);
  if (!order) throw notFound();
  const network = offeredNetworks().find(entry => entry.id === networkId);
  const coin = network?.coins.find(entry => entry.coin === coinId);
  if (!network || !coin) throw new BillingError("That coin isn't offered on that network.", "method_unavailable", 400);
  const same = (row: OrderRow) => row.network === network.id && row.coin === coin.coin;
  const locked = () => conflict("Payment details were already issued for another network or coin. Start a new order to pay another way.", "details_locked");
  if (order.network) {
    if (same(order)) return customerView(order.id);
    throw locked();
  }
  assertCanIssue(order);
  const wallet = walletFor(network)!;
  // Priced before the transaction: a quote can take seconds, and nothing waits on a lock meanwhile.
  const quote = coin.kind === "native" ? await quoteUsd(coin.coin as NativeCoin) : null;
  if (coin.kind === "native" && quote === null) throw new BillingError(`${coin.coin} can't be priced reliably right now. Pay with USDT or USDC, or try again in a few minutes.`, "no_quote", 503);
  await transaction(async client => {
    const row = await lockOrder(client, order.id);
    if (!row) throw notFound();
    if (row.network) {
      if (same(row)) return;
      throw locked();
    }
    assertCanIssue(row);
    // Amounts on one network and coin are handed out one at a time, so two orders never get the same one.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('curialy-pay:' || $1 || ':' || $2))", [network.id, coin.coin]);
    const { rows: taken } = await client.query<{ units: string }>(
      `SELECT expected_units::text AS units FROM curialy.payment_orders WHERE network = $1 AND coin = $2 AND expected_units IS NOT NULL
         AND (quoted_at > now() - interval '48 hours' OR status IN (${STILL_OPEN}))`,
      [network.id, coin.coin],
    );
    const units = allocateUnits(coin, centsOf(row.price_usd), quote, new Set(taken.map(entry => entry.units)));
    if (units === null) throw new BillingError(`Too many ${coin.coin} payments are open on ${network.label} right now. Choose another coin or network.`, "amounts_busy", 503);
    const amount = formatUnits(units, coin.decimals);
    const quoted = quote === null ? null : quote.toFixed(8);
    await client.query(
      `UPDATE curialy.payment_orders SET network = $2, coin = $3, pay_address = $4, expected_amount = $5, expected_units = $6, quote_usd_price = $7,
         quoted_at = now(), expires_at = now() + make_interval(mins => $8), updated_at = now() WHERE id = $1`,
      [row.id, network.id, coin.coin, wallet, amount, units.toString(), quoted, ORDER_TTL_MINUTES],
    );
    await addEvent(client, row.id, row.status, row.status, { actor: "customer", actorId: userId }, `Payment details issued: exactly ${amount} ${coin.coin} on ${network.label}.`);
  });
  return customerView(order.id);
}

// ---- Transaction hashes ----

function assertCanSubmit(row: OrderRow, now = Date.now()) {
  if (row.status === "confirming") throw conflict("This payment is already confirming on the network.", "already_confirming");
  if (row.status === "completed") throw conflict("This order is already completed.", "order_completed");
  if (row.status === "rejected") throw conflict("This order was rejected.", "order_rejected");
  // Paid just before the details expired: the hash is still taken for a while after.
  if ((row.status === "awaiting_payment" || row.status === "expired") && now >= row.expires_at.getTime() + LATE_SUBMIT_HOURS * 3_600_000) {
    throw conflict(`This order expired more than ${LATE_SUBMIT_HOURS} hours ago. If you paid it, contact support with the transaction hash.`, "order_expired");
  }
}

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === "23505";
const hashUsed = () => conflict("This transaction already paid another order.", "hash_used");

/**
 * Another order this transaction already paid, if any: one it matched (confirming, completed, or
 * verified and waiting for the operator). Only a match takes a transaction: anyone can see payments
 * arrive at the wallet and paste someone else's hash, so a hash on an order whose check didn't
 * match blocks nobody; the exact amounts decide which order a transaction pays, and the unique
 * index on matched orders (payment_orders_paid_tx_idx, the same condition) makes sure it pays one.
 */
async function paidElsewhere(client: PoolClient, row: Pick<OrderRow, "id" | "network">, hash: string) {
  const { rows } = await client.query<{ code: string }>(
    `SELECT code FROM curialy.payment_orders WHERE network = $1 AND tx_hash = $2 AND id <> $3
       AND (status IN ('confirming', 'completed') OR (status = 'review' AND chain_verified_at IS NOT NULL)) LIMIT 1`,
    [row.network, hash, row.id],
  );
  return rows[0]?.code ?? null;
}

/**
 * The order a mismatched transaction most likely belongs to: another order on the same network and
 * coin that expects exactly what it sent, with details issued before it was made. Exact amounts are
 * unique, so that amount points to one order; the operator must not hand its payment to another.
 */
async function rightfulOrder(client: PoolClient, row: OrderRow) {
  if (row.received_units === null || row.received_units === row.expected_units || !row.network || !row.coin) return null;
  const { rows } = await client.query<{ code: string }>(
    `SELECT code FROM curialy.payment_orders WHERE network = $1 AND coin = $2 AND expected_units = $3 AND id <> $4
       AND status <> 'completed' AND (quoted_at > now() - interval '48 hours' OR status IN (${STILL_OPEN}))
       AND ($5::timestamptz IS NULL OR quoted_at <= $5::timestamptz + interval '5 minutes') LIMIT 1`,
    [row.network, row.coin, row.received_units, row.id, row.tx_block_time],
  );
  return rows[0]?.code ?? null;
}

/** The payer's transaction: checking starts at once (and continues in the watcher). */
export async function submitHash(userId: string, code: string, rawHash: unknown) {
  const order = await findOrder(code, userId);
  if (!order) throw notFound();
  if (!order.network || !order.coin) throw conflict("Choose a network and coin first.", "no_details");
  const hash = normalizeTxHash(order.network, typeof rawHash === "string" ? rawHash : "");
  if (!hash) throw new BillingError(`That isn't a ${networkInfo(order.network)?.label ?? ""} transaction hash. Copy it from your wallet or the block explorer.`, "invalid_hash", 400);
  // The same hash again (a double click, a reload): nothing to do.
  if (order.tx_hash === hash) return customerView(order.id);
  assertCanSubmit(order);
  const changed = await transaction(async client => {
    // With the account's other orders (the cap): taken before the order itself, like createOrder.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`curialy-orders:${userId}`]);
    const row = await lockOrder(client, order.id);
    if (!row) throw notFound();
    if (row.tx_hash === hash) return false;
    assertCanSubmit(row);
    if (await paidElsewhere(client, row, hash)) throw hashUsed();
    // A late hash brings an order that had stopped counting back into progress.
    const reviving = row.status === "expired" || (row.status === "awaiting_payment" && row.expires_at.getTime() <= Date.now());
    if (reviving && (await ordersInProgress(client, userId)) >= MAX_OPEN_ORDERS) throw tooManyOrders();
    try {
      await client.query(
        `UPDATE curialy.payment_orders SET tx_hash = $2, status = 'pending', status_detail = $3, submitted_at = coalesce(submitted_at, now()), check_count = 0, next_check_at = now(),
           confirmations = NULL, required_confirmations = NULL, tx_from = NULL, tx_block_time = NULL, received_units = NULL, chain_verified_at = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id, hash, LOOKING.not_found],
      );
    } catch (error) {
      // Another order took the same transaction a moment ago (the unique index on network and hash).
      if (isUniqueViolation(error)) throw hashUsed();
      throw error;
    }
    // A replaced hash stays on record, with what its check found, for the operator.
    const found = row.received_units !== null && row.received_units !== "0" ? `, which sent ${unitsText(row, row.received_units)} ${row.coin}` : "";
    await addEvent(client, row.id, row.status, "pending", { actor: "customer", actorId: userId }, row.tx_hash ? `Transaction hash replaced (was ${row.tx_hash.slice(0, 10)}…${row.tx_hash.slice(-6)}${found})` : "Transaction hash submitted");
    return true;
  });
  if (changed) void runCheck(order.id).catch(error => console.error(`[Curialy Billing] Check of ${order.code} failed:`, error instanceof Error ? error.message : error));
  return customerView(order.id);
}

// ---- Payments found without a hash ----

export type InboxOrder = { id: string; coin: CoinId; units: bigint; quotedAt: Date; expiresAt: Date };

/**
 * Which open order each incoming transfer pays. The amount, the coin and the order's window have to
 * agree, and one transfer pays one order: two orders that want the same amount are left for the
 * hash (or the operator) instead of guessing.
 */
export function matchInbox(orders: InboxOrder[], transfers: InboundPayment[], now = Date.now()): { id: string; txHash: string }[] {
  const lateUntil = LATE_SUBMIT_HOURS * 3_600_000;
  const open = orders.filter(order => now <= order.expiresAt.getTime() + lateUntil);
  const claims: { id: string; txHash: string }[] = [];
  const usedOrders = new Set<string>();
  const usedHashes = new Set<string>();
  for (const transfer of transfers) {
    if (usedHashes.has(transfer.txHash)) continue;
    const hits = open.filter(order => !usedOrders.has(order.id) && order.coin === transfer.coin && order.units === transfer.units
      && transfer.blockTime.getTime() >= order.quotedAt.getTime() - BEFORE_MARGIN_MS
      && transfer.blockTime.getTime() <= order.expiresAt.getTime() + AFTER_MARGIN_MS);
    if (hits.length !== 1) continue;
    usedOrders.add(hits[0].id);
    usedHashes.add(transfer.txHash);
    claims.push({ id: hits[0].id, txHash: transfer.txHash });
  }
  return claims;
}

/** Starts the on-chain check for a payment the inbox found. The row lock repeats the match, so a hash pasted in the meantime stays. */
async function attachFound(id: string, hash: string, blockTime: Date): Promise<boolean> {
  const changed = await transaction(async client => {
    const row = await lockOrder(client, id);
    if (!row || row.tx_hash || !row.network || !row.coin || !row.expected_units || !row.quoted_at) return false;
    if (row.status !== "awaiting_payment" && row.status !== "expired") return false;
    if (Date.now() > row.expires_at.getTime() + LATE_SUBMIT_HOURS * 3_600_000) return false;
    if (blockTime.getTime() < row.quoted_at.getTime() - BEFORE_MARGIN_MS || blockTime.getTime() > row.expires_at.getTime() + AFTER_MARGIN_MS) return false;
    const { rows: taken } = await client.query<{ id: string }>("SELECT id FROM curialy.payment_orders WHERE network = $1 AND tx_hash = $2 LIMIT 1", [row.network, hash]);
    if (taken.length) return false;
    try {
      await client.query(
        `UPDATE curialy.payment_orders SET tx_hash = $2, status = 'pending', status_detail = $3, submitted_at = coalesce(submitted_at, now()), check_count = 0, next_check_at = now(),
           confirmations = NULL, required_confirmations = NULL, tx_from = NULL, tx_block_time = NULL, received_units = NULL, chain_verified_at = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id, hash, "Payment found on the network. Checking it."],
      );
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
    await addEvent(client, row.id, row.status, "pending", { actor: "system", actorId: null }, "Payment found on the network, so checking it.");
    return true;
  });
  if (!changed) return false;
  await runCheck(id).catch(error => console.error(`[Curialy Billing] Check of a found payment failed:`, error instanceof Error ? error.message : error));
  return true;
}

/**
 * Reads the receiving wallets for transfers that match an order still waiting (including one whose
 * window closed within the late period) and starts the same check a pasted hash would. Nothing is
 * credited here: the check does that, and it asks the chain about the transaction again.
 */
export async function watchInboxes(): Promise<number> {
  const { rows: groups } = await query<{ network: NetworkId; coin: CoinId; oldest: Date }>(
    `SELECT network, coin, min(quoted_at) AS oldest FROM curialy.payment_orders
       WHERE tx_hash IS NULL AND expected_units IS NOT NULL AND quoted_at IS NOT NULL AND network IS NOT NULL
         AND status IN ('awaiting_payment', 'expired') AND expires_at > now() - make_interval(hours => $1)
       GROUP BY network, coin`,
    [LATE_SUBMIT_HOURS],
  );
  const byNetwork = new Map<NetworkId, { coin: CoinId; oldest: Date }[]>();
  for (const row of groups) {
    const list = byNetwork.get(row.network) ?? [];
    list.push(row);
    byNetwork.set(row.network, list);
  }
  let attached = 0;
  for (const [networkId, group] of byNetwork) {
    const info = networkInfo(networkId);
    const wallet = info ? walletFor(info) : null;
    if (!info || !wallet) continue;
    const since = new Date(Math.min(...group.map(entry => new Date(entry.oldest).getTime())) - BEFORE_MARGIN_MS);
    let transfers: InboundPayment[] | null = null;
    try {
      transfers = await incomingPayments(networkId, wallet, since, [...new Set(group.map(entry => entry.coin))]);
    } catch (error) {
      console.error(`[Curialy Billing] Incoming payments on ${info.label}:`, error instanceof Error ? error.message : error);
      continue;
    }
    if (!transfers?.length) continue;
    const { rows } = await query<{ id: string; coin: CoinId; units: string; quoted_at: Date; expires_at: Date }>(
      `SELECT id, coin, expected_units::text AS units, quoted_at, expires_at FROM curialy.payment_orders
         WHERE network = $1 AND tx_hash IS NULL AND expected_units IS NOT NULL AND quoted_at IS NOT NULL
           AND status IN ('awaiting_payment', 'expired') AND expires_at > now() - make_interval(hours => $2)`,
      [networkId, LATE_SUBMIT_HOURS],
    );
    const waiting = rows.map(row => ({ id: row.id, coin: row.coin, units: BigInt(row.units), quotedAt: new Date(row.quoted_at), expiresAt: new Date(row.expires_at) }));
    for (const claim of matchInbox(waiting, transfers)) {
      const transfer = transfers.find(entry => entry.txHash === claim.txHash);
      if (transfer && await attachFound(claim.id, claim.txHash, transfer.blockTime)) attached++;
    }
  }
  return attached;
}

// ---- Checking on-chain ----

// What the payer sees under "Looking for your transaction": what the last check found.
const LOOKING = { not_found: "Not on the network yet: a new transaction can take a minute to show up.", seen: "Seen on the network, waiting for a block." } as const;

/** What one check found, and what it does to the order. */
export type Decision = {
  status: PaymentStatus;
  /** undefined: the detail stays as it is. */
  detail: string | null | undefined;
  /** What the chain showed, kept on the order (fields left out stay as they are). */
  chain: Partial<{ confirmations: number | null; required: number | null; from: string | null; receivedUnits: bigint | null; blockTime: Date | null }>;
  /** It matched on-chain (chain_verified_at). */
  verified: boolean;
  /** Complete and apply it now. */
  apply: boolean;
  alert: "review" | "completed" | null;
  /** The event note when the status changes. */
  note: string;
  /** Seconds until the next check, or null: no more checks. */
  nextCheckSeconds: number | null;
};

export type CheckContext = {
  status: PaymentStatus;
  network: NetworkId;
  /** Checks so far, this one included. */
  checkCount: number;
  /** When the current hash was submitted, and when the order last started confirming (ms). */
  submittedAt: number;
  confirmingSince: number | null;
  autoVerify: boolean;
  /** The transaction already paid another order (only one order can take it). */
  paidElsewhere: boolean;
  now: number;
};

/** The watcher's rules: what a check's result does to an order (pure, so every rule is testable). */
export function decide(ctx: CheckContext, check: ChainCheck): Decision {
  const info = networkInfo(ctx.network)!;
  const keep = { verified: false, apply: false, alert: null };
  const review = (detail: string, chain: Decision["chain"] = {}): Decision => ({ status: "review", detail, chain, verified: false, apply: false, alert: "review", note: detail, nextCheckSeconds: null });
  const confirmingEvery = info.family === "solana" ? 15 : 10;
  const confirmingFor = ctx.confirmingSince === null ? 0 : ctx.now - ctx.confirmingSince;
  if (check.state === "not_found" || check.state === "seen" || check.state === "unavailable") {
    if (ctx.status === "confirming") {
      if (check.state !== "unavailable") {
        // Its block is gone (a reorganisation): look for it again.
        return { ...keep, status: "pending", detail: LOOKING[check.state], chain: { confirmations: null }, note: "The transaction left its block; looking for it again.", nextCheckSeconds: 10 };
      }
      if (confirmingFor > CONFIRM_WINDOW_MS) return review("Still confirming after 60 minutes, and the network couldn't be reached to check it.");
      return { ...keep, status: "confirming", detail: undefined, chain: {}, note: "", nextCheckSeconds: confirmingEvery };
    }
    if (ctx.now - ctx.submittedAt > FIND_WINDOW_MS) {
      if (check.state === "unavailable") return review("The network couldn't be reached to check this payment.");
      if (check.state === "seen") return review(`This transaction was still waiting for a block on ${info.label} after 30 minutes.`);
      return review(`We couldn't find this transaction on ${info.label} after 30 minutes. Check the hash and the network.`);
    }
    const backoff = [10, 20, 40][ctx.checkCount - 1] ?? 60;
    return { ...keep, status: "pending", detail: check.state === "unavailable" ? undefined : LOOKING[check.state], chain: {}, note: check.state === "unavailable" ? "" : LOOKING[check.state], nextCheckSeconds: backoff };
  }
  if (check.state === "mismatch") {
    return review(check.reason, { from: check.from ?? undefined, receivedUnits: check.receivedUnits ?? undefined, blockTime: check.blockTime ?? undefined });
  }
  const chain = { confirmations: check.confirmations, required: check.required, from: check.from, receivedUnits: check.receivedUnits, blockTime: check.blockTime };
  if (ctx.paidElsewhere) return review("This transaction already paid another order.", chain);
  const progress = check.secondCheck ? "Confirmed; double-checking it with a second network provider."
    : info.family === "solana" ? "Confirmed; waiting for the network to finalize it." : `${check.confirmations} of ${check.required} confirmations`;
  if (check.state === "confirming") {
    if (ctx.status === "confirming" && confirmingFor > CONFIRM_WINDOW_MS) {
      return review(check.secondCheck ? "Confirmed by one network provider, but a second one couldn't confirm it within 60 minutes." : `Still not final after 60 minutes (${progress}).`, chain);
    }
    return { ...keep, status: "confirming", detail: progress, chain, note: progress, nextCheckSeconds: confirmingEvery };
  }
  if (ctx.autoVerify) return { status: "completed", detail: null, chain, verified: true, apply: true, alert: "completed", note: "Verified on-chain and applied.", nextCheckSeconds: null };
  return { ...review("Verified on-chain: waiting for the operator.", chain), verified: true };
}

/**
 * Checks an order's transaction on-chain and moves it on. The watcher passes due pending and
 * confirming orders; the operator can force a check of any order with a hash but a completed one.
 * The next check time is set before the network is asked, so a crash or a second worker can't
 * check it twice at once. Returns the operator's view when the operator asked for the check (null
 * when there was nothing to check, or for the watcher, which doesn't need it).
 */
export async function runCheck(orderId: string, opts: { force?: boolean; actorId?: string | null } = {}): Promise<AdminPaymentOrder | null> {
  const settings = await getBillingSettings();
  const { rows: [claimed] } = await query<OrderRow>(
    `UPDATE curialy.payment_orders SET check_count = check_count + 1, last_checked_at = now(), next_check_at = now() + interval '60 seconds', updated_at = now()
     WHERE id = $1 AND tx_hash IS NOT NULL AND network IS NOT NULL AND expected_units IS NOT NULL
       AND CASE WHEN $2::boolean THEN status <> 'completed' ELSE status IN ('pending', 'confirming') AND next_check_at <= now() END
     RETURNING *`,
    [orderId, Boolean(opts.force)],
  );
  if (!claimed) return null;
  const payment: PaymentToVerify = {
    network: claimed.network!, coin: claimed.coin!, txHash: claimed.tx_hash!, wallet: claimed.pay_address!, expectedUnits: BigInt(claimed.expected_units!),
    notBefore: new Date((claimed.quoted_at ?? claimed.created_at).getTime() - BEFORE_MARGIN_MS), notAfter: new Date(claimed.expires_at.getTime() + AFTER_MARGIN_MS),
  };
  let provider: string | undefined;
  let check = await verifyPayment(payment, { onAnswer: answered => { provider = answered; } });
  if (check.state === "confirmed") check = await secondOpinion(payment, check, provider);
  const by: Actor = opts.force ? { actor: "admin", actorId: opts.actorId ?? null } : { actor: "system", actorId: null };
  const decision = await transaction(async client => {
    const row = await lockOrder(client, orderId);
    // Replaced or finished while the network was asked: this answer is about something else now.
    if (!row || row.tx_hash !== claimed.tx_hash || row.status !== claimed.status || row.status === "completed" || (!opts.force && row.status !== "pending" && row.status !== "confirming")) return null;
    const { rows: [times] } = await client.query<{ submitted: Date | null; confirming: Date | null }>(
      `SELECT max(created_at) FILTER (WHERE actor = 'customer' AND to_status = 'pending') AS submitted,
              max(created_at) FILTER (WHERE to_status = 'confirming' AND from_status IS DISTINCT FROM 'confirming') AS confirming
       FROM curialy.payment_events WHERE order_id = $1`,
      [row.id],
    );
    const matched = check.state === "confirming" || check.state === "confirmed";
    const decided = decide({
      status: row.status, network: row.network!, checkCount: row.check_count, submittedAt: (times?.submitted ?? row.submitted_at ?? row.created_at).getTime(),
      confirmingSince: times?.confirming?.getTime() ?? null, autoVerify: settings.autoVerify, paidElsewhere: matched && Boolean(await paidElsewhere(client, row, row.tx_hash!)), now: Date.now(),
    }, check);
    const { chain } = decided;
    const pick = <T>(value: T | undefined, current: T) => (value === undefined ? current : value);
    await client.query(
      `UPDATE curialy.payment_orders SET status = $2, status_detail = $3, confirmations = $4, required_confirmations = $5, tx_from = $6, tx_block_time = $7,
         received_units = $8, chain_verified_at = $9, next_check_at = now() + make_interval(secs => $10), updated_at = now() WHERE id = $1`,
      [
        row.id, decided.apply ? row.status : decided.status, pick(decided.detail, row.status_detail), pick(chain.confirmations, row.confirmations), pick(chain.required, row.required_confirmations),
        pick(chain.from, row.tx_from), pick(chain.blockTime, row.tx_block_time), chain.receivedUnits === undefined ? row.received_units : chain.receivedUnits?.toString() ?? null,
        decided.verified ? new Date() : check.state === "mismatch" || check.state === "not_found" || check.state === "seen" ? null : row.chain_verified_at, decided.nextCheckSeconds,
      ],
    );
    if (decided.apply) await applyLocked(client, row, by, decided.note, null);
    else if (decided.status !== row.status) await addEvent(client, row.id, row.status, decided.status, by, decided.note || null);
    else if (opts.force) await addEvent(client, row.id, row.status, row.status, by, `Checked again: ${pick(decided.detail, row.status_detail) ?? PAYMENT_STATUS[row.status].label}`);
    return decided;
  });
  // The operator who asked for the check sees its result; alerts are for what happens by itself.
  const alert = decision?.alert && (decision.alert === "completed" || !opts.force) ? decision.alert : null;
  if (!alert && !opts.force) return null;
  const view = await adminView(orderId);
  if (alert) void notifyOrder(view, alert);
  return view;
}

/**
 * Nothing is credited on one provider's word: a payment one provider shows as confirmed is checked
 * with another before it counts. Until a second one agrees it stays confirming (and goes to the
 * operator after 60 minutes); a second one that sees something else in the block sends it to the
 * operator at once.
 */
/** A check that found the payment in a block (confirming or confirmed). */
type Found = Extract<ChainCheck, { receivedUnits: bigint; confirmations: number }>;

async function secondOpinion(payment: PaymentToVerify, first: Found, provider: string | undefined): Promise<ChainCheck> {
  const second = await verifyPayment(payment, { skipProvider: provider });
  if (second.state === "confirmed" && second.receivedUnits === first.receivedUnits) return first;
  const otherAmount = (second.state === "confirmed" || second.state === "confirming") && second.receivedUnits !== first.receivedUnits;
  if (second.state === "mismatch" || otherAmount) {
    return { state: "mismatch", reason: "Two network providers disagree about this transaction, so it is checked by hand.", from: first.from, receivedUnits: first.receivedUnits, blockTime: first.blockTime };
  }
  return { ...first, state: "confirming", secondCheck: true };
}

// ---- Applying an order ----

/**
 * Completes a locked order and gives the account what it bought, once: an order already applied is
 * left as it is. A plan starts, extends or upgrades the account's plan (planAfterPurchase) with the
 * plan's allowance as it is now; a top-up adds to the API balance with a ledger entry.
 */
async function applyLocked(client: PoolClient, row: OrderRow, by: Actor, note: string | null, adminNote: string | null) {
  if (row.applied_at || row.status === "completed") return false;
  const settings = await getBillingSettings();
  const user = await lockUser(client, row.user_id);
  let applied: NonNullable<PaymentOrder["applied"]>;
  if (row.kind === "plan") {
    if (!isPlanId(row.plan_id)) throw new Error(`Order ${row.code} has no plan.`);
    // The plan as it was sold: its days, its allowance, and its list price for converting days.
    const config = settings.plans[row.plan_id];
    const sold = { ...config, priceUsd: Number(row.list_usd), days: row.plan_days ?? config.days, creditsPerWindow: row.plan_credits_per_window ?? config.creditsPerWindow };
    const next = planAfterPurchase(planStateOf(user), row.plan_id, { ...settings.plans, [row.plan_id]: sold });
    const allowance = planAllowance(next, user, settings.plans, sold.creditsPerWindow);
    const name = settings.plans[next.planId].name;
    await client.query("UPDATE curialy.users SET plan_id = $2, plan_expires_at = $3, plan_credits_per_window = $4 WHERE id = $1", [user.id, next.planId, next.expiresAt, allowance]);
    await client.query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'plan', 0, $2, $3)", [user.id, `${name} plan until ${dayOf(next.expiresAt)} (order ${row.code})`, by.actorId]);
    applied = { planId: next.planId, planExpiresAt: next.expiresAt, effect: next.effect };
  } else {
    if (row.credit_usd === null) throw new Error(`Order ${row.code} has no balance to add.`);
    const micros = centsOf(row.credit_usd) * (MICROS_PER_USD / 100);
    const { rows: [after] } = await client.query<{ balance: string }>("UPDATE curialy.users SET api_balance_micros = api_balance_micros + $2 WHERE id = $1 RETURNING api_balance_micros::text AS balance", [user.id, micros]);
    await client.query(
      "INSERT INTO curialy.api_ledger (user_id, kind, amount_micros, balance_after_micros, order_id, note, created_by) VALUES ($1, 'topup', $2, $3, $4, $5, $6)",
      [user.id, micros, after.balance, row.id, `order ${row.code}`, by.actorId],
    );
    applied = { apiBalanceAddedUsd: micros / MICROS_PER_USD };
  }
  await client.query(
    `UPDATE curialy.payment_orders SET status = 'completed', status_detail = NULL, completed_at = now(), applied_at = now(), applied_detail = $2,
       admin_note = coalesce($3, admin_note), next_check_at = NULL, updated_at = now() WHERE id = $1`,
    [row.id, JSON.stringify(applied), adminNote],
  );
  await addEvent(client, row.id, row.status, "completed", by, note);
  return true;
}

/**
 * The allowance a plan change leaves the account with, for a purchase and the operator's grant alike:
 * extending never lowers an allowance already paid for, and a higher plan a lower one extends keeps
 * its own. given: the allowance of the plan bought or given.
 */
function planAllowance(next: { planId: PlanId; effect: PlanEffect }, user: UserRow, plans: Record<PlanId, PlanConfig>, given: number) {
  if (next.effect === "extend_higher") return user.plan_credits_per_window ?? plans[next.planId].creditsPerWindow;
  if (next.effect === "extend") return Math.max(user.plan_credits_per_window ?? 0, given);
  return given;
}

const planStateOf = (user: UserRow): PlanState =>
  isPlanId(user.plan_id) && user.plan_expires_at ? { planId: user.plan_id, expiresAt: user.plan_expires_at.toISOString() } : null;

/** Completes and applies an order (idempotent: a second call changes nothing). Returns whether it applied now. */
export async function applyOrder(orderId: string, actor: PaymentEvent["actor"], actorId: string | null = null, note: string | null = null) {
  return transaction(async client => {
    const row = await lockOrder(client, orderId);
    if (!row) throw notFound();
    return applyLocked(client, row, { actor, actorId }, note ?? (actor === "admin" ? "Approved by the operator" : "Applied"), actor === "admin" ? note : null);
  });
}

// ---- Expiry ----

/** Orders still awaiting payment past their window expire (an event each, in the same statement). */
export async function expireOrders() {
  const { rowCount } = await query(
    `WITH expired AS (
       UPDATE curialy.payment_orders SET status = 'expired', next_check_at = NULL, updated_at = now() WHERE status = 'awaiting_payment' AND expires_at <= now() RETURNING id
     )
     INSERT INTO curialy.payment_events (order_id, from_status, to_status, actor, note) SELECT id, 'awaiting_payment', 'expired', 'system', 'Expired without a payment' FROM expired`,
  );
  return rowCount ?? 0;
}

// ---- The operator ----

async function adminOrder(code: string) {
  const row = await findOrder(code);
  if (!row) throw new BillingError("No order with that code.", "not_found", 404);
  return row;
}

export async function getAdminOrder(code: string) {
  return adminView((await adminOrder(code)).id);
}

export type AdminOrderFilter = { status: PaymentStatus | "all" | "attention"; q: string; offset: number };

/** 50 orders a page, newest first; `q` matches the code, the account's login or the transaction hash. */
export async function listAdminOrders(filter: AdminOrderFilter) {
  const like = `%${filter.q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const [{ rows }, settings] = await Promise.all([
    query<OrderRow>(
      `${ORDER_SELECT} WHERE ($1 = 'all' OR ($1 = 'attention' AND o.status = 'review') OR o.status = $1)
         AND ($2 = '' OR o.code ILIKE $3 OR u.login ILIKE $3 OR o.tx_hash ILIKE $3)
       ORDER BY o.created_at DESC LIMIT 51 OFFSET $4`,
      [filter.status, filter.q, like, filter.offset],
    ),
    getBillingSettings(),
  ]);
  return { orders: rows.slice(0, 50).map(row => toAdminOrderView(row, [], settings.plans)), more: rows.length > 50 };
}

/** Checks an order's transaction again now, whatever the watcher's schedule. */
export async function recheckOrder(code: string, adminId: string) {
  const row = await adminOrder(code);
  if (row.status === "completed") throw conflict("This order is already completed.", "order_completed");
  if (!row.tx_hash) throw conflict("This order has no transaction to check.", "no_hash");
  return (await runCheck(row.id, { force: true, actorId: adminId })) ?? adminView(row.id);
}

/** Completes and applies an order whatever the chain said (the operator saw the payment). */
export async function approveOrder(code: string, adminId: string, note: string) {
  const row = await adminOrder(code);
  if (row.status === "completed") throw conflict("This order is already completed.", "order_completed");
  await transaction(async client => {
    const locked = await lockOrder(client, row.id);
    if (!locked || locked.status === "completed") throw conflict("This order is already completed.", "order_completed");
    // One payment never completes two orders, even by hand.
    const other = locked.tx_hash ? await paidElsewhere(client, locked, locked.tx_hash) : null;
    if (other) throw conflict(`This order's transaction already paid order ${other}. Reject this one, or give the account what it bought from its billing.`, "hash_used");
    // Nor another payer's: a transaction that sent exactly what another order expects is that order's.
    const owner = await rightfulOrder(client, locked);
    if (owner) throw conflict(`This transaction sent exactly what order ${owner} expects, so it is most likely that order's payment, pasted here. Reject this one; if you're sure, give the account what it bought from its billing instead.`, "belongs_elsewhere");
    await applyLocked(client, locked, { actor: "admin", actorId: adminId }, note || "Approved by the operator", note || null);
  });
  return adminView(row.id);
}

/** What the payer is told when the operator keeps the real reason off their page. */
const PAYER_REJECTED = "This payment was rejected.";
const PAYER_DISAPPROVED = "This payment was disapproved.";

/** Rejects an order that has not been applied. tellPayer: the reason is what they see; otherwise they only see that it was rejected. */
export async function rejectOrder(code: string, adminId: string, note: string, tellPayer = true) {
  const reason = note.trim();
  if (!reason) throw new BillingError("Say why the order is rejected.", "note_required", 400);
  const row = await adminOrder(code);
  await transaction(async client => {
    const locked = await lockOrder(client, row.id);
    if (!locked || locked.status === "completed") throw conflict("A completed order can't be rejected. Disapprove it to take back what it applied.", "order_completed");
    await client.query(
      "UPDATE curialy.payment_orders SET status = 'rejected', status_detail = $2, admin_note = $3, next_check_at = NULL, updated_at = now() WHERE id = $1",
      [locked.id, tellPayer ? reason : PAYER_REJECTED, reason],
    );
    await addEvent(client, locked.id, locked.status, "rejected", { actor: "admin", actorId: adminId }, reason);
  });
  return adminView(row.id);
}

export type DisapprovalUndo = "removed" | "shortened" | "unchanged" | "balance";

/**
 * Takes back a completed payment: the order is rejected, and what it applied is undone when that
 * is still what the account has. tellPayer puts the reason on the payer's page; otherwise they
 * only see that it was disapproved, and the reason stays on the order for operators.
 */
export async function disapproveOrder(code: string, adminId: string, note: string, tellPayer = true): Promise<{ order: AdminPaymentOrder; undo: DisapprovalUndo }> {
  const reason = note.trim();
  if (!reason) throw new BillingError("Say why this payment is disapproved.", "note_required", 400);
  const row = await adminOrder(code);
  if (row.status !== "completed") throw conflict("Only a completed payment can be disapproved.", "not_completed");
  const undo = await transaction(async client => {
    const locked = await lockOrder(client, row.id);
    if (!locked || locked.status !== "completed") throw conflict("Only a completed payment can be disapproved.", "not_completed");
    const result = locked.applied_at ? await undoApplied(client, locked, adminId) : "unchanged";
    await client.query(
      `UPDATE curialy.payment_orders SET status = 'rejected', status_detail = $2, admin_note = $3, applied_at = NULL, applied_detail = NULL, completed_at = NULL, next_check_at = NULL, updated_at = now() WHERE id = $1`,
      [locked.id, tellPayer ? reason : PAYER_DISAPPROVED, reason],
    );
    await addEvent(client, locked.id, "completed", "rejected", { actor: "admin", actorId: adminId }, reason);
    return result;
  });
  return { order: await adminView(row.id), undo };
}

/**
 * Undoes what a completed order applied, when the account still has exactly that. A later plan
 * (a different expiry or plan) is left alone. An API top-up is removed down to zero.
 */
async function undoApplied(client: PoolClient, row: OrderRow, adminId: string): Promise<DisapprovalUndo> {
  const user = await lockUser(client, row.user_id);
  const applied = row.applied_detail;
  if (row.kind === "api") {
    const added = applied?.apiBalanceAddedUsd != null ? usdToMicros(applied.apiBalanceAddedUsd) : centsOf(row.credit_usd ?? "0") * (MICROS_PER_USD / 100);
    const before = Number(user.api_balance_micros);
    const after = Math.max(0, before - added);
    await client.query("UPDATE curialy.users SET api_balance_micros = $2 WHERE id = $1", [user.id, after]);
    await client.query(
      "INSERT INTO curialy.api_ledger (user_id, kind, amount_micros, balance_after_micros, order_id, note, created_by) VALUES ($1, $2, $3, $4, NULL, $5, $6)",
      [user.id, "adjust", after - before, after, `disapproved order ${row.code}`, adminId],
    );
    return "balance";
  }
  if (!applied?.planId || !applied.planExpiresAt || !isPlanId(user.plan_id) || !user.plan_expires_at) return "unchanged";
  const same = user.plan_id === applied.planId && Math.abs(user.plan_expires_at.getTime() - Date.parse(applied.planExpiresAt)) < 2_000;
  if (!same) return "unchanged";
  const settings = await getBillingSettings();
  const bought = isPlanId(row.plan_id) ? row.plan_id : applied.planId;
  const soldDays = (row.plan_days ?? settings.plans[bought].days) * (row.plan_months ?? 1);
  // Extending the same plan adds its days. Buying a lower plan while a higher one is active adds
  // the lower plan's value in the higher plan's days (planAfterPurchase, effect extend_higher).
  const daily = (id: PlanId) => settings.plans[id].priceUsd / settings.plans[id].days;
  const soldMs = applied.effect === "extend_higher" ? soldDays * 86_400_000 * daily(bought) / daily(applied.planId) : soldDays * 86_400_000;
  const clear = async (detail: string) => {
    await client.query("UPDATE curialy.users SET plan_id = NULL, plan_expires_at = NULL, plan_credits_per_window = NULL WHERE id = $1", [user.id]);
    await client.query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'plan', 0, $2, $3)", [user.id, detail, adminId]);
  };
  if (applied.effect === "start") {
    await clear(`${settings.plans[applied.planId].name} plan removed: order ${row.code} was disapproved`);
    return "removed";
  }
  const back = new Date(user.plan_expires_at.getTime() - soldMs);
  if (back.getTime() <= Date.now()) {
    await clear(`${settings.plans[applied.planId].name} plan removed: order ${row.code} was disapproved`);
    return "removed";
  }
  await client.query(
    "UPDATE curialy.users SET plan_id = $2, plan_expires_at = $3, plan_credits_per_window = $4 WHERE id = $1",
    [user.id, user.plan_id, back.toISOString(), user.plan_credits_per_window],
  );
  await client.query(
    "INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'plan', 0, $2, $3)",
    [user.id, `${settings.plans[applied.planId].name} plan shortened: order ${row.code} was disapproved`, adminId],
  );
  return "shortened";
}

export async function billingOverview(): Promise<Omit<AdminBillingOverview, "settings">> {
  const { rows: [row] } = await query<{ counts: Record<string, number> | null; d7: string; d30: string; total: string; plans: Record<string, number> | null; api_micros: string }>(
    `SELECT (SELECT json_object_agg(status, n) FROM (SELECT status, count(*)::int AS n FROM curialy.payment_orders GROUP BY status) c) AS counts,
            (SELECT coalesce(sum(price_usd), 0) FROM curialy.payment_orders WHERE status = 'completed' AND completed_at > now() - interval '7 days') AS d7,
            (SELECT coalesce(sum(price_usd), 0) FROM curialy.payment_orders WHERE status = 'completed' AND completed_at > now() - interval '30 days') AS d30,
            (SELECT coalesce(sum(price_usd), 0) FROM curialy.payment_orders WHERE status = 'completed') AS total,
            (SELECT json_object_agg(plan_id, n) FROM (SELECT plan_id, count(*)::int AS n FROM curialy.users WHERE plan_id IS NOT NULL AND plan_expires_at > now() GROUP BY plan_id) p) AS plans,
            (SELECT coalesce(sum(api_balance_micros), 0)::text FROM curialy.users) AS api_micros`,
  );
  const counts = Object.fromEntries(Object.keys(PAYMENT_STATUS).map(status => [status, Number(row?.counts?.[status] ?? 0)])) as Record<PaymentStatus, number>;
  return {
    counts,
    revenue: { last7dUsd: centsOf(row?.d7 ?? 0) / 100, last30dUsd: centsOf(row?.d30 ?? 0) / 100, totalUsd: centsOf(row?.total ?? 0) / 100 },
    subscribers: { pro: Number(row?.plans?.pro ?? 0), max: Number(row?.plans?.max ?? 0) },
    apiBalanceTotalUsd: Number(row?.api_micros ?? 0) / MICROS_PER_USD,
    wallets: walletConfig(),
    alerts: alertsConfigured(),
  };
}

let holdings: { at: number; value: AdminWalletBalances } | null = null;

/** What the receiving wallets hold on each offered network, read from the chains by address (at most 30 s old). */
export async function walletBalances(): Promise<AdminWalletBalances> {
  if (holdings && Date.now() - holdings.at < 30_000) return holdings.value;
  const networks = await Promise.all(offeredNetworks().map(async network => {
    const address = walletFor(network)!;
    const read = await walletHoldings(network.id, address);
    return {
      network: network.id, label: network.label, address, explorerUrl: `${network.explorer.address}${address}`, unavailable: read.unavailable,
      coins: read.coins.map(entry => ({ coin: entry.coin, amount: entry.units === null ? null : formatUnits(entry.units, coinOn(network.id, entry.coin)!.decimals) })),
    };
  }));
  holdings = { at: Date.now(), value: { checkedAt: new Date().toISOString(), networks } };
  return holdings.value;
}

// ---- Accounts: plans and API balance ----

/**
 * How many months of `planId` the account can pay for now: its plan, then its open plan orders as
 * sold (placed but not paid or turned down yet), may not run past MAX_PLAN_MONTHS periods from now.
 */
async function prepayRoom(client: Pick<PoolClient, "query">, userId: string, planId: PlanId, plans: Record<PlanId, PlanConfig>) {
  const [{ rows: [user] }, { rows: open }] = await Promise.all([
    client.query<UserRow>("SELECT id, plan_id, plan_expires_at, plan_credits_per_window, api_balance_micros FROM curialy.users WHERE id = $1", [userId]),
    client.query<{ plan_id: PlanId; plan_days: number | null; list_usd: string }>(
      `SELECT plan_id, plan_days, list_usd FROM curialy.payment_orders WHERE user_id = $1 AND kind = 'plan' AND plan_id IS NOT NULL
         AND (status IN ('pending', 'confirming', 'review') OR (status = 'awaiting_payment' AND expires_at > now())) ORDER BY created_at`,
      [userId],
    ),
  ]);
  const orders = open.filter(order => isPlanId(order.plan_id)).map(order => ({ planId: order.plan_id, days: order.plan_days ?? plans[order.plan_id].days, listUsd: Number(order.list_usd) }));
  return prepayableMonths(user ? planStateOf(user) : null, orders, planId, plans);
}

/** BillingAccount.prepay: the most months of each plan the account can pay for now. */
export async function prepayLimits(userId: string): Promise<Record<PlanId, number>> {
  const settings = await getBillingSettings();
  const db = { query: (text: string, values?: unknown[]) => query(text, values) } as Pick<PoolClient, "query">;
  const [pro, max] = await Promise.all([prepayRoom(db, userId, "pro", settings.plans), prepayRoom(db, userId, "max", settings.plans)]);
  return { pro, max };
}

/** The account's active plan (BillingAccount.plan). */
export async function planOfAccount(userId: string) {
  const [{ rows: [user] }, settings] = await Promise.all([
    query<UserRow>("SELECT id, plan_id, plan_expires_at, plan_credits_per_window, api_balance_micros FROM curialy.users WHERE id = $1", [userId]),
    getBillingSettings(),
  ]);
  return user ? activePlan(user, settings.plans) : null;
}

/** An account's billing for the operator, less its API wallet (the caller adds it). */
export async function accountBilling(userId: string): Promise<Omit<AdminAccountBilling, "apiWallet">> {
  const [{ rows: [user] }, settings] = await Promise.all([
    query<UserRow>("SELECT id, plan_id, plan_expires_at, plan_credits_per_window, api_balance_micros FROM curialy.users WHERE id = $1", [userId]),
    getBillingSettings(),
  ]);
  if (!user) throw new BillingError("Account not found.", "not_found", 404);
  const [{ rows: orders }, { rows: ledger }] = await Promise.all([
    query<OrderRow>(`${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [userId]),
    query<{ kind: AdminAccountBilling["ledger"][number]["kind"]; amount_micros: string; balance_after_micros: string; order_code: string | null; note: string | null; created_at: Date }>(
      `SELECT l.kind, l.amount_micros, l.balance_after_micros, o.code AS order_code, l.note, l.created_at FROM curialy.api_ledger l
       LEFT JOIN curialy.payment_orders o ON o.id = l.order_id WHERE l.user_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 50`,
      [userId],
    ),
  ]);
  return {
    plan: activePlan(user, settings.plans),
    orders: orders.map(row => toAdminOrderView(row, [], settings.plans)),
    ledger: ledger.map(entry => ({
      kind: entry.kind, amountUsd: Number(entry.amount_micros) / MICROS_PER_USD, balanceAfterUsd: Number(entry.balance_after_micros) / MICROS_PER_USD,
      orderCode: entry.order_code, note: entry.note, at: entry.created_at.toISOString(),
    })),
  };
}

/**
 * Gives (or extends) a plan without a payment, like buying it for `days` days at the same price per
 * day (so an upgrade or a lower plan converts the same way a purchase does).
 */
export async function grantPlan(userId: string, planId: PlanId, days: number, note: string, adminId: string) {
  if (!isPlanId(planId)) throw new BillingError("Choose Pro or Max.", "invalid_plan", 400);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new BillingError("Days are a whole number from 1 to 366.", "invalid_days", 400);
  const settings = await getBillingSettings();
  const bought = settings.plans[planId];
  const plans = { ...settings.plans, [planId]: { ...bought, days, priceUsd: (bought.priceUsd * days) / bought.days } };
  await transaction(async client => {
    const user = await lockUser(client, userId);
    const next = planAfterPurchase(planStateOf(user), planId, plans);
    const plan = settings.plans[next.planId];
    await client.query("UPDATE curialy.users SET plan_id = $2, plan_expires_at = $3, plan_credits_per_window = $4 WHERE id = $1", [user.id, next.planId, next.expiresAt, planAllowance(next, user, settings.plans, bought.creditsPerWindow)]);
    // The account's history shows the detail up to the operator's note.
    await client.query(
      "INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'plan', 0, $2, $3)",
      [user.id, `${plan.name} plan until ${dayOf(next.expiresAt)} (given by the operator)${note.trim() ? `${PLAN_NOTE_MARK}${note.trim().slice(0, 200)}` : ""}`, adminId],
    );
  });
}

/** Ends an account's plan now. */
export async function endPlan(userId: string, note: string, adminId: string) {
  const settings = await getBillingSettings();
  await transaction(async client => {
    const user = await lockUser(client, userId);
    const plan = activePlan(user, settings.plans);
    if (!plan) throw conflict("This account has no active plan.", "no_plan");
    await client.query("UPDATE curialy.users SET plan_id = NULL, plan_expires_at = NULL, plan_credits_per_window = NULL WHERE id = $1", [user.id]);
    await client.query(
      "INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'plan', 0, $2, $3)",
      [user.id, `${plan.name} plan ended by the operator${note.trim() ? `${PLAN_NOTE_MARK}${note.trim().slice(0, 200)}` : ""}`, adminId],
    );
  });
}

/** Adds (or, negative, removes) API balance; it never goes below zero, and the ledger records what was actually applied. */
export async function adjustApiBalance(userId: string, amountUsd: number, note: string, adminId: string) {
  const micros = Number.isFinite(amountUsd) && Math.abs(amountUsd) <= 10_000 ? usdToMicros(amountUsd) : 0;
  if (micros === 0) throw new BillingError("Enter an amount from -$10,000 to $10,000, not zero.", "invalid_amount", 400);
  await transaction(async client => {
    const user = await lockUser(client, userId);
    const before = Number(user.api_balance_micros);
    // A removal stops at zero; it never moves a balance that is already at or below zero (a reply that overran).
    if (micros < 0 && before <= 0) throw conflict("There is no API balance to remove.", "nothing_to_remove");
    const after = micros > 0 ? before + micros : Math.max(0, before + micros);
    await client.query("UPDATE curialy.users SET api_balance_micros = $2 WHERE id = $1", [user.id, after]);
    await client.query(
      "INSERT INTO curialy.api_ledger (user_id, kind, amount_micros, balance_after_micros, order_id, note, created_by) VALUES ($1, $2, $3, $4, NULL, $5, $6)",
      [user.id, micros > 0 ? "grant" : "adjust", after - before, after, note.trim().slice(0, 200) || null, adminId],
    );
  });
}
