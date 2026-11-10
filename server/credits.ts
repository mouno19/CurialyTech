import { randomBytes } from "node:crypto";
import { DEFAULT_PLANS, isPlanId, type PlanConfig, type PlanId } from "@shared/billing";
import { DEFAULT_CREDIT_SETTINGS, MIN_CREDITS_TO_START, normalizeXHandle, type CreditBalance, type CreditSettings } from "@shared/credits";
import { getBillingSettings, knownPlans } from "./billing/settings";
import { db, query } from "./db/pg";

// Credits: a new account starts with welcome credits (default 60), given once. Bonus credits (the
// welcome credits, promo codes, grants, X rewards) are spent after the window's and never expire.
// A refilling allowance per window comes from a plan (30 days, paid in crypto), from an allowance
// the operator set for the account, from the settings' allowance for everyone (default 0: none),
// or from the launch boost (server/rewards.ts: both X rewards done, while the offer lasts). The
// largest applies; a window opens with the first credit spent after the previous one ended. Admins
// are not charged. Every change is a credit_events row.

/**
 * free_allowance_withheld: the account started without the free credits (see auth-github.ts); an own allowance still applies.
 * plan_*: the plan bought or given, until when, and its allowance as it was when it started.
 * x_followed_at, x_posted_at: when each X reward was claimed (both: the launch boost applies while it is offered).
 */
export type UserCredits = {
  id: string; role: string; credit_allowance: number | null; bonus_credits: string; window_started_at: Date | null; window_used: string; free_allowance_withheld?: boolean;
  plan_id?: string | null; plan_expires_at?: Date | null; plan_credits_per_window?: number | null;
  x_followed_at?: Date | null; x_posted_at?: Date | null;
};

/** In a 'plan' event's detail, what follows this is the operator's note (left out of the account's own history). */
export const PLAN_NOTE_MARK = " · note: ";

/** The account's plan while it lasts, named as the billing settings name it now; null when it has none or it has ended. */
export function activePlan(row: Pick<UserCredits, "plan_id" | "plan_expires_at" | "plan_credits_per_window">, plans: Record<PlanId, PlanConfig> = knownPlans(), now = Date.now()): CreditBalance["plan"] {
  if (!isPlanId(row.plan_id) || !row.plan_expires_at || row.plan_expires_at.getTime() <= now) return null;
  const config = plans[row.plan_id] ?? DEFAULT_PLANS[row.plan_id];
  return { id: row.plan_id, name: config.name, expiresAt: row.plan_expires_at.toISOString(), creditsPerWindow: row.plan_credits_per_window ?? config.creditsPerWindow };
}

/** Why a credit operation was refused; `unavailable` and `busy` are temporary. */
export type CreditErrorCode = "no_credits" | "invalid_code" | "code_used" | "busy" | "unavailable" | "not_linked" | "x_taken" | "not_following" | "post_invalid" | "already_claimed" | "locked";

export class CreditError extends Error {
  constructor(message: string, readonly code: CreditErrorCode, readonly status = 402, readonly balance?: CreditBalance) {
    super(message);
  }
}

// ---- Settings (one row, cached briefly: every run start reads them) ----

let settingsCache: { at: number; value: CreditSettings } | null = null;

/** A saved row or a patch over the settings: the rewards and the boost merge field by field, so older rows and partial patches keep the rest. */
export type CreditSettingsPatch = Partial<Omit<CreditSettings, "rewards">> & { rewards?: Partial<Omit<CreditSettings["rewards"], "boost">> & { boost?: Partial<CreditSettings["rewards"]["boost"]> } };

export function mergeSettings(base: CreditSettings, patch: CreditSettingsPatch | null | undefined): CreditSettings {
  const { rewards, ...plain } = patch ?? {};
  const { boost, ...reward } = rewards ?? {};
  return { ...base, ...plain, rewards: { ...base.rewards, ...reward, boost: { ...base.rewards.boost, ...boost } } };
}

export async function getSettings(): Promise<CreditSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 30_000) return settingsCache.value;
  const { rows } = await query<{ value: CreditSettingsPatch }>("SELECT value FROM curialy.app_settings WHERE key = 'credits'");
  const value = mergeSettings(DEFAULT_CREDIT_SETTINGS, rows[0]?.value);
  settingsCache = { at: Date.now(), value };
  return value;
}

/** Tests: forget the cached settings. */
export function resetCreditSettings() {
  settingsCache = null;
}

const invalid = (message: string) => new CreditError(message, "invalid_code", 400);
const wholeCredits = (value: unknown, what: string) => {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100_000) throw invalid(`${what} must be a whole number from 0 to 100000.`);
};

export async function saveSettings(patch: CreditSettingsPatch, by: string) {
  const previous = await getSettings();
  const next = mergeSettings(previous, patch);
  wholeCredits(next.creditsPerWindow, "Credits per window");
  wholeCredits(next.welcomeCredits, "Welcome credits");
  wholeCredits(next.rewards.followCredits, "The follow reward");
  wholeCredits(next.rewards.postCredits, "The post reward");
  wholeCredits(next.rewards.boost.creditsPerWindow, "The boost's credits per window");
  if (!(next.windowHours >= 1 && next.windowHours <= 168)) throw invalid("A window lasts from 1 to 168 hours.");
  if (!(next.rewards.boost.windowHours >= 1 && next.rewards.boost.windowHours <= 168)) throw invalid("The boost's window lasts from 1 to 168 hours.");
  const handle = normalizeXHandle(String(next.rewards.followHandle ?? ""));
  if (!handle) throw invalid("The X account to follow is a username of 1 to 15 letters, digits or underscores.");
  next.rewards.followHandle = handle;
  for (const flag of [next.signupsOpen, next.rewards.boost.enabled]) if (typeof flag !== "boolean") throw invalid("Switches are on or off (true or false).");
  // Only a new end time must be in the future: a boost that has ended stays as it is when the form sends the settings back.
  if (next.rewards.boost.endsAt !== null) {
    const ends = typeof next.rewards.boost.endsAt === "string" ? Date.parse(next.rewards.boost.endsAt) : NaN;
    const unchanged = previous.rewards.boost.endsAt !== null && ends === Date.parse(previous.rewards.boost.endsAt);
    if (!unchanged && (!Number.isFinite(ends) || ends <= Date.now())) throw invalid("The boost's end must be a time in the future, or none.");
    next.rewards.boost.endsAt = new Date(ends).toISOString();
  }
  await query(
    "INSERT INTO curialy.app_settings (key, value, updated_by, updated_at) VALUES ('credits', $1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
    [JSON.stringify(next), by],
  );
  settingsCache = { at: Date.now(), value: next };
  return next;
}

// ---- Balance ----

/** The launch boost as it applies to this account right now: both X rewards claimed, and the offer on and not ended. */
export function activeBoost(row: Pick<UserCredits, "x_followed_at" | "x_posted_at">, settings: CreditSettings, now = Date.now()): CreditBalance["boost"] {
  const { boost } = settings.rewards;
  if (!boost.enabled || !(boost.creditsPerWindow > 0) || !row.x_followed_at || !row.x_posted_at) return null;
  if (boost.endsAt && Date.parse(boost.endsAt) <= now) return null;
  return { creditsPerWindow: boost.creditsPerWindow, windowHours: boost.windowHours, endsAt: boost.endsAt };
}

export function balanceOf(row: UserCredits, settings: CreditSettings, now = Date.now(), plans: Record<PlanId, PlanConfig> = knownPlans()): CreditBalance {
  const own = row.credit_allowance ?? (row.free_allowance_withheld ? 0 : settings.creditsPerWindow);
  const plan = activePlan(row, plans, now);
  const boost = activeBoost(row, settings, now);
  // A plan or the boost raises the allowance, never lowers it; a withheld free allowance doesn't reduce
  // a paid plan. The window is the boost's only when the boost alone sets the allowance.
  let allowance = plan ? Math.max(plan.creditsPerWindow, own) : own;
  let windowHours = settings.windowHours;
  if (boost && boost.creditsPerWindow > allowance) {
    allowance = boost.creditsPerWindow;
    windowHours = boost.windowHours;
  }
  const bonus = Number(row.bonus_credits);
  const windowMs = windowHours * 3_600_000;
  // Without an allowance there is no window, and so never a refill time.
  const open = allowance > 0 && row.window_started_at !== null && now < row.window_started_at.getTime() + windowMs;
  const used = open ? Number(row.window_used) : 0;
  const remaining = Math.max(0, allowance - used);
  return {
    unlimited: row.role === "admin",
    allowance, used: round(used), remaining: round(remaining), bonus: round(bonus), available: round(remaining + bonus),
    resetsAt: open ? new Date(row.window_started_at!.getTime() + windowMs).toISOString() : null,
    windowHours,
    plan,
    boost,
    welcome: !row.free_allowance_withheld,
    canEarn: !row.free_allowance_withheld && !(row.x_followed_at && row.x_posted_at),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;
const COLUMNS = "id, role, credit_allowance, bonus_credits, window_started_at, window_used, free_allowance_withheld, plan_id, plan_expires_at, plan_credits_per_window, x_followed_at, x_posted_at";

export async function getBalance(userId: string): Promise<CreditBalance> {
  const [{ rows }, settings, billing] = await Promise.all([query<UserCredits>(`SELECT ${COLUMNS} FROM curialy.users WHERE id = $1`, [userId]), getSettings(), getBillingSettings()]);
  if (!rows[0]) throw new CreditError("Account not found.", "invalid_code", 404);
  return balanceOf(rows[0], settings, Date.now(), billing.plans);
}

/** Refuse to start a run without credits; admins always can. */
export async function assertCanStart(userId: string) {
  const balance = await getBalance(userId);
  if (balance.unlimited || balance.available >= MIN_CREDITS_TO_START) return balance;
  throw new CreditError(outOfCreditsMessage(balance), "no_credits", 402, balance);
}

/** In words that read right in any time zone (the client shows the clock time itself). */
export function outOfCreditsMessage(balance: CreditBalance) {
  // What adds credits for this account: the X rewards it hasn't claimed, a plan, a higher plan, or (on the highest) a promo code.
  const earn = balance.canEarn && !balance.plan;
  const more = balance.plan?.id === "max" ? "a promo code" : balance.plan ? "a higher plan or a promo code" : earn ? "the X rewards, a plan or a promo code" : "a plan or a promo code";
  if (!balance.resetsAt) {
    const action = balance.plan?.id === "max" ? "Redeem a promo code" : balance.plan ? "Get a higher plan or redeem a promo code" : earn ? "Earn credits on X, get a plan or redeem a promo code" : "Get a plan or redeem a promo code";
    return `Your account has no credits right now. ${action} to continue.`;
  }
  const minutes = Math.max(1, Math.ceil((Date.parse(balance.resetsAt) - Date.now()) / 60_000));
  const wait = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `You've used this window's credits. They refill in ${wait}; ${more} ${earn && !balance.plan ? "add" : "adds"} more now.`;
}

/**
 * Charge credits for usage: from the window first (opening one if none is open), then bonus credits.
 * Never fails for lack of credits (a response already happened); returns the balance afterwards.
 */
export async function charge(userId: string, amount: number, sessionId: string | null, detail: string): Promise<CreditBalance> {
  const settings = await getSettings();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<UserCredits>(`SELECT ${COLUMNS} FROM curialy.users WHERE id = $1 FOR UPDATE`, [userId]);
    const row = rows[0];
    if (!row) throw new Error("Account not found.");
    if (row.role === "admin" || amount <= 0) {
      await client.query("COMMIT");
      return balanceOf(row, settings);
    }
    const now = Date.now();
    const before = balanceOf(row, settings, now);
    const fromWindow = Math.min(before.remaining, amount);
    const fromBonus = Math.min(before.bonus, amount - fromWindow);
    // Whatever neither covers still counts against the window (it ends at the reset). Without an
    // allowance there is no window: only bonus credits are spent, and no window is opened.
    const windowless = before.allowance === 0;
    const windowStart = windowless ? row.window_started_at : before.resetsAt ? row.window_started_at! : new Date(now);
    const windowUsed = windowless ? Number(row.window_used) : before.used + amount - fromBonus;
    const { rows: [updated] } = await client.query<UserCredits>(
      `UPDATE curialy.users SET window_started_at = $2, window_used = $3, bonus_credits = bonus_credits - $4 WHERE id = $1 RETURNING ${COLUMNS}`,
      [userId, windowStart, round(windowUsed), round(fromBonus)],
    );
    await client.query("INSERT INTO curialy.credit_events (user_id, kind, amount, session_id, detail) VALUES ($1, 'usage', $2, $3, $4)", [userId, -round(amount), sessionId, detail]);
    await client.query("COMMIT");
    return balanceOf(updated, settings, now);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Admin: add (or, with a negative amount, remove) bonus credits. */
export async function grant(userId: string, amount: number, by: string, note: string) {
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) throw new CreditError("Enter a number of credits (not zero).", "invalid_code", 400);
  const { rowCount } = await query("UPDATE curialy.users SET bonus_credits = GREATEST(0, bonus_credits + $2) WHERE id = $1", [userId, round(amount)]);
  if (!rowCount) throw new CreditError("Account not found.", "invalid_code", 404);
  await query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'grant', $2, $3, $4)", [userId, round(amount), note.slice(0, 200) || null, by]);
  return getBalance(userId);
}

/** Admin: give an account the free allowance, or take it away (an own allowance still applies either way). */
export async function setFreeAllowance(userId: string, withheld: boolean, by: string) {
  const { rowCount } = await query("UPDATE curialy.users SET free_allowance_withheld = $2 WHERE id = $1 AND role <> 'admin'", [userId, withheld]);
  if (!rowCount) throw new CreditError("Account not found.", "invalid_code", 404);
  await query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'adjust', 0, $2, $3)", [userId, withheld ? "free allowance removed" : "free allowance given", by]);
  return getBalance(userId);
}

/** Admin: a per-window allowance for one account (null: back to the default). */
export async function setAllowance(userId: string, allowance: number | null, by: string) {
  if (allowance !== null && (!Number.isInteger(allowance) || allowance < 0 || allowance > 100_000)) throw new CreditError("The allowance is a whole number from 0 to 100000.", "invalid_code", 400);
  const { rowCount } = await query("UPDATE curialy.users SET credit_allowance = $2 WHERE id = $1", [userId, allowance]);
  if (!rowCount) throw new CreditError("Account not found.", "invalid_code", 404);
  await query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'adjust', 0, $2, $3)", [userId, allowance === null ? "allowance reset to the default" : `allowance set to ${allowance} per window`, by]);
  return getBalance(userId);
}

// ---- Promo codes ----

export type PromoCode = {
  id: string; code: string; credits: number; forUser: { id: string; login: string | null } | null; maxRedemptions: number | null;
  redemptions: number; expiresAt: string | null; disabledAt: string | null; note: string | null; createdAt: string;
  state: "active" | "used_up" | "expired" | "disabled";
};

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,31}$/;
export const normalizeCode = (code: string) => code.trim().toUpperCase();

function newCode() {
  // No look-alike characters (0/O, 1/I/L).
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const body = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  return `${body.slice(0, 5)}-${body.slice(5)}`;
}

type PromoRow = {
  id: string; code: string; credits: number; for_user_id: string | null; for_login: string | null; max_redemptions: number | null; redemptions: number;
  expires_at: Date | null; disabled_at: Date | null; note: string | null; created_at: Date;
};

function promoOf(row: PromoRow): PromoCode {
  const state = row.disabled_at ? "disabled" : row.expires_at && row.expires_at.getTime() <= Date.now() ? "expired" : row.max_redemptions !== null && row.redemptions >= row.max_redemptions ? "used_up" : "active";
  return {
    id: row.id, code: row.code, credits: row.credits, forUser: row.for_user_id ? { id: row.for_user_id, login: row.for_login } : null,
    maxRedemptions: row.max_redemptions, redemptions: row.redemptions, expiresAt: row.expires_at?.toISOString() ?? null,
    disabledAt: row.disabled_at?.toISOString() ?? null, note: row.note, createdAt: row.created_at.toISOString(), state,
  };
}

export async function listPromoCodes(): Promise<PromoCode[]> {
  const { rows } = await query<PromoRow>(
    `SELECT p.*, u.login AS for_login FROM curialy.promo_codes p LEFT JOIN curialy.users u ON u.id = p.for_user_id ORDER BY p.created_at DESC LIMIT 500`,
  );
  return rows.map(promoOf);
}

export async function createPromoCode(input: { code?: string; credits: number; forUserId?: string | null; maxRedemptions?: number | null; expiresAt?: string | null; note?: string }, by: string) {
  const code = input.code ? normalizeCode(input.code) : newCode();
  if (!CODE_PATTERN.test(code)) throw new CreditError("A code is 4 to 32 letters, digits or dashes.", "invalid_code", 400);
  if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 1_000_000) throw new CreditError("Credits must be a whole number from 1 to 1000000.", "invalid_code", 400);
  // A code for one person is redeemable once unless the admin says otherwise.
  const max = input.maxRedemptions === undefined ? (input.forUserId ? 1 : null) : input.maxRedemptions;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 1_000_000)) throw new CreditError("Uses must be a whole number from 1 to 1000000, or unlimited.", "invalid_code", 400);
  const expires = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expires && (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now())) throw new CreditError("The expiry must be a date in the future.", "invalid_code", 400);
  try {
    const { rows } = await query<{ id: string }>(
      "INSERT INTO curialy.promo_codes (code, credits, for_user_id, max_redemptions, expires_at, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [code, input.credits, input.forUserId || null, max, expires, input.note?.trim().slice(0, 200) || null, by],
    );
    return (await listPromoCodes()).find(promo => promo.id === rows[0].id)!;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new CreditError("That code already exists.", "code_used", 409);
    if ((error as { code?: string }).code === "23503") throw new CreditError("That account doesn't exist.", "invalid_code", 404);
    throw error;
  }
}

export async function disablePromoCode(id: string) {
  const { rowCount } = await query("UPDATE curialy.promo_codes SET disabled_at = coalesce(disabled_at, now()) WHERE id = $1", [id]);
  if (!rowCount) throw new CreditError("Promo code not found.", "invalid_code", 404);
}

/** A user redeems a code: its credits become bonus credits. */
export async function redeemPromoCode(userId: string, rawCode: string) {
  const code = normalizeCode(rawCode);
  if (!CODE_PATTERN.test(code)) throw new CreditError("That code isn't valid.", "invalid_code", 400);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<PromoRow>("SELECT *, NULL::text AS for_login FROM curialy.promo_codes WHERE upper(code) = $1 FOR UPDATE", [code]);
    const promo = rows[0] ? promoOf(rows[0]) : null;
    // One message for unknown codes and codes meant for someone else: a code's existence is not revealed.
    if (!promo || (promo.forUser && promo.forUser.id !== userId)) throw new CreditError("That code isn't valid.", "invalid_code", 400);
    // A code for anyone is free credit for every account someone opens: not for an account that
    // started without the free allowance (unless the operator gave it one, or it has a plan). Said like an unknown code.
    if (!promo.forUser) {
      const { rows: [account] } = await client.query<{ free_allowance_withheld: boolean; credit_allowance: number | null; plan_id: string | null; plan_expires_at: Date | null; plan_credits_per_window: number | null }>(
        "SELECT free_allowance_withheld, credit_allowance, plan_id, plan_expires_at, plan_credits_per_window FROM curialy.users WHERE id = $1",
        [userId],
      );
      if (account?.free_allowance_withheld && !account.credit_allowance && !activePlan(account)) throw new CreditError("That code isn't valid.", "invalid_code", 400);
    }
    if (promo.state === "disabled" || promo.state === "expired") throw new CreditError("That code has expired.", "invalid_code", 400);
    if (promo.state === "used_up") throw new CreditError("That code has already been used.", "code_used", 409);
    const inserted = await client.query("INSERT INTO curialy.promo_redemptions (code_id, user_id, credits) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [promo.id, userId, promo.credits]);
    if (!inserted.rowCount) throw new CreditError("You've already redeemed this code.", "code_used", 409);
    await client.query("UPDATE curialy.promo_codes SET redemptions = redemptions + 1 WHERE id = $1", [promo.id]);
    await client.query("UPDATE curialy.users SET bonus_credits = bonus_credits + $2 WHERE id = $1", [userId, promo.credits]);
    await client.query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail) VALUES ($1, 'promo', $2, $3)", [userId, promo.credits, `code ${promo.code}`]);
    await client.query("COMMIT");
    return { credits: promo.credits, balance: await getBalance(userId) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Recent credit activity for an account (admin view and the account's own history). The account's
 * own view leaves out the operator's notes on grants, adjustments and plans.
 */
export async function creditHistory(userId: string, limit = 50, opts: { forAccount?: boolean } = {}) {
  const { rows } = await query<{ kind: string; amount: string; detail: string | null; session_id: string | null; created_at: Date }>(
    "SELECT kind, amount, detail, session_id, created_at FROM curialy.credit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit],
  );
  const hidden = (kind: string) => opts.forAccount && (kind === "grant" || kind === "adjust");
  const detail = (kind: string, text: string | null) => (hidden(kind) ? null : opts.forAccount && kind === "plan" && text ? text.split(PLAN_NOTE_MARK)[0] : text);
  return rows.map(row => ({ kind: row.kind, amount: Number(row.amount), detail: detail(row.kind, row.detail), taskId: row.session_id, at: row.created_at.toISOString() }));
}
