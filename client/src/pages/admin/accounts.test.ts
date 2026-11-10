import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "@shared/billing";
import { balanceChangePreview, balanceChangeText, grantLabel, grantResult, grantSentence, LEDGER_LABEL, parseBalanceChange, parseDays, planChipText, planStateOf } from "./accounts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const inDays = (count: number) => new Date(NOW + count * DAY).toISOString();
const day = (iso: string) => iso.slice(0, 10);
const plans = DEFAULT_PLANS;

describe("amounts and days", () => {
  it("takes a dollar change either way", () => {
    expect(parseBalanceChange("10")).toEqual({ ok: true, amountUsd: 10 });
    expect(parseBalanceChange(" -2.50 ")).toEqual({ ok: true, amountUsd: -2.5 });
    expect(parseBalanceChange("$5")).toEqual({ ok: true, amountUsd: 5 });
    expect(parseBalanceChange("-$5")).toEqual({ ok: true, amountUsd: -5 });
    expect(parseBalanceChange("+1,000")).toEqual({ ok: true, amountUsd: 1000 });
    expect(parseBalanceChange("0.000001")).toEqual({ ok: true, amountUsd: 0.000001 });
  });

  it("refuses what the server refuses", () => {
    expect(parseBalanceChange("")).toMatchObject({ ok: false });
    expect(parseBalanceChange("0")).toEqual({ ok: false, error: "Enter an amount other than zero." });
    expect(parseBalanceChange("10001")).toEqual({ ok: false, error: "Enter an amount from -$10,000 to $10,000." });
    expect(parseBalanceChange("-10000.01")).toMatchObject({ ok: false });
    expect(parseBalanceChange("0.0000001")).toEqual({ ok: false, error: "Use at most six decimals (a millionth of a dollar)." });
    expect(parseBalanceChange("ten")).toMatchObject({ ok: false });
  });

  it("takes whole days from 1 to 366", () => {
    expect(parseDays("30")).toEqual({ ok: true, days: 30 });
    expect(parseDays(" 366 ")).toEqual({ ok: true, days: 366 });
    for (const bad of ["0", "367", "1.5", "", "-3", "abc"]) expect(parseDays(bad)).toEqual({ ok: false, error: "Days are a whole number from 1 to 366." });
  });
});

describe("giving a plan", () => {
  it("reads only a plan that is still running", () => {
    expect(planStateOf({ id: "pro", name: "Pro", expiresAt: inDays(3), creditsPerWindow: 6000 }, NOW)).toEqual({ planId: "pro", expiresAt: inDays(3) });
    expect(planStateOf({ id: "pro", name: "Pro", expiresAt: inDays(-1), creditsPerWindow: 6000 }, NOW)).toBeNull();
    expect(planStateOf(null, NOW)).toBeNull();
  });

  it("works like buying the plan for those days", () => {
    expect(grantResult(null, "pro", 7, plans, NOW)).toEqual({ planId: "pro", expiresAt: inDays(7), effect: "start" });
    expect(grantResult({ planId: "pro", expiresAt: inDays(10) }, "pro", 30, plans, NOW)).toEqual({ planId: "pro", expiresAt: inDays(40), effect: "extend" });
    // 12 days of Pro are worth 3 days of Max.
    expect(grantResult({ planId: "pro", expiresAt: inDays(12) }, "max", 10, plans, NOW)).toEqual({ planId: "max", expiresAt: inDays(13), effect: "upgrade" });
    // 20 days of Pro add 5 days to Max.
    expect(grantResult({ planId: "max", expiresAt: inDays(2) }, "pro", 20, plans, NOW)).toEqual({ planId: "max", expiresAt: inDays(7), effect: "extend_higher" });
  });

  it("names the button and the result", () => {
    const pro = { planId: "pro" as const, expiresAt: inDays(12) };
    expect(grantLabel("start", "pro", null, plans)).toBe("Give Pro");
    expect(grantLabel("extend", "pro", pro, plans)).toBe("Extend Pro");
    expect(grantLabel("upgrade", "max", pro, plans)).toBe("Upgrade to Max");
    expect(grantLabel("extend_higher", "pro", { planId: "max", expiresAt: inDays(2) }, plans)).toBe("Add to Max");
    expect(grantSentence(grantResult(null, "pro", 7, plans, NOW), "pro", 7, null, plans, day)).toBe(`Pro starts now and runs until about ${day(inDays(7))}.`);
    expect(grantSentence(grantResult(pro, "max", 10, plans, NOW), "max", 10, pro, plans, day)).toBe(`Max starts now, with the days left on Pro carried over at their value: until about ${day(inDays(13))}.`);
    const max = { planId: "max" as const, expiresAt: inDays(2) };
    expect(grantSentence(grantResult(max, "pro", 1, plans, NOW), "pro", 1, max, plans, day)).toMatch(/^Max stays, with the value of 1 day of Pro added: until about /);
  });
});

describe("the API balance", () => {
  it("names every ledger entry", () => {
    expect(Object.keys(LEDGER_LABEL).sort()).toEqual(["adjust", "grant", "refund", "topup"]);
  });

  it("says what a change will do before any money moves", () => {
    expect(balanceChangePreview("@ada", 10, 12_340_000)).toEqual({ possible: true, text: "Adds $10.00 to @ada's API balance: $12.34 → $22.34. The account's API keys can spend it at once." });
    expect(balanceChangePreview("@ada", -5, 12_000_000)).toEqual({ possible: true, text: "Removes $5.00 from @ada's API balance: $12.00 → $7.00." });
    expect(balanceChangePreview("@ada", -20, 20_000_000).text).toBe("Removes $20.00 from @ada's API balance: $20.00 → $0.00.");
    // A removal stops at zero, as the server applies it.
    expect(balanceChangePreview("@ada", -100, 20_000_000)).toEqual({ possible: true, text: "Removes all of @ada's API balance, which is less than the $100.00 you entered: $20.00 → $0.00." });
    // Nothing to take from a balance at or below zero (the server refuses it).
    expect(balanceChangePreview("@ada", -5, 0)).toEqual({ possible: false, text: "@ada's API balance is $0.00, so there is nothing to remove." });
    expect(balanceChangePreview("@ada", -5, -370_000).possible).toBe(false);
    expect(balanceChangePreview("@ada", 1, -370_000).text).toBe("Adds $1.00 to @ada's API balance: -$0.37 → $0.63. The account's API keys can spend it at once.");
  });

  it("says what a change actually did", () => {
    expect(balanceChangeText("@ada", 10, 10, 22.34)).toBe("Added $10.00 to @ada's API balance. It's now $22.34.");
    expect(balanceChangeText("@ada", -5, -5, 7)).toBe("Removed $5.00 from @ada's API balance. It's now $7.00.");
    expect(balanceChangeText("@ada", -50, -3.21, 0)).toBe("Removed $3.21 from @ada's API balance, all it had. It's now $0.00.");
    expect(balanceChangeText("@ada", -5, 0, 0)).toBe("Nothing to remove: @ada's API balance is $0.00.");
  });

  it("shows a running plan with its end", () => {
    expect(planChipText({ name: "Max", expiresAt: inDays(30) }, day, NOW)).toBe(`Max · until ${day(inDays(30))}`);
    expect(planChipText({ name: "Max", expiresAt: inDays(-1) }, day, NOW)).toBeNull();
    expect(planChipText(null, day, NOW)).toBeNull();
  });
});
