import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { BASE_OUTPUT_TOKENS, MODELS, outputLimit } from "@shared/agent";
import {
  API_PRICES, API_TOPUP, COIN_INFO, discountedPrices, discountedUsd, discountPercent, MAX_DISCOUNT_PERCENT, MAX_PLAN_MONTHS, modelLimits, NON_STREAMING_MAX_TOKENS,
  PAYMENT_STATUS, PLAN_IDS, USAGE_RANGES, type AdminAccountBilling, type AdminBillingOverview, type ApiModelPrice, type BillingAccount, type BillingCatalog,
  type FreeTier, type NetworkInfo, type PaymentStatus, type PublicNetwork, type UsageRange,
} from "@shared/billing";
import type { CreditSettings } from "@shared/credits";
import { GATEWAY_MODELS, type GatewayModel } from "@shared/gateway";
import { accountOf, rateLimited, requireAdmin, requireUser } from "../auth";
import { getSettings as getCreditSettings } from "../credits";
import {
  accountBilling, adjustApiBalance, approveOrder, billingOverview, chooseMethod, createOrder, endPlan, getAdminOrder, getOwnOrder, grantPlan, listAdminOrders, walletBalances,
  listOwnOrders, planOfAccount, prepayLimits, recheckOrder, rejectOrder, submitHash, type AdminOrderFilter,
} from "./orders";
import { apiUsageReport, creditUsageReport } from "./reports";
import { BillingError, getBillingSettings, offeredNetworks, saveBillingSettings } from "./settings";
import { getApiWallet } from "./wallet";

// /api/billing: the public catalog (plans, the offer, API prices, payment networks), then, signed in,
// the account's plan and API balance, its orders (only ever its own: someone else's code is not
// found, exactly like an unknown one) and its usage. /api/admin/billing: the operator's payments
// queue, settings, and plans and API balances by account.

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  fn(req, res).catch(error => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; "), code: "invalid_request" });
    if (error instanceof BillingError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error("[Curialy Billing]", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Something went wrong. Try again.", code: "server_error" });
  });
};

const busy = (res: Response) => res.status(429).json({ error: "Too many requests. Wait a few minutes and try again.", code: "busy" });

// ---- The catalog ----

const publicNetwork = (network: NetworkInfo): PublicNetwork => ({
  id: network.id, label: network.label, family: network.family, confirmations: network.confirmations, wait: network.wait, logo: network.logo, explorerName: network.explorer.name,
  coins: network.coins.map(coin => ({ coin: coin.coin, kind: coin.kind, standard: coin.standard, label: COIN_INFO[coin.coin].label, logo: COIN_INFO[coin.coin].logo, tokens: coin.tokens })),
});

function modelPrice(model: GatewayModel, percent: number): ApiModelPrice {
  const pricing = API_PRICES[model.id];
  const list = { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead, cacheWrite: pricing.cacheWrite };
  const long = pricing.longContext;
  const limits = modelLimits(model.id);
  const spec = MODELS.find(entry => entry.id === model.id);
  return {
    id: model.id, label: model.label, format: model.format, list, price: discountedPrices(list, percent),
    longContext: long ? { above: long.above, input: long.input, output: long.output, cacheRead: long.cacheRead, cacheWrite: long.cacheWrite, price: discountedPrices(long, percent) } : null,
    contextWindow: limits?.contextWindow ?? null, maxOutput: limits?.maxOutput ?? null,
    // Streamed replies may use the model's verified output limit; whole ones are capped lower.
    maxTokens: { streaming: spec ? outputLimit(spec) : BASE_OUTPUT_TOKENS, nonStreaming: NON_STREAMING_MAX_TOKENS },
  };
}

/** The free tier as the catalog says it: the boost only while it is offered. */
export function freeTier(credits: CreditSettings, now = Date.now()): FreeTier {
  const { rewards } = credits;
  const offered = rewards.boost.enabled && rewards.boost.creditsPerWindow > 0 && (!rewards.boost.endsAt || Date.parse(rewards.boost.endsAt) > now);
  return {
    welcomeCredits: credits.welcomeCredits, creditsPerWindow: credits.creditsPerWindow, windowHours: credits.windowHours,
    rewards: {
      followHandle: rewards.followHandle, followCredits: rewards.followCredits, postCredits: rewards.postCredits,
      boost: offered ? { creditsPerWindow: rewards.boost.creditsPerWindow, windowHours: rewards.boost.windowHours, endsAt: rewards.boost.endsAt } : null,
    },
  };
}

export async function billingCatalog(): Promise<BillingCatalog> {
  const [settings, credits] = await Promise.all([getBillingSettings(), getCreditSettings()]);
  const plansPercent = discountPercent(settings.discount, "plans");
  const apiPercent = discountPercent(settings.discount, "api");
  const networks = offeredNetworks();
  return {
    plans: PLAN_IDS.map(id => {
      const plan = settings.plans[id];
      return { id, name: plan.name, listUsd: plan.priceUsd, priceUsd: discountedUsd(plan.priceUsd, plansPercent), discountPercent: plansPercent, creditsPerWindow: plan.creditsPerWindow, days: plan.days };
    }),
    discount: { plansPercent, apiPercent, endsAt: plansPercent || apiPercent ? settings.discount.endsAt : null },
    free: freeTier(credits),
    apiTopup: { minUsd: API_TOPUP.minUsd, maxUsd: API_TOPUP.maxUsd, presets: [...API_TOPUP.presets] },
    paymentsOpen: settings.paymentsOpen && networks.length > 0,
    networks: networks.map(publicNetwork),
    // A model without a price can't be called, so it isn't listed.
    models: GATEWAY_MODELS.filter(model => API_PRICES[model.id]).map(model => modelPrice(model, apiPercent)),
  };
}

// ---- Bodies ----

const newOrderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"), planId: z.enum(["pro", "max"], "Choose Pro or Max."),
    months: z.number("Choose how many months.").int(`Choose from 1 to ${MAX_PLAN_MONTHS} months.`).min(1, `Choose from 1 to ${MAX_PLAN_MONTHS} months.`).max(MAX_PLAN_MONTHS, `Choose from 1 to ${MAX_PLAN_MONTHS} months.`).optional(),
  }),
  z.object({
    kind: z.literal("api"),
    amountUsd: z.number("Enter an amount in dollars.").int("A top-up is a whole number of dollars.")
      .min(API_TOPUP.minUsd, `A top-up is at least $${API_TOPUP.minUsd}.`).max(API_TOPUP.maxUsd, `A top-up is at most $${API_TOPUP.maxUsd.toLocaleString("en-US")}.`),
  }),
], "Choose a plan or an API top-up.");
const methodSchema = z.object({ network: z.string("Choose a network.").max(20), coin: z.string("Choose a coin.").max(10) });
const submitSchema = z.object({ txHash: z.string("Paste the transaction hash.").max(200, "That isn't a transaction hash.") });
const noteSchema = z.object({ note: z.string().trim().max(500, "Keep the note under 500 characters.").default("") });

const planPatch = z.object({
  name: z.string().trim().min(1, "A plan's name is 1 to 24 characters.").max(24, "A plan's name is 1 to 24 characters.").optional(),
  priceUsd: z.number().min(1, "A plan costs $1 to $10,000.").max(10_000, "A plan costs $1 to $10,000.").optional(),
  creditsPerWindow: z.number().int("Credits per window are a whole number.").min(0).max(1_000_000, "Credits per window are at most 1000000.").optional(),
  days: z.number().int("A plan lasts a whole number of days.").min(1, "A plan lasts 1 to 366 days.").max(366, "A plan lasts 1 to 366 days.").optional(),
}).strict();
const settingsSchema = z.object({
  plans: z.object({ pro: planPatch.optional(), max: planPatch.optional() }).strict().optional(),
  discount: z.object({
    percent: z.number().int("The discount is a whole percent.").min(0).max(MAX_DISCOUNT_PERCENT, `The discount is at most ${MAX_DISCOUNT_PERCENT}%.`).optional(),
    plans: z.boolean().optional(),
    api: z.boolean().optional(),
    endsAt: z.string().datetime({ offset: true, message: "The offer's end must be a date and time." }).nullable().optional(),
  }).strict().optional(),
  paymentsOpen: z.boolean().optional(),
  autoVerify: z.boolean().optional(),
}).strict();

const uuid = z.string().uuid("Unknown account.");
const orderStatuses = Object.keys(PAYMENT_STATUS) as PaymentStatus[];

/** A time zone Intl accepts, else UTC. */
function timeZoneOf(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 64) return "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function rangeOf(value: unknown): UsageRange {
  if (typeof value === "string" && (USAGE_RANGES as string[]).includes(value)) return value as UsageRange;
  throw new BillingError(`The range is one of ${USAGE_RANGES.join(", ")}.`, "invalid_range", 400);
}

// ---- The account's routes ----

export function billingRouter() {
  const router = Router();

  // Public (the homepage shows it).
  router.get("/catalog", handle(async (req, res) => {
    if (rateLimited(`billing-catalog:${req.ip ?? "unknown"}`, 120)) return busy(res);
    res.json(await billingCatalog());
  }));

  router.use(requireUser);

  router.get("/account", handle(async (req, res) => {
    const user = accountOf(req);
    const [plan, apiWallet, prepay] = await Promise.all([planOfAccount(user.id), getApiWallet(user.id), prepayLimits(user.id)]);
    res.json({ plan, apiWallet, operator: user.role === "admin", prepay } satisfies BillingAccount);
  }));

  router.get("/orders", handle(async (req, res) => res.json({ orders: await listOwnOrders(accountOf(req).id) })));

  router.post("/orders", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`billing-order:${user.id}`, 20)) return busy(res);
    const { order, created } = await createOrder(user.id, newOrderSchema.parse(req.body ?? {}));
    res.status(created ? 201 : 200).json({ order });
  }));

  router.get("/orders/:code", handle(async (req, res) => res.json({ order: await getOwnOrder(accountOf(req).id, req.params.code) })));

  router.post("/orders/:code/method", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`billing-method:${user.id}`, 30)) return busy(res);
    const { network, coin } = methodSchema.parse(req.body ?? {});
    res.json({ order: await chooseMethod(user.id, req.params.code, network, coin) });
  }));

  router.post("/orders/:code/submit", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`billing-submit:${user.id}`, 20)) return busy(res);
    const { txHash } = submitSchema.parse(req.body ?? {});
    res.json({ order: await submitHash(user.id, req.params.code, txHash) });
  }));

  // Usage charts: a page shows a few at once.
  router.get("/api/usage", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`billing-usage:${user.id}`, 240)) return busy(res);
    res.json(await apiUsageReport(user.id, rangeOf(req.query.range), timeZoneOf(req.query.tz)));
  }));

  router.get("/credits/usage", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`billing-usage:${user.id}`, 240)) return busy(res);
    res.json(await creditUsageReport(user.id, rangeOf(req.query.range), timeZoneOf(req.query.tz)));
  }));

  return router;
}

// ---- The operator's routes ----

async function adminAccount(userId: string): Promise<AdminAccountBilling> {
  const [parts, apiWallet] = await Promise.all([accountBilling(userId), getApiWallet(userId)]);
  return { ...parts, apiWallet };
}

export function billingAdminRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get("/overview", handle(async (_req, res) => {
    const [overview, settings] = await Promise.all([billingOverview(), getBillingSettings()]);
    res.json({ ...overview, settings } satisfies AdminBillingOverview);
  }));

  router.get("/wallets", handle(async (_req, res) => res.json(await walletBalances())));

  router.get("/orders", handle(async (req, res) => {
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : "all";
    if (status !== "all" && status !== "attention" && !orderStatuses.includes(status as PaymentStatus)) throw new BillingError("Unknown status.", "invalid_status", 400);
    const filter: AdminOrderFilter = {
      status: status as AdminOrderFilter["status"],
      q: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "",
      offset: Math.min(100_000, Math.max(0, Math.floor(Number(req.query.offset)) || 0)),
    };
    res.json(await listAdminOrders(filter));
  }));

  router.get("/orders/:code", handle(async (req, res) => res.json({ order: await getAdminOrder(req.params.code) })));

  router.post("/orders/:code/recheck", handle(async (req, res) => res.json({ order: await recheckOrder(req.params.code, accountOf(req).id) })));

  router.post("/orders/:code/approve", handle(async (req, res) => {
    const { note } = noteSchema.parse(req.body ?? {});
    res.json({ order: await approveOrder(req.params.code, accountOf(req).id, note) });
  }));

  router.post("/orders/:code/reject", handle(async (req, res) => {
    const { note } = noteSchema.parse(req.body ?? {});
    res.json({ order: await rejectOrder(req.params.code, accountOf(req).id, note) });
  }));

  router.get("/settings", handle(async (_req, res) => res.json({ settings: await getBillingSettings() })));

  router.put("/settings", handle(async (req, res) => {
    const patch = settingsSchema.parse(req.body ?? {});
    res.json({ settings: await saveBillingSettings(patch, accountOf(req).id) });
  }));

  router.get("/users/:id", handle(async (req, res) => res.json(await adminAccount(uuid.parse(req.params.id)))));

  router.post("/users/:id/plan", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = z.object({
      planId: z.enum(["pro", "max"], "Choose Pro or Max."),
      days: z.number("Enter a number of days.").int("Days are a whole number.").min(1, "Days are 1 to 366.").max(366, "Days are 1 to 366."),
      note: z.string().trim().max(200).default(""),
    }).parse(req.body ?? {});
    await grantPlan(id, input.planId, input.days, input.note, accountOf(req).id);
    res.json(await adminAccount(id));
  }));

  router.delete("/users/:id/plan", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { note } = noteSchema.parse(req.body ?? {});
    await endPlan(id, note, accountOf(req).id);
    res.json(await adminAccount(id));
  }));

  router.post("/users/:id/api-balance", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = z.object({
      amountUsd: z.number("Enter an amount in dollars.").refine(value => value !== 0 && Math.abs(value) <= 10_000, "Enter an amount from -$10,000 to $10,000, not zero."),
      note: z.string().trim().max(200).default(""),
    }).parse(req.body ?? {});
    await adjustApiBalance(id, input.amountUsd, input.note, accountOf(req).id);
    res.json(await adminAccount(id));
  }));

  return router;
}
