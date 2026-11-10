import { describe, expect, it } from "vitest";
import { parseTopUp } from "./topUp";

const LIMITS = { minUsd: 5, maxUsd: 1000 };

describe("parseTopUp", () => {
  it("takes whole dollars as people type them", () => {
    expect(parseTopUp("25", LIMITS)).toEqual({ ok: true, amountUsd: 25 });
    expect(parseTopUp(" $40 ", LIMITS)).toEqual({ ok: true, amountUsd: 40 });
    expect(parseTopUp("$ 1,000", LIMITS)).toEqual({ ok: true, amountUsd: 1000 });
    expect(parseTopUp("25.00", LIMITS)).toEqual({ ok: true, amountUsd: 25 });
    expect(parseTopUp("5", LIMITS)).toEqual({ ok: true, amountUsd: 5 });
  });

  it("says why an amount can't be used", () => {
    expect(parseTopUp("", LIMITS)).toEqual({ ok: false, error: "Enter an amount from $5 to $1,000." });
    expect(parseTopUp("25.50", LIMITS)).toEqual({ ok: false, error: "Use whole dollars, without cents." });
    expect(parseTopUp("ten", LIMITS)).toEqual({ ok: false, error: "Enter whole dollars as digits, from $5 to $1,000." });
    expect(parseTopUp("-5", LIMITS).ok).toBe(false);
    expect(parseTopUp("1e3", LIMITS).ok).toBe(false);
    expect(parseTopUp("4", LIMITS)).toEqual({ ok: false, error: "The smallest top-up is $5." });
    expect(parseTopUp("1001", LIMITS)).toEqual({ ok: false, error: "The largest top-up is $1,000." });
    expect(parseTopUp("1,0000", LIMITS).ok).toBe(false);
  });
});
