import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditsFor, DEFAULT_CREDIT_SETTINGS, modelWeight } from "@shared/credits";

// Credits: the balance a window shows, the order a charge spends in (window, then bonus), plans
// (their allowance while they last), and the checks that refuse bad promo codes and settings before
// anything is written.

const store = vi.hoisted(() => ({
  promo: null as null | Record<string, unknown>,
  user: null as null | Record<string, unknown>,
  updates: [] as unknown[][],
  events: [] as unknown[][],
  settings: null as null | Record<string, unknown>,
  billing: null as null | Record<string, unknown>,
  history: [] as Record<string, unknown>[],
}));

vi.mock("./db/pg", () => {
  const run = async (text: string, values: unknown[] = []) => {
    if (text.includes("FROM curialy.app_settings WHERE key = 'billing'")) return { rows: store.billing ? [{ value: store.billing }] : [] };
    if (text.includes("FROM curialy.app_settings")) return { rows: store.settings ? [{ value: store.settings }] : [] };
    if (text.startsWith("SELECT id, role, credit_allowance")) return { rows: store.user ? [store.user] : [] };
    if (text.startsWith("SELECT *, NULL::text AS for_login FROM curialy.promo_codes")) return { rows: store.promo ? [store.promo] : [] };
    if (text.startsWith("SELECT free_allowance_withheld, credit_allowance")) return { rows: store.user ? [store.user] : [] };
    if (text.startsWith("SELECT kind, amount, detail, session_id, created_at FROM curialy.credit_events")) return { rows: store.history };
    if (text.startsWith("INSERT INTO curialy.promo_redemptions")) return { rows: [], rowCount: 1 };
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
const { resetBillingSettings } = await import("./billing/settings");

const HOUR = 3_600_000;
const user = (patch: Record<string, unknown> = {}) => ({ id: "u1", role: "user", credit_allowance: null, bonus_credits: "0", window_started_at: null, window_used: "0", ...patch });
// The refilling allowance these tests describe; the defaults (welcome credits, no window) are merged over it when the database is read.
const settings = { ...DEFAULT_CREDIT_SETTINGS, creditsPerWindow: 60, windowHours: 5, signupsOpen: true };

beforeEach(() => {
  store.promo = null;
  store.user = null;
  store.updates.length = 0;
  store.events.length = 0;
  store.settings = null;
  store.billing = null;
  store.history = [];
  store.settings = { creditsPerWindow: 60, windowHours: 5, signupsOpen: true };
  resetBillingSettings();
  credits.resetCreditSettings();
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

  it("gives an account without the free allowance no window and no refill time; an own allowance still applies", () => {
    const now = Date.now();
    const withheld = user({ free_allowance_withheld: true, bonus_credits: "12", window_started_at: new Date(now - HOUR), window_used: "3" });
    expect(credits.balanceOf(withheld, settings, now)).toMatchObject({ allowance: 0, used: 0, remaining: 0, bonus: 12, available: 12, resetsAt: null });
    expect(credits.balanceOf({ ...withheld, credit_allowance: 40 }, settings, now)).toMatchObject({ allowance: 40, remaining: 37 });
    // Its out-of-credits text never promises a refill.
    expect(credits.outOfCreditsMessage(credits.balanceOf(user({ free_allowance_withheld: true }), settings, now))).toBe("Your account has no credits right now. Get a plan or redeem a promo code to continue.");
  });

  it("uses an account's own allowance, never shows a negative remainder, and marks admins unlimited", () => {
    const now = Date.now();
    expect(credits.balanceOf(user({ credit_allowance: 200 }), settings, now)).toMatchObject({ allowance: 200, remaining: 200 });
    expect(credits.balanceOf(user({ window_started_at: new Date(now), window_used: "75" }), settings, now)).toMatchObject({ remaining: 0, available: 0 });
    expect(credits.balanceOf(user({ role: "admin" }), settings, now).unlimited).toBe(true);
  });
});

describe("plans", () => {
  const DAY = 86_400_000;
  const pro = (patch: Record<string, unknown> = {}) => user({ plan_id: "pro", plan_expires_at: new Date(Date.now() + 10 * DAY), plan_credits_per_window: 6000, ...patch });

  it("raise the allowance to the plan's while it lasts, and never lower it", () => {
    const now = Date.now();
    const balance = credits.balanceOf(pro(), settings, now);
    expect(balance).toMatchObject({ allowance: 6000, remaining: 6000, available: 6000 });
    expect(balance.plan).toEqual({ id: "pro", name: "Pro", expiresAt: new Date(now + 10 * DAY).toISOString(), creditsPerWindow: 6000 });
    // An own allowance above the plan's stays.
    expect(credits.balanceOf(pro({ credit_allowance: 10_000 }), settings, now).allowance).toBe(10_000);
    // The allowance frozen at purchase counts, not today's setting.
    expect(credits.balanceOf(pro({ plan_credits_per_window: 5000 }), settings, now).allowance).toBe(5000);
    // A window already open uses the plan's allowance.
    expect(credits.balanceOf(pro({ window_started_at: new Date(now - 3_600_000), window_used: "75" }), settings, now)).toMatchObject({ used: 75, remaining: 5925 });
  });

  it("give a paid plan's allowance to an account that started without the free one", () => {
    const now = Date.now();
    const withheld = pro({ free_allowance_withheld: true, window_started_at: new Date(now - 3_600_000), window_used: "10" });
    expect(credits.balanceOf(withheld, settings, now)).toMatchObject({ allowance: 6000, used: 10, remaining: 5990, plan: { id: "pro" } });
    expect(credits.balanceOf(withheld, settings, now).resetsAt).not.toBeNull();
  });

  it("add the boost's allowance on its own window once both X rewards are claimed, and drop it when the offer ends", () => {
    const now = Date.now();
    const both = user({ x_followed_at: new Date(now - HOUR), x_posted_at: new Date(now - HOUR), window_started_at: new Date(now - HOUR), window_used: "40" });
    const boosted = { ...DEFAULT_CREDIT_SETTINGS, creditsPerWindow: 0 };
    const balance = credits.balanceOf(both, boosted, now);
    expect(balance).toMatchObject({ allowance: 300, windowHours: 8, used: 40, remaining: 260, canEarn: false, welcome: true, boost: { creditsPerWindow: 300, windowHours: 8, endsAt: null } });
    expect(Date.parse(balance.resetsAt!)).toBe(now + 7 * HOUR);
    // One reward isn't enough, and a plan above the boost keeps the plan's window.
    expect(credits.balanceOf(user({ x_followed_at: new Date() }), boosted, now)).toMatchObject({ allowance: 0, boost: null, canEarn: true });
    expect(credits.balanceOf({ ...both, plan_id: "pro", plan_expires_at: new Date(now + 10 * 86_400_000), plan_credits_per_window: 6000 }, boosted, now)).toMatchObject({ allowance: 6000, windowHours: 5, boost: { creditsPerWindow: 300 } });
    const ended = { ...boosted, rewards: { ...boosted.rewards, boost: { ...boosted.rewards.boost, endsAt: new Date(now - 1000).toISOString() } } };
    expect(credits.balanceOf(both, ended, now)).toMatchObject({ allowance: 0, boost: null, resetsAt: null });
  });

  it("are ignored once ended, and admins stay unlimited", () => {
    const now = Date.now();
    expect(credits.balanceOf(pro({ plan_expires_at: new Date(now - 1000) }), settings, now)).toMatchObject({ allowance: 60, plan: null });
    expect(credits.balanceOf(pro({ plan_expires_at: new Date(now - 1000), free_allowance_withheld: true }), settings, now)).toMatchObject({ allowance: 0, plan: null });
    expect(credits.balanceOf(user({ plan_id: "gold", plan_expires_at: new Date(now + DAY) }), settings, now).plan).toBeNull();
    expect(credits.balanceOf(pro({ role: "admin" }), settings, now)).toMatchObject({ unlimited: true, plan: { id: "pro" } });
  });

  it("are named as the billing settings name them", async () => {
    store.billing = { plans: { max: { name: "Max Team" } } };
    store.user = user({ plan_id: "max", plan_expires_at: new Date(Date.now() + DAY), plan_credits_per_window: 30000 });
    const balance = await credits.getBalance("u1");
    expect(balance).toMatchObject({ allowance: 30000, plan: { id: "max", name: "Max Team", creditsPerWindow: 30000 } });
    // A plan that somehow has no frozen allowance uses the plan's own.
    store.user = user({ plan_id: "pro", plan_expires_at: new Date(Date.now() + DAY), plan_credits_per_window: null });
    expect((await credits.getBalance("u1")).plan).toMatchObject({ name: "Pro", creditsPerWindow: 6000 });
  });

  it("are spent from like any allowance, and point to a plan when credits run out", async () => {
    store.user = pro({ bonus_credits: "5" });
    expect(await credits.charge("u1", 100, "t1", "turn")).toMatchObject({ used: 100, remaining: 5900, bonus: 5 });
    const empty = credits.balanceOf(user({ window_started_at: new Date(), window_used: "60" }), settings);
    expect(credits.outOfCreditsMessage(empty)).toMatch(/^You've used this window's credits\. They refill in 5 h; the X rewards, a plan or a promo code add more now\.$/);
  });

  it("let an account without the free allowance redeem a code for anyone while one lasts", async () => {
    const open = { id: "p1", code: "WELCOME-2026", credits: 50, for_user_id: null, max_redemptions: null, redemptions: 0, expires_at: null, disabled_at: null, note: null, created_at: new Date() };
    store.promo = open;
    store.user = pro({ free_allowance_withheld: true });
    expect(await credits.redeemPromoCode("u1", "WELCOME-2026")).toMatchObject({ credits: 50 });
    store.user = pro({ free_allowance_withheld: true, plan_expires_at: new Date(Date.now() - 1000) });
    await expect(credits.redeemPromoCode("u1", "WELCOME-2026")).rejects.toThrow("That code isn't valid.");
  });

  it("show in the account's own history without the operator's note", async () => {
    store.history = [
      { kind: "plan", amount: "0", detail: "Pro plan until 9 Dec 2026 (given by the operator) · note: beta tester, see ticket 41", session_id: null, created_at: new Date() },
      { kind: "plan", amount: "0", detail: "Max plan until 9 Dec 2026 (order CUR-7K3M2QX9)", session_id: null, created_at: new Date() },
    ];
    expect((await credits.creditHistory("u1", 30, { forAccount: true })).map(entry => entry.detail)).toEqual(["Pro plan until 9 Dec 2026 (given by the operator)", "Max plan until 9 Dec 2026 (order CUR-7K3M2QX9)"]);
    expect((await credits.creditHistory("u1", 30))[0].detail).toContain("beta tester");
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

  it("spends only bonus credits for an account without the free allowance, and never opens a window for it", async () => {
    store.user = user({ free_allowance_withheld: true, bonus_credits: "10" });
    let balance = await credits.charge("u1", 4, "t1", "turn 1");
    expect(balance).toMatchObject({ allowance: 0, bonus: 6, available: 6, resetsAt: null });
    expect(store.user!.window_started_at).toBeNull();
    balance = await credits.charge("u1", 15, "t1", "turn 2");
    expect(balance).toMatchObject({ bonus: 0, available: 0, resetsAt: null });
    expect(store.user!.window_used).toBe("0");
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

describe("promo codes and the free allowance", () => {
  const open = { id: "p1", code: "WELCOME-2026", credits: 50, for_user_id: null, max_redemptions: null, redemptions: 0, expires_at: null, disabled_at: null, note: null, created_at: new Date() };

  it("refuses a code meant for anyone to an account without the free allowance, said like an unknown code", async () => {
    store.promo = open;
    store.user = user({ free_allowance_withheld: true });
    await expect(credits.redeemPromoCode("u1", "WELCOME-2026")).rejects.toThrow("That code isn't valid.");
    // An own allowance of 0 gives it nothing either.
    store.user = user({ free_allowance_withheld: true, credit_allowance: 0 });
    await expect(credits.redeemPromoCode("u1", "WELCOME-2026")).rejects.toThrow("That code isn't valid.");
    // A code made for this account, or an account the operator gave an allowance, still works.
    store.promo = { ...open, for_user_id: "u1" };
    store.user = user({ free_allowance_withheld: true });
    expect(await credits.redeemPromoCode("u1", "WELCOME-2026")).toMatchObject({ credits: 50 });
    store.promo = open;
    store.user = user({ free_allowance_withheld: true, credit_allowance: 20 });
    expect(await credits.redeemPromoCode("u1", "WELCOME-2026")).toMatchObject({ credits: 50 });
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
    await expect(credits.saveSettings({ welcomeCredits: -1 }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.saveSettings({ rewards: { followHandle: "not a name" } }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.saveSettings({ rewards: { boost: { windowHours: 0 } } }, "admin")).rejects.toMatchObject({ status: 400 });
    await expect(credits.saveSettings({ rewards: { apiUsd: -1 } }, "admin")).rejects.toMatchObject({ status: 400 });
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
