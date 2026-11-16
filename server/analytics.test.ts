import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Analytics: what a page view keeps (no IP address, a visitor hash that changes daily, the page as
// a route, where the visit came from, the device, the country from the time zone), bots and the
// operator kept out, time on the page, and the usage ledger's estimate at list prices.

process.env.SESSION_SECRET = "test-session-secret";

const state = vi.hoisted(() => ({ statements: [] as { text: string; values: any[] }[], user: null as null | { id: string; role: "admin" | "user" } }));

vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: any[] = []) => {
    state.statements.push({ text: text.replace(/\s+/g, " ").trim(), values });
    return { rows: [], rowCount: 1 };
  }),
}));
vi.mock("./auth", async importOriginal => {
  const actual = await importOriginal<typeof import("./auth")>();
  return { ...actual, currentUser: async () => state.user, rateLimited: () => false };
});

const track = await import("./analytics/track");
const geo = await import("./analytics/geo");
const usage = await import("./analytics/usage");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/analytics", track.analyticsCollectRouter());
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/analytics`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  state.statements = [];
  state.user = null;
});

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const post = (path: string, body: unknown, ua = CHROME) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: JSON.stringify(body) });
const settled = async () => {
  for (let i = 0; i < 50 && !state.statements.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
};

describe("what a page view keeps", () => {
  it("records pages as routes", () => {
    expect(track.pageOf("/tasks/1b2c3d4e-0000-4000-8000-000000000001?x=1")).toBe("/tasks/:id");
    expect(track.pageOf("/pay/CUR-ABC123")).toBe("/pay/:code");
    expect(track.pageOf("/p/abc/index.html")).toBe("/p/:id");
    expect(track.pageOf("/docs/")).toBe("/docs");
    expect(track.pageOf("/")).toBe("/");
  });

  it("names where a visit came from: campaign, referral code, a known site, another site, or direct", () => {
    expect(track.sourceOf({ utmSource: "Newsletter", referrer: "https://www.google.com/" }, "curialy.tech").source).toBe("newsletter");
    expect(track.sourceOf({ ref: "mouno19" }, "curialy.tech").source).toBe("ref:MOUNO19");
    expect(track.sourceOf({ referrer: "https://www.google.co.uk/search?q=curialy" }, "curialy.tech")).toEqual({ source: "Google", referrerHost: "google.co.uk" });
    expect(track.sourceOf({ referrer: "https://t.co/abc" }, "curialy.tech").source).toBe("X");
    expect(track.sourceOf({ referrer: "https://blog.example.org/post" }, "curialy.tech").source).toBe("blog.example.org");
    expect(track.sourceOf({ referrer: "https://curialy.tech/docs" }, "curialy.tech").source).toBe("direct");
    expect(track.sourceOf({}, "curialy.tech").source).toBe("direct");
  });

  it("reads the device, browser and system", () => {
    expect(track.deviceOf(CHROME)).toEqual({ device: "Desktop", browser: "Chrome", os: "Windows" });
    expect(track.deviceOf(IPHONE)).toEqual({ device: "Mobile", browser: "Safari", os: "iOS" });
    expect(track.deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Edg/141.0").browser).toBe("Edge");
  });

  it("knows a visitor for one day only", () => {
    expect(track.visitorHash("1.2.3.4", CHROME, "2026-11-14")).toBe(track.visitorHash("1.2.3.4", CHROME, "2026-11-14"));
    expect(track.visitorHash("1.2.3.4", CHROME, "2026-11-15")).not.toBe(track.visitorHash("1.2.3.4", CHROME, "2026-11-14"));
    expect(track.visitorHash("1.2.3.5", CHROME, "2026-11-14")).not.toBe(track.visitorHash("1.2.3.4", CHROME, "2026-11-14"));
    expect(track.visitorHash("1.2.3.4", CHROME, "2026-11-14")).toMatch(/^[0-9a-f]{20}$/);
  });

  it("reads the country from the time zone (old names too), else the language's region", () => {
    expect(geo.countryForZone("Asia/Dhaka")).toBe("BD");
    expect(geo.countryForZone("Asia/Calcutta")).toBe("IN");
    expect(geo.countryForZone("America/New_York")).toBe("US");
    expect(geo.countryForZone("Europe/Berlin")).toBe("DE");
    expect(geo.countryForZone("UTC")).toBeNull();
    expect(geo.countryForZone("../etc/passwd")).toBeNull();
    expect(geo.countryForLanguage("en-GB")).toBe("GB");
    expect(geo.countryForLanguage("en")).toBeNull();
    expect(geo.countryName("BD")).toBe("Bangladesh");
  });
});

describe("collecting", () => {
  const hit = { viewId: "abcdefghijklmnop", path: "/docs?utm_source=x", entry: true, referrer: "https://www.reddit.com/r/x", utmSource: null, timeZone: "Asia/Dhaka", language: "bn-BD", returning: false, width: 1280 };

  it("stores a view with no IP address, its page, source, country and device", async () => {
    expect((await post("/hit", hit)).status).toBe(204);
    await settled();
    const insert = state.statements.find(statement => statement.text.startsWith("INSERT INTO curialy.page_views"))!;
    const [viewId, visitor, returning, entry, userId, operator, path, page, source, referrerHost, , , country, device, browser, os, language] = insert.values;
    expect({ viewId, returning, entry, userId, operator, path, page, source, referrerHost, country, device, browser, os, language }).toEqual({
      viewId: "abcdefghijklmnop", returning: false, entry: true, userId: null, operator: false, path: "/docs", page: "/docs", source: "Reddit", referrerHost: "reddit.com", country: "BD", device: "Desktop", browser: "Chrome", os: "Windows", language: "bn-BD",
    });
    expect(visitor).toMatch(/^[0-9a-f]{20}$/);
    expect(JSON.stringify(insert.values)).not.toContain("127.0.0.1");
  });

  it("marks the operator's own views (left out of the reports) and keeps no source on later pages", async () => {
    state.user = { id: "admin-id", role: "admin" };
    await post("/hit", { ...hit, viewId: "operatorview1234", entry: false });
    await settled();
    const values = state.statements[0].values;
    expect(values[4]).toBe("admin-id");
    expect(values[5]).toBe(true);
    expect(values[8]).toBeNull();
  });

  it("drops bots, bad input and the site's own API paths", async () => {
    await post("/hit", hit, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
    await post("/hit", hit, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36");
    await post("/hit", { ...hit, viewId: "short" });
    await post("/hit", { ...hit, path: "/api/agent/tasks" });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(state.statements).toEqual([]);
  });

  it("records the time on a page once", async () => {
    await post("/leave", { viewId: "abcdefghijklmnop", ms: 42_000 });
    await settled();
    expect(state.statements[0]).toMatchObject({ values: ["abcdefghijklmnop", 42_000] });
    expect(state.statements[0].text).toContain("duration_ms IS NULL");
  });
});

describe("the usage ledger", () => {
  it("prices a turn at its model's list price; a relay route as its model; an unknown model not at all", () => {
    expect(usage.pricedModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(usage.pricedModel("r/claude-opus-4-6-thinking")).toBe("claude-opus-4-6");
    expect(usage.pricedModel("r/gemini-3.8-flash")).toBeNull();
    // 1M input at $2 and 100K output at $10 per million.
    expect(usage.listMicros("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBe(3_000_000);
    expect(usage.listMicros("ultramarine-1-flash", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it("records a turn with its account's plan, and no credits for the operator", async () => {
    await usage.recordAgentUsage("00000000-0000-4000-8000-000000000001", "claude-opus-5-5", { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50 }, 1.5, false);
    await usage.recordAgentUsage("00000000-0000-4000-8000-000000000001", "claude-opus-5-5", { inputTokens: 1000, outputTokens: 200 }, 1.5, true);
    const [charged, operator] = state.statements;
    // Pro and Max side by side: the turn is the highest plan's.
    expect(charged.text).toContain("CASE WHEN u.max_expires_at > now() THEN 'max' WHEN u.pro_expires_at > now() THEN 'pro' END");
    expect(charged.values).toEqual(["00000000-0000-4000-8000-000000000001", "claude-opus-5-5", 1000, 200, 50, 0, 1.5, usage.listMicros("claude-opus-5-5", { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50 }), false]);
    expect(operator.values[6]).toBe(0);
    expect(operator.values[8]).toBe(true);
  });
});
