import {
  DEFAULT_BILLING_SETTINGS, MAX_DISCOUNT_PERCENT, PAYMENT_NETWORKS, PLAN_IDS, type BillingSettings, type BillingSettingsPatch, type DiscountConfig, type NetworkInfo,
  type PlanConfig, type PlanId,
} from "@shared/billing";
import { query } from "../db/pg";
import { isValidEvmAddress, isValidSolanaAddress, toChecksumAddress } from "./evm-address";

// Billing settings: the plans, the launch offer, and whether payments are open and applied by
// themselves. One app_settings row ('billing') merged over the defaults, cached briefly (the catalog
// and every balance read it). The receiving wallets come from the environment, checked once.

export class BillingError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
  }
}

/** What the row (or a patch) may hold: any part of the settings. */
export type BillingPatch = BillingSettingsPatch;

/** `patch` over `base`, field by field (plans and the offer are merged, not replaced); unknown keys are dropped. */
function merge(base: BillingSettings, patch: BillingPatch | null | undefined): BillingSettings {
  const plan = (id: PlanId): PlanConfig => {
    const own = patch?.plans?.[id] ?? {};
    const from = base.plans[id];
    return {
      name: own.name ?? from.name, priceUsd: own.priceUsd ?? from.priceUsd, creditsPerWindow: own.creditsPerWindow ?? from.creditsPerWindow, days: own.days ?? from.days,
    };
  };
  const offer = patch?.discount ?? {};
  return {
    plans: { pro: plan("pro"), max: plan("max") },
    discount: {
      percent: offer.percent ?? base.discount.percent, plans: offer.plans ?? base.discount.plans, api: offer.api ?? base.discount.api,
      endsAt: offer.endsAt === undefined ? base.discount.endsAt : offer.endsAt,
    },
    paymentsOpen: patch?.paymentsOpen ?? base.paymentsOpen,
    autoVerify: patch?.autoVerify ?? base.autoVerify,
  };
}

let cache: { at: number; value: BillingSettings } | null = null;

export async function getBillingSettings(): Promise<BillingSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const { rows } = await query<{ value: BillingPatch }>("SELECT value FROM curialy.app_settings WHERE key = 'billing'");
  const value = merge(DEFAULT_BILLING_SETTINGS, rows[0]?.value);
  cache = { at: Date.now(), value };
  return value;
}

/** The plans as last read (the defaults before the first read): for callers that can't wait on the database. */
export const knownPlans = (): Record<PlanId, PlanConfig> => (cache?.value ?? DEFAULT_BILLING_SETTINGS).plans;

const invalid = (message: string) => new BillingError(message, "invalid_settings", 400);

function validate(next: BillingSettings, previous: BillingSettings, now = Date.now()) {
  for (const id of PLAN_IDS) {
    const plan = next.plans[id];
    const name = typeof plan.name === "string" ? plan.name.trim() : "";
    if (name.length < 1 || name.length > 24) throw invalid("A plan's name is 1 to 24 characters.");
    plan.name = name;
    // Whole cents: prices are compared and stored in cents.
    if (typeof plan.priceUsd !== "number" || !(plan.priceUsd >= 1 && plan.priceUsd <= 10_000) || Math.abs(plan.priceUsd * 100 - Math.round(plan.priceUsd * 100)) > 1e-6) {
      throw invalid(`The ${name} price must be from $1 to $10,000, in whole cents.`);
    }
    if (!Number.isInteger(plan.creditsPerWindow) || plan.creditsPerWindow < 0 || plan.creditsPerWindow > 1_000_000) throw invalid(`${name} credits per window must be a whole number from 0 to 1000000.`);
    if (!Number.isInteger(plan.days) || plan.days < 1 || plan.days > 366) throw invalid(`${name} lasts a whole number of days from 1 to 366.`);
  }
  const { discount } = next;
  if (!Number.isInteger(discount.percent) || discount.percent < 0 || discount.percent > MAX_DISCOUNT_PERCENT) throw invalid(`The discount is a whole percent from 0 to ${MAX_DISCOUNT_PERCENT}.`);
  for (const flag of [discount.plans, discount.api, next.paymentsOpen, next.autoVerify]) if (typeof flag !== "boolean") throw invalid("Switches are on or off (true or false).");
  // Only a new end time must be in the future: an offer that has ended stays as it is when the
  // settings are saved again (a form sends them all back).
  if (discount.endsAt !== null) {
    const ends = typeof discount.endsAt === "string" ? Date.parse(discount.endsAt) : NaN;
    const unchanged = previous.discount.endsAt !== null && ends === Date.parse(previous.discount.endsAt);
    if (!unchanged && (!Number.isFinite(ends) || ends <= now)) throw invalid("The offer's end must be a time in the future, or none.");
    discount.endsAt = new Date(ends).toISOString();
  }
}

export async function saveBillingSettings(patch: BillingPatch, by: string) {
  const previous = await getBillingSettings();
  const next = merge(previous, patch);
  validate(next, previous);
  await query(
    "INSERT INTO curialy.app_settings (key, value, updated_by, updated_at) VALUES ('billing', $1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
    [JSON.stringify(next), by],
  );
  cache = { at: Date.now(), value: next };
  return next;
}

// ---- Receiving wallets ----

let wallets: { evm: string | null; solana: string | null } | null = null;

/**
 * The receiving wallets from PAY_EVM_ADDRESS and PAY_SOLANA_ADDRESS, checked once. One that is unset
 * or invalid is null and its networks are not offered; the value itself is never logged (a pasted
 * private key must not end up in the journal).
 */
export function walletConfig(): { evm: string | null; solana: string | null } {
  if (wallets) return wallets;
  const evm = (process.env.PAY_EVM_ADDRESS ?? "").trim();
  const solana = (process.env.PAY_SOLANA_ADDRESS ?? "").trim();
  const evmOk = isValidEvmAddress(evm);
  const solanaOk = isValidSolanaAddress(solana);
  if (!evm) console.warn("[Curialy Billing] PAY_EVM_ADDRESS is not set: Ethereum, BNB Chain and Polygon payments are off.");
  else if (!evmOk) console.error("[Curialy Billing] PAY_EVM_ADDRESS is not a valid address (0x and 40 hex characters, with a correct EIP-55 checksum when mixed case): Ethereum, BNB Chain and Polygon payments are off.");
  if (!solana) console.warn("[Curialy Billing] PAY_SOLANA_ADDRESS is not set: Solana payments are off.");
  else if (!solanaOk) console.error("[Curialy Billing] PAY_SOLANA_ADDRESS is not a valid Solana wallet (base58, 32 bytes, on the ed25519 curve): Solana payments are off.");
  // Wallets show addresses checksummed; the payer copies this form.
  wallets = { evm: evmOk ? toChecksumAddress(evm) : null, solana: solanaOk ? solana : null };
  return wallets;
}

/** The wallet that receives payments on a network, or null when that network is off. */
export const walletFor = (network: NetworkInfo) => (network.family === "evm" ? walletConfig().evm : walletConfig().solana);

/** The networks a payment can use: those whose wallet is configured. */
export const offeredNetworks = (): NetworkInfo[] => PAYMENT_NETWORKS.filter(network => walletFor(network) !== null);

/** Tests: forget the cached settings and wallets. */
export function resetBillingSettings() {
  cache = null;
  wallets = null;
}
