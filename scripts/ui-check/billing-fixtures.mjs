// Billing in the UI check's fixture world (crypto payments, 30-day plans, the paid Developer API), in
// the shapes of shared/billing.ts. The catalog, prices and networks come from billing-catalog.json,
// generated from shared/ by billing-catalog.gen.mjs; the rest is made up here, relative to `now`.
// Accounts: "free" is ada-lovelace on Pro, with an API balance and two requests running; "newcomer"
// is a new account on the free allowance that has bought nothing; the operator isn't charged.
import fs from "node:fs";

export const BILLING = JSON.parse(fs.readFileSync(new URL("./billing-catalog.json", import.meta.url), "utf8"));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MICROS = 1_000_000;
const STATUSES = ["awaiting_payment", "pending", "confirming", "review", "completed", "rejected", "expired"];
/** A code no account has (valid, so the page asks the server, which says it isn't found). */
export const UNKNOWN_ORDER_CODE = "CUR-N0TF0VND";

// ---- Deterministic values (hashes, addresses, jitter) ----

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const HEX = "0123456789abcdef";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const draw = (alphabet, length, seed) => {
  const next = rng(seed);
  return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
};
const evmHash = seed => `0x${draw(HEX, 64, seed)}`;
/** Mixed case, the way wallets show a checksummed address. */
const evmAddress = seed => {
  const next = rng(seed + 7);
  return `0x${[...draw(HEX, 40, seed)].map(char => (/[a-f]/.test(char) && next() < 0.5 ? char.toUpperCase() : char)).join("")}`;
};
const solanaSignature = seed => draw(BASE58, 88, seed);

export const EVM_WALLET = evmAddress(4101);
export const SOLANA_WALLET = draw(BASE58, 44, 4102);

// ---- Time zones (usage buckets are the caller's local hours and days, like the server's) ----

function zoneOf(tz) {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z][\w+-]*(?:\/[\w+-]+)*$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
function wallClock(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, min: Number(parts.minute), s: Number(parts.second) };
}
const offsetAt = (ms, timeZone) => {
  const wall = wallClock(ms, timeZone);
  return Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min, wall.s) - (ms - (ms % 1000));
};
/** The instant a local calendar day starts. */
function localMidnight(y, m, d, timeZone) {
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
}
/** Every bucket of a range, oldest first: 24 local hours, or 7, 30 or 90 local days (today last). */
function bucketStarts(range, timeZone, now) {
  const wall = wallClock(now, timeZone);
  if (range === "24h") {
    const hourStart = now - ((wall.min * 60 + wall.s) * 1000 + (now % 1000));
    return { bucket: "hour", starts: Array.from({ length: 24 }, (_, index) => hourStart - (23 - index) * HOUR) };
  }
  const count = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return {
    bucket: "day",
    starts: Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(wall.y, wall.m - 1, wall.d - (count - 1 - index)));
      return localMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), timeZone);
    }),
  };
}
const weekdayOf = (ms, timeZone) => {
  const wall = wallClock(ms + 12 * HOUR, timeZone);
  return new Date(Date.UTC(wall.y, wall.m - 1, wall.d)).getUTCDay();
};

// ---- API usage: what each model's requests look like, and what they cost ----

/** Share of requests and tokens per request (cache writes only where the model bills them). */
const MODEL_MIX = [
  { model: "claude-sonnet-5-5", share: 0.44, input: 3400, cacheRead: 11_800, cacheWrite: 900, output: 620 },
  { model: "claude-haiku-5-5", share: 0.24, input: 1600, cacheRead: 0, cacheWrite: 0, output: 280 },
  { model: "openai-gpt-5.4", share: 0.14, input: 4100, cacheRead: 2600, cacheWrite: 0, output: 880 },
  { model: "claude-opus-5-5", share: 0.1, input: 5200, cacheRead: 16_400, cacheWrite: 1800, output: 1350 },
  { model: "glm-5.3", share: 0.08, input: 2300, cacheRead: 0, cacheWrite: 0, output: 760 },
];
/** Requests through the day, local time (business hours, a quiet night). */
const HOUR_PROFILE = [0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.05, 0.25, 0.6, 0.95, 1, 1, 0.75, 0.9, 1, 1, 0.95, 0.7, 0.45, 0.3, 0.25, 0.18, 0.1, 0.05];
const PROFILE_SUM = HOUR_PROFILE.reduce((sum, value) => sum + value, 0);

const zeroTotals = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0, listMicros: 0 });
const addTotals = (into, from) => {
  for (const key of Object.keys(into)) into[key] += from[key];
  return into;
};

/** One model's share of a bucket: tokens from the mix, cost at its list price and after the offer (shared/billing.ts apiCost). */
function modelUsage(mix, requests, seed, percentOff, charged) {
  if (requests <= 0) return zeroTotals();
  const next = rng(seed);
  const tokens = average => Math.round(requests * average * (0.88 + 0.24 * next()));
  const usage = { inputTokens: tokens(mix.input), outputTokens: tokens(mix.output), cacheReadTokens: tokens(mix.cacheRead), cacheWriteTokens: tokens(mix.cacheWrite) };
  const pricing = BILLING.apiPrices[mix.model];
  const raw = usage.inputTokens * pricing.input + usage.outputTokens * pricing.output + usage.cacheReadTokens * pricing.cacheRead + usage.cacheWriteTokens * pricing.cacheWrite;
  const round = value => Math.max(0, Math.ceil(value - 1e-6));
  return { requests, ...usage, listMicros: round(raw), costMicros: charged ? round((raw * (100 - percentOff)) / 100) : 0 };
}

/**
 * The account's API requests k days ago (0: today, so far): weekdays busier than weekends, growing
 * since the first key, a batch job 9 days ago, a paused app 16 days ago, nothing before 27 days ago.
 */
function apiRequestsOnDay(daysAgo, weekday, dayFraction) {
  if (daysAgo > 26 || daysAgo === 16) return 0;
  const next = rng(9100 + daysAgo);
  const week = weekday === 0 ? 0.22 : weekday === 6 ? 0.34 : 1;
  const trend = 0.55 + 0.7 * (1 - daysAgo / 26);
  const spike = daysAgo === 9 ? 2.6 : 1;
  const whole = 300 * week * trend * spike * (0.8 + 0.4 * next());
  return Math.round(daysAgo === 0 ? whole * dayFraction : whole);
}

/** Credits the account's runs used k days ago, and how many runs: Pro since the plan started, the free allowance before it. */
function creditsOnDay(daysAgo, weekday, { planSinceDays, accountDays, freeAllowancePerDay }) {
  if (daysAgo >= accountDays) return { credits: 0, runs: 0 };
  const next = rng(7300 + daysAgo);
  const week = weekday === 0 || weekday === 6 ? 0.3 : 1;
  if (planSinceDays !== null && daysAgo <= planSinceDays) {
    const runs = Math.max(1, Math.round((6 + 8 * next()) * week));
    return { credits: Math.round(runs * (90 + 140 * next()) * 10) / 10, runs };
  }
  const runs = Math.max(daysAgo === 3 ? 0 : 1, Math.round((1 + 3 * next()) * week));
  return { credits: runs ? Math.min(freeAllowancePerDay, Math.round(runs * (14 + 26 * next()) * 10) / 10) : 0, runs };
}

// ---- The world ----

/**
 * @param {{ now: number, state: { account: string }, users: Record<string, { id: string, login: string | null, name: string }> }} options
 * users: operator, free (ada), newcomer, grace, hedy, alan, margaret, radia.
 * refresh(now) builds the world again around a new now: a run is created once and lasts minutes,
 * longer than a payment window, so each check starts with its countdowns where they belong.
 */
export function createBilling(options) {
  let world = buildWorld(options.now, options);
  return {
    // The same routes in the same order every build: each one asks the current world.
    routes: world.routes.map(([method, pattern, , extra], index) => [method, pattern, args => world.routes[index][2](args), extra]),
    refresh(now = Date.now()) {
      world = buildWorld(now, options);
    },
    payStates: world.payStates,
    reviewOrderCode: world.reviewOrderCode,
    planOf: user => world.planOf(user),
    apiBalanceUsd: user => world.apiBalanceUsd(user),
    get data() {
      return world.data;
    },
    reports: { apiUsage: (...args) => world.reports.apiUsage(...args), creditUsage: (...args) => world.reports.creditUsage(...args) },
    users: options.users,
  };
}

function buildWorld(now, { state, users }) {
  const iso = ms => new Date(ms).toISOString();
  const at = minutes => iso(now + minutes * MINUTE);
  const catalogData = BILLING.catalog;
  const settings = structuredClone(BILLING.settings);
  const free = { creditsPerWindow: 60, windowHours: 5 };
  const catalog = () => ({ ...structuredClone(catalogData), free, paymentsOpen: settings.paymentsOpen });
  const plans = Object.fromEntries(catalogData.plans.map(plan => [plan.id, plan]));
  const networks = Object.fromEntries(BILLING.networks.map(network => [network.id, network]));
  const current = () => (state.account === "free" ? users.free : state.account === "newcomer" ? users.newcomer : users.operator);

  // ---- Orders ----
  const rows = [];
  /**
   * One order. Minutes are relative to now (negative: past). events: [status, actor, note, minutes].
   * The customer's view leaves out the operator's notes, as the server's does.
   */
  const order = spec => {
    const { code, user, plan = null, topUp = null, network = null, coin = null, amount = null, quote = null, status, detail = null, created, quoted = null, expires, submitted = null, completed = null, tx = null, received = null, confirmations = null, required = null, applied = null, events, admin = {} } = spec;
    const offer = plan ? plans[plan] : null;
    const info = network ? networks[network] : null;
    const expiresMs = now + expires * MINUTE;
    const lateUntil = expiresMs + BILLING.lateSubmitHours * HOUR;
    const view = {
      code, kind: plan ? "plan" : "api", planId: plan,
      // The plan's terms as sold, frozen on the order (the server sends both, or null for a top-up).
      planDays: offer ? offer.days : null, planCreditsPerWindow: offer ? offer.creditsPerWindow : null,
      title: offer ? `${offer.name} · ${offer.days} days` : `API balance · $${topUp}`,
      listUsd: offer ? offer.listUsd : topUp, discountPercent: offer ? offer.discountPercent : 0, priceUsd: offer ? offer.priceUsd : topUp, creditUsd: offer ? null : topUp,
      network, coin, payAddress: info ? (info.family === "evm" ? EVM_WALLET : SOLANA_WALLET) : null, expectedAmount: amount, quoteUsdPrice: quote,
      txHash: tx, receivedAmount: received, status, statusDetail: detail, confirmations, requiredConfirmations: required,
      createdAt: at(created), quotedAt: quoted === null ? null : at(quoted), expiresAt: iso(expiresMs),
      submitUntil: info && ["awaiting_payment", "expired", "pending", "review"].includes(status) && lateUntil > now ? iso(lateUntil) : null,
      submittedAt: submitted === null ? null : at(submitted), completedAt: completed === null ? null : at(completed), applied,
      explorerUrl: info && tx ? `${info.explorer.tx}${tx}` : null,
      events: events.map(([to, actor, note, minutes]) => ({ status: to, actor, note, at: at(minutes) })),
    };
    const adminView = {
      ...view,
      user: { id: user.id, login: user.login, name: user.name },
      adminNote: admin.note ?? null, txFrom: admin.from ?? null, txBlockTime: admin.blockTime === undefined ? null : at(admin.blockTime),
      checkCount: admin.checks ?? 0, lastCheckedAt: admin.lastChecked === undefined ? null : at(admin.lastChecked), chainVerifiedAt: admin.verified === undefined ? null : at(admin.verified),
    };
    const customer = { ...view, events: view.events.map(event => (event.actor === "admin" ? { ...event, note: null } : event)) };
    rows.push({ code, user, customer, admin: adminView });
    return adminView;
  };
  const created = minutes => ["awaiting_payment", "customer", "Order created", minutes];
  const issued = (amount, coin, network, minutes) => ["awaiting_payment", "customer", `Payment details issued: exactly ${amount} ${coin} on ${networks[network].label}.`, minutes];
  const sent = minutes => ["pending", "customer", "Transaction hash submitted", minutes];
  const ada = users.free;

  // Ada's: one order in every status (several awaiting payment: up to five are allowed).
  order({ code: "CUR-7K3M9QXA", user: ada, plan: "max", status: "awaiting_payment", created: -2, expires: 28, events: [created(-2)] });
  order({
    code: "CUR-4HW2B8NZ", user: ada, plan: "pro", network: "bnb", coin: "USDT", amount: "2.0037", status: "awaiting_payment", created: -7, quoted: -6, expires: 24,
    events: [created(-7), issued("2.0037", "USDT", "bnb", -6)],
  });
  order({
    code: "CUR-9D5TQ2MC", user: ada, plan: "max", network: "ethereum", coin: "ETH", amount: "0.0023504", quote: 3412.18, status: "awaiting_payment", created: -4, quoted: -3, expires: 27,
    events: [created(-4), issued("0.0023504", "ETH", "ethereum", -3)],
  });
  order({
    code: "CUR-2VBN6HJP", user: ada, topUp: 25, network: "polygon", coin: "USDC", amount: "25.0061", status: "pending", detail: "Not on the network yet: a new transaction can take a minute to show up.", created: -16, quoted: -15, expires: 15, submitted: -0.7,
    tx: evmHash(5201), events: [created(-16), issued("25.0061", "USDC", "polygon", -15), sent(-0.7)], admin: { checks: 1, lastChecked: -0.6 },
  });
  order({
    code: "CUR-6YRC4KTD", user: ada, topUp: 10, network: "bnb", coin: "USDT", amount: "10.0084", status: "confirming", detail: "7 of 20 confirmations", created: -22, quoted: -21, expires: 9, submitted: -3,
    tx: evmHash(5202), received: "10.0084", confirmations: 7, required: 20,
    events: [created(-22), issued("10.0084", "USDT", "bnb", -21), sent(-3), ["confirming", "system", "2 of 20 confirmations", -2.6]],
    admin: { from: evmAddress(5302), blockTime: -2.7, checks: 6, lastChecked: -0.2 },
  });
  order({
    code: "CUR-3PZQ8WXE", user: ada, plan: "pro", network: "ethereum", coin: "USDT", amount: "2.0052", status: "review", created: -95, quoted: -94, expires: -64, submitted: -80,
    detail: "This transaction sent 1.9952 USDT to the Curialy wallet; this order expects exactly 2.0052 USDT.", tx: evmHash(5203), received: "1.9952",
    events: [created(-95), issued("2.0052", "USDT", "ethereum", -94), sent(-80), ["review", "system", "This transaction sent 1.9952 USDT to the Curialy wallet; this order expects exactly 2.0052 USDT.", -79]],
    admin: { from: evmAddress(5303), blockTime: -81, checks: 2, lastChecked: -79 },
  });
  const planStart = -(8 * 24 * 60 + 3 * 60);
  const planEnd = now + planStart * MINUTE + 30 * DAY;
  order({
    code: "CUR-8F2KMR5S", user: ada, plan: "pro", network: "solana", coin: "USDC", amount: "2.0042", status: "completed", created: planStart - 12, quoted: planStart - 11, expires: planStart + 19, submitted: planStart - 4,
    completed: planStart, tx: solanaSignature(5204), received: "2.0042", confirmations: 1, required: 1, applied: { planId: "pro", planExpiresAt: iso(planEnd), effect: "start" },
    events: [created(planStart - 12), issued("2.0042", "USDC", "solana", planStart - 11), sent(planStart - 4), ["confirming", "system", "Confirmed; waiting for the network to finalize it.", planStart - 3.5], ["completed", "system", "Verified on-chain and applied.", planStart]],
    admin: { from: draw(BASE58, 44, 5304), blockTime: planStart - 4.5, checks: 3, lastChecked: planStart, verified: planStart },
  });
  const topUpAt = -(5 * 24 * 60 + 110);
  order({
    code: "CUR-KX4D7GQB", user: ada, topUp: 25, network: "bnb", coin: "BNB", amount: "0.0408243", quote: 612.4, status: "completed", created: topUpAt - 14, quoted: topUpAt - 13, expires: topUpAt + 17, submitted: topUpAt - 6,
    completed: topUpAt, tx: evmHash(5205), received: "0.0408243", confirmations: 20, required: 20, applied: { apiBalanceAddedUsd: 25 },
    events: [created(topUpAt - 14), issued("0.0408243", "BNB", "bnb", topUpAt - 13), sent(topUpAt - 6), ["confirming", "system", "3 of 20 confirmations", topUpAt - 5], ["completed", "system", "Verified on-chain and applied.", topUpAt]],
    admin: { from: evmAddress(5305), blockTime: topUpAt - 6.5, checks: 9, lastChecked: topUpAt, verified: topUpAt },
  });
  const rejectedAt = -(2 * 24 * 60 + 4 * 60);
  const rejection = "The transaction paid a different wallet, so nothing reached the Curialy wallet. Start a new order and send it to the address its payment page shows.";
  order({
    code: "CUR-5GTX7NBH", user: ada, plan: "max", network: "polygon", coin: "POL", amount: "33.617", quote: 0.2381, status: "rejected", detail: rejection, created: rejectedAt - 70, quoted: rejectedAt - 69,
    expires: rejectedAt - 39, submitted: rejectedAt - 58, tx: evmHash(5206), received: "0",
    events: [created(rejectedAt - 70), issued("33.617", "POL", "polygon", rejectedAt - 69), sent(rejectedAt - 58), ["review", "system", "This transaction didn't send POL on Polygon to the Curialy wallet.", rejectedAt - 57], ["rejected", "admin", rejection, rejectedAt]],
    admin: { from: evmAddress(5306), blockTime: rejectedAt - 59, checks: 1, lastChecked: rejectedAt - 57, note: rejection },
  });
  order({
    code: "CUR-1QCW9ZRM", user: ada, plan: "pro", network: "solana", coin: "SOL", amount: "0.010763", quote: 186.2, status: "expired", created: -185, quoted: -184, expires: -154,
    events: [created(-185), issued("0.010763", "SOL", "solana", -184), ["expired", "system", "Expired without a payment", -153.5]],
  });
  order({ code: "CUR-0AXK4PEV", user: ada, topUp: 5, status: "expired", created: -(12 * 24 * 60), expires: -(12 * 24 * 60) + 30, events: [created(-(12 * 24 * 60)), ["expired", "system", "Expired without a payment", -(12 * 24 * 60) + 31]] });

  // Other accounts' (the operator's Payments tab).
  order({
    code: "CUR-W3NH8RZA", user: users.grace, plan: "max", network: "bnb", coin: "USDT", amount: "8.0071", status: "review", created: -52, quoted: -51, expires: -21, submitted: -48,
    detail: "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.", tx: evmHash(5207),
    events: [created(-52), issued("8.0071", "USDT", "bnb", -51), sent(-48), ["review", "system", "We couldn't find this transaction on BNB Chain after 30 minutes. Check the hash and the network.", -17]],
    admin: { checks: 7, lastChecked: -17 },
  });
  order({
    code: "CUR-T9BQ2XKM", user: users.hedy, topUp: 100, network: "solana", coin: "USDC", amount: "100.0023", status: "completed", created: -1460, quoted: -1459, expires: -1429, submitted: -1452, completed: -1450,
    tx: solanaSignature(5208), received: "100.0023", confirmations: 1, required: 1, applied: { apiBalanceAddedUsd: 100 },
    events: [created(-1460), issued("100.0023", "USDC", "solana", -1459), sent(-1452), ["completed", "system", "Verified on-chain and applied.", -1450]],
    admin: { from: draw(BASE58, 44, 5308), blockTime: -1452.5, checks: 2, lastChecked: -1450, verified: -1450 },
  });
  order({ code: "CUR-M6ZV4PQS", user: users.alan, plan: "pro", status: "awaiting_payment", created: -5, expires: 25, events: [created(-5)] });
  order({
    code: "CUR-E8RJ5WNY", user: users.margaret, plan: "max", network: "ethereum", coin: "ETH", amount: "0.0023417", quote: 3418.9, status: "completed", created: -4340, quoted: -4339, expires: -4309, submitted: -4331,
    completed: -4318, tx: evmHash(5209), received: "0.0023417", confirmations: 12, required: 12, applied: { planId: "max", planExpiresAt: iso(now + 27 * DAY), effect: "upgrade" },
    events: [created(-4340), issued("0.0023417", "ETH", "ethereum", -4339), sent(-4331), ["confirming", "system", "1 of 12 confirmations", -4330], ["completed", "system", "Verified on-chain and applied.", -4318]],
    admin: { from: evmAddress(5309), blockTime: -4331.5, checks: 14, lastChecked: -4318, verified: -4318 },
  });
  order({
    code: "CUR-H2TC6MVB", user: users.radia, topUp: 10, network: "ethereum", coin: "USDC", amount: "10.0019", status: "expired", created: -400, quoted: -399, expires: -369,
    events: [created(-400), issued("10.0019", "USDC", "ethereum", -399), ["expired", "system", "Expired without a payment", -368.5]],
  });
  const newest = list => [...list].sort((a, b) => Date.parse(b.admin.createdAt) - Date.parse(a.admin.createdAt));
  const ordersOf = user => newest(rows.filter(row => row.user.id === user.id));

  // ---- Accounts: plans and API wallets ----
  const planOf = {
    [ada.id]: { id: "pro", name: plans.pro.name, expiresAt: iso(planEnd), creditsPerWindow: plans.pro.creditsPerWindow },
    [users.margaret.id]: { id: "max", name: plans.max.name, expiresAt: iso(now + 27 * DAY), creditsPerWindow: plans.max.creditsPerWindow },
  };
  const wallet = (balanceUsd, reservedUsd = 0, reservedTokens = 0, running = 0) => {
    const balanceMicros = Math.round(balanceUsd * MICROS);
    const reservedMicros = Math.round(reservedUsd * MICROS);
    return { balanceMicros, reservedMicros, reservedTokens, requestsInFlight: running, availableMicros: Math.max(0, balanceMicros - reservedMicros) };
  };
  const wallets = {
    [ada.id]: wallet(18.42, 1.2846, 214_336, 2),
    [users.hedy.id]: wallet(87.65),
    [users.radia.id]: wallet(4.5),
  };
  const walletOf = user => wallets[user.id] ?? wallet(0);
  const ledgers = {
    [ada.id]: [
      { kind: "adjust", amountUsd: -1.5, balanceAfterUsd: 22.71, orderCode: null, note: "Reversed a duplicate refund", at: at(-(2 * 24 * 60 + 35)) },
      { kind: "topup", amountUsd: 25, balanceAfterUsd: 25.84, orderCode: "CUR-KX4D7GQB", note: "order CUR-KX4D7GQB", at: at(topUpAt) },
      { kind: "refund", amountUsd: 0.38, balanceAfterUsd: 1.12, orderCode: null, note: "A streamed reply failed before any content", at: at(-(9 * 24 * 60 + 200)) },
      { kind: "grant", amountUsd: 5, balanceAfterUsd: 5, orderCode: null, note: "Developer API beta: welcome credit", at: at(-(27 * 24 * 60 + 90)) },
    ],
    [users.hedy.id]: [{ kind: "topup", amountUsd: 100, balanceAfterUsd: 100, orderCode: "CUR-T9BQ2XKM", note: "order CUR-T9BQ2XKM", at: at(-1450) }],
    [users.radia.id]: [{ kind: "grant", amountUsd: 5, balanceAfterUsd: 5, orderCode: null, note: "Conference talk", at: at(-(6 * 24 * 60)) }],
  };
  const billingAccount = user => ({ plan: planOf[user.id] ?? null, apiWallet: user.id === users.operator.id ? wallet(0) : walletOf(user), operator: user.id === users.operator.id });
  const adminAccount = user => ({ plan: planOf[user.id] ?? null, apiWallet: walletOf(user), orders: ordersOf(user).map(row => ({ ...row.admin, events: [] })), ledger: ledgers[user.id] ?? [] });
  const userById = id => Object.values(users).find(user => user.id === id) ?? null;

  // ---- Usage reports ----
  const charged = user => user.id !== users.operator.id;
  const apiAccountDays = user => (user.id === ada.id || user.id === users.operator.id ? Infinity : 0);
  function apiUsage(user, range, tz) {
    const timeZone = zoneOf(tz);
    const { bucket, starts } = bucketStarts(range, timeZone, now);
    const wall = wallClock(now, timeZone);
    const dayFraction = Math.max(0.05, (wall.h * 60 + wall.min) / 1440);
    const percentOff = catalogData.discount.apiPercent;
    const today = localMidnight(wall.y, wall.m, wall.d, timeZone);
    const byModel = new Map(MODEL_MIX.map(mix => [mix.model, zeroTotals()]));
    const buckets = starts.map((start, index) => {
      const daysAgo = Math.round((today - localMidnight(...Object.values(wallClock(start, timeZone)).slice(0, 3), timeZone)) / DAY);
      const active = apiAccountDays(user) > 0;
      let requests = active ? apiRequestsOnDay(daysAgo, weekdayOf(start, timeZone), dayFraction) : 0;
      if (bucket === "hour") {
        // The day's requests spread over its hours; the current hour so far.
        const hour = wallClock(start, timeZone).h;
        const elapsed = index === starts.length - 1 ? Math.max(0.1, wall.min / 60) : 1;
        requests = active ? Math.round((apiRequestsOnDay(daysAgo, weekdayOf(start, timeZone), 1) * HOUR_PROFILE[hour] * elapsed) / PROFILE_SUM) : 0;
      }
      const totals = zeroTotals();
      MODEL_MIX.forEach((mix, column) => {
        const next = rng(31 * (bucket === "hour" ? 1000 + index : daysAgo) + column);
        const share = requests ? Math.round(requests * mix.share * (0.75 + 0.5 * next())) : 0;
        const usage = modelUsage(mix, share, 977 * (daysAgo + 1) + 13 * column + (bucket === "hour" ? index * 7919 : 0), percentOff, charged(user));
        addTotals(totals, usage);
        addTotals(byModel.get(mix.model), usage);
      });
      return { start: iso(start), ...totals };
    });
    const totals = buckets.reduce((sum, entry) => addTotals(sum, { requests: entry.requests, inputTokens: entry.inputTokens, outputTokens: entry.outputTokens, cacheReadTokens: entry.cacheReadTokens, cacheWriteTokens: entry.cacheWriteTokens, costMicros: entry.costMicros, listMicros: entry.listMicros }), zeroTotals());
    // By key: the production app most, staging some; the revoked key and a deleted one only in the longer ranges.
    const keyShares = range === "30d" || range === "90d"
      ? [["key-production", 0.68], ["key-staging", 0.24], ["key-old-cli", 0.06], [null, 0.02]]
      : [["key-production", 0.74], ["key-staging", 0.26]];
    const keyRows = totals.requests === 0 ? [] : keyShares.map(([keyId, share], position) => {
      const row = Object.fromEntries(Object.keys(totals).map(field => [field, Math.floor(totals[field] * share)]));
      if (position === 0) for (const field of Object.keys(totals)) row[field] += totals[field] - keyShares.reduce((sum, [, other]) => sum + Math.floor(totals[field] * other), 0);
      const key = KEYS.find(entry => entry.id === keyId);
      return { keyId, name: key?.name ?? null, prefix: key?.prefix ?? null, ...row };
    });
    return {
      range, bucket, timeZone, buckets,
      byModel: [...byModel].filter(([, sum]) => sum.requests > 0).map(([model, sum]) => ({ model, ...sum })),
      byKey: keyRows,
      totals,
    };
  }
  function creditUsage(user, range, tz) {
    const timeZone = zoneOf(tz);
    const { bucket, starts } = bucketStarts(range, timeZone, now);
    const wall = wallClock(now, timeZone);
    const today = localMidnight(wall.y, wall.m, wall.d, timeZone);
    const profile = user.id === ada.id
      ? { planSinceDays: 8, accountDays: 41, freeAllowancePerDay: 288 }
      : user.id === users.newcomer.id ? { planSinceDays: null, accountDays: 6, freeAllowancePerDay: 140 } : { planSinceDays: null, accountDays: 0, freeAllowancePerDay: 0 };
    const buckets = starts.map((start, index) => {
      const daysAgo = Math.round((today - localMidnight(...Object.values(wallClock(start, timeZone)).slice(0, 3), timeZone)) / DAY);
      const day = creditsOnDay(daysAgo, weekdayOf(start, timeZone), profile);
      if (bucket === "hour") {
        const hour = wallClock(start, timeZone).h;
        const elapsed = index === starts.length - 1 ? Math.max(0.1, wall.min / 60) : 1;
        const part = (HOUR_PROFILE[hour] * elapsed) / PROFILE_SUM;
        return { start: iso(start), credits: Math.round(day.credits * part * 10) / 10, runs: Math.round(day.runs * part) };
      }
      return { start: iso(start), ...day };
    });
    const plan = planOf[user.id];
    return {
      range, bucket, timeZone, buckets,
      totals: { credits: Math.round(buckets.reduce((sum, entry) => sum + entry.credits, 0) * 10) / 10, runs: buckets.reduce((sum, entry) => sum + entry.runs, 0) },
      allowance: user.id === users.operator.id ? 0 : plan ? Math.max(plan.creditsPerWindow, free.creditsPerWindow) : free.creditsPerWindow,
      windowHours: free.windowHours,
    };
  }

  // ---- Developer API keys (shared/gateway.ts ApiKeyInfo) ----
  const KEYS = [
    { id: "key-production", name: "Production app", prefix: "cur_live_3f9a", allowedModels: [...BILLING.gatewayModelIds], status: "active", createdAt: at(-(12 * 24 * 60)), lastUsedAt: at(-4) },
    { id: "key-staging", name: "Staging · invoice summariser", prefix: "cur_live_8c1e", allowedModels: ["claude-sonnet-5-5", "claude-haiku-5-5", "openai-gpt-5.4", "glm-5.3"], status: "active", createdAt: at(-(6 * 24 * 60)), lastUsedAt: at(-125) },
    { id: "key-old-cli", name: "Old CLI experiments", prefix: "cur_live_b27d", allowedModels: ["claude-opus-5-5"], status: "revoked", createdAt: at(-(28 * 24 * 60)), lastUsedAt: at(-(15 * 24 * 60)) },
  ];
  const keysOf = user => (user.id === ada.id ? KEYS : []);

  // ---- The operator's views ----
  const counts = () => Object.fromEntries(STATUSES.map(status => [status, rows.filter(row => row.admin.status === status).length]));
  const revenue = days => rows.filter(row => row.admin.status === "completed" && (days === null || Date.parse(row.admin.completedAt) > now - days * DAY)).reduce((sum, row) => sum + row.admin.priceUsd, 0);
  const overview = () => ({
    counts: counts(),
    revenue: { last7dUsd: revenue(7), last30dUsd: revenue(30), totalUsd: revenue(null) },
    subscribers: { pro: Object.values(planOf).filter(plan => plan.id === "pro").length, max: Object.values(planOf).filter(plan => plan.id === "max").length },
    apiBalanceTotalUsd: Object.values(wallets).reduce((sum, entry) => sum + entry.balanceMicros, 0) / MICROS,
    wallets: { evm: EVM_WALLET, solana: SOLANA_WALLET },
    alerts: false,
    settings,
  });
  // Read from the chains a few seconds ago: some coins at zero, Polygon unreachable, one balance unread.
  const walletBalances = () => ({
    checkedAt: iso(now - 12_000),
    networks: BILLING.networks.map(network => {
      const address = network.family === "evm" ? EVM_WALLET : SOLANA_WALLET;
      const held = { ethereum: ["0", "38.0042", "0.0141893"], bnb: ["126.0219", "0", "0.0816486"], polygon: [null, null, null], solana: [null, "152.0288", "1.204381"] }[network.id];
      return { network: network.id, label: network.label, address, explorerUrl: `${network.explorer.address}${address}`, coins: network.coins.map((coin, index) => ({ coin: coin.coin, amount: held[index] })), unavailable: network.id === "polygon" };
    }),
  });
  const PAGE = 50;
  function adminOrders(query) {
    const status = query.get("status") || "all";
    if (status !== "all" && status !== "attention" && !STATUSES.includes(status)) return { status: 400, expected: true, json: { error: "Unknown status.", code: "invalid_status" } };
    const q = (query.get("q") ?? "").trim().toLowerCase();
    const offset = Math.max(0, Number(query.get("offset")) || 0);
    const matching = newest(rows).filter(row => (status === "all" || row.admin.status === (status === "attention" ? "review" : status))
      && (!q || [row.code, row.user.login ?? "", row.admin.txHash ?? ""].some(value => value.toLowerCase().includes(q))));
    return { json: { orders: matching.slice(offset, offset + PAGE).map(row => row.admin), more: matching.length > offset + PAGE } };
  }
  const adminOrder = code => rows.find(row => row.code === code) ?? null;
  const notFound = message => ({ status: 404, expected: true, json: { error: message, code: "not_found" } });

  // POSTs answer like the server would (no check performs one; they keep a stray click harmless).
  const issue = (row, network, coin) => {
    const info = networks[network];
    const entry = info?.coins.find(item => item.coin === coin);
    if (!info || !entry) return { status: 400, expected: true, json: { error: "That coin isn't offered on that network.", code: "method_unavailable" } };
    const amount = entry.kind === "stablecoin" ? `${row.customer.priceUsd}.0029` : "0.0012345";
    return { json: { order: { ...row.customer, network, coin, payAddress: info.family === "evm" ? EVM_WALLET : SOLANA_WALLET, expectedAmount: amount, quotedAt: iso(now), expiresAt: iso(now + BILLING.orderTtlMinutes * MINUTE), submitUntil: iso(now + BILLING.orderTtlMinutes * MINUTE + BILLING.lateSubmitHours * HOUR) } } };
  };

  const routes = [
    ["GET", "/api/billing/catalog", () => ({ json: catalog() }), { public: true }],
    ["GET", "/api/billing/account", () => ({ json: billingAccount(current()) })],
    ["GET", "/api/billing/orders", () => ({ json: { orders: ordersOf(current()).map(row => row.customer) } })],
    ["POST", "/api/billing/orders", ({ body }) => {
      const plan = body?.kind === "plan" ? plans[body.planId] : null;
      const topUp = body?.kind === "api" ? body.amountUsd : null;
      if (!plan && !(Number.isInteger(topUp) && topUp >= catalogData.apiTopup.minUsd && topUp <= catalogData.apiTopup.maxUsd)) return { status: 400, expected: true, json: { error: "Choose a plan or an API top-up.", code: "invalid_request" } };
      // An open order for the same thing without details is handed back (as the server does).
      const existing = ordersOf(current()).find(row => row.customer.status === "awaiting_payment" && !row.customer.network && (plan ? row.customer.planId === plan.id : row.customer.creditUsd === topUp));
      if (existing) return { json: { order: existing.customer } };
      const fresh = {
        code: "CUR-NEW0RD3R", kind: plan ? "plan" : "api", planId: plan?.id ?? null, title: plan ? `${plan.name} · ${plan.days} days` : `API balance · $${topUp}`,
        listUsd: plan ? plan.listUsd : topUp, discountPercent: plan ? plan.discountPercent : 0, priceUsd: plan ? plan.priceUsd : topUp, creditUsd: plan ? null : topUp,
        network: null, coin: null, payAddress: null, expectedAmount: null, quoteUsdPrice: null, txHash: null, receivedAmount: null, status: "awaiting_payment", statusDetail: null,
        confirmations: null, requiredConfirmations: null, createdAt: iso(now), quotedAt: null, expiresAt: iso(now + BILLING.orderTtlMinutes * MINUTE), submitUntil: null,
        submittedAt: null, completedAt: null, applied: null, explorerUrl: null, events: [{ status: "awaiting_payment", actor: "customer", note: "Order created", at: iso(now) }],
      };
      return { status: 201, json: { order: fresh } };
    }],
    ["GET", "/api/billing/orders/:code", ({ params }) => {
      const row = ordersOf(current()).find(entry => entry.code === params.code);
      return row ? { json: { order: row.customer } } : notFound("No order with that code on this account.");
    }],
    ["POST", "/api/billing/orders/:code/method", ({ params, body }) => {
      const row = ordersOf(current()).find(entry => entry.code === params.code);
      if (!row) return notFound("No order with that code on this account.");
      if (row.customer.network) return { status: 409, expected: true, json: { error: "Payment details were already issued for another network or coin. Start a new order to pay another way.", code: "details_locked" } };
      return issue(row, body?.network, body?.coin);
    }],
    ["POST", "/api/billing/orders/:code/submit", ({ params, body }) => {
      const row = ordersOf(current()).find(entry => entry.code === params.code);
      if (!row) return notFound("No order with that code on this account.");
      if (!row.customer.network) return { status: 409, expected: true, json: { error: "Choose a network and coin first.", code: "no_details" } };
      return { json: { order: { ...row.customer, txHash: String(body?.txHash ?? ""), status: "pending", statusDetail: "Not on the network yet: a new transaction can take a minute to show up.", submittedAt: iso(now) } } };
    }],
    ["GET", "/api/billing/api/usage", ({ query }) => {
      const range = query.get("range");
      if (!["24h", "7d", "30d", "90d"].includes(range)) return { status: 400, expected: true, json: { error: "The range is one of 24h, 7d, 30d, 90d.", code: "invalid_range" } };
      return { json: apiUsage(current(), range, query.get("tz")) };
    }],
    ["GET", "/api/billing/credits/usage", ({ query }) => {
      const range = query.get("range");
      if (!["24h", "7d", "30d", "90d"].includes(range)) return { status: 400, expected: true, json: { error: "The range is one of 24h, 7d, 30d, 90d.", code: "invalid_range" } };
      return { json: creditUsage(current(), range, query.get("tz")) };
    }],

    ["GET", "/api/admin/billing/overview", () => ({ json: overview() })],
    ["GET", "/api/admin/billing/wallets", () => ({ json: walletBalances() })],
    ["GET", "/api/admin/billing/orders", ({ query }) => adminOrders(query)],
    ["GET", "/api/admin/billing/orders/:code", ({ params }) => {
      const row = adminOrder(params.code);
      return row ? { json: { order: row.admin } } : notFound("No order has that code.");
    }],
    ["POST", "/api/admin/billing/orders/:code/recheck", ({ params }) => {
      const row = adminOrder(params.code);
      return row ? { json: { order: { ...row.admin, checkCount: row.admin.checkCount + 1, lastCheckedAt: iso(now) } } } : notFound("No order has that code.");
    }],
    ["POST", "/api/admin/billing/orders/:code/approve", ({ params, body }) => {
      const row = adminOrder(params.code);
      if (!row) return notFound("No order has that code.");
      const applied = row.admin.kind === "api" ? { apiBalanceAddedUsd: row.admin.creditUsd } : { planId: row.admin.planId, planExpiresAt: iso(now + 30 * DAY), effect: "start" };
      return { json: { order: { ...row.admin, status: "completed", statusDetail: null, completedAt: iso(now), applied, adminNote: body?.note || null } } };
    }],
    ["POST", "/api/admin/billing/orders/:code/reject", ({ params, body }) => {
      const row = adminOrder(params.code);
      if (!row) return notFound("No order has that code.");
      if (!String(body?.note ?? "").trim()) return { status: 400, expected: true, json: { error: "Say why the order is rejected.", code: "note_required" } };
      return { json: { order: { ...row.admin, status: "rejected", statusDetail: body.note, adminNote: body.note } } };
    }],
    ["GET", "/api/admin/billing/settings", () => ({ json: { settings } })],
    ["PUT", "/api/admin/billing/settings", ({ body }) => {
      const patch = body ?? {};
      const next = {
        plans: { pro: { ...settings.plans.pro, ...(patch.plans?.pro ?? {}) }, max: { ...settings.plans.max, ...(patch.plans?.max ?? {}) } },
        discount: { ...settings.discount, ...(patch.discount ?? {}) },
        paymentsOpen: patch.paymentsOpen ?? settings.paymentsOpen,
        autoVerify: patch.autoVerify ?? settings.autoVerify,
      };
      return { json: { settings: next } };
    }],
    ["GET", "/api/admin/billing/users/:id", ({ params }) => {
      const user = userById(params.id);
      return user ? { json: adminAccount(user) } : notFound("Account not found.");
    }],
    ["POST", "/api/admin/billing/users/:id/plan", ({ params }) => {
      const user = userById(params.id);
      return user ? { json: adminAccount(user) } : notFound("Account not found.");
    }],
    ["DELETE", "/api/admin/billing/users/:id/plan", ({ params }) => {
      const user = userById(params.id);
      return user ? { json: { ...adminAccount(user), plan: null } } : notFound("Account not found.");
    }],
    ["POST", "/api/admin/billing/users/:id/api-balance", ({ params }) => {
      const user = userById(params.id);
      return user ? { json: adminAccount(user) } : notFound("Account not found.");
    }],

    ["GET", "/api/keys", () => ({ json: { keys: keysOf(current()) } })],
    ["POST", "/api/keys", ({ body }) => ({ status: 201, json: { key: { id: "key-new", name: String(body?.name ?? "New key"), prefix: "cur_live_51d0", allowedModels: Array.isArray(body?.models) ? body.models : [], status: "active", createdAt: iso(now), lastUsedAt: null }, secret: `cur_live_51d0${draw(HEX, 28, 5401)}` } })],
    ["DELETE", "/api/keys/:id", ({ params }) => {
      const key = keysOf(current()).find(entry => entry.id === params.id);
      return key ? { json: { key: { ...key, status: "revoked" } } } : notFound("No key with that id.");
    }],
  ];

  const payStates = [
    { key: "choose", code: "CUR-7K3M9QXA", action: "pick-method" },
    { key: "usdt", code: "CUR-4HW2B8NZ" },
    { key: "eth", code: "CUR-9D5TQ2MC" },
    { key: "pending", code: "CUR-2VBN6HJP" },
    { key: "confirming", code: "CUR-6YRC4KTD" },
    { key: "review", code: "CUR-3PZQ8WXE" },
    { key: "completed", code: "CUR-8F2KMR5S" },
    { key: "rejected", code: "CUR-5GTX7NBH" },
    { key: "expired", code: "CUR-1QCW9ZRM" },
    { key: "unknown", code: UNKNOWN_ORDER_CODE, short: true },
  ];

  return {
    routes,
    payStates,
    reviewOrderCode: "CUR-3PZQ8WXE",
    planOf: user => planOf[user.id] ?? null,
    apiBalanceUsd: user => walletOf(user).balanceMicros / MICROS,
    data: {
      catalog: catalog(), settings, overview: overview(), walletBalances: walletBalances(), keys: KEYS, ledgers,
      orders: rows.map(row => row.admin), customerOrders: rows.map(row => row.customer),
      accounts: Object.fromEntries(Object.entries(users).map(([name, user]) => [name, billingAccount(user)])),
      usage: { api: apiUsage(ada, "30d", "UTC"), credits: creditUsage(ada, "30d", "UTC") },
    },
    // For the dry run's checks.
    reports: { apiUsage, creditUsage },
    users,
  };
}
