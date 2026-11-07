// Credits: what a run costs and how the free allowance refills. Shared by the server (which charges)
// and the client (which explains). No runtime dependencies.

/** One credit is this many weighted tokens on a standard model. */
export const TOKENS_PER_CREDIT = 25_000;
/** Output tokens (thinking included) cost about four times as much as input. */
export const OUTPUT_WEIGHT = 4;

export type CreditSettings = {
  /** Credits every account gets per window (a user's own allowance, when set, replaces it). */
  creditsPerWindow: number;
  /** How long a window lasts, from the first credit spent in it. */
  windowHours: number;
  /** Whether new people can sign up (existing accounts can always sign in). */
  signupsOpen: boolean;
};

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = { creditsPerWindow: 60, windowHours: 5, signupsOpen: true };

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
  windowHours: number;
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

export const formatCredits = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 1 : 0));
