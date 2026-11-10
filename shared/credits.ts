// Credits: what a run costs and how the free allowance refills. Shared by the server (which charges)
// and the client (which explains). No runtime dependencies.

/** One credit is this many weighted tokens on a standard model. */
export const TOKENS_PER_CREDIT = 25_000;
/** Output tokens (thinking included) cost about four times as much as input. */
export const OUTPUT_WEIGHT = 4;

/**
 * The launch boost: accounts that both follow the X account and posted about Curialy get this
 * refilling allowance while the offer lasts (the operator ends it with `endsAt` or `enabled`).
 */
export type BoostSettings = { enabled: boolean; creditsPerWindow: number; windowHours: number; endsAt: string | null };

/** Credits earned on X: following the operator's account, and a post about the site. Each once per account. */
export type RewardSettings = {
  /** The X account to follow, without the @. */
  followHandle: string;
  followCredits: number;
  postCredits: number;
  /** Dollars added to the Developer API balance once, when both rewards are claimed (0: none). */
  apiUsd: number;
  boost: BoostSettings;
};

export type CreditSettings = {
  /** A refilling allowance every account gets per window (0: none; a user's own allowance, when set, replaces it). */
  creditsPerWindow: number;
  /** How long a window lasts, from the first credit spent in it (plans and own allowances refill on it). */
  windowHours: number;
  /** Whether new people can sign up (existing accounts can always sign in). */
  signupsOpen: boolean;
  /** Credits a new account starts with: given once, never expire, no window. */
  welcomeCredits: number;
  rewards: RewardSettings;
};

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = {
  creditsPerWindow: 0, windowHours: 5, signupsOpen: true, welcomeCredits: 60,
  rewards: { followHandle: "Yumiko_web3", followCredits: 240, postCredits: 300, apiUsd: 20, boost: { enabled: true, creditsPerWindow: 300, windowHours: 8, endsAt: null } },
};

/** The X username as typed ("@Name", "name ", "x.com/name"), without the @; null when it can't be one. */
export function normalizeXHandle(input: string): string | null {
  const value = input.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(value) ? value : null;
}

/** The id of an X post from its address ("https://x.com/name/status/123…", twitter.com too) or the bare id; null otherwise. */
export function parseXPostId(input: string): string | null {
  const value = input.trim();
  if (/^\d{5,25}$/.test(value)) return value;
  const match = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/i.exec(value);
  return match ? match[1] : null;
}

/** What the account has done on X and what it earned, as GET /api/account/rewards reports. */
export type RewardsState = {
  /** The server can check X (it has an X API key); without it nothing can be claimed. */
  available: boolean;
  followHandle: string;
  siteUrl: string;
  welcomeCredits: number;
  /** The X account linked to this account; locked once a reward was claimed with it. */
  x: { username: string; linkedAt: string; locked: boolean } | null;
  follow: { credits: number; claimedAt: string | null };
  post: { credits: number; claimedAt: string | null; postUrl: string | null };
  /** usd: added to the Developer API balance once both are claimed; grantedAt: when this account received it. */
  api: { usd: number; grantedAt: string | null };
  /** offered: the boost is on and hasn't ended; active: this account has it. */
  boost: { offered: boolean; active: boolean; creditsPerWindow: number; windowHours: number; endsAt: string | null };
  /** A post the account can use as it is (the X "post" intent opens with it). */
  suggestedPost: string;
};

/** How much faster a model spends credits than a standard one. */
export function modelWeight(modelId: string) {
  const id = modelId.toLowerCase();
  if (id.includes("opus")) return 5;
  if (/haiku|flash|llama|mistral|ultramarine/.test(id)) return 0.25;
  return 1;
}

/** outputTokens: everything the model generated, thinking included (the APIs count it that way). */
export type TokenUsage = { inputTokens: number; outputTokens: number };

/** Credits one model response costs (two decimals). */
export function creditsFor(modelId: string, usage: TokenUsage) {
  const weighted = (usage.inputTokens + OUTPUT_WEIGHT * usage.outputTokens) * modelWeight(modelId);
  return Math.round((weighted / TOKENS_PER_CREDIT) * 100) / 100;
}

/** A user's credits right now (as the API reports them). */
export type CreditBalance = {
  /** Admins are not charged. */
  unlimited: boolean;
  allowance: number;
  /** Spent in the current window (0 when no window is open). */
  used: number;
  /** Left in the current window. */
  remaining: number;
  /** Bonus credits from promo codes and grants (spent after the window's). */
  bonus: number;
  /** What can be spent now: remaining + bonus. */
  available: number;
  /** When the current window ends and the allowance refills (null: no window open, the full allowance is ready). */
  resetsAt: string | null;
  /** How long this account's window lasts: the boost's when the boost sets the allowance, else the settings'. */
  windowHours: number;
  /** The account's active plan (its allowance is the larger of the plan's and its own), or null. */
  plan: { id: "pro" | "max"; name: string; expiresAt: string; creditsPerWindow: number } | null;
  /** The launch boost this account has (both X rewards done, offer running), whether or not a plan outranks it; else null. */
  boost: { creditsPerWindow: number; windowHours: number; endsAt: string | null } | null;
  /** This account gets the free credits (welcome, and the X rewards). False when it started without them. */
  welcome: boolean;
  /** The account can still earn credits on X (it gets them, and a reward is unclaimed). */
  canEarn: boolean;
};

/**
 * Voice: transcription per audio minute, speech per 1,000 characters. Expressive speech spends a
 * scarce budget, so it costs ten times the standard voice.
 */
export const VOICE_RATES = { transcribePerMinute: 0.1, speechPer1kChars: 0.5, expressivePer1kChars: 5 } as const;

export function voiceCredits(usage: { seconds?: number; characters?: number; expressive?: boolean }) {
  const minutes = (usage.seconds ?? 0) / 60;
  const thousands = (usage.characters ?? 0) / 1000;
  const amount = minutes * VOICE_RATES.transcribePerMinute + thousands * (usage.expressive ? VOICE_RATES.expressivePer1kChars : VOICE_RATES.speechPer1kChars);
  return amount > 0 ? Math.max(0.01, Math.round(amount * 100) / 100) : 0;
}

/** A run can start with at least this many credits available. */
export const MIN_CREDITS_TO_START = 1;

/** "6,000", "43.5", "4,741" (one decimal only under 10). */
export const formatCredits = (value: number) => {
  const digits = Number.isInteger(value) || value >= 10 ? 0 : 1;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
