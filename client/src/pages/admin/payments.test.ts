import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, type AdminPaymentOrder, type PaymentStatus } from "@shared/billing";
import {
  adminHref, appendOrders, appliedText, approveCaution, approveDetail, approveText, chainFinding, compactUsd, confirmationsText, explorerAddressUrl, filterTotal, isOrderFilter,
  listSummary, methodText, nextOffset, orderChangeText, readAdminLocation, replaceOrder, sameAmount, statusFilters,
} from "./payments";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const inDays = (count: number) => new Date(NOW + count * DAY).toISOString();
const day = (iso: string) => iso.slice(0, 10);

const COUNTS: Record<PaymentStatus, number> = { awaiting_payment: 5, pending: 1, confirming: 0, review: 3, completed: 20, rejected: 1, expired: 12 };

/** A Pro order in review whose transaction sent the exact amount, not verified (chainVerifiedAt null) unless a test says so. */
function order(patch: Partial<AdminPaymentOrder> = {}): AdminPaymentOrder {
  return {
    code: "CUR-7K3M2QX9", kind: "plan", planId: "pro", planDays: 30, planCreditsPerWindow: 6000, title: "Pro · 30 days", listUsd: 20, discountPercent: 90, priceUsd: 2, creditUsd: null,
    network: "bnb", coin: "USDT", payAddress: "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b", expectedAmount: "2.0037", quoteUsdPrice: null,
    txHash: `0x${"ab".repeat(32)}`, status: "review", statusDetail: null, confirmations: 20, requiredConfirmations: 20,
    createdAt: inDays(-1), quotedAt: inDays(-1), expiresAt: inDays(-1), submitUntil: null, submittedAt: inDays(-1), completedAt: null, applied: null,
    explorerUrl: null, events: [], user: { id: "u1", login: "mouno19", name: "Mouno" }, adminNote: null, txFrom: "0xfrom", receivedAmount: "2.0037",
    txBlockTime: inDays(-1), checkCount: 3, lastCheckedAt: inDays(-1), chainVerifiedAt: null,
    ...patch,
  };
}
const OTHER_HASH = `0x${"cd".repeat(32)}`;

describe("the admin address", () => {
  it("reads the tab and the order a payment alert links to", () => {
    expect(readAdminLocation("?tab=payments&order=CUR-7K3M2QX9")).toEqual({ tab: "payments", order: "CUR-7K3M2QX9" });
    expect(readAdminLocation("tab=plans")).toEqual({ tab: "plans", order: null });
    expect(readAdminLocation("")).toEqual({ tab: null, order: null });
    expect(readAdminLocation("?tab=nope")).toEqual({ tab: null, order: null });
  });

  it("normalizes a typed code, keeps one that can't be a code, and opens orders on Payments", () => {
    expect(readAdminLocation("?order=cur-7k3m2qx9")).toEqual({ tab: "payments", order: "CUR-7K3M2QX9" });
    expect(readAdminLocation("?tab=accounts&order=7K3M 2QX9")).toEqual({ tab: "accounts", order: "CUR-7K3M2QX9" });
    expect(readAdminLocation("?order=hello")).toEqual({ tab: "payments", order: "hello" });
    expect(readAdminLocation(`?order=${"x".repeat(200)}`).order).toHaveLength(64);
  });

  it("writes plain /admin for the first tab, and the tab with any open order", () => {
    expect(adminHref("accounts", null)).toBe("/admin");
    expect(adminHref("payments", null)).toBe("/admin?tab=payments");
    expect(adminHref("payments", "CUR-7K3M2QX9")).toBe("/admin?tab=payments&order=CUR-7K3M2QX9");
    expect(adminHref("accounts", "CUR-7K3M2QX9")).toBe("/admin?tab=accounts&order=CUR-7K3M2QX9");
    expect(readAdminLocation(adminHref("plans", "CUR-7K3M2QX9").split("?")[1])).toEqual({ tab: "plans", order: "CUR-7K3M2QX9" });
  });
});

describe("status filters", () => {
  it("lists All, Needs attention and every status with its count", () => {
    const chips = statusFilters(COUNTS);
    expect(chips.map(chip => chip.id)).toEqual(["all", "attention", "awaiting_payment", "pending", "confirming", "review", "completed", "rejected", "expired"]);
    expect(chips[0]).toEqual({ id: "all", label: "All", count: 42 });
    expect(chips[1]).toEqual({ id: "attention", label: "Needs attention", count: 3 });
    expect(chips.find(chip => chip.id === "pending")).toEqual({ id: "pending", label: "Checking the network", count: 1 });
  });

  it("has no counts until the overview loads", () => {
    expect(statusFilters(null).every(chip => chip.count === null)).toBe(true);
    expect(filterTotal("completed", undefined)).toBeNull();
    expect(filterTotal("attention", COUNTS)).toBe(3);
  });

  it("knows its filters", () => {
    expect(isOrderFilter("attention")).toBe(true);
    expect(isOrderFilter("expired")).toBe(true);
    expect(isOrderFilter("toString")).toBe(false);
  });

  it("says what the table shows", () => {
    expect(listSummary("all", 50, true, 132, "")).toBe("Showing 50 of 132 orders, newest first");
    expect(listSummary("attention", 3, false, 3, "")).toBe("3 orders in review, newest first");
    expect(listSummary("pending", 1, false, 1, "")).toBe("1 order being checked on the network, newest first");
    expect(listSummary("completed", 0, false, 0, "")).toBe("No completed orders");
    expect(listSummary("completed", 2, false, null, " mouno ")).toBe("2 completed orders matching “mouno”");
    expect(listSummary("all", 50, true, null, "0xab")).toBe("The newest 50 orders matching “0xab”");
    expect(listSummary("expired", 0, false, null, "zz")).toBe("No expired orders match “zz”");
  });

  it("keeps revenue short enough for a stat tile", () => {
    expect(compactUsd(2)).toBe("$2.00");
    expect(compactUsd(9999.99)).toBe("$9,999.99");
    expect(compactUsd(10_000)).toBe("$10K");
    expect(compactUsd(12_345.67)).toBe("$12.3K");
    expect(compactUsd(999_950)).toBe("$1M");
    expect(compactUsd(1_250_000)).toBe("$1.3M");
    expect(compactUsd(-12_345)).toBe("-$12.3K");
  });

  it("adds a page without repeating orders, and replaces one in place", () => {
    const a = order({ code: "CUR-AAAAAAAA" });
    const b = order({ code: "CUR-BBBBBBBB" });
    const c = order({ code: "CUR-CCCCCCCC" });
    expect(appendOrders([a, b], [b, c]).map(entry => entry.code)).toEqual(["CUR-AAAAAAAA", "CUR-BBBBBBBB", "CUR-CCCCCCCC"]);
    const approved = { ...b, status: "completed" as const };
    expect(replaceOrder([a, b, c], approved)[1]).toBe(approved);
  });

  it("starts the next page after the rows still in the filter", () => {
    // Three orders in review, one approved here: on the server the review list moved up by one.
    const rows = [order(), order({ status: "completed" }), order()];
    expect(nextOffset(rows, "attention")).toBe(2);
    expect(nextOffset(rows, "review")).toBe(2);
    expect(nextOffset(rows, "all")).toBe(3);
    expect(nextOffset(rows, "expired")).toBe(0);
  });
});

describe("what an order shows", () => {
  it("names the method and links the wallet", () => {
    expect(methodText(order())).toBe("USDT on BNB Chain (BEP-20)");
    expect(methodText(order({ network: null, coin: null }))).toBeNull();
    expect(explorerAddressUrl("solana", "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i")).toBe("https://solscan.io/account/9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i");
    expect(explorerAddressUrl("bnb", null)).toBeNull();
  });

  it("compares amounts as numbers written in decimals", () => {
    expect(sameAmount("2.0037", "2.00370")).toBe(true);
    expect(sameAmount("02.0037", "2.0037")).toBe(true);
    expect(sameAmount("1", "1.0")).toBe(true);
    expect(sameAmount("2.0037", "2.0036")).toBe(false);
    expect(sameAmount(null, "2")).toBe(false);
    expect(sameAmount("", "")).toBe(false);
  });

  it("says what the check found from what the server stored", () => {
    expect(chainFinding(order({ receivedAmount: "1.5" }))).toEqual({ tone: "warning", text: "The transaction sent 1.5 USDT; the order expects exactly 2.0037 USDT." });
    expect(chainFinding(order({ receivedAmount: "0" })).text).toBe("The transaction didn't send any USDT to the wallet.");
    expect(chainFinding(order({ receivedAmount: null })).tone).toBe("neutral");
    expect(chainFinding(order({ txHash: null })).text).toBe("The payer hasn't submitted a transaction hash.");
    expect(chainFinding(order({ network: null, coin: null, expectedAmount: null })).text).toContain("No payment details");
    expect(confirmationsText(order({ confirmations: null }))).toBeNull();
  });

  it("passes only a payment the server verified, not just the right amount", () => {
    const verified = order({ chainVerifiedAt: inDays(-1), statusDetail: "Verified on-chain: waiting for the operator." });
    expect(chainFinding(verified)).toEqual({ tone: "success", text: "Verified on-chain: the transaction sent exactly 2.0037 USDT, with 20 of 20 confirmations." });
    // The exact amount, stopped for a reason: two providers disagree (not counted yet), the wrong time, already paid another order, gone from its block.
    for (const [statusDetail, confirmations] of [
      ["Two network providers disagree about this transaction, so it is checked by hand.", null],
      ["This transaction arrived after the payment window closed.", null],
      ["This transaction already paid another order.", 20],
      ["We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.", 20],
    ] as const) {
      expect(chainFinding(order({ statusDetail, confirmations }))).toEqual({ tone: "warning", text: "A check found exactly 2.0037 USDT sent to the wallet, but the payment isn't verified." });
    }
    // Still being checked: a second provider hasn't agreed yet (with every confirmation in), still counting, or looking again after a reorganisation.
    expect(chainFinding(order({ status: "confirming", statusDetail: "Confirmed; double-checking it with a second network provider." })))
      .toEqual({ tone: "neutral", text: "A check found exactly 2.0037 USDT sent to the wallet, with 20 of 20 confirmations; it isn't verified yet." });
    expect(chainFinding(order({ status: "confirming", confirmations: 7 })).text).toBe("A check found exactly 2.0037 USDT sent to the wallet, with 7 of 20 confirmations so far; it isn't verified yet.");
    expect(chainFinding(order({ status: "pending", confirmations: null, statusDetail: "Seen on the network, waiting for a block." })))
      .toEqual({ tone: "neutral", text: "A check found exactly 2.0037 USDT sent to the wallet; it isn't verified yet." });
    // Approved by hand without a verified check.
    expect(chainFinding(order({ status: "completed" }))).toEqual({ tone: "neutral", text: "A check found exactly 2.0037 USDT sent to the wallet, but the payment wasn't verified on-chain." });
  });

  it("words the approve confirmation by what the check found", () => {
    // A short payment: the server's reason only repeats the amounts, and approving gives the order in full anyway.
    const short = order({
      kind: "api", planId: null, planDays: null, planCreditsPerWindow: null, title: "API balance · $25", listUsd: 25, priceUsd: 25, creditUsd: 25, expectedAmount: "25.0037", receivedAmount: "2.5",
      statusDetail: "This transaction sent 2.5 USDT to the Curialy wallet; this order expects exactly 25.0037 USDT.",
    });
    expect(approveDetail(short, chainFinding(short))).toBeNull();
    expect(approveCaution(short, chainFinding(short))).toBe("Approving adds the full $25.00 anyway: approve it only if the rest reached the wallet some other way, or you're choosing to cover it.");
    const nothing = order({ receivedAmount: "0", statusDetail: "This transaction didn't send USDT on BNB Chain to the Curialy wallet." });
    expect(approveDetail(nothing, chainFinding(nothing))).toBe("This transaction didn't send USDT on BNB Chain to the Curialy wallet.");
    expect(approveCaution(nothing, chainFinding(nothing))).toMatch(/^Approving gives the whole plan anyway: /);
    // The right amount, not verified: the reason stays, and the operator should have seen the payment arrive.
    const disputed = order({ statusDetail: "Two network providers disagree about this transaction, so it is checked by hand.", confirmations: null });
    expect(approveDetail(disputed, chainFinding(disputed))).toBe("Two network providers disagree about this transaction, so it is checked by hand.");
    expect(approveCaution(disputed, chainFinding(disputed))).toBe("Approve it only if you've seen the payment arrive.");
    expect(approveCaution(order({ receivedAmount: "3" }), chainFinding(order({ receivedAmount: "3" })))).toBe("Approve it only if you've seen the payment arrive.");
    // Verified: no caution, and "waiting for the operator" would only repeat the finding.
    const verified = order({ chainVerifiedAt: inDays(-1), statusDetail: "Verified on-chain: waiting for the operator." });
    expect(approveCaution(verified, chainFinding(verified))).toBeNull();
    expect(approveDetail(verified, chainFinding(verified))).toBeNull();
    expect(approveDetail(order({ statusDetail: "  " }), chainFinding(order()))).toBeNull();
  });

  it("notices an order that moved on while a decision was open", () => {
    const seen = order({ receivedAmount: null, statusDetail: "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network." });
    expect(orderChangeText(seen, seen)).toBeNull();
    // Counting confirmations isn't a change that needs another look.
    expect(orderChangeText(order({ status: "confirming", confirmations: 7 }), order({ status: "confirming", confirmations: 8 }))).toBeNull();
    expect(orderChangeText(seen, order({ status: "pending", txHash: OTHER_HASH, receivedAmount: null })))
      .toBe("The payer submitted a different transaction hash while you had this order open, and it's now checking the network. Read it again before you decide.");
    expect(orderChangeText(order({ status: "pending" }), order({ status: "pending", txHash: OTHER_HASH })))
      .toBe("The payer submitted a different transaction hash while you had this order open. Read it again before you decide.");
    expect(orderChangeText(order({ status: "confirming" }), order({ status: "review" }))).toBe("This order is now in review (it was confirming when you opened it). Read it again before you decide.");
    expect(orderChangeText(order({ status: "confirming" }), order({ status: "completed" }))).toBe("This order completed while you had it open, so there is nothing left to decide.");
    expect(orderChangeText(order({ status: "pending", receivedAmount: null }), order({ status: "pending" }))).toMatch(/^The on-chain check found something new/);
    expect(orderChangeText(order(), order({ receivedAmount: "2.00370" }))).toBeNull();
  });

  it("says what completing it did", () => {
    const name = (id: string) => (id === "pro" ? "Pro" : "Max");
    expect(appliedText(order({ applied: { planId: "max", planExpiresAt: "2026-12-09T12:00:00.000Z", effect: "upgrade" } }), name, day)).toBe("Max until 2026-12-09 · upgraded");
    expect(appliedText(order({ kind: "api", applied: { apiBalanceAddedUsd: 25 } }), name, day)).toBe("$25.00 added to the API balance");
    expect(appliedText(order(), name, day)).toBeNull();
  });
});

describe("what approving an order gives", () => {
  const plans = DEFAULT_PLANS;
  const plan = (id: "pro" | "max", expiresIn: number) => ({ id, name: plans[id].name, expiresAt: inDays(expiresIn), creditsPerWindow: plans[id].creditsPerWindow });

  it("adds a top-up's balance", () => {
    expect(approveText(order({ kind: "api", planId: null, title: "API balance · $25", priceUsd: 25, creditUsd: 25 }), null, plans, day, NOW)).toBe("Adds $25.00 to @mouno19's API balance.");
  });

  const maxOrder = (patch: Partial<AdminPaymentOrder> = {}) => order({ planId: "max", planDays: 30, planCreditsPerWindow: 30_000, title: "Max · 30 days", listUsd: 80, priceUsd: 8, ...patch });

  it("starts, extends or upgrades the plan like a purchase", () => {
    expect(approveText(order(), null, plans, day, NOW)).toBe(`Gives @mouno19 Pro for 30 days, starting now: until about ${day(inDays(30))}, with 6,000 credits per window.`);
    expect(approveText(order(), plan("pro", 10), plans, day, NOW)).toBe(`Adds 30 days to @mouno19's Pro plan: until about ${day(inDays(40))}, with 6,000 credits per window.`);
    expect(approveText(maxOrder(), plan("pro", 12), plans, day, NOW))
      .toBe(`Upgrades @mouno19 from Pro to Max now, with the days left carried over at their value: until about ${day(inDays(33))}, with 30,000 credits per window.`);
    // A month of Pro is worth a quarter of a month of Max; Max keeps its own allowance.
    expect(approveText(order(), plan("max", 5), plans, day, NOW)).toBe(`Adds the value of 30 days of Pro to @mouno19's Max plan: until about ${day(inDays(12.5))}, keeping its 30,000 credits per window.`);
  });

  it("gives the plan as it was sold, even when the plan has changed since", () => {
    // Pro was sold as 30 days at $20 with 6,000 credits; it is now 60 days at $30 with 10,000.
    const changed = { ...plans, pro: { ...plans.pro, days: 60, priceUsd: 30, creditsPerWindow: 10_000 } };
    expect(approveText(order(), null, changed, day, NOW)).toBe(`Gives @mouno19 Pro for 30 days, starting now: until about ${day(inDays(30))}, with 6,000 credits per window.`);
    // Max sold at $80 list, then repriced to $160: 10 days of Pro carry over at the price it was sold at (2.5 days, not 1.25).
    const pricier = { ...plans, max: { ...plans.max, priceUsd: 160 } };
    expect(approveText(maxOrder(), plan("pro", 10), pricier, day, NOW)).toContain(`until about ${day(inDays(32.5))},`);
    // An extension keeps the larger allowance: the account's own, or the one sold.
    expect(approveText(order(), { ...plan("pro", 10), creditsPerWindow: 8_000 }, plans, day, NOW)).toBe(`Adds 30 days to @mouno19's Pro plan: until about ${day(inDays(40))}, with 8,000 credits per window.`);
    // An order from before the terms were kept on it falls back to the plan's settings.
    expect(approveText(order({ planDays: null, planCreditsPerWindow: null }), null, changed, day, NOW)).toBe(`Gives @mouno19 Pro for 60 days, starting now: until about ${day(inDays(60))}, with 10,000 credits per window.`);
  });

  it("treats a plan that has ended as none, and doesn't guess without the account's plan", () => {
    expect(approveText(order(), plan("max", -1), plans, day, NOW)).toContain("starting now");
    expect(approveText(order(), undefined, plans, day, NOW)).toBe("Gives @mouno19 Pro · 30 days the way a purchase does: it starts, extends or upgrades their plan.");
    expect(approveText(order({ user: { id: "u2", login: null, name: "Ada" } }), undefined, null, day, NOW)).toContain("Gives Ada ");
  });
});
