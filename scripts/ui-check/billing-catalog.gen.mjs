#!/usr/bin/env node
// Writes billing-catalog.json next to this file: the billing data the UI check's fixtures serve
// (plans at the launch offer, the four payment networks, every Developer API model with its list
// price, offer price and limits), worked out from shared/billing.ts, shared/gateway.ts and
// shared/agent.ts exactly as server/billing/routes.ts builds GET /api/billing/catalog.
// fixtures.mjs reads the JSON (it imports no app code), so run this again after a price change:
//   node scripts/ui-check/billing-catalog.gen.mjs        (Node 22.18+ strips the types itself)
//   npx tsx scripts/ui-check/billing-catalog.gen.mjs     (older Node)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.resolve(HERE, "../../shared");
const billing = await import(path.join(SHARED, "billing.ts"));
const gateway = await import(path.join(SHARED, "gateway.ts"));
const agent = await import(path.join(SHARED, "agent.ts"));

const settings = billing.DEFAULT_BILLING_SETTINGS;
const plansPercent = billing.discountPercent(settings.discount, "plans");
// routes.ts bills API usage at the listed prices. The top-up multiple is the offer.
const apiPercent = 0;

// routes.ts publicNetwork(): what the catalog says about a network.
const publicNetwork = network => ({
  id: network.id, label: network.label, family: network.family, confirmations: network.confirmations, wait: network.wait, logo: network.logo, explorerName: network.explorer.name,
  coins: network.coins.map(coin => ({ coin: coin.coin, kind: coin.kind, standard: coin.standard, label: billing.COIN_INFO[coin.coin].label, logo: billing.COIN_INFO[coin.coin].logo, tokens: coin.tokens })),
});

// routes.ts modelPrice(): list and offer prices, long-context rates, limits and max_tokens.
function modelPrice(model, percent) {
  const pricing = billing.API_PRICES[model.id];
  const list = { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead, cacheWrite: pricing.cacheWrite };
  const long = pricing.longContext;
  const limits = billing.modelLimits(model.id);
  const spec = agent.MODELS.find(entry => entry.id === model.id);
  return {
    id: model.id, label: model.label, format: model.format, list, price: billing.discountedPrices(list, percent),
    longContext: long ? { above: long.above, input: long.input, output: long.output, cacheRead: long.cacheRead, cacheWrite: long.cacheWrite, price: billing.discountedPrices(long, percent) } : null,
    contextWindow: limits?.contextWindow ?? null, maxOutput: limits?.maxOutput ?? null,
    maxTokens: { streaming: spec ? agent.outputLimit(spec) : agent.BASE_OUTPUT_TOKENS, nonStreaming: billing.NON_STREAMING_MAX_TOKENS },
  };
}

const out = {
  generatedFrom: "shared/billing.ts, shared/gateway.ts, shared/agent.ts (scripts/ui-check/billing-catalog.gen.mjs)",
  settings,
  catalog: {
    plans: billing.PLAN_IDS.map(id => {
      const plan = settings.plans[id];
      return { id, name: plan.name, listUsd: plan.priceUsd, priceUsd: billing.discountedUsd(plan.priceUsd, plansPercent), discountPercent: plansPercent, creditsPerWindow: plan.creditsPerWindow, days: plan.days };
    }),
    discount: { plansPercent, apiPercent, endsAt: plansPercent || apiPercent ? settings.discount.endsAt : null },
    apiTopup: { minUsd: billing.API_TOPUP.minUsd, maxUsd: billing.API_TOPUP.maxUsd, presets: [...billing.API_TOPUP.presets], creditPerUsd: billing.API_TOPUP.creditPerUsd },
    networks: billing.PAYMENT_NETWORKS.map(publicNetwork),
    models: gateway.GATEWAY_MODELS.filter(model => billing.API_PRICES[model.id]).map(model => modelPrice(model, apiPercent)),
  },
  /** Everything an order needs about a network: decimals, token contracts, explorer pages. */
  networks: billing.PAYMENT_NETWORKS,
  coinInfo: billing.COIN_INFO,
  /** List prices per 1M tokens, for usage costs (cost = tokens × price, in micro-dollars). */
  apiPrices: billing.API_PRICES,
  gatewayModelIds: gateway.GATEWAY_MODEL_IDS,
  orderTtlMinutes: billing.ORDER_TTL_MINUTES,
  lateSubmitHours: billing.LATE_SUBMIT_HOURS,
};

const file = path.join(HERE, "billing-catalog.json");
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${path.relative(process.cwd(), file)}: ${out.catalog.plans.length} plans at ${plansPercent}% off, ${out.catalog.networks.length} networks, ${out.catalog.models.length} models\n`);
