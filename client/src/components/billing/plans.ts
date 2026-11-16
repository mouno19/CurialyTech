import { FREE_VAULT_BYTES, FREE_VAULT_FILES } from "@shared/media";
import { applyPlanPurchase, formatUsd, planForMonths, type BillingCatalog, type FreeTier, type PlanConfig, type PlanEffect, type PlanId, type PlanOffer, type PlanState } from "@shared/billing";
import { creditCount } from "./format";

// Plans as the billing page and the homepage say them: prices, the offer, how a plan compares
// with the free allowance, and what buying one does to the plans an account already has (Pro and
// Max run side by side, and their credits add up).

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

/** "1 month", "3 months" */
export const monthsText = (months: number) => `${months} ${months === 1 ? "month" : "months"}`;

/** What a card's Media Vault holds: a plan's has no limit; a free account's has the free vault's. */
export const vaultText = (paid: boolean) => (paid ? "Unlimited Media Vault storage" : `Media Vault: ${Math.round(FREE_VAULT_BYTES / 1024 / 1024)} MB or ${FREE_VAULT_FILES} files`);

/** "29 days left", "1 day left", "Less than a day left". */
export function daysLeftText(iso: string, now = Date.now()) {
  const days = Math.floor((Date.parse(iso) - now) / DAY_MS);
  if (!(days >= 1)) return "Less than a day left";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

/** The account's plans as applyPlanPurchase reads them: the ones still running. */
export function planState(plans: { id: PlanId; expiresAt: string }[] | null | undefined, now = Date.now()): PlanState {
  return (plans ?? []).filter(plan => Date.parse(plan.expiresAt) > now).map(plan => ({ planId: plan.id, expiresAt: plan.expiresAt }));
}

/** The plans still running, as the account reported them. */
export const runningPlans = <T extends { expiresAt: string }>(plans: T[] | null | undefined, now = Date.now()): T[] => (plans ?? []).filter(plan => Date.parse(plan.expiresAt) > now);

/** Credits per window the plans give together (plans held together add up). */
export const plansAllowance = (plans: { creditsPerWindow: number }[]) => plans.reduce((sum, plan) => sum + plan.creditsPerWindow, 0);

/** "Pro + Max": the plans by name, Pro first. */
export const plansText = (plans: { name: string }[]) => plans.map(plan => plan.name).join(" + ");

/** The catalog's plans in applyPlanPurchase's shape, at list prices. */
export function planConfigs(offers: PlanOffer[]): Record<PlanId, PlanConfig> | null {
  const pro = offers.find(offer => offer.id === "pro");
  const max = offers.find(offer => offer.id === "max");
  if (!pro || !max) return null;
  const config = (offer: PlanOffer): PlanConfig => ({ name: offer.name, priceUsd: offer.listUsd, creditsPerWindow: offer.creditsPerWindow, days: offer.days });
  return { pro: config(pro), max: config(max) };
}

export type PlanAction = { effect: PlanEffect; label: string; hint: string };

/**
 * A plan's button: what buying it (for `months` periods) does to the account's plans, in words.
 * held: the plans the account has (their allowances, for what the two add up to).
 */
export function planAction(held: { id: PlanId; name: string; expiresAt: string; creditsPerWindow: number }[], offer: PlanOffer, plans: Record<PlanId, PlanConfig>, now = Date.now(), months = 1): PlanAction {
  const running = runningPlans(held, now);
  const next = applyPlanPurchase(planState(running, now), offer.id, planForMonths(plans, offer.id, months), now);
  const days = offer.days * months;
  const span = months > 1 ? ` for ${monthsText(months)}` : "";
  if (next.effect === "extend") return { effect: next.effect, label: `Extend ${offer.name}${span}`, hint: `Adds ${daysText(days)} to the end of your ${offer.name} plan.` };
  if (next.effect === "concurrent") {
    // The other plan keeps its own days; while both run, their credits add up.
    const others = running.filter(plan => plan.id !== offer.id);
    const total = plansAllowance(others) + offer.creditsPerWindow;
    return {
      effect: next.effect, label: `Add ${offer.name}${span}`,
      hint: `Runs alongside ${plansText(others)} for ${daysText(days)}: ${creditCount(total)} credits per window while both last. ${plansText(others)} keeps its own end date.`,
    };
  }
  return { effect: next.effect, label: `Get ${offer.name}${span}`, hint: `${daysText(days)} from when the payment is applied.` };
}

/**
 * The account's own allowance where the page can see it, or null: without a plan the allowance is
 * the account's own; with plans, only when it's higher than what they give together (the account
 * gets the larger).
 */
export function ownAllowance(credits: { unlimited: boolean; allowance: number } | null, plans: { creditsPerWindow: number }[]) {
  if (!credits || credits.unlimited) return null;
  if (!plans.length) return credits.allowance;
  return credits.allowance > plansAllowance(plans) ? credits.allowance : null;
}

/**
 * The Free card, line by line: the headline ("60 credits to start", or the refilling allowance when
 * the operator gives one) and what the X rewards add, with the boost while it is offered. formatDate
 * says the boost's end the way offerEnd does.
 */
export function freeTierLines(free: FreeTier, formatDate: (iso: string) => string): { headline: string; lines: string[] } {
  const { welcomeCredits: welcome, creditsPerWindow, windowHours, rewards } = free;
  const headline = creditsPerWindow > 0 ? `${creditCount(creditsPerWindow)} credits every ${windowHours} hours` : welcome > 0 ? `${creditCount(welcome)} credits to start` : "No credits included";
  const lines: string[] = [];
  if (creditsPerWindow > 0 && welcome > 0) lines.push(`${creditCount(welcome)} more to start`);
  if (rewards.followCredits > 0) lines.push(`+${creditCount(rewards.followCredits)} for following @${rewards.followHandle} on X`);
  if (rewards.postCredits > 0) lines.push(`+${creditCount(rewards.postCredits)} for a post about Curialy`);
  const both: string[] = [];
  if (rewards.apiUsd > 0) both.push(`${formatPrice(rewards.apiUsd)} on the Developer API`);
  if (rewards.boost) both.push(`${creditCount(rewards.boost.creditsPerWindow)} credits every ${rewards.boost.windowHours} hours · ${offerEnd(rewards.boost.endsAt, formatDate)}`);
  if (both.length === 1) lines.push(`Both done: ${both[0]}`);
  if (both.length === 2) lines.push(`Both done: ${both[0]}, and ${both[1]}`);
  return { headline, lines };
}

/** How many times the free allowance a plan's allowance is (null when it isn't more). */
export function freeMultiple(creditsPerWindow: number, freeCredits: number) {
  if (!(freeCredits > 0) || !(creditsPerWindow > freeCredits)) return null;
  return Math.round((creditsPerWindow / freeCredits) * 10) / 10;
}

type Discount = BillingCatalog["discount"];

/** What a top-up shows: the balance crossed out, and the dollars you pay beside it. */
export function topUpSentence(creditPerUsd: number) {
  return `The crossed price is the balance you receive: ${formatPrice(1)} paid is shown as ${formatPrice(creditPerUsd)} crossed out. Requests are charged at the prices on the Developer API page.`;
}

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
