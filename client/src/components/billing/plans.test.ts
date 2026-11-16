import { describe, expect, it } from "vitest";
import type { PlanOffer } from "@shared/billing";
import type { FreeTier } from "@shared/billing";
import { daysLeftText, daysText, formatPrice, freeMultiple, freeTierLines, listText, offerBadge, offerEnd, offerSentence, offerText, ownAllowance, planAction, planConfigs, plansAllowance, planState, plansText, runningPlans, topUpSentence } from "./plans";

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
  const onPro = { id: "pro" as const, name: "Pro", expiresAt: inDays(10), creditsPerWindow: 6000 };
  const onMax = { id: "max" as const, name: "Max", expiresAt: inDays(5), creditsPerWindow: 30_000 };

  it("gets a plan, extends the one the account has, and adds the other one alongside it", () => {
    expect(planAction([], pro, plans, NOW)).toMatchObject({ effect: "start", label: "Get Pro", hint: "30 days from when the payment is applied." });
    expect(planAction([onPro], pro, plans, NOW)).toMatchObject({ effect: "extend", label: "Extend Pro", hint: "Adds 30 days to the end of your Pro plan." });
    // Max on Pro is never blocked or converted: both run, and the credits add up.
    expect(planAction([onPro], max, plans, NOW)).toEqual({
      effect: "concurrent", label: "Add Max",
      hint: "Runs alongside Pro for 30 days: 36,000 credits per window while both last. Pro keeps its own end date.",
    });
    expect(planAction([onMax], pro, plans, NOW)).toMatchObject({ effect: "concurrent", label: "Add Pro", hint: expect.stringContaining("36,000 credits per window while both last") });
    // Holding both, each button extends its own plan.
    expect(planAction([onPro, onMax], max, plans, NOW)).toMatchObject({ effect: "extend", label: "Extend Max" });
  });

  it("treats an ended plan as none, and pays ahead for the whole purchase", () => {
    const ended = { ...onMax, expiresAt: inDays(-1) };
    expect(planState([ended], NOW)).toEqual([]);
    expect(planAction([ended], pro, plans, NOW).label).toBe("Get Pro");
    expect(planAction([], pro, plans, NOW, 3)).toMatchObject({ effect: "start", label: "Get Pro for 3 months", hint: "90 days from when the payment is applied." });
    expect(planAction([onPro], pro, plans, NOW, 2)).toMatchObject({ effect: "extend", label: "Extend Pro for 2 months", hint: "Adds 60 days to the end of your Pro plan." });
    expect(planAction([onMax], pro, plans, NOW, 2)).toMatchObject({ effect: "concurrent", label: "Add Pro for 2 months", hint: expect.stringContaining("for 60 days") });
    expect(planState([onMax], NOW)).toEqual([{ planId: "max", expiresAt: inDays(5) }]);
  });

  it("adds up and names the plans an account has", () => {
    expect(runningPlans([onPro, { ...onMax, expiresAt: inDays(-1) }], NOW)).toEqual([onPro]);
    expect(plansAllowance([onPro, onMax])).toBe(36_000);
    expect(plansText([onPro, onMax])).toBe("Pro + Max");
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
    expect(ownAllowance({ unlimited: false, allowance: 10_000 }, [])).toBe(10_000);
    expect(ownAllowance({ unlimited: false, allowance: 0 }, [])).toBe(0);
    // With plans, the account gets the larger: its own shows only when it's above what they give together.
    expect(ownAllowance({ unlimited: false, allowance: 10_000 }, [{ creditsPerWindow: 6000 }])).toBe(10_000);
    expect(ownAllowance({ unlimited: false, allowance: 6000 }, [{ creditsPerWindow: 6000 }])).toBeNull();
    expect(ownAllowance({ unlimited: false, allowance: 36_000 }, [{ creditsPerWindow: 6000 }, { creditsPerWindow: 30_000 }])).toBeNull();
    expect(ownAllowance({ unlimited: true, allowance: 0 }, [])).toBeNull();
    expect(ownAllowance(null, [])).toBeNull();
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
    expect(topUpSentence(100)).toBe("The crossed price is the balance you receive: $1 paid is shown as $100 crossed out. Requests are charged at the prices on the Developer API page.");
    expect(offerSentence({ plansPercent: 90, apiPercent: 50, endsAt: null })).toBe("Launch offer: 90% off plans, 50% off Developer API prices.");
  });

  it("joins lists in words", () => {
    expect(listText(["USDT", "USDC", "ETH"])).toBe("USDT, USDC or ETH");
    expect(listText(["Ethereum", "Solana"], "and")).toBe("Ethereum and Solana");
    expect(listText(["SOL"])).toBe("SOL");
    expect(listText([])).toBe("");
  });
});
