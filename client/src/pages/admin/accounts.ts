import { formatUsd, microsToUsd, planAfterPurchase, usdToMicros, type AdminAccountBilling, type PlanConfig, type PlanEffect, type PlanId, type PlanState } from "@shared/billing";

// An account's plan and API balance as the operator changes them (the Billing dialog under
// Accounts): the amounts and days the fields take, what giving a plan does, and the words for the
// API ledger. Pure, so the server's rules are checked here the same way.

type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };

/** "10" adds $10, "-2.50" removes $2.50 ("$5", "-$5" and "1,000" are fine): non-zero, at most $10,000 either way. */
export function parseBalanceChange(raw: string): Parsed<{ amountUsd: number }> {
  const text = raw.replace(/\s+/g, "").replace(/^([+-]?)\$/, "$1").replace(/,/g, "");
  if (!text) return { ok: false, error: "Enter an amount in dollars: 10 adds $10, -10 removes $10." };
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Enter the amount as a number of dollars, like 10 or -2.50." };
  if (!/^[+-]?\d+(\.\d{1,6})?$/.test(text)) return { ok: false, error: "Use at most six decimals (a millionth of a dollar)." };
  const amountUsd = Number(text);
  if (amountUsd === 0) return { ok: false, error: "Enter an amount other than zero." };
  if (Math.abs(amountUsd) > 10_000) return { ok: false, error: "Enter an amount from -$10,000 to $10,000." };
  return { ok: true, amountUsd };
}

/** Days of a plan to give: a whole number from 1 to 366. */
export function parseDays(raw: string): Parsed<{ days: number }> {
  const text = raw.trim();
  const days = Number(text);
  if (!/^\d+$/.test(text) || days < 1 || days > 366) return { ok: false, error: "Days are a whole number from 1 to 366." };
  return { ok: true, days };
}

/** The account's plan as planAfterPurchase reads it (null without one, or once it has ended). */
export function planStateOf(plan: AdminAccountBilling["plan"], now = Date.now()): PlanState {
  return plan && Date.parse(plan.expiresAt) > now ? { planId: plan.id, expiresAt: plan.expiresAt } : null;
}

/**
 * What giving `planId` for `days` days does, worked out as the server does it (grantPlan): like
 * buying the plan for that many days at the same price per day, so it starts, extends or upgrades
 * the plan, or adds its value to a higher one.
 */
export function grantResult(current: PlanState, planId: PlanId, days: number, plans: Record<PlanId, PlanConfig>, now = Date.now()) {
  const bought = plans[planId];
  const scaled: Record<PlanId, PlanConfig> = { ...plans };
  scaled[planId] = { ...bought, days, priceUsd: (bought.priceUsd * days) / bought.days };
  return planAfterPurchase(current, planId, scaled, now);
}

/** The give button: "Give Pro", "Extend Pro", "Upgrade to Max", "Add to Max". */
export function grantLabel(effect: PlanEffect, planId: PlanId, current: PlanState, plans: Record<PlanId, PlanConfig>) {
  const name = plans[planId].name;
  if (effect === "start") return `Give ${name}`;
  if (effect === "extend") return `Extend ${name}`;
  if (effect === "upgrade") return `Upgrade to ${name}`;
  return `Add to ${current ? plans[current.planId].name : name}`;
}

/** The line under the give form: what the account ends up with ("about": the server works the date out when it applies). */
export function grantSentence(result: { planId: PlanId; expiresAt: string; effect: PlanEffect }, planId: PlanId, days: number, current: PlanState, plans: Record<PlanId, PlanConfig>, day: (iso: string) => string) {
  const until = day(result.expiresAt);
  const name = plans[planId].name;
  const length = `${days} ${days === 1 ? "day" : "days"}`;
  if (result.effect === "start") return `${name} starts now and runs until about ${until}.`;
  if (result.effect === "extend") return `${length} are added to ${name}: it runs until about ${until}.`;
  const had = current ? plans[current.planId].name : name;
  if (result.effect === "upgrade") return `${name} starts now, with the days left on ${had} carried over at their value: until about ${until}.`;
  return `${had} stays, with the value of ${length} of ${name} added: until about ${until}.`;
}

export const LEDGER_LABEL: Record<AdminAccountBilling["ledger"][number]["kind"], string> = {
  topup: "Top-up",
  grant: "Added by the operator",
  refund: "Refund",
  adjust: "Removed by the operator",
};

/**
 * What a balance change will do, for its confirmation (before any money moves), from the balance
 * the dialog last read, by the server's rules: an addition can be spent at once; a removal stops at
 * zero, and there is nothing to remove from a balance at or below zero (possible: false).
 */
export function balanceChangePreview(name: string, amountUsd: number, balanceMicros: number): { text: string; possible: boolean } {
  const change = usdToMicros(amountUsd);
  const now = formatUsd(microsToUsd(balanceMicros));
  if (change > 0) {
    return { possible: true, text: `Adds ${formatUsd(amountUsd)} to ${name}'s API balance: ${now} → ${formatUsd(microsToUsd(balanceMicros + change))}. The account's API keys can spend it at once.` };
  }
  if (balanceMicros <= 0) return { possible: false, text: `${name}'s API balance is ${now}, so there is nothing to remove.` };
  if (balanceMicros + change < 0) {
    return { possible: true, text: `Removes all of ${name}'s API balance, which is less than the ${formatUsd(-amountUsd)} you entered: ${now} → $0.00.` };
  }
  return { possible: true, text: `Removes ${formatUsd(-amountUsd)} from ${name}'s API balance: ${now} → ${formatUsd(microsToUsd(balanceMicros + change))}.` };
}

/**
 * The toast after adding or removing API balance, from what the ledger recorded: the balance never
 * goes below zero, so a removal larger than the balance takes what there was.
 */
export function balanceChangeText(name: string, requestedUsd: number, appliedUsd: number, balanceAfterUsd: number) {
  const after = formatUsd(balanceAfterUsd);
  if (requestedUsd > 0) return `Added ${formatUsd(appliedUsd)} to ${name}'s API balance. It's now ${after}.`;
  if (appliedUsd === 0) return `Nothing to remove: ${name}'s API balance is ${after}.`;
  if (-appliedUsd < -requestedUsd) return `Removed ${formatUsd(-appliedUsd)} from ${name}'s API balance, all it had. It's now ${after}.`;
  return `Removed ${formatUsd(-appliedUsd)} from ${name}'s API balance. It's now ${after}.`;
}

/** "Pro · until 9 Dec" for the accounts list, or null without a plan (or once it has ended). */
export function planChipText(plan: { name: string; expiresAt: string } | null | undefined, day: (iso: string) => string, now = Date.now()) {
  if (!plan || !(Date.parse(plan.expiresAt) > now)) return null;
  return `${plan.name} · until ${day(plan.expiresAt)}`;
}
