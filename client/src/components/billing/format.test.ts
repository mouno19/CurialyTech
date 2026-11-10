import { describe, expect, it } from "vitest";
import { creditCount, microsText, spendableCredits, spendableMicrosText } from "./format";

describe("creditCount", () => {
  it("groups thousands the way every other figure in the app does (en-US, whatever the viewer's locale)", () => {
    expect(creditCount(6000)).toBe("6,000");
    expect(creditCount(4741)).toBe("4,741");
    expect(creditCount(30000)).toBe("30,000");
  });

  it("keeps the hundredths runs are charged in, so small use never reads 0 or twice its size", () => {
    expect(creditCount(0.03)).toBe("0.03");
    expect(creditCount(0.05)).toBe("0.05");
    expect(creditCount(0)).toBe("0");
    expect(creditCount(4.5)).toBe("4.5");
    expect(creditCount(43.5)).toBe("44");
  });
});

describe("what can be spent", () => {
  it("cuts credits to what's shown instead of rounding up", () => {
    expect(spendableCredits(0.96)).toBe(0.96);
    expect(spendableCredits(0.29)).toBe(0.29);
    expect(spendableCredits(4.97)).toBe(4.9);
    expect(spendableCredits(4741.6)).toBe(4741);
    expect(spendableCredits(0)).toBe(0);
    expect(spendableCredits(-2)).toBe(0);
    // Under the one credit a run needs, the account card never says "1".
    expect(creditCount(spendableCredits(0.999))).toBe("0.99");
  });

  it("cuts money to the cent instead of rounding up", () => {
    expect(spendableMicrosText(4_999_999)).toBe("$4.99");
    expect(spendableMicrosText(9_995_000)).toBe("$9.99");
    expect(spendableMicrosText(5_000_000)).toBe("$5.00");
    expect(spendableMicrosText(0)).toBe("$0.00");
    // Under a cent the shared format already keeps the digits.
    expect(spendableMicrosText(4_200)).toBe("$0.0042");
    // A hold is shown as it is.
    expect(microsText(4_999_999)).toBe("$5.00");
  });
});
