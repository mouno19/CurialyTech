import { describe, expect, it } from "vitest";
import type { PaymentEvent, PaymentOrder } from "@shared/billing";
import { dayText } from "./format";
import { addressParts, canSubmitHash, clockLeft, completedText, confirmationShare, confirmationText, doubleCheck, hashProblem, methodText, milestone, orderTimeline, payView, pollDelay, retryDelay, shortHash, shownStatus, submitDeadline, transferFound } from "./orderState";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const HASH = `0x${"ab".repeat(32)}`;
const WALLET = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";

function order(patch: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    code: "CUR-7K3M2QX9", kind: "plan", planId: "pro", planDays: 30, planCreditsPerWindow: 6000, title: "Pro · 30 days", listUsd: 20, discountPercent: 90, priceUsd: 2, creditUsd: null,
    network: null, coin: null, payAddress: null, expectedAmount: null, quoteUsdPrice: null, txHash: null, receivedAmount: null, status: "awaiting_payment", statusDetail: null,
    confirmations: null, requiredConfirmations: null, createdAt: at(-5), quotedAt: null, expiresAt: at(25), submitUntil: null, submittedAt: null,
    completedAt: null, applied: null, explorerUrl: null, events: [{ status: "awaiting_payment", actor: "customer", note: null, at: at(-5) }],
    ...patch,
  };
}
const issued = (patch: Partial<PaymentOrder> = {}) => order({ network: "bnb", coin: "USDT", payAddress: WALLET, expectedAmount: "2.0037", quotedAt: at(-4), ...patch });
const event = (status: PaymentEvent["status"], minutes: number, actor: PaymentEvent["actor"] = "system"): PaymentEvent => ({ status, actor, note: null, at: at(minutes) });

describe("payView and shownStatus", () => {
  it("picks the panel from the status and whether the details are issued", () => {
    expect(payView(order(), NOW)).toBe("choose");
    expect(payView(issued(), NOW)).toBe("pay");
    expect(payView(issued({ status: "pending", txHash: HASH }), NOW)).toBe("pending");
    expect(payView(issued({ status: "review" }), NOW)).toBe("review");
  });

  it("flips an order awaiting payment to expired at its deadline, before the server's sweep", () => {
    const due = issued({ expiresAt: at(0) });
    expect(shownStatus(due, NOW - 1)).toBe("awaiting_payment");
    expect(shownStatus(due, NOW)).toBe("expired");
    expect(payView(due, NOW)).toBe("expired");
    // Only an order awaiting payment expires: one being checked keeps its status.
    expect(shownStatus(issued({ status: "pending", expiresAt: at(-10) }), NOW)).toBe("pending");
  });
});

describe("canSubmitHash", () => {
  it("needs issued details", () => {
    expect(canSubmitHash(order(), NOW)).toBe(false);
    expect(canSubmitHash(issued(), NOW)).toBe(true);
  });

  it("takes a replacement while checking or in review, never while confirming or once settled", () => {
    expect(canSubmitHash(issued({ status: "pending" }), NOW)).toBe(true);
    expect(canSubmitHash(issued({ status: "review" }), NOW)).toBe(true);
    expect(canSubmitHash(issued({ status: "confirming" }), NOW)).toBe(false);
    expect(canSubmitHash(issued({ status: "completed" }), NOW)).toBe(false);
    expect(canSubmitHash(issued({ status: "rejected" }), NOW)).toBe(false);
  });

  it("takes a late hash on an expired order until submitUntil (the server's, else 24 hours after expiry)", () => {
    const expired = issued({ status: "expired", expiresAt: at(-60) });
    expect(submitDeadline(expired)).toBe(NOW - 3_600_000 + 24 * 3_600_000);
    expect(canSubmitHash(expired, NOW)).toBe(true);
    expect(canSubmitHash(expired, NOW + 23 * 3_600_000)).toBe(false);
    const reported = issued({ status: "expired", expiresAt: at(-60), submitUntil: at(30) });
    expect(canSubmitHash(reported, NOW + 29 * 60_000)).toBe(true);
    expect(canSubmitHash(reported, NOW + 30 * 60_000)).toBe(false);
    // Expired before any details: there is nothing a transaction could have paid.
    expect(canSubmitHash(order({ status: "expired", expiresAt: at(-60) }), NOW)).toBe(false);
  });
});

describe("pollDelay and retryDelay", () => {
  it("polls fast while checking, slowly while awaiting payment or in review, and stops once it's settled", () => {
    expect(pollDelay("pending")).toBe(5_000);
    expect(pollDelay("confirming")).toBe(5_000);
    expect(pollDelay("awaiting_payment")).toBe(20_000);
    // The operator's decision shows on a page left open.
    expect(pollDelay("review")).toBe(30_000);
    for (const status of ["completed", "rejected", "expired"] as const) expect(pollDelay(status)).toBeNull();
  });

  it("keeps asking after a failure, backing off to a minute and never faster than the status's pace", () => {
    expect([1, 2, 3, 4, 5, 9].map(failures => retryDelay(failures, 5_000))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect([1, 3, 4].map(failures => retryDelay(failures, 20_000))).toEqual([20_000, 20_000, 40_000]);
    expect(retryDelay(1, 30_000)).toBe(30_000);
  });
});

describe("formatting", () => {
  it("shows a countdown as a clock", () => {
    expect(clockLeft(1745)).toBe("29:05");
    expect(clockLeft(59)).toBe("0:59");
    expect(clockLeft(3725)).toBe("1:02:05");
    expect(clockLeft(-3)).toBe("0:00");
  });

  it("splits an address into the parts to check (after 0x on EVM)", () => {
    expect(addressParts(WALLET)).toEqual({ prefix: "0x", head: "6FD853", middle: "FE610A76b20E1B02751bc5eD3716", tail: "D3894b" });
    const solana = "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i";
    const parts = addressParts(solana);
    expect(parts).toMatchObject({ prefix: "", head: "9bXLFJ", tail: "fU5K7i" });
    expect(parts.prefix + parts.head + parts.middle + parts.tail).toBe(solana);
    expect(addressParts("0xabc")).toEqual({ prefix: "0x", head: "abc", middle: "", tail: "" });
  });

  it("names the method with the token standard for stablecoins", () => {
    expect(methodText("bnb", "USDT")).toBe("USDT · BEP-20 on BNB Chain");
    expect(methodText("ethereum", "ETH")).toBe("ETH on Ethereum");
    expect(methodText("solana", "BNB")).toBeNull();
    expect(methodText(null, null)).toBeNull();
  });

  it("shortens hashes and reports confirmations as the server counted them", () => {
    expect(shortHash(HASH)).toBe("0xabababab…ababab");
    expect(shortHash(null)).toBeNull();
    expect(confirmationText({ confirmations: 7, requiredConfirmations: 20 })).toBe("7 of 20 confirmations");
    expect(confirmationText({ confirmations: 23, requiredConfirmations: 20 })).toBe("20 of 20 confirmations");
    expect(confirmationText({ confirmations: null, requiredConfirmations: 20 })).toBeNull();
    expect(confirmationShare({ confirmations: 5, requiredConfirmations: 20 })).toBe(0.25);
    expect(confirmationShare({ confirmations: 40, requiredConfirmations: 20 })).toBe(1);
    expect(confirmationText({ confirmations: 0, requiredConfirmations: 1 })).toBe("Waiting for finalization");
    expect(confirmationText({ confirmations: 1, requiredConfirmations: 1 })).toBe("Finalized");
  });
});

describe("transferFound", () => {
  const review = (patch: Partial<PaymentOrder>) => issued({ status: "review", txHash: HASH, ...patch });

  it("finds nothing when the check saw no transfer to the wallet", () => {
    // Not found, failed or sent through a contract: nothing kept.
    expect(transferFound(review({}))).toBe("none");
    // Another coin or nothing to the wallet: the server keeps "0".
    expect(transferFound(review({ receivedAmount: "0" }))).toBe("none");
  });

  it("tells a transfer that doesn't match from one that does", () => {
    // Another amount (an exchange kept its fee).
    expect(transferFound(review({ receivedAmount: "1.5037" }))).toBe("other");
    // The right amount outside the order's window: never in a block for this order.
    expect(transferFound(review({ receivedAmount: "2.0037" }))).toBe("other");
    // Exactly the amount, in a block: verified and waiting for the operator, or a second check that ran out.
    expect(transferFound(review({ receivedAmount: "2.0037", confirmations: 20, requiredConfirmations: 20 }))).toBe("match");
    expect(transferFound(review({ receivedAmount: "2.0037", confirmations: 7, requiredConfirmations: 20 }))).toBe("match");
  });
});

describe("doubleCheck", () => {
  const DOUBLE = "Confirmed; double-checking it with a second network provider.";

  it("reads a confirming order at its full count as the server's second check", () => {
    expect(doubleCheck(issued({ status: "confirming", confirmations: 21, requiredConfirmations: 20, statusDetail: DOUBLE }))).toBe(DOUBLE);
    expect(doubleCheck(issued({ status: "confirming", network: "solana", confirmations: 1, requiredConfirmations: 1, statusDetail: DOUBLE }))).toBe(DOUBLE);
    expect(doubleCheck(issued({ status: "confirming", confirmations: 7, requiredConfirmations: 20, statusDetail: "7 of 20 confirmations" }))).toBeNull();
    expect(doubleCheck(issued({ status: "completed", confirmations: 20, requiredConfirmations: 20 }))).toBeNull();
  });
});

describe("hashProblem", () => {
  it("accepts a hash for the order's network", () => {
    expect(hashProblem("bnb", `  ${HASH.toUpperCase().replace("0X", "0x")} `)).toBeNull();
    expect(hashProblem("solana", "5".repeat(88))).toBeNull();
  });

  it("says what was pasted instead", () => {
    expect(hashProblem("bnb", "")).toMatch(/first/);
    expect(hashProblem("bnb", WALLET)).toMatch(/wallet address/);
    expect(hashProblem("bnb", "5".repeat(88))).toMatch(/Solana signature.*BNB Chain/);
    expect(hashProblem("bnb", "0x1234")).toMatch(/BNB Chain transaction hash is 0x followed by 64/);
    expect(hashProblem("solana", HASH)).toMatch(/Ethereum-style hash/);
    expect(hashProblem("solana", "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i")).toMatch(/wallet address/);
    expect(hashProblem("solana", "not a hash")).toMatch(/about 88/);
  });
});

describe("orderTimeline", () => {
  const keys = (steps: ReturnType<typeof orderTimeline>) => steps.map(step => `${step.key}:${step.state}`);

  it("asks for a method first, then for the transaction", () => {
    expect(keys(orderTimeline(order(), NOW))).toEqual(["created:done", "details:current", "submitted:todo", "chain:todo", "completed:todo"]);
    const steps = orderTimeline(issued(), NOW);
    expect(keys(steps)).toEqual(["created:done", "details:done", "submitted:current", "chain:todo", "completed:todo"]);
    expect(steps[1]).toMatchObject({ at: at(-4), detail: "2.0037 USDT on BNB Chain" });
    expect(steps[3].label).toBe("Confirmed on BNB Chain");
  });

  it("follows the check on the network with the server's detail and counts", () => {
    const pending = orderTimeline(issued({ status: "pending", txHash: HASH, submittedAt: at(-2), statusDetail: "Not on the network yet: a new transaction can take a minute to show up." }), NOW);
    expect(keys(pending)).toEqual(["created:done", "details:done", "submitted:done", "chain:current", "completed:todo"]);
    expect(pending[2]).toMatchObject({ at: at(-2), detail: "0xabababab…ababab" });
    expect(pending[3]).toMatchObject({ label: "Looking for it on BNB Chain", detail: "Not on the network yet: a new transaction can take a minute to show up." });
    const confirming = orderTimeline(issued({ status: "confirming", txHash: HASH, submittedAt: at(-2), confirmations: 7, requiredConfirmations: 20, events: [event("pending", -2, "customer"), event("confirming", -1)] }), NOW);
    expect(confirming[3]).toMatchObject({ label: "Confirming on BNB Chain", state: "current", at: at(-1), detail: "7 of 20 confirmations" });
  });

  it("says a second provider is checking instead of a full count", () => {
    const DOUBLE = "Confirmed; double-checking it with a second network provider.";
    const checking = issued({ status: "confirming", txHash: HASH, submittedAt: at(-3), confirmations: 21, requiredConfirmations: 20, statusDetail: DOUBLE, events: [event("pending", -3, "customer"), event("confirming", -2)] });
    expect(orderTimeline(checking, NOW)[3]).toMatchObject({ label: "Confirming on BNB Chain", detail: DOUBLE });
    expect(milestone(checking, "confirming")).toBe(`Transaction found on BNB Chain. ${DOUBLE}`);
    // Solana's single step reads the same, not "Finalized".
    const solana = issued({ network: "solana", coin: "USDC", status: "confirming", txHash: "5".repeat(88), confirmations: 1, requiredConfirmations: 1, statusDetail: DOUBLE, events: [event("pending", -3, "customer")] });
    expect(orderTimeline(solana, NOW)[3].detail).toBe(DOUBLE);
  });

  it("dates the hash and its check from the last one the payer submitted", () => {
    // A confirming first hash went to review; the payer replaced it with one that can't be found.
    const replaced = orderTimeline(issued({
      status: "review", txHash: HASH, submittedAt: at(-90), statusDetail: "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.",
      events: [event("pending", -90, "customer"), event("confirming", -89), event("review", -29), event("pending", -28, "customer"), event("review", -1)],
    }), NOW);
    expect(keys(replaced)).toEqual(["created:done", "details:done", "submitted:done", "review:attention"]);
    expect(replaced[2].at).toBe(at(-28));
    // Found again after a reorganisation: the step stays, dated from the first find of this hash.
    const refound = orderTimeline(issued({
      status: "review", txHash: HASH, statusDetail: "Verified on-chain: waiting for the operator.", confirmations: 20, requiredConfirmations: 20, receivedAmount: "2.0037",
      events: [event("pending", -40, "customer"), event("confirming", -39), event("pending", -38), event("confirming", -37), event("review", -30)],
    }), NOW);
    expect(refound.find(step => step.key === "chain")).toMatchObject({ label: "Found on BNB Chain", state: "done", at: at(-39) });
  });

  it("says confirmed only when the system completed it, and names an operator's approval", () => {
    const auto = orderTimeline(issued({ status: "completed", txHash: HASH, submittedAt: at(-3), completedAt: at(-1), confirmations: 20, requiredConfirmations: 20, applied: { planId: "pro", planExpiresAt: at(43_200), effect: "start" }, events: [event("pending", -3, "customer"), event("confirming", -2), event("completed", -1)] }), NOW);
    expect(keys(auto)).toEqual(["created:done", "details:done", "submitted:done", "chain:done", "completed:done"]);
    expect(auto[3].label).toBe("Confirmed on BNB Chain");
    expect(auto[4]).toMatchObject({ at: at(-1), detail: "Plan applied" });

    // Approved from review without the chain ever confirming it: no "confirmed" step.
    const approved = orderTimeline(issued({ status: "completed", kind: "api", planId: null, creditUsd: 25, txHash: HASH, submittedAt: at(-50), completedAt: at(-1), applied: { apiBalanceAddedUsd: 25 }, events: [event("pending", -50, "customer"), event("review", -20), event("completed", -1, "admin")] }), NOW);
    expect(keys(approved)).toEqual(["created:done", "details:done", "submitted:done", "completed:done"]);
    expect(approved[3].detail).toBe("Approved by the operator · $25.00 added to your API balance");
  });

  it("ends in review, rejected or expired with what happened", () => {
    const review = orderTimeline(issued({ status: "review", txHash: HASH, submittedAt: at(-40), statusDetail: "We couldn't find this transaction on BNB Chain after 30 minutes.", events: [event("pending", -40, "customer"), event("review", -10)] }), NOW);
    expect(keys(review)).toEqual(["created:done", "details:done", "submitted:done", "review:attention"]);
    expect(review[3]).toMatchObject({ at: at(-10), detail: "We couldn't find this transaction on BNB Chain after 30 minutes." });

    const rejected = orderTimeline(issued({ status: "rejected", statusDetail: "Paid on another network.", events: [event("rejected", -3, "admin")] }), NOW);
    expect(keys(rejected)).toEqual(["created:done", "details:done", "rejected:failed"]);

    const lapsed = orderTimeline(order({ expiresAt: at(-1) }), NOW);
    expect(keys(lapsed)).toEqual(["created:done", "expired:ended"]);
    expect(lapsed[1]).toMatchObject({ at: at(-1), detail: "It expired before payment details were issued." });
    const swept = orderTimeline(issued({ status: "expired", expiresAt: at(-3), events: [event("expired", -2)] }), NOW);
    expect(keys(swept)).toEqual(["created:done", "details:done", "expired:ended"]);
    expect(swept[2].at).toBe(at(-2));
  });
});

describe("completedText", () => {
  const names = (id: string) => (id === "max" ? "Max" : "Pro");
  const until = at(43_200);
  const done = (patch: Partial<PaymentOrder>) => issued({ status: "completed", txHash: HASH, completedAt: at(-1), ...patch });

  it("says what the payment did in the present only while the account's plan is still the one it left", () => {
    const start = done({ applied: { planId: "pro", planExpiresAt: until, effect: "start" } });
    expect(completedText(start, names, { id: "pro", expiresAt: until }, 8)).toBe(`Pro is active until ${dayText(until)}, with 6,000 credits every 8 hours.`);
    // Extended since (or ended, or changed by the operator): what this payment gave, in the past.
    expect(completedText(start, names, { id: "pro", expiresAt: at(86_400) }, 8)).toBe(`This payment gave you Pro until ${dayText(until)}, with 6,000 credits every 8 hours.`);
    expect(completedText(start, names, null, 8)).toBe(`This payment gave you Pro until ${dayText(until)}, with 6,000 credits every 8 hours.`);
  });

  it("states the allowance the order bought, not today's settings, and only where it gave that plan", () => {
    // Bought when Pro gave 5,000: that's what it applied, whatever Pro gives now.
    const older = done({ planCreditsPerWindow: 5000, applied: { planId: "pro", planExpiresAt: until, effect: "start" } });
    expect(completedText(older, names, { id: "pro", expiresAt: until }, 8)).toContain("with 5,000 credits every 8 hours");
    // Pro bought on Max adds days to Max: the account keeps Max's allowance, so none is stated.
    const higher = done({ applied: { planId: "max", planExpiresAt: until, effect: "extend_higher" } });
    expect(completedText(higher, names, { id: "max", expiresAt: until }, 8)).toBe(`Your Max plan now runs until ${dayText(until)}; this purchase was added to it in days.`);
    expect(completedText(higher, names, null, 8)).toBe(`This payment added days to your Max plan, up to ${dayText(until)}.`);
    const extend = done({ applied: { planId: "pro", planExpiresAt: until, effect: "extend" } });
    expect(completedText(extend, names, null, 8)).toBe(`This payment extended Pro to ${dayText(until)}.`);
    // An order placed before plans were fixed on orders: no figure rather than today's.
    expect(completedText(done({ planCreditsPerWindow: null, applied: { planId: "pro", planExpiresAt: until, effect: "start" } }), names, null, 8)).toBe(`This payment gave you Pro until ${dayText(until)}.`);
  });

  it("names a top-up's balance", () => {
    expect(completedText(done({ kind: "api", planId: null, applied: { apiBalanceAddedUsd: 25 } }), names, null, 8)).toBe("$25.00 was added to your API balance. Your API keys on the Developer API page spend it.");
    expect(completedText(done({ applied: null }), names, null, 8)).toBe("Your payment is complete.");
  });
});

describe("milestone", () => {
  it("announces each new panel in plain words", () => {
    expect(milestone(issued(), "pay")).toBe("Payment details are ready: send exactly 2.0037 USDT on BNB Chain.");
    expect(milestone(issued({ confirmations: 3, requiredConfirmations: 20 }), "confirming")).toBe("Transaction found on BNB Chain: 3 of 20 confirmations.");
    expect(milestone(issued({ status: "review", statusDetail: "The amount was different." }), "review")).toBe("This payment is in review. The amount was different.");
    expect(milestone(order(), "choose")).toBeNull();
  });
});
