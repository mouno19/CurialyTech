import {
  coinOn, formatUsd, networkInfo, normalizeOrderCode, PAYMENT_STATUS, planAfterPurchase,
  type AdminPaymentOrder, type BillingAccount, type PaymentEvent, type PaymentOrder, type PaymentStatus, type PlanConfig, type PlanEffect, type PlanId,
} from "@shared/billing";
import { formatCredits } from "@shared/credits";

// The operator's Payments tab and order dialog as pure functions: the admin page's address
// (/admin?tab=payments&order=CUR-…, which payment alerts link to), the status filters and their
// counts, and what an order shows and what approving it would do. Every sentence here says only
// what the server reported, or what the server will do by the same rules (planAfterPurchase).

// ---- Tabs and the address ----

export type AdminTab = "accounts" | "payments" | "codes" | "plans" | "settings";

export const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: "accounts", label: "Accounts" },
  { id: "payments", label: "Payments" },
  { id: "codes", label: "Promo codes" },
  { id: "plans", label: "Plans & pricing" },
  { id: "settings", label: "Settings" },
];

const isTab = (value: string | null): value is AdminTab => ADMIN_TABS.some(tab => tab.id === value);

/**
 * The tab and the order to open from the address. A code is normalized when it can be ("cur-7k3m…");
 * anything else is kept as typed, so the dialog can say no order has it. An order without a tab
 * opens on Payments.
 */
export function readAdminLocation(search: string): { tab: AdminTab | null; order: string | null } {
  const params = new URLSearchParams(search);
  const raw = (params.get("order") ?? "").trim().slice(0, 64);
  const order = raw ? normalizeOrderCode(raw) ?? raw : null;
  const tab = params.get("tab");
  return { tab: isTab(tab) ? tab : order ? "payments" : null, order };
}

/** The address of a tab and the open order: plain /admin for the first tab with nothing open. */
export function adminHref(tab: AdminTab, order: string | null) {
  const params = new URLSearchParams();
  if (tab !== "accounts" || order) params.set("tab", tab);
  if (order) params.set("order", order);
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

// ---- Status filters ----

export type OrderFilter = PaymentStatus | "all" | "attention";

/** Every status, in the order an order moves through them. */
export const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS) as PaymentStatus[];

export const isOrderFilter = (value: string): value is OrderFilter => value === "all" || value === "attention" || (PAYMENT_STATUSES as string[]).includes(value);

export type FilterChip = { id: OrderFilter; label: string; count: number | null };

/** All, Needs attention (the server's "attention": the orders in review), then each status; counts are null until the overview loads. */
export function statusFilters(counts: Record<PaymentStatus, number> | null | undefined): FilterChip[] {
  return [
    { id: "all", label: "All", count: filterTotal("all", counts) },
    { id: "attention", label: "Needs attention", count: filterTotal("attention", counts) },
    ...PAYMENT_STATUSES.map(status => ({ id: status, label: PAYMENT_STATUS[status].label, count: filterTotal(status, counts) })),
  ];
}

/** How many orders a filter has in all (the overview's counts), or null when they aren't known. */
export function filterTotal(filter: OrderFilter, counts: Record<PaymentStatus, number> | null | undefined): number | null {
  if (!counts) return null;
  if (filter === "all") return PAYMENT_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
  return counts[filter === "attention" ? "review" : filter] ?? 0;
}

const NOUN: Record<OrderFilter, [one: string, many: string]> = {
  all: ["order", "orders"],
  attention: ["order in review", "orders in review"],
  awaiting_payment: ["order awaiting payment", "orders awaiting payment"],
  pending: ["order being checked on the network", "orders being checked on the network"],
  confirming: ["order confirming", "orders confirming"],
  review: ["order in review", "orders in review"],
  completed: ["completed order", "completed orders"],
  rejected: ["rejected order", "rejected orders"],
  expired: ["expired order", "expired orders"],
};

/**
 * The line above the table: "Showing 50 of 132 orders, newest first", "3 orders in review, newest
 * first", "2 completed orders matching “mouno”". total: the filter's count (unknown while searching).
 */
export function listSummary(filter: OrderFilter, shown: number, more: boolean, total: number | null, query: string) {
  const [one, many] = NOUN[filter];
  const noun = (count: number) => (count === 1 ? one : many);
  const q = query.trim();
  if (q) {
    if (shown === 0) return `No ${many} match “${q}”`;
    return more ? `The newest ${shown} ${many} matching “${q}”` : `${shown} ${noun(shown)} matching “${q}”`;
  }
  if (shown === 0) return `No ${many}`;
  if (total !== null && total > shown) return `Showing ${shown} of ${total} ${noun(total)}, newest first`;
  return more ? `The newest ${shown} ${many}` : `${shown} ${noun(shown)}, newest first`;
}

/**
 * Where the next page starts: the rows shown that are still in the filter. An order whose status
 * changed here (approved out of Needs attention) has left the server's list, so counting it would
 * skip the order that moved up into its place; appendOrders drops any overlap the other way.
 */
export function nextOffset(orders: Pick<PaymentOrder, "status">[], filter: OrderFilter) {
  if (filter === "all") return orders.length;
  const status: PaymentStatus = filter === "attention" ? "review" : filter;
  return orders.filter(order => order.status === status).length;
}

/** The next page after the rows already shown: an order that moved down a page meanwhile isn't listed twice. */
export function appendOrders<T extends { code: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map(order => order.code));
  return [...current, ...next.filter(order => !seen.has(order.code))];
}

/** The list with one order replaced by its newer copy (it stays where it is until the next load). */
export function replaceOrder<T extends { code: string }>(list: T[], order: T): T[] {
  return list.map(entry => (entry.code === order.code ? order : entry));
}

/** An amount on a stat tile: exact under $10,000 ("$1,234.50"), compact from there ("$12.3K", "$1.2M"). */
export function compactUsd(usd: number) {
  const value = Math.abs(usd);
  if (value < 10_000) return formatUsd(usd);
  const sign = usd < 0 ? "-" : "";
  const thousands = Math.round(value / 100) / 10;
  if (thousands < 1000) return `${sign}$${thousands.toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  const millions = Math.round(value / 100_000) / 10;
  return `${sign}$${millions.toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
}

// ---- What an order shows ----

/** "@login", or the name when the account has no login. */
export const accountName = (user: AdminPaymentOrder["user"]) => (user.login ? `@${user.login}` : user.name || "this account");

/** "USDT on BNB Chain (BEP-20)", or null before a network and coin were chosen. */
export function methodText(order: Pick<PaymentOrder, "network" | "coin">) {
  const network = networkInfo(order.network);
  if (!network || !order.coin) return null;
  const coin = coinOn(order.network, order.coin);
  return `${order.coin} on ${network.label}${coin ? ` (${coin.standard})` : ""}`;
}

/** A wallet's page on the network's block explorer. */
export const explorerAddressUrl = (network: string | null | undefined, address: string | null | undefined) => {
  const info = networkInfo(network);
  return info && address ? `${info.explorer.address}${address}` : null;
};

/** Decimal amounts as the server writes them: "2.0037", "2.00370" and "02.0037" are the same amount. */
export function sameAmount(a: string | null | undefined, b: string | null | undefined) {
  const normal = (value: string) => {
    const [whole, fraction = ""] = value.trim().split(".");
    return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  };
  return typeof a === "string" && typeof b === "string" && a.trim() !== "" && normal(a) === normal(b);
}

/** "7 of 20", or null before the transaction was found in a block. */
export function confirmationsText(order: Pick<PaymentOrder, "confirmations" | "requiredConfirmations">) {
  if (order.confirmations === null) return null;
  return order.requiredConfirmations ? `${order.confirmations} of ${order.requiredConfirmations}` : String(order.confirmations);
}

export type Finding = { tone: "success" | "warning" | "neutral"; text: string };

/**
 * What the on-chain check found, in one sentence, from what the server stored: the amount the
 * transaction sent to the wallet against the exact amount the order expects, the confirmations, and
 * whether the server verified the payment (chainVerifiedAt: a second network provider agreed, inside
 * the order's window, deep enough). Only a verified payment reads as a pass: an exact amount alone
 * doesn't (two providers can disagree, the time can be wrong, the block can be gone). The status
 * detail says why it wasn't verified (a failed transaction, the wrong time, a payment through a contract).
 */
export function chainFinding(order: AdminPaymentOrder): Finding {
  const coin = order.coin ?? "";
  if (!order.network || !order.expectedAmount) return { tone: "neutral", text: "No payment details were issued for this order, so there is nothing to check on-chain." };
  if (!order.txHash) return { tone: "neutral", text: "The payer hasn't submitted a transaction hash." };
  if (order.receivedAmount === null) return { tone: "neutral", text: "The check hasn't found an amount sent to the wallet." };
  if (sameAmount(order.receivedAmount, "0")) return { tone: "warning", text: `The transaction didn't send any ${coin} to the wallet.` };
  if (!sameAmount(order.receivedAmount, order.expectedAmount)) {
    return { tone: "warning", text: `The transaction sent ${order.receivedAmount} ${coin}; the order expects exactly ${order.expectedAmount} ${coin}.` };
  }
  const exact = `${order.expectedAmount} ${coin}`;
  const confirmations = confirmationsText(order);
  if (order.chainVerifiedAt) return { tone: "success", text: `Verified on-chain: the transaction sent exactly ${exact}${confirmations ? `, with ${confirmations} confirmations` : ""}.` };
  // The right amount, but not verified: still being checked, or stopped for the reason in the status detail.
  if (order.status === "pending" || order.status === "confirming") {
    const settled = order.confirmations !== null && order.requiredConfirmations !== null && order.confirmations >= order.requiredConfirmations;
    return { tone: "neutral", text: `A check found exactly ${exact} sent to the wallet${confirmations ? `, with ${confirmations} confirmations${settled ? "" : " so far"}` : ""}; it isn't verified yet.` };
  }
  if (order.status === "review") return { tone: "warning", text: `A check found exactly ${exact} sent to the wallet, but the payment isn't verified.` };
  return { tone: "neutral", text: `A check found exactly ${exact} sent to the wallet, but the payment wasn't verified on-chain.` };
}

/**
 * The status detail under the finding in the approve confirmation: why the order is where it is.
 * Left out when it only repeats the finding: the amounts of a mismatch, or a verified payment's
 * "waiting for the operator" (the dialog behind still shows it).
 */
export function approveDetail(order: AdminPaymentOrder, finding: Finding) {
  const detail = order.statusDetail?.trim();
  if (!detail || finding.tone === "success") return null;
  const repeats = finding.tone === "warning" && order.expectedAmount !== null && order.coin !== null && detail.includes(`${order.expectedAmount} ${order.coin}`);
  return repeats ? null : detail;
}

/**
 * The approve confirmation's last word, unless the server verified the payment: approving gives the
 * order in full whatever arrived, so a short payment says so, and anything unverified asks the
 * operator to have seen the payment themselves.
 */
export function approveCaution(order: AdminPaymentOrder, finding: Finding) {
  if (finding.tone === "success") return null;
  const short = order.receivedAmount !== null && order.expectedAmount !== null && Number(order.receivedAmount) < Number(order.expectedAmount);
  if (!short) return "Approve it only if you've seen the payment arrive.";
  const gives = order.kind === "api" ? `adds the full ${formatUsd(order.creditUsd ?? order.priceUsd)}` : "gives the whole plan";
  return `Approving ${gives} anyway: approve it only if the rest reached the wallet some other way, or you're choosing to cover it.`;
}

type Seen = Pick<PaymentOrder, "status" | "txHash" | "receivedAmount">;

/**
 * Why an order needs another look before the operator's decision goes through: it moved on since
 * they opened the confirmation (the payer sent another hash, a check finished), or null when it is
 * as they saw it.
 */
export function orderChangeText(seen: Seen, now: Seen) {
  const label = (status: PaymentStatus) => PAYMENT_STATUS[status].label.toLowerCase();
  if (now.status === "completed" && seen.status !== "completed") return "This order completed while you had it open, so there is nothing left to decide.";
  if (now.txHash !== seen.txHash) {
    return `The payer submitted a different transaction hash while you had this order open${now.status !== seen.status ? `, and it's now ${label(now.status)}` : ""}. Read it again before you decide.`;
  }
  if (now.status !== seen.status) return `This order is now ${label(now.status)} (it was ${label(seen.status)} when you opened it). Read it again before you decide.`;
  if (now.receivedAmount !== seen.receivedAmount && !sameAmount(now.receivedAmount, seen.receivedAmount)) {
    return "The on-chain check found something new while you had this order open. Read it again before you decide.";
  }
  return null;
}

export const ACTOR_LABEL: Record<PaymentEvent["actor"], string> = { customer: "Payer", system: "Automatic", admin: "Operator" };

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

const EFFECT_WORD: Record<PlanEffect, string> = { start: "started", extend: "extended", upgrade: "upgraded", extend_higher: "added to the higher plan" };

/** What completing the order did: "Pro until 9 Dec 2026 · upgraded", "$25.00 added to the API balance". */
export function appliedText(order: PaymentOrder, planName: (id: PlanId) => string, day: (iso: string) => string) {
  const applied = order.applied;
  if (!applied) return null;
  if (typeof applied.apiBalanceAddedUsd === "number") return `${formatUsd(applied.apiBalanceAddedUsd)} added to the API balance`;
  if (applied.planId && applied.planExpiresAt) return `${planName(applied.planId)} until ${day(applied.planExpiresAt)}${applied.effect ? ` · ${EFFECT_WORD[applied.effect]}` : ""}`;
  return null;
}

/**
 * What approving the order gives the account, by the rules the server applies it with
 * (applyLocked): a top-up adds its balance; a plan starts, extends or upgrades the account's plan
 * (planAfterPurchase) as it was sold, with the days, credits per window and list price fixed when
 * the order was placed, whatever the plan's settings are now. current: the account's plan (null:
 * none; undefined: not known, so the sentence doesn't guess an end date). Dates are "about": the
 * server works them out when it applies.
 */
export function approveText(order: AdminPaymentOrder, current: BillingAccount["plan"] | undefined, plans: Record<PlanId, PlanConfig> | null, day: (iso: string) => string, now = Date.now()) {
  const who = accountName(order.user);
  if (order.kind === "api") return `Adds ${formatUsd(order.creditUsd ?? order.priceUsd)} to ${who}'s API balance.`;
  const planId = order.planId;
  if (!planId || !plans || current === undefined) return `Gives ${who} ${order.title} the way a purchase does: it starts, extends or upgrades their plan.`;
  const config = plans[planId];
  const sold: PlanConfig = { ...config, priceUsd: order.listUsd, days: order.planDays ?? config.days, creditsPerWindow: order.planCreditsPerWindow ?? config.creditsPerWindow };
  const active = current && Date.parse(current.expiresAt) > now ? current : null;
  const next = planAfterPurchase(active && { planId: active.id, expiresAt: active.expiresAt }, planId, { ...plans, [planId]: sold }, now);
  const until = day(next.expiresAt);
  const credits = (count: number) => `${formatCredits(count)} credits per window`;
  // The allowance as the server sets it: the sold one, or the higher of the two on an extension; a higher plan keeps its own.
  if (next.effect === "start") return `Gives ${who} ${sold.name} for ${days(sold.days)}, starting now: until about ${until}, with ${credits(sold.creditsPerWindow)}.`;
  if (next.effect === "extend") return `Adds ${days(sold.days)} to ${who}'s ${sold.name} plan: until about ${until}, with ${credits(Math.max(active!.creditsPerWindow, sold.creditsPerWindow))}.`;
  if (next.effect === "upgrade") return `Upgrades ${who} from ${plans[active!.id].name} to ${sold.name} now, with the days left carried over at their value: until about ${until}, with ${credits(sold.creditsPerWindow)}.`;
  return `Adds the value of ${days(sold.days)} of ${sold.name} to ${who}'s ${plans[next.planId].name} plan: until about ${until}, keeping its ${credits(active!.creditsPerWindow)}.`;
}
