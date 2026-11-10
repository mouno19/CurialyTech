import { describe, expect, it } from "vitest";
import type { PlanOffer } from "@shared/billing";
import type { FreeTier } from "@shared/billing";
import { daysLeftText, daysText, formatPrice, freeMultiple, freeTierLines, listText, offerBadge, offerEnd, offerSentence, offerText, ownAllowance, planAction, planConfigs, planState } from "./plans";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString();
const OFFERS: PlanOffer[] = [
  { id: "pro", name: "Pro", listUsd: 20, priceUsd: 2, discountPercent: 90, creditsPerWindow: 6000, days: 30 },
  { id: "max", name: "Max", listUsd: 80, priceUsd: 8, discountPercent: 90, creditsPerWindow: 30000, days: 30 },
];
const plans = planConfigs(OFFERS)!;
const [pro, max] = OFFERS;

describe("planAction", () => {
  it("reads planAfterPurchase's effect into the button", () => {
    expect(planAction(null, pro, plans, NOW)).toMatchObject({ effect: "start", label: "Get Pro" });
    expect(planAction({ planId: "pro", expiresAt: inDays(10) }, pro, plans, NOW)).toMatchObject({ effect: "extend", label: "Extend Pro", hint: "Adds 30 days to the end of your plan." });
    expect(planAction({ planId: "pro", expiresAt: inDays(12) }, max, plans, NOW)).toMatchObject({ effect: "upgrade", label: "Upgrade to Max", hint: expect.stringContaining("about 3 days more for the time left on Pro") });
    // A month of Pro is worth a quarter of a month of Max.
    expect(planAction({ planId: "max", expiresAt: inDays(5) }, pro, plans, NOW)).toMatchObject({ effect: "extend_higher", label: "Adds 7.5 days to Max" });
  });

  it("treats an ended plan as none", () => {
    const ended = planState({ id: "max", expiresAt: inDays(-1) }, NOW);
    expect(ended).toBeNull();
    expect(planAction(ended, pro, plans, NOW).label).toBe("Get Pro");
    // Paying ahead: the whole purchase, at the same value per day.
    expect(planAction(null, pro, plans, NOW, 3)).toMatchObject({ effect: "start", label: "Get Pro for 3 months", hint: "90 days from when the payment is applied." });
    expect(planAction({ planId: "pro", expiresAt: inDays(10) }, pro, plans, NOW, 2)).toMatchObject({ effect: "extend", label: "Extend Pro for 2 months", hint: "Adds 60 days to the end of your plan." });
    expect(planAction({ planId: "max", expiresAt: inDays(5) }, pro, plans, NOW, 2)).toMatchObject({ effect: "extend_higher", label: "Adds 15 days to Max" });
    expect(planState({ id: "max", expiresAt: inDays(1) }, NOW)).toEqual({ planId: "max", expiresAt: inDays(1) });
  });

  it("converts at list prices, so the offer never changes what a plan is worth", () => {
    expect(plans.pro.priceUsd).toBe(20);
    expect(planConfigs(OFFERS.slice(0, 1))).toBeNull();
  });
});

describe("prices and the offer", () => {
  it("formats whole dollars without cents", () => {
    expect(formatPrice(2)).toBe("$2");
    expect(formatPrice(1000)).toBe("$1,000");
    expect(formatPrice(2.5)).toBe("$2.50");
    expect(daysText(30)).toBe("30 days");
    expect(daysText(1)).toBe("1 day");
    expect(daysText(7.4999)).toBe("7.5 days");
    expect(daysLeftText(inDays(29.6), NOW)).toBe("29 days left");
    expect(daysLeftText(inDays(1.2), NOW)).toBe("1 day left");
    expect(daysLeftText(inDays(0.5), NOW)).toBe("Less than a day left");
  });

  it("says what a free account gets: once, then on X, then the boost while it is offered", () => {
    const free: FreeTier = {
      welcomeCredits: 60, creditsPerWindow: 0, windowHours: 5,
      rewards: { followHandle: "Yumiko_web3", followCredits: 240, postCredits: 300, apiUsd: 20, boost: { creditsPerWindow: 300, windowHours: 8, endsAt: null } },
    };
    const date = (iso: string) => iso;
    expect(freeTierLines(free, date)).toEqual({
      headline: "60 credits to start",
      lines: ["+240 for following @Yumiko_web3 on X", "+300 for a post about Curialy", "Both done: $20 on the Developer API, and 300 credits every 8 hours · limited time"],
    });
    expect(freeTierLines({ ...free, creditsPerWindow: 600, welcomeCredits: 0, rewards: { ...free.rewards, apiUsd: 0, boost: null } }, date)).toEqual({ headline: "600 credits every 5 hours", lines: ["+240 for following @Yumiko_web3 on X", "+300 for a post about Curialy"] });
  });

  it("compares a plan with the free allowance", () => {
    expect(freeMultiple(6000, 600)).toBe(10);
    expect(freeMultiple(30000, 600)).toBe(50);
    expect(freeMultiple(600, 600)).toBeNull();
    expect(freeMultiple(6000, 0)).toBeNull();
  });

  it("knows the account's own allowance only where it shows", () => {
    // Without a plan, the allowance is the account's own (none at all included).
    expect(ownAllowance({ unlimited: false, allowance: 10_000 }, null)).toBe(10_000);
    expect(ownAllowance({ unlimited: false, allowance: 0 }, null)).toBe(0);
    // With one, the account gets the larger: its own shows only when it's above the plan's.
    expect(ownAllowance({ unlimited: false, allowance: 10_000 }, { creditsPerWindow: 6000 })).toBe(10_000);
    expect(ownAllowance({ unlimited: false, allowance: 6000 }, { creditsPerWindow: 6000 })).toBeNull();
    expect(ownAllowance({ unlimited: true, allowance: 0 }, null)).toBeNull();
    expect(ownAllowance(null, null)).toBeNull();
  });

  it("says the offer in one line and as a badge", () => {
    // In the viewer's time zone (whatever the machine running this uses).
    const date = (iso: string) => `${new Date(iso).getDate()}/${new Date(iso).getMonth() + 1}`;
    const time = (iso: string) => `${new Date(iso).getHours()}:${String(new Date(iso).getMinutes()).padStart(2, "0")}`;
    const midnight = new Date(2026, 10, 30).toISOString();
    expect(offerText({ plansPercent: 90, apiPercent: 90, endsAt: null })).toBe("90% off plans and Developer API prices");
    expect(offerText({ plansPercent: 90, apiPercent: 50, endsAt: null })).toBe("90% off plans, 50% off Developer API prices");
    expect(offerText({ plansPercent: 0, apiPercent: 50, endsAt: null })).toBe("50% off Developer API prices");
    expect(offerText({ plansPercent: 0, apiPercent: 0, endsAt: null })).toBeNull();
    expect(offerBadge({ plansPercent: 90, apiPercent: 90, endsAt: null }, date)).toBe("90% off · limited time");
    // An offer that stops at midnight doesn't include the day it stops on.
    expect(offerBadge({ plansPercent: 90, apiPercent: 50, endsAt: midnight }, date, time)).toBe("Up to 90% off · through 29/11");
    expect(offerBadge({ plansPercent: 0, apiPercent: 0, endsAt: null }, date)).toBeNull();
    expect(offerEnd(new Date(2026, 10, 30, 15, 0).toISOString(), date, time)).toBe("until 30/11, 15:00");
    expect(offerEnd(new Date(2026, 10, 30, 23, 59).toISOString(), date, time)).toBe("until 30/11, 23:59");
    expect(offerEnd(null, date, time)).toBe("limited time");
    expect(offerEnd("not a date", date, time)).toBe("limited time");
    expect(offerSentence({ plansPercent: 90, apiPercent: 90, endsAt: null })).toBe("Launch offer on plans and Developer API prices.");
    expect(offerSentence({ plansPercent: 90, apiPercent: 0, endsAt: null })).toBe("Launch offer on plans.");
    expect(offerSentence({ plansPercent: 90, apiPercent: 50, endsAt: null })).toBe("Launch offer: 90% off plans, 50% off Developer API prices.");
  });

  it("joins lists in words", () => {
    expect(listText(["USDT", "USDC", "ETH"])).toBe("USDT, USDC or ETH");
    expect(listText(["Ethereum", "Solana"], "and")).toBe("Ethereum and Solana");
    expect(listText(["SOL"])).toBe("SOL");
    expect(listText([])).toBe("");
  });
});
