// Billing: the 30-day plans, the launch discount, Developer API prices, the networks and coins a
// payment can use, and the shapes the billing API returns. Shared by the server (which prices,
// verifies and applies payments) and the client (which shows prices and walks a payment through).
// No runtime dependencies.

// ---- Plans ----

export type PlanId = "pro" | "max";
export const PLAN_IDS: PlanId[] = ["pro", "max"];

/** A plan: while it is active, the account's allowance per window is the plan's (when that is higher than its own). */
export type PlanConfig = { name: string; priceUsd: number; creditsPerWindow: number; days: number };

export const DEFAULT_PLANS: Record<PlanId, PlanConfig> = {
  pro: { name: "Pro", priceUsd: 20, creditsPerWindow: 6000, days: 30 },
  max: { name: "Max", priceUsd: 80, creditsPerWindow: 30000, days: 30 },
};

/** A higher plan bought while a lower one is active upgrades the account. */
export const PLAN_RANK: Record<PlanId, number> = { pro: 1, max: 2 };

export const isPlanId = (value: unknown): value is PlanId => value === "pro" || value === "max";

/** An account's plan: which one and until when (null: none, or it has ended). */
export type PlanState = { planId: PlanId; expiresAt: string } | null;

export type PlanEffect = "start" | "extend" | "upgrade" | "extend_higher";

/**
 * What a bought plan does to the account's current plan, at list prices (never the discounted ones,
 * so a conversion is the same during and after an offer):
 * - no active plan: it starts now for its days;
 * - the same plan: its days are added to the end;
 * - a higher plan: it starts now, and the days left on the lower one are added at their value;
 * - a lower plan while a higher one is active: its value extends the higher plan.
 */
export function planAfterPurchase(current: PlanState, bought: PlanId, plans: Record<PlanId, PlanConfig>, now = Date.now()): { planId: PlanId; expiresAt: string; effect: PlanEffect } {
  const length = plans[bought].days * 86_400_000;
  const active = current && Date.parse(current.expiresAt) > now ? current : null;
  if (!active) return { planId: bought, expiresAt: new Date(now + length).toISOString(), effect: "start" };
  const end = Date.parse(active.expiresAt);
  if (active.planId === bought) return { planId: bought, expiresAt: new Date(end + length).toISOString(), effect: "extend" };
  // List price per day of each plan.
  const daily = (id: PlanId) => plans[id].priceUsd / plans[id].days;
  if (PLAN_RANK[bought] > PLAN_RANK[active.planId]) {
    const carried = ((end - now) * daily(active.planId)) / daily(bought);
    return { planId: bought, expiresAt: new Date(now + length + carried).toISOString(), effect: "upgrade" };
  }
  const added = (length * daily(bought)) / daily(active.planId);
  return { planId: active.planId, expiresAt: new Date(end + added).toISOString(), effect: "extend_higher" };
}

// ---- Paying ahead ----

/** A plan can be paid for up to this many periods (its days) at once, and never runs further ahead than that from today. */
export const MAX_PLAN_MONTHS = 6;

const DAY_MS = 86_400_000;

/** A plan as sold for `months` periods: that many times its days, at that many times its list price. */
export function planForMonths(plans: Record<PlanId, PlanConfig>, planId: PlanId, months: number): Record<PlanId, PlanConfig> {
  const plan = plans[planId];
  return { ...plans, [planId]: { ...plan, days: plan.days * months, priceUsd: plan.priceUsd * months } };
}

/**
 * The most months of `planId` the account can pay for now (0 when none): after its plan and the plan
 * orders it has open (placed but not paid or turned down yet, as sold: their days and list price), a
 * new one may not take the plan further than MAX_PLAN_MONTHS periods from now (a day's slack).
 */
export function prepayableMonths(
  state: PlanState, open: { planId: PlanId; days: number; listUsd: number }[], planId: PlanId, plans: Record<PlanId, PlanConfig>, now = Date.now(),
): number {
  let projected = state;
  for (const order of open) {
    projected = planAfterPurchase(projected, order.planId, { ...plans, [order.planId]: { ...plans[order.planId], days: order.days, priceUsd: order.listUsd } }, now);
  }
  for (let months = MAX_PLAN_MONTHS; months >= 1; months--) {
    const next = planAfterPurchase(projected, planId, planForMonths(plans, planId, months), now);
    if (Date.parse(next.expiresAt) <= now + (MAX_PLAN_MONTHS * plans[next.planId].days + 1) * DAY_MS) return months;
  }
  return 0;
}

// ---- The launch discount ----

export type DiscountConfig = {
  /** Percent off, 0 to 95. */
  percent: number;
  /** Applies to plan prices. */
  plans: boolean;
  /** Applies to Developer API token prices (not to top-ups: $1 paid is $1 of balance). */
  api: boolean;
  /** When it ends (ISO), or null: until the operator turns it off. */
  endsAt: string | null;
};

export const DEFAULT_DISCOUNT: DiscountConfig = { percent: 90, plans: true, api: true, endsAt: null };

export const MAX_DISCOUNT_PERCENT = 95;

/** The percent off plans or the API right now (0 when the offer is off or has ended). */
export function discountPercent(discount: DiscountConfig, scope: "plans" | "api", now = Date.now()): number {
  if (!discount[scope] || !(discount.percent > 0)) return 0;
  if (discount.endsAt && Date.parse(discount.endsAt) <= now) return 0;
  return Math.min(MAX_DISCOUNT_PERCENT, Math.max(0, Math.round(discount.percent)));
}

/** A USD price after a discount, in whole cents. */
export const discountedUsd = (listUsd: number, percent: number) => Math.round(listUsd * (100 - percent)) / 100;

// ---- Settings (the operator edits these on the Admin page) ----

export type BillingSettings = {
  plans: Record<PlanId, PlanConfig>;
  discount: DiscountConfig;
  /** New orders can be placed (orders already placed still complete). */
  paymentsOpen: boolean;
  /** Payments are checked on-chain and applied by themselves; off: every payment waits for the operator. */
  autoVerify: boolean;
};

export const DEFAULT_BILLING_SETTINGS: BillingSettings = { plans: DEFAULT_PLANS, discount: DEFAULT_DISCOUNT, paymentsOpen: true, autoVerify: true };

/** A change to the settings: plans and the offer merge field by field, so unchanged fields can be left out. */
export type BillingSettingsPatch = {
  plans?: Partial<Record<PlanId, Partial<PlanConfig>>>;
  discount?: Partial<DiscountConfig>;
  paymentsOpen?: boolean;
  autoVerify?: boolean;
};

/** Developer API top-ups, in whole US dollars. */
export const API_TOPUP = { minUsd: 5, maxUsd: 1000, presets: [5, 10, 25, 50, 100] } as const;

// ---- Money ----

/** API balances and costs are kept in micro-dollars (millionths of a US dollar), as integers. */
export const MICROS_PER_USD = 1_000_000;
export const usdToMicros = (usd: number) => Math.round(usd * MICROS_PER_USD);
export const microsToUsd = (micros: number) => micros / MICROS_PER_USD;

/** "$2.00"; amounts under a cent keep up to four significant decimals ("$0.0042"), zero is "$0.00". */
export function formatUsd(usd: number) {
  const sign = usd < 0 ? "-" : "";
  const value = Math.abs(usd);
  if (value === 0 || value >= 0.01) return `${sign}$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${sign}$${value.toLocaleString("en-US", { maximumSignificantDigits: 2 })}`;
}

/** A per-million-token price: "$4", "$0.50", "$0.075". */
export function formatPerMillion(usd: number) {
  if (usd >= 1 && Number.isInteger(usd)) return `$${usd}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

// ---- Developer API prices ----

/** USD per 1 million tokens. cacheRead: cached input that is read; cacheWrite: input written to the cache. */
export type TokenPrices = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** longContext: prompts with more than `above` input tokens (cached included) bill at these rates instead. */
export type ModelPricing = TokenPrices & { longContext?: TokenPrices & { above: number } };

/**
 * List prices (each provider's standard pay-as-you-go rates) for every Developer API model. Callers
 * pay these less the API discount. A model without an entry here cannot be called.
 */
export const API_PRICES: Record<string, ModelPricing> = {
  // Anthropic (platform.claude.com pricing, 2026-11-09): cache writes are the 5-minute rate; cache
  // reads are 0.05x input on Opus 5.5 and Sonnet 5.5, 0.1x elsewhere.
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Prompts over 100K tokens (cached included) bill every token at the higher rates.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longContext: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  // OpenAI (developers.openai.com pricing, standard tier): cached input bills at the cache-read rate;
  // there is no separate cache-write charge. GPT 5.5 and 5.4 cost more past 272K input tokens.
  "openai-gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5, longContext: { above: 272_000, input: 10, output: 45, cacheRead: 1, cacheWrite: 10 } },
  "openai-gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5, longContext: { above: 272_000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 5 } },
  "openai-gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75 },
  "openai-gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  // xAI (docs.x.ai): prompts of 200K tokens or more bill every token at the higher rates.
  "grok-4.7": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2, longContext: { above: 199_999, input: 4, output: 12, cacheRead: 1, cacheWrite: 4 } },
  "grok-4.6": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 2, longContext: { above: 199_999, input: 4, output: 12, cacheRead: 1, cacheWrite: 4 } },
  // Moonshot (platform.kimi.ai): flat, cache writes at the 5-minute rate.
  "kimi-k3": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  // Z.ai: flat, no cache-write charge.
  "glm-5.3": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
};

export type TokenUsageDetail = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** The rates a request bills at (the long-context rates when its prompt is long enough). */
export function ratesFor(pricing: ModelPricing, promptTokens: number): TokenPrices {
  return pricing.longContext && promptTokens > pricing.longContext.above ? pricing.longContext : pricing;
}

/**
 * What a request costs in micro-dollars: at list price, and after `percentOff`. Tokens times USD per
 * million tokens is micro-dollars; each total rounds up to a whole micro-dollar.
 * Throws for a model without a price (it must never run for free by accident).
 */
export function apiCost(model: string, usage: TokenUsageDetail, percentOff: number): { listMicros: number; costMicros: number } {
  const pricing = API_PRICES[model];
  if (!pricing) throw new Error(`No API price for ${model}`);
  const rates = ratesFor(pricing, usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens);
  const raw = usage.inputTokens * rates.input + usage.outputTokens * rates.output + usage.cacheReadTokens * rates.cacheRead + usage.cacheWriteTokens * rates.cacheWrite;
  const round = (value: number) => Math.max(0, Math.ceil(value - 1e-6));
  return { listMicros: round(raw), costMicros: round((raw * (100 - percentOff)) / 100) };
}

/** Prices after a discount, for display. */
export function discountedPrices(prices: TokenPrices, percentOff: number): TokenPrices {
  const cut = (value: number) => Math.round(value * (100 - percentOff) * 10_000) / 1_000_000;
  return { input: cut(prices.input), output: cut(prices.output), cacheRead: cut(prices.cacheRead), cacheWrite: cut(prices.cacheWrite) };
}

/** A non-streaming API request may ask for at most this many output tokens (longer replies must stream). */
export const NON_STREAMING_MAX_TOKENS = 16_384;

// ---- Model limits (the operator's list; not every model in it is offered) ----

export type ModelLimits = { contextWindow: number; maxOutput: number };

export const MODEL_LIMITS: Record<string, ModelLimits> = {
  "claude-opus-5-5": { contextWindow: 1_000_000, maxOutput: 128_000 },
  "claude-opus-5": { contextWindow: 1_000_000, maxOutput: 128_000 },
  "claude-sonnet-5": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "claude-opus-4-8": { contextWindow: 1_000_000, maxOutput: 128_000 },
  "claude-opus-4-7": { contextWindow: 1_000_000, maxOutput: 128_000 },
  "claude-opus-4-6": { contextWindow: 1_000_000, maxOutput: 128_000 },
  "claude-sonnet-4-6": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "claude-opus-4-5": { contextWindow: 200_000, maxOutput: 64_000 },
  "claude-sonnet-4-5": { contextWindow: 200_000, maxOutput: 64_000 },
  "claude-haiku-4-5": { contextWindow: 200_000, maxOutput: 64_000 },
  "openai-gpt-6-luna": { contextWindow: 1_050_000, maxOutput: 128_000 },
  "openai-gpt-5.6-terra": { contextWindow: 1_050_000, maxOutput: 128_000 },
  "openai-gpt-5.6-luna": { contextWindow: 1_050_000, maxOutput: 128_000 },
  "openai-gpt-5.4-mini": { contextWindow: 400_000, maxOutput: 128_000 },
  "openai-gpt-5.4-nano": { contextWindow: 400_000, maxOutput: 128_000 },
  "openai-gpt-5.1": { contextWindow: 272_000, maxOutput: 8_192 },
  "openai-gpt-5": { contextWindow: 272_000, maxOutput: 8_192 },
  "openai-gpt-5-mini": { contextWindow: 272_000, maxOutput: 8_192 },
  "openai-gpt-5-nano": { contextWindow: 272_000, maxOutput: 8_192 },
  "openai-gpt-4.1": { contextWindow: 128_000, maxOutput: 32_000 },
  "gemini-4-argon": { contextWindow: 1_000_000, maxOutput: 32_768 },
  "gemini-3.8-flash": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "gemini-3.7-flash": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "gemini-3.5-flash": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "gemini-3.1-pro": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "gemini-3.1-flash-lite": { contextWindow: 1_000_000, maxOutput: 64_000 },
  "grok-4.7": { contextWindow: 500_000, maxOutput: 65_536 },
  "glm-5.3": { contextWindow: 1_000_000, maxOutput: 128_000 },
  "qwen3-32b": { contextWindow: 128_000, maxOutput: 8_192 },
  "qwen3-next-80b-a3b": { contextWindow: 128_000, maxOutput: 8_192 },
  "qwen3-vl-235b-a22b": { contextWindow: 128_000, maxOutput: 8_192 },
  "mistral-large3": { contextWindow: 256_000, maxOutput: 32_768 },
  "mistral-large2": { contextWindow: 128_000, maxOutput: 8_192 },
  "mixtral-8x7b": { contextWindow: 32_000, maxOutput: 8_192 },
  "mistral-7b": { contextWindow: 32_000, maxOutput: 8_192 },
  "llama4-maverick": { contextWindow: 128_000, maxOutput: 8_192 },
  "llama3.3-70b": { contextWindow: 128_000, maxOutput: 8_192 },
  "llama3.1-70b": { contextWindow: 128_000, maxOutput: 8_192 },
  "llama3.1-8b": { contextWindow: 128_000, maxOutput: 8_192 },
};

/** A model's limits by its id here, its backup-route id ("r/…") or its thinking variant; null when the list has none. */
export function modelLimits(id: string): ModelLimits | null {
  return MODEL_LIMITS[id] ?? MODEL_LIMITS[id.replace(/^r\//, "").replace(/-thinking$/, "")] ?? null;
}

/** "1M", "200K", "1.05M", "65.5K" */
export function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}K`;
  return String(tokens);
}

// ---- Payment networks and coins ----

export type NetworkId = "ethereum" | "bnb" | "polygon" | "solana";
export type CoinId = "USDC" | "USDT" | "ETH" | "BNB" | "POL" | "SOL";
export type CoinKind = "stablecoin" | "native";

export type CoinOnNetwork = {
  coin: CoinId;
  kind: CoinKind;
  /** Decimals of the token on this network (USDC and USDT have 18 on BNB Chain, 6 elsewhere). */
  decimals: number;
  /** Token contracts (EVM) or mints (Solana) that count as this coin; empty for the network's own coin. */
  tokens: string[];
  /** How wallets name the token on this network. */
  standard: string;
};

export type NetworkInfo = {
  id: NetworkId;
  label: string;
  family: "evm" | "solana";
  coins: CoinOnNetwork[];
  /** EVM: blocks on top of the payment's block (counting it) before it counts. Solana: finalized. */
  confirmations: number;
  /** About how long confirmation takes, for the payer. */
  wait: string;
  /** Block explorer pages: transaction and address URL prefixes. */
  explorer: { name: string; tx: string; address: string };
  logo: string;
};

const stable = (coin: "USDC" | "USDT", decimals: number, tokens: string[], standard: string): CoinOnNetwork => ({ coin, kind: "stablecoin", decimals, tokens, standard });
const native = (coin: CoinId, decimals: number, standard: string): CoinOnNetwork => ({ coin, kind: "native", decimals, tokens: [], standard });

/** Every token contract and mint below was checked on-chain (symbol and decimals) on 2026-11-09. */
export const PAYMENT_NETWORKS: NetworkInfo[] = [
  {
    id: "ethereum", label: "Ethereum", family: "evm", confirmations: 12, wait: "about 3 minutes",
    explorer: { name: "Etherscan", tx: "https://etherscan.io/tx/", address: "https://etherscan.io/address/" }, logo: "/pay/net-ethereum.svg",
    coins: [
      stable("USDT", 6, ["0xdAC17F958D2ee523a2206206994597C13D831ec7"], "ERC-20"),
      stable("USDC", 6, ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"], "ERC-20"),
      native("ETH", 18, "Ether"),
    ],
  },
  {
    id: "bnb", label: "BNB Chain", family: "evm", confirmations: 20, wait: "under a minute",
    explorer: { name: "BscScan", tx: "https://bscscan.com/tx/", address: "https://bscscan.com/address/" }, logo: "/pay/net-bnb.svg",
    coins: [
      stable("USDT", 18, ["0x55d398326f99059fF775485246999027B3197955"], "BEP-20"),
      stable("USDC", 18, ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"], "BEP-20"),
      native("BNB", 18, "BNB"),
    ],
  },
  {
    id: "polygon", label: "Polygon", family: "evm", confirmations: 32, wait: "about a minute",
    explorer: { name: "PolygonScan", tx: "https://polygonscan.com/tx/", address: "https://polygonscan.com/address/" }, logo: "/pay/net-polygon.svg",
    coins: [
      stable("USDT", 6, ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F"], "Polygon PoS"),
      // Native USDC, and the bridged USDC.e many wallets still hold.
      stable("USDC", 6, ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"], "Polygon PoS (USDC or USDC.e)"),
      native("POL", 18, "POL"),
    ],
  },
  {
    id: "solana", label: "Solana", family: "solana", confirmations: 1, wait: "under a minute",
    explorer: { name: "Solscan", tx: "https://solscan.io/tx/", address: "https://solscan.io/account/" }, logo: "/pay/net-solana.svg",
    coins: [
      stable("USDT", 6, ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"], "SPL"),
      stable("USDC", 6, ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], "SPL"),
      native("SOL", 9, "SOL"),
    ],
  },
];

export const COIN_INFO: Record<CoinId, { label: string; logo: string }> = {
  USDT: { label: "Tether USD", logo: "/pay/coin-usdt.svg" },
  USDC: { label: "USD Coin", logo: "/pay/coin-usdc.svg" },
  ETH: { label: "Ether", logo: "/pay/net-ethereum.svg" },
  BNB: { label: "BNB", logo: "/pay/net-bnb.svg" },
  POL: { label: "Polygon", logo: "/pay/net-polygon.svg" },
  SOL: { label: "Solana", logo: "/pay/net-solana.svg" },
};

export const networkInfo = (id: string | null | undefined) => PAYMENT_NETWORKS.find(network => network.id === id);
export const coinOn = (network: string | null | undefined, coin: string | null | undefined) => networkInfo(network)?.coins.find(entry => entry.coin === coin);

export const explorerTxUrl = (network: string | null | undefined, hash: string | null | undefined) => {
  const info = networkInfo(network);
  return info && hash ? `${info.explorer.tx}${hash}` : null;
};

/** The transaction id a payer pastes, cleaned up (EVM hashes lowercased), or null when it can't be one. */
export function normalizeTxHash(network: string, raw: string): string | null {
  const value = raw.trim();
  const info = networkInfo(network);
  if (!info) return null;
  if (info.family === "evm") return /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
  // A Solana signature: 64 bytes in base58 (87 or 88 characters).
  return /^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(value) ? value : null;
}

// ---- Orders ----

export type PaymentStatus = "awaiting_payment" | "pending" | "confirming" | "review" | "completed" | "rejected" | "expired";

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "progress" | "warning" | "success" | "danger" }> = {
  awaiting_payment: { label: "Awaiting payment", tone: "neutral" },
  pending: { label: "Checking the network", tone: "progress" },
  confirming: { label: "Confirming", tone: "progress" },
  review: { label: "In review", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

/** Statuses an order can still move on from by itself. */
export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = ["awaiting_payment", "pending", "confirming"];

/** How long payment details stay valid once issued (and an order without them stays open). */
export const ORDER_TTL_MINUTES = 30;
/** After it expires, an order that had payment details still takes a transaction hash for this long. */
export const LATE_SUBMIT_HOURS = 24;
/** At most this many orders awaiting payment per account. */
export const MAX_OPEN_ORDERS = 5;

/** "CUR-" and 8 Crockford base32 characters (no I, L, O or U). */
export const ORDER_CODE_PATTERN = /^CUR-[0-9A-HJKMNP-TV-Z]{8}$/;

/** What a payer types (lower case, spaces, no prefix) as an order code, or null. */
export function normalizeOrderCode(input: string): string | null {
  const cleaned = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("CUR") ? cleaned.slice(3) : cleaned;
  const code = `CUR-${body}`;
  return ORDER_CODE_PATTERN.test(code) ? code : null;
}

export type PaymentEvent = { status: PaymentStatus; actor: "customer" | "system" | "admin"; note: string | null; at: string };

export type PaymentOrder = {
  code: string;
  kind: "plan" | "api";
  planId: PlanId | null;
  /** What the plan gives, fixed when the order was placed (it applies these even if the plan has changed since). */
  planDays: number | null;
  planCreditsPerWindow: number | null;
  /** How many periods of the plan it pays for (1 to MAX_PLAN_MONTHS); null for a top-up. */
  planMonths: number | null;
  /** "Pro · 30 days", "Pro · 3 months", "API balance · $25" */
  title: string;
  listUsd: number;
  discountPercent: number;
  /** What is paid, in USD. */
  priceUsd: number;
  /** API balance added when it completes (kind "api"). */
  creditUsd: number | null;
  network: NetworkId | null;
  coin: CoinId | null;
  /** The wallet to pay, fixed on the order when its payment details are issued. */
  payAddress: string | null;
  /** The exact amount to send, as a decimal string in the coin ("2.0037"). */
  expectedAmount: string | null;
  /** The coin's USD price the amount was quoted at (native coins only). */
  quoteUsdPrice: number | null;
  txHash: string | null;
  /** What the transaction sent to the wallet, in the coin, once it was found (may differ from expectedAmount when the operator approved it). */
  receivedAmount: string | null;
  status: PaymentStatus;
  /** Why it is in review or was rejected, what was found, and the like: safe to show the payer. */
  statusDetail: string | null;
  confirmations: number | null;
  requiredConfirmations: number | null;
  createdAt: string;
  quotedAt: string | null;
  expiresAt: string;
  /** Until when a transaction hash is still taken (later than expiresAt for expired orders that had details). */
  submitUntil: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  /** What completing it did: the plan and its new end, or the API balance added. */
  applied: { planId?: PlanId; planExpiresAt?: string; effect?: PlanEffect; apiBalanceAddedUsd?: number } | null;
  explorerUrl: string | null;
  events: PaymentEvent[];
};

export type AdminPaymentOrder = PaymentOrder & {
  user: { id: string; login: string | null; name: string };
  adminNote: string | null;
  txFrom: string | null;
  txBlockTime: string | null;
  checkCount: number;
  lastCheckedAt: string | null;
  /** When the chain check matched (null: it hasn't). */
  chainVerifiedAt: string | null;
};

// ---- Catalog and account views ----

export type PlanOffer = { id: PlanId; name: string; listUsd: number; priceUsd: number; discountPercent: number; creditsPerWindow: number; days: number };

export type ApiModelPrice = {
  id: string;
  label: string;
  format: "anthropic" | "openai";
  list: TokenPrices;
  /** After the API discount. */
  price: TokenPrices;
  longContext: (TokenPrices & { above: number; price: TokenPrices }) | null;
  contextWindow: number | null;
  maxOutput: number | null;
  /** The largest max_tokens one request may ask for. */
  maxTokens: { streaming: number; nonStreaming: number };
};

export type PublicCoin = { coin: CoinId; kind: CoinKind; standard: string; label: string; logo: string; tokens: string[] };
export type PublicNetwork = { id: NetworkId; label: string; family: "evm" | "solana"; confirmations: number; wait: string; logo: string; explorerName: string; coins: PublicCoin[] };

/**
 * What a free account gets: welcome credits once, the refilling allowance (0: none), what following
 * and posting on X earn, and the launch boost while it is offered (null once it has ended or is off).
 */
export type FreeTier = {
  welcomeCredits: number;
  creditsPerWindow: number;
  windowHours: number;
  rewards: { followHandle: string; followCredits: number; postCredits: number; apiUsd: number; boost: { creditsPerWindow: number; windowHours: number; endsAt: string | null } | null };
};

/** GET /api/billing/catalog (no sign-in needed: the homepage shows it). */
export type BillingCatalog = {
  plans: PlanOffer[];
  /** The offer as it applies right now (percent 0 when it is off or has ended). */
  discount: { plansPercent: number; apiPercent: number; endsAt: string | null };
  free: FreeTier;
  apiTopup: { minUsd: number; maxUsd: number; presets: number[] };
  /** Payments can be made right now (the operator can pause new orders; a server without wallets has none). */
  paymentsOpen: boolean;
  networks: PublicNetwork[];
  models: ApiModelPrice[];
};

export type ApiWallet = {
  balanceMicros: number;
  /** Held for requests still running: what they could cost at most. */
  reservedMicros: number;
  /** Tokens those requests may use at most (input and max_tokens). */
  reservedTokens: number;
  requestsInFlight: number;
  /** balance less reserved (never below 0). */
  availableMicros: number;
};

/** GET /api/billing/account */
export type BillingAccount = {
  plan: { id: PlanId; name: string; expiresAt: string; creditsPerWindow: number } | null;
  apiWallet: ApiWallet;
  /** The operator's account is not charged for credits or API use. */
  operator: boolean;
  /** The most months of each plan the account can pay for now (prepayableMonths). */
  prepay: Record<PlanId, number>;
};

// ---- Usage reports ----

export type UsageRange = "24h" | "7d" | "30d" | "90d";
export const USAGE_RANGES: UsageRange[] = ["24h", "7d", "30d", "90d"];

export type ApiUsageTotals = { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costMicros: number; listMicros: number };

/** GET /api/billing/api/usage?range=&tz= : buckets cover the whole range, empty ones included. */
export type ApiUsageReport = {
  range: UsageRange;
  bucket: "hour" | "day";
  timeZone: string;
  buckets: (ApiUsageTotals & { start: string })[];
  byModel: (ApiUsageTotals & { model: string })[];
  byKey: (ApiUsageTotals & { keyId: string | null; name: string | null; prefix: string | null })[];
  totals: ApiUsageTotals;
};

/** GET /api/billing/credits/usage?range=&tz= */
export type CreditUsageReport = {
  range: UsageRange;
  bucket: "hour" | "day";
  timeZone: string;
  buckets: { start: string; credits: number; runs: number }[];
  totals: { credits: number; runs: number };
  /** The account's allowance per window right now, and the window length. */
  allowance: number;
  windowHours: number;
};

// ---- Operator views ----

export type AdminBillingOverview = {
  counts: Record<PaymentStatus, number>;
  revenue: { last7dUsd: number; last30dUsd: number; totalUsd: number };
  subscribers: Record<PlanId, number>;
  apiBalanceTotalUsd: number;
  /** The receiving wallets this server is configured with (null: payments on that family are off). */
  wallets: { evm: string | null; solana: string | null };
  /** Telegram alerts are configured. */
  alerts: boolean;
  settings: BillingSettings;
};

/** GET /api/admin/billing/wallets: what the receiving wallets hold right now, read from each chain by address. */
export type AdminWalletBalances = {
  checkedAt: string;
  networks: {
    network: NetworkId; label: string; address: string; explorerUrl: string;
    /** amount: a decimal string in the coin, or null when it couldn't be read. */
    coins: { coin: CoinId; amount: string | null }[];
    /** No endpoint answered for this network. */
    unavailable: boolean;
  }[];
};

export type AdminAccountBilling = {
  plan: BillingAccount["plan"];
  apiWallet: ApiWallet;
  orders: AdminPaymentOrder[];
  ledger: { kind: "topup" | "grant" | "refund" | "adjust"; amountUsd: number; balanceAfterUsd: number; orderCode: string | null; note: string | null; at: string }[];
};
