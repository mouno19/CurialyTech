import { describe, expect, it } from "vitest";
import { DEFAULT_BILLING_SETTINGS, type BillingSettings } from "@shared/billing";
import { apiSample, catalogPreview, checkDraft, defaultOfferEnd, draftOf, FIELD_ERROR, FIELD_ORDER, fromLocalInput, offerEnded, parsePrice, toLocalInput, type PricingDraft } from "./pricing";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const inDays = (count: number) => new Date(NOW + count * DAY).toISOString();
const saved = (patch: Partial<BillingSettings> = {}): BillingSettings => ({ ...DEFAULT_BILLING_SETTINGS, ...patch });
const edit = (draft: PricingDraft, patch: Partial<PricingDraft>) => ({ ...draft, ...patch });
const editPlan = (draft: PricingDraft, id: "pro" | "max", patch: Partial<PricingDraft["plans"]["pro"]>): PricingDraft => ({ ...draft, plans: { ...draft.plans, [id]: { ...draft.plans[id], ...patch } } });

describe("the offer's end in a datetime-local field", () => {
  it("round-trips through local time at minute precision", () => {
    const iso = "2026-11-30T23:59:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput("2026-11-30T23:59:42.123Z")).toBe(toLocalInput(iso));
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("2026-13-40T99:99")).toBeNull();
    expect(fromLocalInput("tomorrow")).toBeNull();
  });

  it("starts a new end a week out, on the hour", () => {
    const end = Date.parse(fromLocalInput(defaultOfferEnd(NOW))!);
    expect(end).toBeGreaterThan(NOW + 7 * DAY - 3_600_000);
    expect(new Date(end).getMinutes()).toBe(0);
  });

  it("knows when an offer has ended", () => {
    expect(offerEnded({ ...DEFAULT_BILLING_SETTINGS.discount, endsAt: inDays(-1) }, NOW)).toBe(true);
    expect(offerEnded({ ...DEFAULT_BILLING_SETTINGS.discount, endsAt: inDays(1) }, NOW)).toBe(false);
    expect(offerEnded(DEFAULT_BILLING_SETTINGS.discount, NOW)).toBe(false);
  });
});

describe("plan prices", () => {
  it("takes dollars in whole cents from $1 to $10,000", () => {
    expect(parsePrice("20")).toEqual({ ok: true, value: 20 });
    expect(parsePrice(" $19.99 ")).toEqual({ ok: true, value: 19.99 });
    expect(parsePrice("1,000.50")).toEqual({ ok: true, value: 1000.5 });
    expect(parsePrice("19.990")).toEqual({ ok: true, value: 19.99 });
    expect(parsePrice("19.999")).toEqual({ ok: false, error: "Use whole cents: at most two decimals." });
    expect(parsePrice("0.5")).toEqual({ ok: false, error: "A plan costs $1 to $10,000." });
    expect(parsePrice("10001")).toEqual({ ok: false, error: "A plan costs $1 to $10,000." });
    expect(parsePrice("")).toMatchObject({ ok: false });
    expect(parsePrice("twenty")).toMatchObject({ ok: false });
    expect(parsePrice("-5")).toMatchObject({ ok: false });
  });
});

describe("checking the form", () => {
  const base = saved();
  const draft = draftOf(base, NOW);

  it("starts from the saved settings with nothing to send", () => {
    expect(draft.plans.pro).toEqual({ name: "Pro", price: "20", credits: "6000", days: "30" });
    expect(draft).toMatchObject({ percent: "90", onPlans: true, onApi: true, ends: "never", paymentsOpen: true, autoVerify: true });
    expect(checkDraft(draft, base, NOW)).toEqual({ errors: {}, patch: {}, changed: false, effective: base });
  });

  it("sends only what changed", () => {
    const next = edit(editPlan(draft, "max", { price: "79.5", name: " Max+ " }), { percent: "50", autoVerify: false });
    expect(checkDraft(next, base, NOW).patch).toEqual({ plans: { max: { name: "Max+", priceUsd: 79.5 } }, discount: { percent: 50 }, autoVerify: false });
  });

  it("gives the server's limits for every field", () => {
    const next = edit(editPlan(editPlan(draft, "pro", { name: " ", credits: "1.5", days: "0" }), "max", { price: "abc", days: "367" }), { percent: "96" });
    const { errors, patch, changed } = checkDraft(next, base, NOW);
    expect(errors).toEqual({
      "pro.name": FIELD_ERROR.name, "pro.credits": FIELD_ERROR.credits, "pro.days": FIELD_ERROR.days,
      "max.price": "Enter the price in dollars, like 20 or 19.99.", "max.days": FIELD_ERROR.days, percent: FIELD_ERROR.percent,
    });
    expect(patch).toEqual({});
    expect(changed).toBe(true);
    expect(FIELD_ORDER.filter(field => errors[field])[0]).toBe("pro.name");
    expect(checkDraft(editPlan(draft, "pro", { credits: "1,000,000" }), base, NOW).patch).toEqual({ plans: { pro: { creditsPerWindow: 1_000_000 } } });
    expect(checkDraft(editPlan(draft, "pro", { name: "x".repeat(25) }), base, NOW).errors).toEqual({ "pro.name": FIELD_ERROR.name });
  });

  it("sets, keeps and removes the offer's end", () => {
    const end = toLocalInput(inDays(3));
    expect(checkDraft(edit(draft, { ends: "at", endsAt: end }), base, NOW).patch).toEqual({ discount: { endsAt: fromLocalInput(end) } });
    expect(checkDraft(edit(draft, { ends: "at", endsAt: toLocalInput(inDays(-1)) }), base, NOW).errors).toEqual({ endsAt: FIELD_ERROR.endsPast });
    expect(checkDraft(edit(draft, { ends: "at", endsAt: "" }), base, NOW).errors).toEqual({ endsAt: FIELD_ERROR.endsAt });
    // Never, while the offer had an end.
    const ending = saved({ discount: { ...base.discount, endsAt: inDays(3) } });
    expect(checkDraft(edit(draftOf(ending, NOW), { ends: "never" }), ending, NOW).patch).toEqual({ discount: { endsAt: null } });
  });

  it("leaves an offer that has ended as it is when the end isn't touched", () => {
    const ended = saved({ discount: { ...base.discount, endsAt: inDays(-2) } });
    const form = draftOf(ended, NOW);
    expect(form.ends).toBe("at");
    const { errors, patch, effective } = checkDraft(editPlan(form, "pro", { name: "Plus" }), ended, NOW);
    expect(errors).toEqual({});
    expect(patch).toEqual({ plans: { pro: { name: "Plus" } } });
    expect(effective.discount.endsAt).toBe(inDays(-2));
  });

  it("previews the valid fields over the saved settings", () => {
    const { effective } = checkDraft(edit(editPlan(draft, "pro", { price: "30", days: "x" }), { percent: "50" }), base, NOW);
    expect(effective.plans.pro).toEqual({ name: "Pro", priceUsd: 30, creditsPerWindow: 6000, days: 30 });
    expect(effective.discount.percent).toBe(50);
  });
});

describe("what customers see", () => {
  it("prices the plans as the catalog does", () => {
    const { offers, discount } = catalogPreview(saved(), NOW);
    expect(offers.map(offer => [offer.name, offer.listUsd, offer.priceUsd, offer.discountPercent])).toEqual([["Pro", 20, 2, 90], ["Max", 80, 8, 90]]);
    expect(discount).toEqual({ plansPercent: 90, apiPercent: 90, endsAt: null });
  });

  it("drops the offer where it doesn't apply, and once it has ended", () => {
    const plansOnly = catalogPreview(saved({ discount: { percent: 50, plans: true, api: false, endsAt: inDays(5) } }), NOW);
    expect(plansOnly.discount).toEqual({ plansPercent: 50, apiPercent: 0, endsAt: inDays(5) });
    expect(plansOnly.offers[0].priceUsd).toBe(10);
    const ended = catalogPreview(saved({ discount: { percent: 90, plans: true, api: true, endsAt: inDays(-1) } }), NOW);
    expect(ended.discount).toEqual({ plansPercent: 0, apiPercent: 0, endsAt: null });
    expect(ended.offers[1].priceUsd).toBe(80);
  });

  it("samples a few models' token prices", () => {
    const [opus] = apiSample(90);
    expect(opus).toMatchObject({ label: "Claude Opus 5.5", list: { input: 4, output: 20 }, price: { input: 0.4, output: 2 } });
    expect(apiSample(0)[0].price.output).toBe(20);
    expect(apiSample(90).length).toBeGreaterThan(1);
  });
});
