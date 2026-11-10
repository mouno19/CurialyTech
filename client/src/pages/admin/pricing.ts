import {
  API_PRICES, discountedPrices, discountedUsd, discountPercent, MAX_DISCOUNT_PERCENT, PLAN_IDS,
  type BillingCatalog, type BillingSettings, type BillingSettingsPatch, type DiscountConfig, type PlanConfig, type PlanId, type PlanOffer, type TokenPrices,
} from "@shared/billing";
import { gatewayModel } from "@shared/gateway";

// The Plans & pricing form as pure functions: the settings as the fields hold them (strings, so a
// half-typed number stays as typed), the checks the server makes (same limits, same words), the
// change to send, and what customers would see with it.

/** What PUT /api/admin/billing/settings takes: any part of the settings, merged by the server field by field. */
/** What a save sends: only the fields that changed (the server merges plans and the offer field by field). */
export type SettingsPatch = BillingSettingsPatch;

export type PlanDraft = { name: string; price: string; credits: string; days: string };

export type PricingDraft = {
  plans: Record<PlanId, PlanDraft>;
  percent: string;
  onPlans: boolean;
  onApi: boolean;
  /** never: the offer runs until the operator turns it off. */
  ends: "never" | "at";
  /** A datetime-local value, in the operator's time zone. */
  endsAt: string;
  paymentsOpen: boolean;
  autoVerify: boolean;
};

export type DraftField = `${PlanId}.${keyof PlanDraft}` | "percent" | "endsAt";
export type DraftErrors = Partial<Record<DraftField, string>>;

/** A plan's field, as the errors and the form name it ("pro.price"). */
export const fieldOf = (id: PlanId, key: keyof PlanDraft): DraftField => `${id}.${key}`;

// ---- The offer's end, as a datetime-local field holds it ----

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-11-30T23:59" in this browser's time zone (minutes; seconds are dropped). */
export function toLocalInput(iso: string | null | undefined) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value as an ISO time (a date and time without a zone is local time), or null. */
export function fromLocalInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value.trim())) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The end a new date starts from: a week from now, on the hour. */
export function defaultOfferEnd(now = Date.now()) {
  const date = new Date(now + 7 * 86_400_000);
  date.setMinutes(0, 0, 0);
  return toLocalInput(date.toISOString());
}

/** The offer has an end, and it has passed (it stays ended until the operator sets another end or none). */
export const offerEnded = (discount: DiscountConfig, now = Date.now()) => discount.endsAt !== null && Date.parse(discount.endsAt) <= now;

// ---- Settings ↔ the form ----

const priceText = (usd: number) => (Number.isInteger(usd) ? String(usd) : usd.toFixed(2));

export function draftOf(settings: BillingSettings, now = Date.now()): PricingDraft {
  const plan = (config: PlanConfig): PlanDraft => ({ name: config.name, price: priceText(config.priceUsd), credits: String(config.creditsPerWindow), days: String(config.days) });
  const { discount } = settings;
  return {
    plans: { pro: plan(settings.plans.pro), max: plan(settings.plans.max) },
    percent: String(discount.percent),
    onPlans: discount.plans,
    onApi: discount.api,
    ends: discount.endsAt ? "at" : "never",
    endsAt: discount.endsAt ? toLocalInput(discount.endsAt) : defaultOfferEnd(now),
    paymentsOpen: settings.paymentsOpen,
    autoVerify: settings.autoVerify,
  };
}

type Parsed = { ok: true; value: number } | { ok: false; error: string };

/** "20", "$20", "19.99": dollars in whole cents, from $1 to $10,000. */
export function parsePrice(raw: string): Parsed {
  const text = raw.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Enter the price in dollars, like 20 or 19.99." };
  const value = Number(text);
  if (!/^\d+(\.\d{0,2}0*)?$/.test(text)) return { ok: false, error: "Use whole cents: at most two decimals." };
  if (value < 1 || value > 10_000) return { ok: false, error: "A plan costs $1 to $10,000." };
  return { ok: true, value: Math.round(value * 100) / 100 };
}

/** A whole number from min to max ("6,000" is fine). */
function parseWhole(raw: string, min: number, max: number, error: string): Parsed {
  const text = raw.trim().replace(/,/g, "");
  if (!/^\d+$/.test(text)) return { ok: false, error };
  const value = Number(text);
  return value >= min && value <= max ? { ok: true, value } : { ok: false, error };
}

export const FIELD_ERROR = {
  name: "A plan's name is 1 to 24 characters.",
  credits: "Credits per window are a whole number from 0 to 1,000,000.",
  days: "A plan lasts a whole number of days from 1 to 366.",
  percent: `The offer is a whole percent from 0 to ${MAX_DISCOUNT_PERCENT}.`,
  endsAt: "Choose the date and time the offer ends.",
  endsPast: "Choose a time in the future, or Never.",
} as const;

export type DraftCheck = {
  errors: DraftErrors;
  /** Only what changed (the server merges it), and only from valid fields. */
  patch: SettingsPatch;
  /** The draft differs from the saved settings (an invalid field counts). */
  changed: boolean;
  /** The saved settings with every valid field of the draft: what the preview shows. */
  effective: BillingSettings;
};

/**
 * Checks the form the way the server does (server/billing/routes.ts and settings.ts) and works out
 * what to send. An unchanged end is never sent: the server only takes a new end in the future, so
 * an offer that has ended stays ended unless the operator picks Never or a new time.
 */
export function checkDraft(draft: PricingDraft, saved: BillingSettings, now = Date.now()): DraftCheck {
  const errors: DraftErrors = {};
  const patch: SettingsPatch = {};
  const plans: NonNullable<SettingsPatch["plans"]> = {};
  const effective: BillingSettings = {
    plans: { pro: { ...saved.plans.pro }, max: { ...saved.plans.max } },
    discount: { ...saved.discount },
    paymentsOpen: draft.paymentsOpen,
    autoVerify: draft.autoVerify,
  };

  for (const id of PLAN_IDS) {
    const input = draft.plans[id];
    const before = saved.plans[id];
    const plan = effective.plans[id];
    const change: Partial<PlanConfig> = {};
    const name = input.name.trim();
    if (name.length < 1 || name.length > 24) errors[fieldOf(id, "name")] = FIELD_ERROR.name;
    else {
      plan.name = name;
      if (name !== before.name) change.name = name;
    }
    const price = parsePrice(input.price);
    if (!price.ok) errors[fieldOf(id, "price")] = price.error;
    else {
      plan.priceUsd = price.value;
      if (Math.round(price.value * 100) !== Math.round(before.priceUsd * 100)) change.priceUsd = price.value;
    }
    const credits = parseWhole(input.credits, 0, 1_000_000, FIELD_ERROR.credits);
    if (!credits.ok) errors[fieldOf(id, "credits")] = credits.error;
    else {
      plan.creditsPerWindow = credits.value;
      if (credits.value !== before.creditsPerWindow) change.creditsPerWindow = credits.value;
    }
    const length = parseWhole(input.days, 1, 366, FIELD_ERROR.days);
    if (!length.ok) errors[fieldOf(id, "days")] = length.error;
    else {
      plan.days = length.value;
      if (length.value !== before.days) change.days = length.value;
    }
    if (Object.keys(change).length) plans[id] = change;
  }
  if (Object.keys(plans).length) patch.plans = plans;

  const offer: Partial<DiscountConfig> = {};
  const percent = parseWhole(draft.percent, 0, MAX_DISCOUNT_PERCENT, FIELD_ERROR.percent);
  if (!percent.ok) errors.percent = percent.error;
  else {
    effective.discount.percent = percent.value;
    if (percent.value !== saved.discount.percent) offer.percent = percent.value;
  }
  effective.discount.plans = draft.onPlans;
  if (draft.onPlans !== saved.discount.plans) offer.plans = draft.onPlans;
  effective.discount.api = draft.onApi;
  if (draft.onApi !== saved.discount.api) offer.api = draft.onApi;
  if (draft.ends === "never") {
    effective.discount.endsAt = null;
    if (saved.discount.endsAt !== null) offer.endsAt = null;
  } else if (!(saved.discount.endsAt !== null && draft.endsAt === toLocalInput(saved.discount.endsAt))) {
    const iso = fromLocalInput(draft.endsAt);
    if (!iso) errors.endsAt = FIELD_ERROR.endsAt;
    else if (Date.parse(iso) <= now) errors.endsAt = FIELD_ERROR.endsPast;
    else {
      effective.discount.endsAt = iso;
      offer.endsAt = iso;
    }
  }
  if (Object.keys(offer).length) patch.discount = offer;

  if (draft.paymentsOpen !== saved.paymentsOpen) patch.paymentsOpen = draft.paymentsOpen;
  if (draft.autoVerify !== saved.autoVerify) patch.autoVerify = draft.autoVerify;
  return { errors, patch, changed: Object.keys(patch).length > 0 || Object.keys(errors).length > 0, effective };
}

/** The fields in the order the form shows them, for moving focus to the first one with an error. */
export const FIELD_ORDER: DraftField[] = [
  ...PLAN_IDS.flatMap(id => (["name", "price", "credits", "days"] as const).map(key => fieldOf(id, key))),
  "percent",
  "endsAt",
];

// ---- What customers would see ----

export type CatalogPreview = { offers: PlanOffer[]; discount: BillingCatalog["discount"] };

/** The catalog's plans and offer with these settings: the same sums GET /api/billing/catalog makes. */
export function catalogPreview(settings: BillingSettings, now = Date.now()): CatalogPreview {
  const plansPercent = discountPercent(settings.discount, "plans", now);
  const apiPercent = discountPercent(settings.discount, "api", now);
  return {
    offers: PLAN_IDS.map(id => {
      const plan = settings.plans[id];
      return { id, name: plan.name, listUsd: plan.priceUsd, priceUsd: discountedUsd(plan.priceUsd, plansPercent), discountPercent: plansPercent, creditsPerWindow: plan.creditsPerWindow, days: plan.days };
    }),
    discount: { plansPercent, apiPercent, endsAt: plansPercent || apiPercent ? settings.discount.endsAt : null },
  };
}

/** A few Developer API models, for the preview of token prices. */
const SAMPLE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "openai-gpt-5.5"];

export type ModelSample = { id: string; label: string; list: TokenPrices; price: TokenPrices };

/** List and offer prices (USD per million tokens) of a few models at this API discount. */
export function apiSample(percent: number): ModelSample[] {
  return SAMPLE_MODELS.flatMap(id => {
    const pricing = API_PRICES[id];
    const model = gatewayModel(id);
    if (!pricing || !model) return [];
    const list = { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead, cacheWrite: pricing.cacheWrite };
    return [{ id, label: model.label, list, price: discountedPrices(list, percent) }];
  });
}
