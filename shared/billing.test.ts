import { describe, expect, it } from "vitest";
import { applyPlanPurchase, DEFAULT_PLANS, MAX_PLAN_MONTHS, planEnd, planForMonths, prepayableMonths } from "./billing";

// Plans side by side: buying the plan an account has extends it; buying the other one starts it now
// and both run, each until its own end. Paying ahead: a plan can be paid for several months at once,
// and never runs more than MAX_PLAN_MONTHS periods past today, counting what is left of it and the
// orders for it still open (each plan has its own limit).

const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = 86_400_000;
const until = (days: number) => new Date(NOW + days * DAY).toISOString();

describe("applyPlanPurchase", () => {
  it("starts a plan now, and extends the same plan from its end", () => {
    expect(applyPlanPurchase([], "pro", DEFAULT_PLANS, NOW)).toEqual({ planId: "pro", expiresAt: until(30), effect: "start" });
    expect(applyPlanPurchase([{ planId: "pro", expiresAt: until(10) }], "pro", DEFAULT_PLANS, NOW)).toEqual({ planId: "pro", expiresAt: until(40), effect: "extend" });
    // An ended plan is no plan: it starts again from now.
    expect(applyPlanPurchase([{ planId: "pro", expiresAt: until(-1) }], "pro", DEFAULT_PLANS, NOW)).toEqual({ planId: "pro", expiresAt: until(30), effect: "start" });
  });

  it("starts the other plan alongside the one the account has, converting nothing", () => {
    // Max bought on Pro (10 days left): Max runs its full 30 days from now, and Pro keeps its own end.
    expect(applyPlanPurchase([{ planId: "pro", expiresAt: until(10) }], "max", DEFAULT_PLANS, NOW)).toEqual({ planId: "max", expiresAt: until(30), effect: "concurrent" });
    // Pro bought on Max: the same, the other way round.
    expect(applyPlanPurchase([{ planId: "max", expiresAt: until(20) }], "pro", DEFAULT_PLANS, NOW)).toEqual({ planId: "pro", expiresAt: until(30), effect: "concurrent" });
    // Holding both, each purchase extends its own plan only.
    const both = [{ planId: "pro" as const, expiresAt: until(10) }, { planId: "max" as const, expiresAt: until(28) }];
    expect(applyPlanPurchase(both, "pro", DEFAULT_PLANS, NOW)).toEqual({ planId: "pro", expiresAt: until(40), effect: "extend" });
    expect(applyPlanPurchase(both, "max", planForMonths(DEFAULT_PLANS, "max", 2), NOW)).toEqual({ planId: "max", expiresAt: until(88), effect: "extend" });
    // The other plan having ended, a purchase is a plain start.
    expect(applyPlanPurchase([{ planId: "pro", expiresAt: until(-1) }], "max", DEFAULT_PLANS, NOW).effect).toBe("start");
  });

  it("reads each plan's end on its own", () => {
    const state = [{ planId: "pro" as const, expiresAt: until(10) }, { planId: "max" as const, expiresAt: until(-2) }];
    expect(planEnd(state, "pro", NOW)).toBe(NOW + 10 * DAY);
    expect(planEnd(state, "max", NOW)).toBeNull();
    expect(planEnd([], "pro", NOW)).toBeNull();
  });
});

describe("prepayableMonths", () => {
  it("allows the full six months with no plan, and counts what is left on the same plan", () => {
    expect(prepayableMonths([], [], "pro", DEFAULT_PLANS, NOW)).toBe(MAX_PLAN_MONTHS);
    // 100 days of Pro left: 2 more months reach 160 days, a third would reach 190.
    expect(prepayableMonths([{ planId: "pro", expiresAt: until(100) }], [], "pro", DEFAULT_PLANS, NOW)).toBe(2);
    // Exactly one month left: five more reach 180 days.
    expect(prepayableMonths([{ planId: "pro", expiresAt: until(30) }], [], "pro", DEFAULT_PLANS, NOW)).toBe(5);
    expect(prepayableMonths([{ planId: "pro", expiresAt: until(170) }], [], "pro", DEFAULT_PLANS, NOW)).toBe(0);
    // An ended plan is no plan.
    expect(prepayableMonths([{ planId: "pro", expiresAt: until(-1) }], [], "pro", DEFAULT_PLANS, NOW)).toBe(MAX_PLAN_MONTHS);
  });

  it("gives each plan its own limit: the other plan and its orders don't count", () => {
    // Pro paid 170 days ahead: no more Pro fits, and Max still takes the full six months.
    const pro = [{ planId: "pro" as const, expiresAt: until(170) }];
    expect(prepayableMonths(pro, [], "pro", DEFAULT_PLANS, NOW)).toBe(0);
    expect(prepayableMonths(pro, [], "max", DEFAULT_PLANS, NOW)).toBe(MAX_PLAN_MONTHS);
    // Max with 100 days left, and a Pro order waiting for its payment: Max's room is Max's alone.
    const both = [...pro, { planId: "max" as const, expiresAt: until(100) }];
    expect(prepayableMonths(both, [{ planId: "pro", days: 180 }], "max", DEFAULT_PLANS, NOW)).toBe(2);
  });

  it("counts open orders as sold, so two orders placed together can't pass the limit", () => {
    const open = [{ planId: "pro" as const, days: 120 }];
    expect(prepayableMonths([], open, "pro", DEFAULT_PLANS, NOW)).toBe(2);
    expect(prepayableMonths([], [...open, { planId: "pro", days: 60 }], "pro", DEFAULT_PLANS, NOW)).toBe(0);
  });

  it("prices and lengthens a plan by its months, so its value per day stays the same", () => {
    const three = planForMonths(DEFAULT_PLANS, "pro", 3);
    expect(three.pro).toMatchObject({ days: 90, priceUsd: 60, creditsPerWindow: DEFAULT_PLANS.pro.creditsPerWindow });
    expect(three.max).toEqual(DEFAULT_PLANS.max);
    expect(Date.parse(applyPlanPurchase([], "pro", three, NOW).expiresAt)).toBe(NOW + 90 * DAY);
  });
});
