import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API_PRICES, NON_STREAMING_MAX_TOKENS } from "@shared/billing";
import { GATEWAY_MODELS } from "@shared/gateway";
import { addOrder, addUser, fake, orderByCode, resetFake } from "./fake-db";

// The billing API over HTTP: the public catalog (prices from the server, only the networks with a
// wallet, nothing that names a provider), orders an account places, pays and follows (only its
// own), usage reports, and the operator's routes (the operator only).

vi.mock("../db/pg", async () => (await import("./fake-db")).pgModule());
vi.mock("../auth", async importOriginal => ({
  ...(await importOriginal<typeof import("../auth")>()),
  requireUser: (req: any, res: any, next: any) => (req.headers["x-test-user"] ? next() : res.status(401).json({ error: "Sign in required." })),
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "Sign in required." });
    return req.headers["x-test-role"] === "admin" ? next() : res.status(403).json({ error: "Only the operator can do this." });
  },
  accountOf: (req: any) => ({ id: req.headers["x-test-user"], role: req.headers["x-test-role"] === "admin" ? "admin" : "user", login: null, displayName: "Test", avatarUrl: null, email: null }),
}));
const chain = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("./chains", async importOriginal => ({ ...(await importOriginal<typeof import("./chains")>()), verifyPayment: vi.fn(async (input: unknown) => { chain.calls.push(input); return { state: "not_found" }; }) }));
const prices = vi.hoisted(() => ({ quote: 3000 as number | null }));
vi.mock("./prices", () => ({ quoteUsd: vi.fn(async () => prices.quote) }));
vi.mock("./notify", () => ({ alertsConfigured: () => false, notifyOrder: vi.fn(async () => undefined) }));
const wallet = { balanceMicros: 7_500_000, reservedMicros: 500_000, reservedTokens: 20_000, requestsInFlight: 1, availableMicros: 7_000_000 };
vi.mock("./wallet", () => ({ getApiWallet: vi.fn(async () => wallet) }));
const reports = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("./reports", () => ({
  apiUsageReport: vi.fn(async (...args: unknown[]) => { reports.calls.push(["api", ...args]); return { range: args[1], bucket: "day", timeZone: args[2], buckets: [], byModel: [], byKey: [], totals: {} }; }),
  creditUsageReport: vi.fn(async (...args: unknown[]) => { reports.calls.push(["credits", ...args]); return { range: args[1], bucket: "day", timeZone: args[2], buckets: [], totals: { credits: 0, runs: 0 }, allowance: 60, windowHours: 5 }; }),
}));

const EVM = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";
const SOLANA = "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i";
const ADA = "10000000-0000-4000-8000-0000000000a1";
const GRACE = "10000000-0000-4000-8000-0000000000a2";
const OPERATOR = "10000000-0000-4000-8000-0000000000ff";
const HASH = `0x${"ab".repeat(32)}`;

const { billingAdminRouter, billingRouter } = await import("./routes");
const { resetBillingSettings } = await import("./settings");

let server: Server;
let base = "";
beforeAll(async () => {
  vi.stubEnv("PAY_EVM_ADDRESS", EVM);
  vi.stubEnv("PAY_SOLANA_ADDRESS", SOLANA);
  const app = express();
  // Tests give each caller its own address (the catalog's limit is per address).
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/billing", billingRouter());
  app.use("/api/admin/billing", billingAdminRouter());
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});
let ip = 0;
beforeEach(() => {
  resetFake();
  resetBillingSettings();
  chain.calls.length = 0;
  reports.calls.length = 0;
  prices.quote = 3000;
  ip++;
  addUser({ id: ADA, login: "ada" });
  addUser({ id: GRACE, login: "grace" });
  addUser({ id: OPERATOR, role: "admin", login: "mouno19" });
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fake.unexpected).toEqual([]);
});

type Call = { method?: string; body?: unknown; user?: string; role?: string };
async function call(path: string, { method = "GET", body, user, role }: Call = {}) {
  const response = await fetch(`${base}${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip}`, ...(user ? { "x-test-user": user } : {}), ...(role ? { "x-test-role": role } : {}) },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const asAdmin = (path: string, init: Omit<Call, "user" | "role"> = {}) => call(path, { ...init, user: OPERATOR, role: "admin" });

describe("the catalog", () => {
  it("is public: plans at the offer's price, the free allowance, top-ups, the networks with a wallet and every priced model", async () => {
    const { status, body } = await call("/api/billing/catalog");
    expect(status).toBe(200);
    expect(body.plans).toEqual([
      { id: "pro", name: "Pro", listUsd: 20, priceUsd: 2, discountPercent: 90, creditsPerWindow: 6000, days: 30 },
      { id: "max", name: "Max", listUsd: 80, priceUsd: 8, discountPercent: 90, creditsPerWindow: 30000, days: 30 },
    ]);
    expect(body).toMatchObject({
      discount: { plansPercent: 90, apiPercent: 0, endsAt: null },
      free: { welcomeCredits: 60, creditsPerWindow: 0, windowHours: 5, rewards: { followHandle: "Yumiko_web3", followCredits: 240, postCredits: 300, apiUsd: 20, boost: { creditsPerWindow: 300, windowHours: 8, endsAt: null } } },
      apiTopup: { minUsd: 5, maxUsd: 1000, presets: [5, 10, 25, 50, 100], creditPerUsd: 100 }, paymentsOpen: true,
    });
    expect(body.networks.map((network: { id: string }) => network.id)).toEqual(["ethereum", "bnb", "polygon", "solana"]);
    expect(body.networks[1]).toEqual({
      id: "bnb", label: "BNB Chain", family: "evm", confirmations: 20, wait: "under a minute", logo: "/pay/net-bnb.svg", explorerName: "BscScan",
      coins: [
        { coin: "USDT", kind: "stablecoin", standard: "BEP-20", label: "Tether USD", logo: "/pay/coin-usdt.svg", tokens: ["0x55d398326f99059fF775485246999027B3197955"] },
        { coin: "USDC", kind: "stablecoin", standard: "BEP-20", label: "USD Coin", logo: "/pay/coin-usdc.svg", tokens: ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"] },
        { coin: "BNB", kind: "native", standard: "BNB", label: "BNB", logo: "/pay/net-bnb.svg", tokens: [] },
      ],
    });
    // Every gateway model that has a price, in the gateway's order (one without a price can't be called).
    expect(body.models.map((model: { id: string }) => model.id)).toEqual(GATEWAY_MODELS.filter(model => API_PRICES[model.id]).map(model => model.id));
    expect(body.models.find((model: { id: string }) => model.id === "claude-opus-5-5")).toEqual({
      id: "claude-opus-5-5", label: "Claude Opus 5.5", format: "anthropic",
      list: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, longContext: null,
      contextWindow: 1_000_000, maxOutput: 128_000, maxTokens: { streaming: 64_000, nonStreaming: NON_STREAMING_MAX_TOKENS },
    });
    expect(body.models.find((model: { id: string }) => model.id === "openai-gpt-5.5")).toMatchObject({
      format: "openai", longContext: { above: 272_000, input: 10, output: 45, cacheRead: 1, cacheWrite: 10, price: { input: 10, output: 45, cacheRead: 1, cacheWrite: 10 } }, contextWindow: null,
    });
    // Streamed: the model's verified output limit (Grok 4.6 answers at 32K); whole replies: 16,384.
    expect(body.models).toHaveLength(GATEWAY_MODELS.length);
    for (const model of body.models) expect(model.maxTokens, model.id).toEqual({ streaming: model.id === "grok-4.6" ? 32_000 : 64_000, nonStreaming: 16_384 });
    // White-label: no provider, endpoint or alert host anywhere in it.
    expect(JSON.stringify(body)).not.toMatch(/publicnode|drpc|merkle|defibit|1rpc|dataseed|mainnet-beta|coinbase|kraken|binance\b|coingecko|telegram|snowflake|cortex|relaystation|browserbase|render\.com|manus|tiger|paper|tinker/i);
  });

  it("shows payments closed while the operator pauses them, or when no wallet is configured, and list prices without the offer", async () => {
    fake.settings.set("billing", { paymentsOpen: false, discount: { percent: 90, plans: false, api: true, endsAt: null } });
    let { body } = await call("/api/billing/catalog");
    expect(body.paymentsOpen).toBe(false);
    expect(body.plans.map((plan: { priceUsd: number }) => plan.priceUsd)).toEqual([20, 80]);
    expect(body.discount).toEqual({ plansPercent: 0, apiPercent: 0, endsAt: null });
    fake.settings.delete("billing");
    resetBillingSettings();
    vi.stubEnv("PAY_EVM_ADDRESS", "");
    vi.stubEnv("PAY_SOLANA_ADDRESS", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      ({ body } = await call("/api/billing/catalog"));
      expect(body).toMatchObject({ paymentsOpen: false, networks: [] });
      expect((await call("/api/billing/orders", { method: "POST", user: ADA, body: { kind: "plan", planId: "pro" } })).body).toMatchObject({ code: "payments_closed" });
    } finally {
      vi.stubEnv("PAY_EVM_ADDRESS", EVM);
      vi.stubEnv("PAY_SOLANA_ADDRESS", SOLANA);
      vi.restoreAllMocks();
      resetBillingSettings();
    }
  });

  it("is limited to 120 requests an address in ten minutes", async () => {
    for (let index = 0; index < 120; index++) expect((await call("/api/billing/catalog")).status).toBe(200);
    expect(await call("/api/billing/catalog")).toMatchObject({ status: 429, body: { code: "busy" } });
    ip++;
    expect((await call("/api/billing/catalog")).status).toBe(200);
  });
});

describe("the account", () => {
  it("needs a sign-in, and shows the plan, the API wallet and whether it is the operator", async () => {
    expect((await call("/api/billing/account")).status).toBe(401);
    expect((await call("/api/billing/account", { user: ADA })).body).toEqual({ plan: null, apiWallet: wallet, operator: false, prepay: { pro: 6, max: 6 } });
    Object.assign(fake.users.get(ADA)!, { plan_id: "max", plan_expires_at: new Date("2099-01-01T00:00:00Z"), plan_credits_per_window: 25_000 });
    expect((await call("/api/billing/account", { user: ADA })).body.plan).toEqual({ id: "max", name: "Max", expiresAt: "2099-01-01T00:00:00.000Z", creditsPerWindow: 25_000 });
    expect((await call("/api/billing/account", { user: OPERATOR, role: "admin" })).body.operator).toBe(true);
  });
});

describe("orders", () => {
  const order = (user: string, body: unknown) => call("/api/billing/orders", { method: "POST", user, body });

  it("are priced on the server: the discount on plans only, a top-up credited at 100 times the payment", async () => {
    const plan = await order(ADA, { kind: "plan", planId: "pro", priceUsd: 0.01, discountPercent: 100 });
    expect(plan.status).toBe(201);
    expect(plan.body.order).toMatchObject({ kind: "plan", planId: "pro", listUsd: 20, discountPercent: 90, priceUsd: 2, status: "awaiting_payment", events: [{ status: "awaiting_payment", actor: "customer" }] });
    const topUp = await order(ADA, { kind: "api", amountUsd: 25, priceUsd: 1 });
    expect(topUp.body.order).toMatchObject({ kind: "api", listUsd: 25, discountPercent: 0, priceUsd: 25, creditUsd: 2500 });
    // A double click is the same order (200, not a new one).
    const again = await order(ADA, { kind: "plan", planId: "pro" });
    expect(again).toMatchObject({ status: 200, body: { order: { code: plan.body.order.code } } });
  });

  it("refuse a malformed request", async () => {
    for (const body of [{}, { kind: "gift" }, { kind: "plan", planId: "ultra" }, { kind: "api", amountUsd: 4 }, { kind: "api", amountUsd: 1001 }, { kind: "api", amountUsd: 5.5 }, { kind: "api", amountUsd: "10" }, { kind: "plan", planId: "pro", months: 7 }, { kind: "plan", planId: "pro", months: 0 }, { kind: "plan", planId: "pro", months: 2.5 }]) {
      const response = await order(ADA, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.code).toBe("invalid_request");
    }
    expect((await order(ADA, { kind: "plan", planId: "ultra" })).body.error).toBe("Choose Pro or Max.");
    expect((await call("/api/billing/orders", { method: "POST", body: { kind: "plan", planId: "pro" } })).status).toBe(401);
    expect(fake.orders).toEqual([]);
  });

  it("are capped at five awaiting payment", async () => {
    for (const amountUsd of [5, 6, 7, 8, 9]) expect((await order(GRACE, { kind: "api", amountUsd })).status).toBe(201);
    expect(await order(GRACE, { kind: "api", amountUsd: 10 })).toMatchObject({ status: 409, body: { code: "too_many_orders" } });
  });

  it("are only ever the account's own: someone else's code is not found, exactly like an unknown one", async () => {
    const { body } = await order(ADA, { kind: "plan", planId: "max" });
    const code = body.order.code;
    expect((await call(`/api/billing/orders/${code}`, { user: ADA })).body.order.code).toBe(code);
    expect((await call(`/api/billing/orders/${code.slice(4).toLowerCase()}`, { user: ADA })).body.order.code).toBe(code);
    const unknown = await call("/api/billing/orders/CUR-00000000", { user: GRACE });
    for (const [path, method, payload] of [[`/api/billing/orders/${code}`, "GET"], [`/api/billing/orders/${code}/method`, "POST", { network: "bnb", coin: "USDT" }], [`/api/billing/orders/${code}/submit`, "POST", { txHash: HASH }]] as const) {
      expect(await call(path, { method, body: payload, user: GRACE })).toEqual(unknown);
    }
    expect(unknown).toEqual({ status: 404, body: { error: "No order with that code on this account.", code: "not_found" } });
    expect((await call("/api/billing/orders", { user: GRACE })).body).toEqual({ orders: [] });
    expect((await call("/api/billing/orders", { user: ADA })).body.orders.map((entry: { code: string }) => entry.code)).toEqual([code]);
    expect(orderByCode(code).network).toBeNull();
  });

  it("issue payment details once, then take the transaction hash and start checking it", async () => {
    const { body } = await order(ADA, { kind: "plan", planId: "pro" });
    const code = body.order.code;
    expect(await call(`/api/billing/orders/${code}/method`, { method: "POST", user: ADA, body: { network: "bnb", coin: "DOGE" } })).toMatchObject({ status: 400, body: { code: "method_unavailable" } });
    const issued = await call(`/api/billing/orders/${code}/method`, { method: "POST", user: ADA, body: { network: "bnb", coin: "USDT" } });
    expect(issued.status).toBe(200);
    expect(issued.body.order).toMatchObject({ network: "bnb", coin: "USDT", payAddress: EVM, status: "awaiting_payment" });
    expect(issued.body.order.expectedAmount).toMatch(/^2\.00\d{1,2}$/);
    expect((await call(`/api/billing/orders/${code}/method`, { method: "POST", user: ADA, body: { network: "bnb", coin: "USDT" } })).body.order.expectedAmount).toBe(issued.body.order.expectedAmount);
    expect(await call(`/api/billing/orders/${code}/method`, { method: "POST", user: ADA, body: { network: "solana", coin: "USDC" } })).toMatchObject({ status: 409, body: { code: "details_locked" } });

    expect(await call(`/api/billing/orders/${code}/submit`, { method: "POST", user: ADA, body: { txHash: "not a hash" } })).toMatchObject({ status: 400, body: { code: "invalid_hash" } });
    const submitted = await call(`/api/billing/orders/${code}/submit`, { method: "POST", user: ADA, body: { txHash: HASH } });
    expect(submitted).toMatchObject({ status: 200, body: { order: { status: "pending", txHash: HASH, explorerUrl: `https://bscscan.com/tx/${HASH}` } } });
    await vi.waitFor(() => expect(chain.calls).toHaveLength(1));
    // Once the transaction has paid an order, it can't pay a second one.
    orderByCode(code).status = "confirming";
    const second = await order(ADA, { kind: "plan", planId: "max" });
    await call(`/api/billing/orders/${second.body.order.code}/method`, { method: "POST", user: ADA, body: { network: "bnb", coin: "USDT" } });
    expect(await call(`/api/billing/orders/${second.body.order.code}/submit`, { method: "POST", user: ADA, body: { txHash: HASH } })).toEqual({ status: 409, body: { error: "This transaction already paid another order.", code: "hash_used" } });
    expect(await call(`/api/billing/orders/${code}/submit`, { method: "POST", user: ADA, body: { txHash: `0x${"cd".repeat(32)}` } })).toMatchObject({ status: 409, body: { code: "already_confirming" } });
  });

  it("refuse a network's own coin without a reliable price", async () => {
    const { body } = await order(ADA, { kind: "plan", planId: "pro" });
    prices.quote = null;
    const refused = await call(`/api/billing/orders/${body.order.code}/method`, { method: "POST", user: ADA, body: { network: "ethereum", coin: "ETH" } });
    expect(refused).toMatchObject({ status: 503, body: { code: "no_quote", error: "ETH can't be priced reliably right now. Pay with USDT or USDC, or try again in a few minutes." } });
  });
});

describe("usage", () => {
  it("passes the range and the caller's time zone on, and falls back to UTC", async () => {
    expect((await call("/api/billing/api/usage?range=7d&tz=Europe%2FParis", { user: ADA })).body).toMatchObject({ range: "7d", timeZone: "Europe/Paris" });
    expect((await call("/api/billing/credits/usage?range=24h&tz=Mars%2FOlympus", { user: ADA })).body).toMatchObject({ range: "24h", timeZone: "UTC" });
    expect(reports.calls).toEqual([["api", ADA, "7d", "Europe/Paris"], ["credits", ADA, "24h", "UTC"]]);
    expect(await call("/api/billing/api/usage?range=1y", { user: ADA })).toMatchObject({ status: 400, body: { code: "invalid_range" } });
    expect((await call("/api/billing/credits/usage?range=7d")).status).toBe(401);
  });
});

describe("the operator's routes", () => {
  it("are for the operator only", async () => {
    const paths: [string, string, unknown?][] = [
      ["/api/admin/billing/overview", "GET"], ["/api/admin/billing/orders", "GET"], ["/api/admin/billing/orders/CUR-00000000", "GET"], ["/api/admin/billing/orders/CUR-00000000/recheck", "POST", {}],
      ["/api/admin/billing/orders/CUR-00000000/approve", "POST", { note: "" }], ["/api/admin/billing/orders/CUR-00000000/reject", "POST", { note: "x" }], ["/api/admin/billing/orders/CUR-00000000/disapprove", "POST", { note: "x" }], ["/api/admin/billing/settings", "GET"],
      ["/api/admin/billing/settings", "PUT", { paymentsOpen: false }], [`/api/admin/billing/users/${ADA}`, "GET"], [`/api/admin/billing/users/${ADA}/plan`, "POST", { planId: "max", days: 30, note: "" }],
      [`/api/admin/billing/users/${ADA}/plan`, "DELETE", { note: "" }], [`/api/admin/billing/users/${ADA}/api-balance`, "POST", { amountUsd: 100, note: "" }],
    ];
    for (const [path, method, body] of paths) {
      expect((await call(path, { method, body })).status, path).toBe(401);
      expect((await call(path, { method, body, user: ADA })).status, path).toBe(403);
    }
    expect(fake.settings.has("billing")).toBe(false);
    expect(fake.users.get(ADA)!).toMatchObject({ plan_id: null, api_balance_micros: "0" });
  });

  it("show the overview and the queue, and approve or reject an order", async () => {
    const review = addOrder({ user_id: ADA, network: "bnb", coin: "USDT", pay_address: EVM, expected_units: "2003700000000000000", quoted_at: new Date(), tx_hash: HASH, status: "review", status_detail: "This transaction arrived after the payment window closed." });
    addOrder({ user_id: GRACE });
    const overview = (await asAdmin("/api/admin/billing/overview")).body;
    expect(overview).toMatchObject({ counts: { review: 1, awaiting_payment: 1, completed: 0 }, revenue: { totalUsd: 0 }, subscribers: { pro: 0, max: 0 }, apiBalanceTotalUsd: 0, wallets: { evm: EVM, solana: SOLANA }, alerts: false });
    expect(overview.settings.plans.pro.priceUsd).toBe(20);
    const queue = (await asAdmin("/api/admin/billing/orders?status=attention&q=&offset=0")).body;
    expect(queue).toMatchObject({ more: false, orders: [{ code: review.code, status: "review", user: { id: ADA, login: "ada" }, receivedAmount: null }] });
    expect((await asAdmin("/api/admin/billing/orders?status=lost")).status).toBe(400);
    expect((await asAdmin(`/api/admin/billing/orders?status=all&q=grace`)).body.orders).toHaveLength(1);
    expect((await asAdmin(`/api/admin/billing/orders/${review.code}`)).body.order.events).toEqual([]);

    expect((await asAdmin(`/api/admin/billing/orders/${review.code}/reject`, { method: "POST", body: {} })).body.code).toBe("note_required");
    const approved = await asAdmin(`/api/admin/billing/orders/${review.code}/approve`, { method: "POST", body: { note: "Late by two minutes; fine." } });
    expect(approved.body.order).toMatchObject({ status: "completed", adminNote: "Late by two minutes; fine.", applied: { planId: "pro", effect: "start" } });
    expect(fake.events.at(-1)).toMatchObject({ actor: "admin", actor_id: OPERATOR });
    expect(await asAdmin(`/api/admin/billing/orders/${review.code}/reject`, { method: "POST", body: { note: "No" } })).toMatchObject({ status: 409, body: { code: "order_completed" } });
    expect((await asAdmin("/api/admin/billing/orders/CUR-ZZZZZZZZ")).status).toBe(404);
  });

  it("read and save settings, refusing anything outside the limits", async () => {
    expect((await asAdmin("/api/admin/billing/settings")).body.settings.discount).toEqual({ percent: 90, plans: true, api: true, endsAt: null });
    for (const body of [{ discount: { percent: 96 } }, { plans: { pro: { priceUsd: 0 } } }, { plans: { gold: {} } }, { surprise: true }, { discount: { endsAt: "2001-01-01T00:00:00Z" } }]) {
      expect((await asAdmin("/api/admin/billing/settings", { method: "PUT", body })).status, JSON.stringify(body)).toBe(400);
    }
    const saved = await asAdmin("/api/admin/billing/settings", { method: "PUT", body: { discount: { percent: 50 }, plans: { max: { creditsPerWindow: 40_000 } } } });
    expect(saved.body.settings).toMatchObject({ discount: { percent: 50, plans: true }, plans: { max: { creditsPerWindow: 40_000, priceUsd: 80 } } });
    expect((await call("/api/billing/catalog")).body.plans[1]).toMatchObject({ priceUsd: 40, discountPercent: 50, creditsPerWindow: 40_000 });
  });

  it("give and end plans and adjust API balances, answering with the account's billing", async () => {
    expect((await asAdmin("/api/admin/billing/users/not-a-uuid")).status).toBe(400);
    const granted = await asAdmin(`/api/admin/billing/users/${ADA}/plan`, { method: "POST", body: { planId: "max", days: 7, note: "Beta tester" } });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ plan: { id: "max", name: "Max", creditsPerWindow: 30000 }, apiWallet: wallet, orders: [], ledger: [] });
    expect((await asAdmin(`/api/admin/billing/users/${ADA}/plan`, { method: "POST", body: { planId: "max", days: 400, note: "" } })).status).toBe(400);
    expect((await asAdmin(`/api/admin/billing/users/${ADA}/plan`, { method: "DELETE", body: { note: "Ended" } })).body.plan).toBeNull();
    expect((await asAdmin(`/api/admin/billing/users/${ADA}/plan`, { method: "DELETE", body: { note: "" } })).body.code).toBe("no_plan");
    const adjusted = await asAdmin(`/api/admin/billing/users/${ADA}/api-balance`, { method: "POST", body: { amountUsd: 12.5, note: "Refund for an outage" } });
    expect(adjusted.body.ledger).toEqual([expect.objectContaining({ kind: "grant", amountUsd: 12.5, balanceAfterUsd: 12.5, orderCode: null, note: "Refund for an outage" })]);
    for (const amountUsd of [0, 10_001, "5"]) expect((await asAdmin(`/api/admin/billing/users/${ADA}/api-balance`, { method: "POST", body: { amountUsd, note: "" } })).status).toBe(400);
    expect((await asAdmin(`/api/admin/billing/users/${GRACE.replace("a2", "a9")}`)).status).toBe(404);
  });
});
