import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, MAX_PLAN_MONTHS, planAfterPurchase, planForMonths, prepayableMonths } from "./billing";

// Paying ahead: a plan can be paid for several months at once, and never runs more than
// MAX_PLAN_MONTHS periods past today, counting the plan the account has and the orders it has open.

const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = 86_400_000;
const until = (days: number) => new Date(NOW + days * DAY).toISOString();

describe("prepayableMonths", () => {
  it("allows the full six months with no plan, and counts what is left on the same plan", () => {
    expect(prepayableMonths(null, [], "pro", DEFAULT_PLANS, NOW)).toBe(MAX_PLAN_MONTHS);
    // 100 days of Pro left: 2 more months reach 160 days, a third would reach 190.
    expect(prepayableMonths({ planId: "pro", expiresAt: until(100) }, [], "pro", DEFAULT_PLANS, NOW)).toBe(2);
    // Exactly one month left: five more reach 180 days.
    expect(prepayableMonths({ planId: "pro", expiresAt: until(30) }, [], "pro", DEFAULT_PLANS, NOW)).toBe(5);
    expect(prepayableMonths({ planId: "pro", expiresAt: until(170) }, [], "pro", DEFAULT_PLANS, NOW)).toBe(0);
    // An ended plan is no plan.
    expect(prepayableMonths({ planId: "pro", expiresAt: until(-1) }, [], "pro", DEFAULT_PLANS, NOW)).toBe(MAX_PLAN_MONTHS);
  });

  it("converts like a purchase: an upgrade carries the lower plan's days at their value, a lower plan extends a higher one", () => {
    // Max over 100 days of Pro: 25 days carried, so five months (175 days) fit and six (205) don't.
    expect(prepayableMonths({ planId: "pro", expiresAt: until(100) }, [], "max", DEFAULT_PLANS, NOW)).toBe(5);
    // Pro while Max runs 170 more days: a month of Pro adds 7.5 Max days (177.5), two add 15 (185).
    expect(prepayableMonths({ planId: "max", expiresAt: until(170) }, [], "pro", DEFAULT_PLANS, NOW)).toBe(1);
  });

  it("counts open orders as sold, so two orders placed together can't pass the limit", () => {
    const open = [{ planId: "pro" as const, days: 120, listUsd: 80 }];
    expect(prepayableMonths(null, open, "pro", DEFAULT_PLANS, NOW)).toBe(2);
    expect(prepayableMonths(null, [...open, { planId: "pro", days: 60, listUsd: 40 }], "pro", DEFAULT_PLANS, NOW)).toBe(0);
  });

  it("prices and lengthens a plan by its months, so its value per day stays the same", () => {
    const three = planForMonths(DEFAULT_PLANS, "pro", 3);
    expect(three.pro).toMatchObject({ days: 90, priceUsd: 60, creditsPerWindow: DEFAULT_PLANS.pro.creditsPerWindow });
    expect(three.max).toEqual(DEFAULT_PLANS.max);
    expect(Date.parse(planAfterPurchase(null, "pro", three, NOW).expiresAt)).toBe(NOW + 90 * DAY);
  });
});
