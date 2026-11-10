import { formatUsd, planAfterPurchase, type BillingCatalog, type PlanConfig, type PlanEffect, type PlanId, type PlanOffer, type PlanState } from "@shared/billing";

// Plans as the billing page and the homepage say them: prices, the offer, how a plan compares
// with the free allowance, and what buying one does to the plan an account already has.

const DAY_MS = 86_400_000;

/** "$2", "$2.50", "$1,000": whole dollars without cents. */
export function formatPrice(usd: number) {
  return Number.isInteger(usd) ? `$${usd.toLocaleString("en-US")}` : formatUsd(usd);
}

/** "30 days", "7.5 days", "1 day" */
export function daysText(days: number) {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** "29 days left", "1 day left", "Less than a day left". */
export function daysLeftText(iso: string, now = Date.now()) {
  const days = Math.floor((Date.parse(iso) - now) / DAY_MS);
  if (!(days >= 1)) return "Less than a day left";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

/** The account's plan as planAfterPurchase reads it: null without one, or once it has ended. */
export function planState(plan: { id: PlanId; expiresAt: string } | null | undefined, now = Date.now()): PlanState {
  return plan && Date.parse(plan.expiresAt) > now ? { planId: plan.id, expiresAt: plan.expiresAt } : null;
}

/** The catalog's plans in planAfterPurchase's shape, at list prices (a conversion never depends on the offer). */
export function planConfigs(offers: PlanOffer[]): Record<PlanId, PlanConfig> | null {
  const pro = offers.find(offer => offer.id === "pro");
  const max = offers.find(offer => offer.id === "max");
  if (!pro || !max) return null;
  const config = (offer: PlanOffer): PlanConfig => ({ name: offer.name, priceUsd: offer.listUsd, creditsPerWindow: offer.creditsPerWindow, days: offer.days });
  return { pro: config(pro), max: config(max) };
}

export type PlanAction = { effect: PlanEffect; label: string; hint: string };

/** A plan's button: what buying it does to the account's current plan, in words. */
export function planAction(current: PlanState, offer: PlanOffer, plans: Record<PlanId, PlanConfig>, now = Date.now()): PlanAction {
  const next = planAfterPurchase(current, offer.id, plans, now);
  const active = current ? plans[current.planId].name : "";
  if (next.effect === "start") return { effect: next.effect, label: `Get ${offer.name}`, hint: `${daysText(offer.days)} from when the payment is applied.` };
  if (next.effect === "extend") return { effect: next.effect, label: `Extend ${offer.name}`, hint: `Adds ${daysText(offer.days)} to the end of your plan.` };
  if (next.effect === "upgrade") {
    // What the days left on the lower plan are worth on this one (as of now; the exact figure is set when the payment is applied).
    const carried = (Date.parse(next.expiresAt) - now - offer.days * DAY_MS) / DAY_MS;
    return { effect: next.effect, label: `Upgrade to ${offer.name}`, hint: `Starts when the payment is applied, with about ${daysText(carried)} more for the time left on ${active}.` };
  }
  // A lower plan while a higher one is active: its value extends the higher plan.
  const added = (Date.parse(next.expiresAt) - (current ? Date.parse(current.expiresAt) : now)) / DAY_MS;
  return { effect: next.effect, label: `Adds ${daysText(added)} to ${plans[next.planId].name}`, hint: `You keep ${active}; ${offer.name}'s value is added to it in days.` };
}

/**
 * The account's own allowance where the page can see it, or null: without a plan the allowance is
 * the account's own; with one, only when it's higher than the plan's (the account gets the larger).
 */
export function ownAllowance(credits: { unlimited: boolean; allowance: number } | null, plan: { creditsPerWindow: number } | null) {
  if (!credits || credits.unlimited) return null;
  if (!plan) return credits.allowance;
  return credits.allowance > plan.creditsPerWindow ? credits.allowance : null;
}

/** How many times the free allowance a plan's allowance is (null when it isn't more). */
export function freeMultiple(creditsPerWindow: number, freeCredits: number) {
  if (!(freeCredits > 0) || !(creditsPerWindow > freeCredits)) return null;
  return Math.round((creditsPerWindow / freeCredits) * 10) / 10;
}

type Discount = BillingCatalog["discount"];

/** The offer in one line ("90% off plans and Developer API prices"), or null without one. */
export function offerText(discount: Discount): string | null {
  const plans = discount.plansPercent;
  const api = discount.apiPercent;
  if (plans > 0 && api > 0) return plans === api ? `${plans}% off plans and Developer API prices` : `${plans}% off plans, ${api}% off Developer API prices`;
  if (plans > 0) return `${plans}% off plans`;
  if (api > 0) return `${api}% off Developer API prices`;
  return null;
}

/** The banner's sentence under the badge: what the offer covers ("Launch offer on plans and Developer API prices."). */
export function offerSentence(discount: Discount) {
  const plans = discount.plansPercent > 0;
  const api = discount.apiPercent > 0;
  if (plans && api && discount.plansPercent !== discount.apiPercent) return `Launch offer: ${offerText(discount)}.`;
  return `Launch offer on ${plans && api ? "plans and Developer API prices" : plans ? "plans" : "Developer API prices"}.`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * When the offer ends, in the viewer's time: "limited time" without an end; "through 29 Nov" when it
 * ends at a local midnight (the 29th is its last full day); otherwise the day and the time it stops,
 * "until 30 Nov, 3:00 PM". The server stops discounting at that instant, so a bare "until 30 Nov"
 * would promise a day that isn't included.
 */
export function offerEnd(endsAt: string | null, formatDate: (iso: string) => string, formatTime: (iso: string) => string = clock): string {
  const end = endsAt ? new Date(endsAt) : null;
  if (!end || !Number.isFinite(end.getTime())) return "limited time";
  if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) return `through ${formatDate(new Date(end.getTime() - 1).toISOString())}`;
  return `until ${formatDate(end.toISOString())}, ${formatTime(end.toISOString())}`;
}

/** The offer's badge: "90% off · limited time", "Up to 90% off · through 29 Nov" (null without one). */
export function offerBadge(discount: Discount, formatDate: (iso: string) => string, formatTime?: (iso: string) => string): string | null {
  const percent = Math.max(discount.plansPercent, discount.apiPercent);
  if (!(percent > 0)) return null;
  const amount = discount.plansPercent > 0 && discount.apiPercent > 0 && discount.plansPercent !== discount.apiPercent ? `Up to ${percent}% off` : `${percent}% off`;
  return `${amount} · ${offerEnd(discount.endsAt, formatDate, formatTime)}`;
}

/** "A, B or C" */
export function listText(items: string[], last = "or") {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}
