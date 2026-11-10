// Live USD prices of the networks' own coins (ETH, BNB, POL, SOL), for quoting an exact amount that
// stays locked for an order's window. Four public sources are asked at once; a quote needs two that
// agree within 2% of their median, so one wrong or stale source can't set a price. Stablecoins need
// none of this (one USDT or USDC is paid per dollar).

export type NativeCoin = "ETH" | "BNB" | "POL" | "SOL";

const GECKO_IDS: Record<NativeCoin, string> = { ETH: "ethereum", BNB: "binancecoin", POL: "polygon-ecosystem-token", SOL: "solana" };
const TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;
/** Sources must agree within this fraction of their median. */
const AGREEMENT = 0.02;

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Each source answers with a USD price for the coin (NaN or an error when it has none). */
const SOURCES: ((coin: NativeCoin) => Promise<number>)[] = [
  async coin => Number((await getJson(`https://api.coinbase.com/v2/prices/${coin}-USD/spot`)).data?.amount),
  async coin => {
    const body = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${coin}USD`);
    if (body.error?.length) throw new Error("no such pair");
    // The result is keyed by the pair's own name (ETH's is XETHZUSD): the first entry, last trade price.
    const first = Object.values(body.result ?? {})[0] as { c?: string[] } | undefined;
    return Number(first?.c?.[0]);
  },
  async coin => Number((await getJson(`https://api.binance.com/api/v3/ticker/price?symbol=${coin}USDT`)).price),
  async coin => Number((await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(GECKO_IDS).join(",")}&vs_currencies=usd`))[GECKO_IDS[coin]]?.usd),
];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The median of the prices that agree within 2% of the median of all of them, or null with fewer than two such. */
export function agreedPrice(prices: number[]): number | null {
  if (prices.length < 2) return null;
  const middle = median(prices);
  const agreeing = prices.filter(price => Math.abs(price - middle) <= middle * AGREEMENT);
  return agreeing.length >= 2 ? median(agreeing) : null;
}

const cache = new Map<NativeCoin, { at: number; price: number }>();
const pending = new Map<NativeCoin, Promise<number | null>>();

async function fetchQuote(coin: NativeCoin) {
  const answers = await Promise.allSettled(SOURCES.map(source => source(coin)));
  const prices = answers.flatMap(answer => (answer.status === "fulfilled" && Number.isFinite(answer.value) && answer.value > 0 ? [answer.value] : []));
  const price = agreedPrice(prices);
  if (price === null) {
    console.warn(`[Curialy Billing] No reliable ${coin} price right now (${prices.length} of ${SOURCES.length} sources answered${prices.length >= 2 ? ", and they disagree" : ""}).`);
    return null;
  }
  cache.set(coin, { at: Date.now(), price });
  return price;
}

/** The coin's USD price (cached for a minute), or null when there is no trustworthy one right now. */
export function quoteUsd(coin: NativeCoin): Promise<number | null> {
  const hit = cache.get(coin);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.price);
  // Orders arriving together share one round of requests.
  let inFlight = pending.get(coin);
  if (!inFlight) {
    inFlight = fetchQuote(coin).finally(() => pending.delete(coin));
    pending.set(coin, inFlight);
  }
  return inFlight;
}

/** Tests: forget cached quotes. */
export function resetPrices() {
  cache.clear();
  pending.clear();
}
