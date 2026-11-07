import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditsFor, modelWeight } from "@shared/credits";

// Credits: the balance a window shows, the order a charge spends in (window, then bonus), and the
// checks that refuse bad promo codes and settings before anything is written.

const store = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  updates: [] as unknown[][],
  events: [] as unknown[][],
  settings: null as null | Record<string, unknown>,
}));

vi.mock("./db/pg", () => {
  const run = async (text: string, values: unknown[] = []) => {
    if (text.includes("FROM curialy.app_settings")) return { rows: store.settings ? [{ value: store.settings }] : [] };
    if (text.startsWith("SELECT id, role, credit_allowance")) return { rows: store.user ? [store.user] : [] };
    if (text.startsWith("UPDATE curialy.users SET window_started_at")) {
      store.updates.push(values);
      const [, windowStart, windowUsed, fromBonus] = values as [string, Date, number, number];
      store.user = { ...store.user!, window_started_at: windowStart, window_used: String(windowUsed), bonus_credits: String(Number(store.user!.bonus_credits) - fromBonus) };
      return { rows: [store.user] };
    }
    if (text.startsWith("INSERT INTO curialy.credit_events")) {
      store.events.push(values);
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  };
  return { query: vi.fn(run), db: () => ({ connect: async () => ({ query: run, release: () => undefined }) }), adminUserId: async () => "admin" };
});

const credits = await import("./credits");

const HOUR = 3_600_000;
const user = (patch: Record<string, unknown> = {}) => ({ id: "u1", role: "user", credit_allowance: null, bonus_credits: "0", window_started_at: null, window_used: "0", ...patch });
const settings = { creditsPerWindow: 60, windowHours: 5, signupsOpen: true };

beforeEach(() => {
  store.user = null;
  store.updates.length = 0;
  store.events.length = 0;
  store.settings = null;
});

describe("balance", () => {
  it("shows the full allowance when no window is open, and what is left in an open one", () => {
    const now = Date.now();
    expect(credits.balanceOf(user({ bonus_credits: "25" }), settings, now)).toMatchObject({ unlimited: false, allowance: 60, used: 0, remaining: 60, bonus: 25, available: 85, resetsAt: null });
    const open = credits.balanceOf(user({ window_started_at: new Date(now - HOUR), window_used: "41.5" }), settings, now);
    expect(open).toMatchObject({ used: 41.5, remaining: 18.5, available: 18.5 });
    expect(Date.parse(open.resetsAt!)).toBe(now + 4 * HOUR);
    // A window that ended counts as none: the allowance is back in full.
    expect(credits.balanceOf(user({ window_started_at: new Date(now - 6 * HOUR), window_used: "60" }), settings, now)).toMatchObject({ used: 0, remaining: 60, resetsAt: null });
  });

  it("uses an account's own allowance, never shows a negative remainder, and marks admins unlimited", () => {
    const now = Date.now();
    expect(credits.balanceOf(user({ credit_allowance: 200 }), settings, now)).toMatchObject({ allowance: 200, remaining: 200 });
    expect(credits.balanceOf(user({ window_started_at: new Date(now), window_used: "75" }), settings, now)).toMatchObject({ remaining: 0, available: 0 });
    expect(credits.balanceOf(user({ role: "admin" }), settings, now).unlimited).toBe(true);
  });
});

describe("charge", () => {
  it("opens a window with the first charge and spends the window before bonus credits", async () => {
    store.user = user({ bonus_credits: "10" });
    let balance = await credits.charge("u1", 50, "t1", "turn 1");
    expect(balance).toMatchObject({ used: 50, remaining: 10, bonus: 10, available: 20 });
    expect(balance.resetsAt).not.toBeNull();
    balance = await credits.charge("u1", 15, "t1", "turn 2");
    // 10 from the window, 5 from the bonus.
    expect(balance).toMatchObject({ used: 60, remaining: 0, bonus: 5, available: 5 });
    expect(store.events.map(values => values[1])).toEqual([-50, -15]);
  });

  it("records what neither covers against the window (it ends at the reset) and never charges an admin", async () => {
    store.user = user({ window_started_at: new Date(), window_used: "58" });
    expect(await credits.charge("u1", 5, null, "turn")).toMatchObject({ used: 63, remaining: 0, available: 0 });
    store.user = user({ role: "admin" });
    store.updates.length = 0;
    expect((await credits.charge("u1", 100, null, "turn")).unlimited).toBe(true);
    expect(store.updates).toEqual([]);
  });

  it("lets a run start with a credit available and refuses it with none", async () => {
    store.user = user({ window_started_at: new Date(), window_used: "59.5", bonus_credits: "0.5" });
    await expect(credits.assertCanStart("u1")).resolves.toMatchObject({ available: 1 });
    store.user = user({ window_started_at: new Date(), window_used: "60" });
    await expect(credits.assertCanStart("u1")).rejects.toMatchObject({ code: "no_credits", status: 402 });
  });
});

describe("validation before anything is written", () => {
  it("refuses bad promo codes, credit amounts, uses and expiry dates", async () => {
    await expect(credits.createPromoCode({ code: "no spaces!", credits: 10 }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.createPromoCode({ credits: 0 }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.createPromoCode({ credits: 10, maxRedemptions: 0 }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.createPromoCode({ credits: 10, expiresAt: "2001-01-01T00:00:00Z" }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.redeemPromoCode("u1", "x")).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("refuses settings outside their range", async () => {
    await expect(credits.saveSettings({ creditsPerWindow: -1 }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.saveSettings({ windowHours: 0 }, "admin")).rejects.toMatchObject({ status: 400 });
  });
});

describe("what a response costs", () => {
  it("weighs output four times and models by family", () => {
    expect(creditsFor("claude-sonnet-5-5", { inputTokens: 20_000, outputTokens: 1_250 })).toBe(1);
    expect(creditsFor("claude-opus-5-5", { inputTokens: 20_000, outputTokens: 1_250 })).toBe(5);
    expect(creditsFor("claude-haiku-5-5", { inputTokens: 20_000, outputTokens: 1_250 })).toBe(0.25);
    // Opus, a turn at the old 16K limit: output_tokens already counts the thinking.
    expect(creditsFor("claude-opus-5-5", { inputTokens: 10_024, outputTokens: 16_000 })).toBe(14.8);
    expect([modelWeight("r/gemini-3.8-flash"), modelWeight("llama3.1-8b"), modelWeight("openai-gpt-5.5")]).toEqual([0.25, 0.25, 1]);
  });
});
