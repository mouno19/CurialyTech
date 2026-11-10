import { formatUsd, LATE_SUBMIT_HOURS, networkInfo, normalizeTxHash, type PaymentEvent, type PaymentOrder, type PaymentStatus } from "@shared/billing";
import { creditCount, dayText } from "./format";

// The payment page's reading of an order: which panel it shows, what the check found, what the
// timeline and the success panel say, and when to ask the server again. Everything comes from what
// the server reported. The one thing worked out
// here is the deadline: an order still awaiting payment past expiresAt shows as expired at once
// (the server's sweep catches up within a minute), and a step is only shown as done with evidence.

export type PayView = "choose" | "pay" | "pending" | "confirming" | "review" | "completed" | "rejected" | "expired";

type Details = Pick<PaymentOrder, "network" | "coin" | "payAddress" | "expectedAmount">;

/** The wallet, network, coin and exact amount are fixed on the order. */
export const detailsIssued = (order: Details) => Boolean(order.network && order.coin && order.payAddress && order.expectedAmount);

export function pastDeadline(iso: string | null | undefined, now = Date.now()) {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) && now >= at;
}

/** The status to show: an order still awaiting payment after its deadline has expired. */
export function shownStatus(order: Pick<PaymentOrder, "status" | "expiresAt">, now = Date.now()): PaymentStatus {
  return order.status === "awaiting_payment" && pastDeadline(order.expiresAt, now) ? "expired" : order.status;
}

/** Which panel the payment page shows for the order. */
export function payView(order: PaymentOrder, now = Date.now()): PayView {
  const status = shownStatus(order, now);
  if (status === "awaiting_payment") return detailsIssued(order) ? "pay" : "choose";
  return status;
}

/** Until when an order awaiting payment (or expired) still takes a transaction hash: the server's submitUntil, else its rule. */
export function submitDeadline(order: PaymentOrder): number | null {
  if (!detailsIssued(order)) return null;
  const reported = order.submitUntil ? Date.parse(order.submitUntil) : Number.NaN;
  if (Number.isFinite(reported)) return reported;
  const expires = Date.parse(order.expiresAt);
  return Number.isFinite(expires) ? expires + LATE_SUBMIT_HOURS * 3_600_000 : null;
}

/** The server takes a transaction hash for this order now (a first one, or one replacing the last). */
export function canSubmitHash(order: PaymentOrder, now = Date.now()) {
  if (!detailsIssued(order)) return false;
  if (order.status === "pending" || order.status === "review") return true;
  if (order.status !== "awaiting_payment" && order.status !== "expired") return false;
  const until = submitDeadline(order);
  return until !== null && now < until;
}

/**
 * How long until the page asks the server again: often while a payment is checked, slowly while one
 * is awaited or the operator reviews it (so a decision shows on an open page), never once it's settled.
 */
export function pollDelay(status: PaymentStatus): number | null {
  if (status === "pending" || status === "confirming") return 5_000;
  if (status === "awaiting_payment") return 20_000;
  if (status === "review") return 30_000;
  return null;
}

/** After `failures` failed asks in a row, the next one: 5, 10, 20, 40, then every 60 s, never sooner than `base` (the status's own pace). */
export function retryDelay(failures: number, base: number) {
  return Math.max(base, Math.min(60_000, 5_000 * 2 ** Math.min(Math.max(0, failures - 1), 4)));
}

/**
 * What the check of the order's current hash found, from what the server kept: "none" (not found,
 * failed, or nothing reached the wallet), "other" (a transfer to the wallet that doesn't match this
 * order: another amount, or outside its window) or "match" (exactly this order's amount, found in a
 * block). Amounts are unique to an order, so a match is this order's payment, whoever decides on it.
 */
export function transferFound(order: Pick<PaymentOrder, "receivedAmount" | "expectedAmount" | "confirmations">): "none" | "other" | "match" {
  if (!order.receivedAmount || !(Number(order.receivedAmount) > 0)) return "none";
  return order.receivedAmount === order.expectedAmount && order.confirmations !== null ? "match" : "other";
}

/**
 * A confirming order that already has its confirmations is waiting on the server's second check (a
 * second network provider must agree before it counts): the server's detail says so, or null.
 */
export function doubleCheck(order: Pick<PaymentOrder, "status" | "statusDetail" | "confirmations" | "requiredConfirmations">) {
  return order.status === "confirming" && confirmationShare(order) === 1 && order.statusDetail ? order.statusDetail : null;
}

/** "29:05", "1:02:05": whole seconds as a clock. */
export function clockLeft(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * A wallet address split for display. The first and last 6 characters (after "0x") are the ones to
 * check after pasting: address-poisoning scams plant look-alikes that differ only in the middle.
 */
export function addressParts(address: string) {
  const prefix = /^0x/i.test(address) ? address.slice(0, 2) : "";
  const body = address.slice(prefix.length);
  if (body.length <= 12) return { prefix, head: body, middle: "", tail: "" };
  return { prefix, head: body.slice(0, 6), middle: body.slice(6, -6), tail: body.slice(-6) };
}

/** "0x9f2c41d0…d07e3b" */
export function shortHash(hash: string | null | undefined) {
  if (!hash) return null;
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

/** "USDT · BEP-20 on BNB Chain", "BNB on BNB Chain" (null when the order has no method yet). */
export function methodText(network: string | null | undefined, coin: string | null | undefined) {
  const info = networkInfo(network);
  const entry = info?.coins.find(item => item.coin === coin);
  if (!info || !entry) return null;
  return entry.kind === "stablecoin" ? `${entry.coin} · ${entry.standard} on ${info.label}` : `${entry.coin} on ${info.label}`;
}

/** What a transaction hash looks like on the network (the field's hint). */
export function hashHint(network: string | null | undefined) {
  if (networkInfo(network)?.family === "solana") return "The transaction signature: about 88 letters and digits.";
  return "0x followed by 64 characters (0–9 and a–f).";
}

const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Why a pasted value can't be a transaction hash on the order's network, or null when it can. */
export function hashProblem(network: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Paste the transaction hash first.";
  if (normalizeTxHash(network, value)) return null;
  const info = networkInfo(network);
  if (!info) return "This order has no network yet.";
  if (info.family === "evm") {
    if (EVM_ADDRESS.test(value)) return "That looks like a wallet address. Paste the transaction hash: 0x and 64 characters.";
    if (SOLANA_SIGNATURE.test(value)) return `That looks like a Solana signature, but this order is paid on ${info.label}.`;
    return `A ${info.label} transaction hash is 0x followed by 64 characters (0–9 and a–f).`;
  }
  if (EVM_HASH.test(value)) return "That looks like an Ethereum-style hash, but this order is paid on Solana.";
  if (SOLANA_ADDRESS.test(value)) return "That looks like a wallet address. Paste the transaction signature: about 88 letters and digits.";
  return "A Solana transaction signature is about 88 letters and digits, with no spaces.";
}

/** "7 of 20 confirmations", from the server's numbers (never past the number required). */
export function confirmationText(order: Pick<PaymentOrder, "confirmations" | "requiredConfirmations">) {
  const required = order.requiredConfirmations;
  if (order.confirmations === null || !required) return null;
  // Solana has one step: finalized or not.
  if (required === 1) return order.confirmations >= 1 ? "Finalized" : "Waiting for finalization";
  return `${Math.min(Math.max(0, order.confirmations), required)} of ${required} confirmations`;
}

/** The share of confirmations reached, 0 to 1 (null without numbers). */
export function confirmationShare(order: Pick<PaymentOrder, "confirmations" | "requiredConfirmations">) {
  const required = order.requiredConfirmations;
  if (order.confirmations === null || !required) return null;
  return Math.min(1, Math.max(0, order.confirmations / required));
}

export type StepState = "done" | "current" | "todo" | "attention" | "failed" | "ended";
export type StepKey = "created" | "details" | "submitted" | "chain" | "completed" | "review" | "rejected" | "expired";
export type TimelineStep = { key: StepKey; label: string; state: StepState; at: string | null; detail: string | null };

const inOrder = (events: PaymentEvent[]) => [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const firstAt = (events: PaymentEvent[], status: PaymentStatus) => events.find(event => event.status === status)?.at ?? null;
const lastOf = (events: PaymentEvent[], status: PaymentStatus) => [...events].reverse().find(event => event.status === status) ?? null;
/** The events since the order's current hash was submitted (a hash is submitted, or replaced, by the payer moving it to pending). */
const sinceHash = (events: PaymentEvent[]) => {
  const index = events.findLastIndex(event => event.actor === "customer" && event.status === "pending");
  return index < 0 ? { submitted: null, after: events } : { submitted: events[index], after: events.slice(index + 1) };
};

/** What completing the order did, in a few words. */
function appliedShort(order: PaymentOrder) {
  if (order.kind === "api") {
    const added = order.applied?.apiBalanceAddedUsd;
    return typeof added === "number" ? `${formatUsd(added)} added to your API balance` : "Added to your API balance";
  }
  return "Plan applied";
}

/**
 * The order's progress: created, details issued, hash submitted, the on-chain check, completed; or
 * in review, rejected or expired. Times come from the order and its events. A historical step is
 * shown only with evidence for it (the operator can approve an order the chain check never confirmed).
 */
export function orderTimeline(order: PaymentOrder, now = Date.now()): TimelineStep[] {
  const status = shownStatus(order, now);
  const events = inOrder(order.events ?? []);
  const where = networkInfo(order.network)?.label ?? null;
  const on = where ? `on ${where}` : "on-chain";
  const issued = detailsIssued(order);
  const steps: TimelineStep[] = [{ key: "created", label: "Order created", state: "done", at: order.createdAt, detail: null }];

  if (issued) steps.push({ key: "details", label: "Payment details issued", state: "done", at: order.quotedAt, detail: `${order.expectedAmount} ${order.coin}${where ? ` on ${where}` : ""}` });
  else if (status === "awaiting_payment") steps.push({ key: "details", label: "Choose how to pay", state: "current", at: null, detail: null });

  if (status === "expired") {
    steps.push({
      key: "expired",
      label: "Expired",
      state: "ended",
      at: lastOf(events, "expired")?.at ?? order.expiresAt,
      detail: issued ? "The payment window closed without a transaction hash." : "It expired before payment details were issued.",
    });
    return steps;
  }

  const outcome = appliedShort(order);
  if (status === "awaiting_payment") {
    steps.push({ key: "submitted", label: "Transaction hash submitted", state: issued ? "current" : "todo", at: null, detail: null });
    steps.push({ key: "chain", label: `Confirmed ${on}`, state: "todo", at: null, detail: null });
    steps.push({ key: "completed", label: order.kind === "api" ? "Balance added" : "Plan applied", state: "todo", at: null, detail: null });
    return steps;
  }

  // The current hash: when it was submitted (the server's submittedAt is the first hash's), and what
  // the chain showed for it since (a hash it replaced may have been found; this one may not be).
  const current = sinceHash(events);
  const submittedAt = current.submitted?.at ?? order.submittedAt ?? firstAt(events, "pending");
  if (order.txHash || submittedAt) steps.push({ key: "submitted", label: "Transaction hash submitted", state: "done", at: submittedAt, detail: shortHash(order.txHash) });

  const counts = confirmationText(order);
  const foundAt = firstAt(current.after, "confirming");
  const completion = lastOf(events, "completed");
  if (status === "pending") steps.push({ key: "chain", label: `Looking for it ${on}`, state: "current", at: null, detail: order.statusDetail });
  else if (status === "confirming") steps.push({ key: "chain", label: `Confirming ${on}`, state: "current", at: foundAt, detail: doubleCheck(order) ?? counts ?? order.statusDetail });
  else if (status === "completed" && completion?.actor === "system") steps.push({ key: "chain", label: `Confirmed ${on}`, state: "done", at: foundAt, detail: counts });
  else if (foundAt) steps.push({ key: "chain", label: `Found ${on}`, state: "done", at: foundAt, detail: counts });

  if (status === "completed") {
    steps.push({ key: "completed", label: "Completed", state: "done", at: order.completedAt ?? completion?.at ?? null, detail: completion?.actor === "admin" ? `Approved by the operator · ${outcome}` : outcome });
  } else if (status === "review") {
    steps.push({ key: "review", label: "In review", state: "attention", at: lastOf(events, "review")?.at ?? null, detail: order.statusDetail });
  } else if (status === "rejected") {
    steps.push({ key: "rejected", label: "Rejected", state: "failed", at: lastOf(events, "rejected")?.at ?? null, detail: order.statusDetail });
  } else {
    steps.push({ key: "completed", label: order.kind === "api" ? "Balance added" : "Plan applied", state: "todo", at: null, detail: null });
  }
  return steps;
}

/**
 * The success panel's sentence: what this payment did. A plan reads in the present tense only while
 * the account's plan still ends where this payment left it (a later order, the operator or time may
 * have changed it since); the allowance is the one this order bought, fixed when it was placed, and
 * only where the order gave the account that plan (an extension adds days, not credits).
 */
export function completedText(order: PaymentOrder, planName: (id: string) => string, accountPlan: { id: string; expiresAt: string } | null, windowHours: number | null) {
  const applied = order.applied;
  if (!applied) return "Your payment is complete.";
  if (typeof applied.apiBalanceAddedUsd === "number") return `${formatUsd(applied.apiBalanceAddedUsd)} was added to your API balance. Your API keys on the Developer API page spend it.`;
  if (!applied.planId || !applied.planExpiresAt) return "Your payment is complete.";
  const name = planName(applied.planId);
  const until = dayText(applied.planExpiresAt);
  const current = accountPlan !== null && accountPlan.id === applied.planId && Date.parse(accountPlan.expiresAt) === Date.parse(applied.planExpiresAt);
  const credits = order.planId === applied.planId && order.planCreditsPerWindow && windowHours ? `, with ${creditCount(order.planCreditsPerWindow)} credits every ${windowHours} hours` : "";
  switch (applied.effect) {
    case "extend":
      return current ? `${name} now runs until ${until}.` : `This payment extended ${name} to ${until}.`;
    case "upgrade":
      return current
        ? `You're on ${name} until ${until}${credits}; the time left on your earlier plan was added.`
        : `This payment upgraded you to ${name} until ${until}${credits}; the time left on your earlier plan was added.`;
    case "extend_higher":
      return current ? `Your ${name} plan now runs until ${until}; this purchase was added to it in days.` : `This payment added days to your ${name} plan, up to ${until}.`;
    default:
      return current ? `${name} is active until ${until}${credits}.` : `This payment gave you ${name} until ${until}${credits}.`;
  }
}

/** The milestone the page announces when the order moves to a new panel (null: nothing to say). */
export function milestone(order: PaymentOrder, view: PayView): string | null {
  const where = networkInfo(order.network)?.label ?? "the network";
  const detail = order.statusDetail ? ` ${order.statusDetail}` : "";
  switch (view) {
    case "pay":
      return `Payment details are ready: send exactly ${order.expectedAmount} ${order.coin} on ${where}.`;
    case "pending":
      return `Transaction hash received. Looking for it on ${where}.`;
    case "confirming": {
      const checking = doubleCheck(order);
      if (checking) return `Transaction found on ${where}. ${checking}`;
      const counts = confirmationText(order);
      return `Transaction found on ${where}${counts ? `: ${counts}` : ""}.`;
    }
    case "completed":
      return `Payment complete. ${appliedShort(order)}.`;
    case "review":
      return `This payment is in review.${detail}`;
    case "rejected":
      return `This payment was rejected.${detail}`;
    case "expired":
      return "This order has expired.";
    default:
      return null;
  }
}
