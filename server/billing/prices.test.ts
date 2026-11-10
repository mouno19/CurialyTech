import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreedPrice, quoteUsd, resetPrices } from "./prices";

// Live quotes for the networks' own coins: the median of the sources that agree, never a price one
// source alone sets, nothing when they can't agree, and a minute's cache.

type Quotes = { coinbase?: number | "error"; kraken?: number | "error"; binance?: number | "error"; gecko?: number | "error" };
const calls: { url: string; signal: unknown }[] = [];
let quotes: Quotes = {};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  resetPrices();
  calls.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, signal: init.signal });
    const coin = /prices\/(\w+)-USD|pair=(\w+)USD|symbol=(\w+)USDT/.exec(url)?.slice(1).find(Boolean);
    const answer = (value: number | "error" | undefined, body: () => unknown) => (value === undefined || value === "error" ? json({ message: "unavailable" }, 503) : json(body()));
    if (url.startsWith("https://api.coinbase.com/")) return answer(quotes.coinbase, () => ({ data: { amount: String(quotes.coinbase), base: coin, currency: "USD" } }));
    if (url.startsWith("https://api.kraken.com/")) return answer(quotes.kraken, () => ({ error: [], result: { [coin === "ETH" ? "XETHZUSD" : `${coin}USD`]: { a: ["1"], c: [String(quotes.kraken), "0.5"] } } }));
    if (url.startsWith("https://api.binance.com/")) return answer(quotes.binance, () => ({ symbol: `${coin}USDT`, price: String(quotes.binance) }));
    if (url.startsWith("https://api.coingecko.com/")) return answer(quotes.gecko, () => ({ ethereum: { usd: quotes.gecko }, solana: { usd: quotes.gecko }, binancecoin: { usd: quotes.gecko }, "polygon-ecosystem-token": { usd: quotes.gecko } }));
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a quote", () => {
  it("is the median of four sources that agree, asked at once with a timeout each", async () => {
    quotes = { coinbase: 3000, kraken: 3010.5, binance: 2995, gecko: 3005 };
    expect(await quoteUsd("ETH")).toBe(3002.5);
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
    // ETH's Kraken pair is named XETHZUSD: the first entry is read whatever its name.
    expect(calls.map(call => new URL(call.url).host).sort()).toEqual(["api.binance.com", "api.coinbase.com", "api.coingecko.com", "api.kraken.com"]);
  });

  it("drops a source that is far from the others", async () => {
    quotes = { coinbase: 150, kraken: 151, binance: 149.5, gecko: 190 };
    expect(await quoteUsd("SOL")).toBe(150);
  });

  it("is refused when the sources disagree, or fewer than two answer", async () => {
    quotes = { coinbase: 600, kraken: 640, binance: 560, gecko: 700 };
    expect(await quoteUsd("BNB")).toBeNull();
    resetPrices();
    quotes = { coinbase: 0.25, kraken: "error", binance: "error", gecko: "error" };
    expect(await quoteUsd("POL")).toBeNull();
    // Two that agree are enough.
    resetPrices();
    quotes = { coinbase: 0.25, kraken: 0.2505, binance: "error", gecko: "error" };
    expect(await quoteUsd("POL")).toBeCloseTo(0.25025, 10);
  });

  it("ignores answers that aren't prices, and a source that throws", async () => {
    quotes = { coinbase: Number.NaN, kraken: -5, binance: 3000, gecko: 3001 };
    expect(await quoteUsd("ETH")).toBe(3000.5);
    resetPrices();
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const host = new URL(String(input)).host;
      if (host === "api.kraken.com") throw new TypeError("fetch failed");
      if (host === "api.binance.com") return json({ code: 0, msg: "Service unavailable from a restricted location" }, 451);
      return host === "api.coinbase.com" ? json({ data: { amount: "3000" } }) : json({ ethereum: { usd: 3010 } });
    });
    expect(await quoteUsd("ETH")).toBe(3005);
  });

  it("is cached for a minute per coin, and orders arriving together share one round", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    quotes = { coinbase: 3000, kraken: 3000, binance: 3000, gecko: 3000 };
    const [first, second] = await Promise.all([quoteUsd("ETH"), quoteUsd("ETH")]);
    expect([first, second]).toEqual([3000, 3000]);
    expect(calls).toHaveLength(4);
    quotes = { coinbase: 3100, kraken: 3100, binance: 3100, gecko: 3100 };
    vi.advanceTimersByTime(59_000);
    expect(await quoteUsd("ETH")).toBe(3000);
    expect(calls).toHaveLength(4);
    // Another coin is its own quote.
    expect(await quoteUsd("SOL")).toBe(3100);
    vi.advanceTimersByTime(2_000);
    expect(await quoteUsd("ETH")).toBe(3100);
    expect(calls).toHaveLength(12);
  });
});

describe("agreement", () => {
  it("needs two prices within 2% of the median of all of them", () => {
    expect(agreedPrice([])).toBeNull();
    expect(agreedPrice([100])).toBeNull();
    expect(agreedPrice([100, 101])).toBe(100.5);
    expect(agreedPrice([100, 104.5])).toBeNull();
    expect(agreedPrice([100, 150, 200])).toBeNull();
    expect(agreedPrice([100, 101, 102, 150])).toBe(101);
  });
});
