import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventBody } from "@shared/agent";
import { brandText } from "@shared/brand";
import { canonicalSourceUrl, cleanSourceUrl, sourceDomain } from "@shared/sources";

// The web_search tool against a stand-in search engine: the request carries the key in its header
// only, results come back normalized and numbered per task, every failure (no key, a rejected key,
// no quota, the engine's rate limit, a timeout, a dropped connection, a 5xx) becomes an honest
// "did not run" for the model and a reason for the user without the engine's own message, our own
// limits hold, and the key never shows up in a result, an event or a log line.

const KEY = "test-search-key-6f1d2c9a-0b7e-4f55-9c3a-1d2e3f405162";
process.env.EXA_API_KEY = KEY;

vi.mock("./agent/store", () => ({ taskOwner: async (taskId: string) => (taskId.startsWith("shared-") ? "owner-shared" : `owner-${taskId}`) }));

const { normalizeResults, numberSources, resetSearch, runWebSearchTool, searchConfigured, SEARCH_REASONS, TASK_LIMIT, ACCOUNT_LIMIT, WEB_SEARCH_SCHEMAS } = await import("./agent/web-search");

const logged: string[] = [];
const spies = (["log", "warn", "error", "info", "debug"] as const).map(level => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); }));

afterAll(() => {
  for (const spy of spies) spy.mockRestore();
  // Nothing the tool logged, in any test, holds the key.
  expect(logged.join("\n")).not.toContain(KEY);
});

type Call = { url: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];
let replies: (() => Promise<Response> | Response)[] = [];

const engine = (async (url: string, init: RequestInit) => {
  calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  const next = replies.shift();
  if (!next) throw new Error("no reply queued");
  const signal = init.signal as AbortSignal;
  return await Promise.race([next(), new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
}) as unknown as typeof fetch;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const never = () => new Promise<Response>(() => undefined);

const NOW = Date.parse("2026-11-14T12:00:00Z");
let events: AgentEventBody[] = [];
let task = 0;
const ctx = (sessionId = `task-${++task}`, signal = new AbortController().signal) => ({ sessionId, callId: `call-${task}`, signal, operator: false, emit: (body: AgentEventBody) => { events.push(body); } });
const search = (input: Record<string, unknown>, context = ctx(), deps: { timeoutMs?: number } = {}) => runWebSearchTool(WEB_SEARCH_SCHEMAS.web_search.parse(input), context, { fetch: engine, now: () => NOW, ...deps });
const searchEvents = () => events.filter((event): event is Extract<AgentEventBody, { type: "web_search" }> => event.type === "web_search");

const RESULTS = {
  requestId: "req-1",
  results: [
    { id: "a", title: "  Node.js —\n Releases ", url: "https://nodejs.org/en/blog/release/?utm_source=x", publishedDate: "2026-11-12T09:30:00.000Z", highlights: ["## Releases\n\nNode.js 26.13.1 (LTS)   is out ![logo](https://x/y.png) with [notes](https://nodejs.org/n).", "tiny"] },
    { id: "b", title: "Duplicate of the first", url: "http://www.nodejs.org/en/blog/release#top", highlights: ["Same page again, another anchor and scheme."] },
    { id: "c", title: "", url: "https://github.com/nodejs/node/releases", publishedDate: "2099-01-01T00:00:00.000Z", text: "Releases of nodejs/node on GitHub, with every tag and changelog." },
    { id: "d", title: "Not a web page", url: "ftp://example.com/file" },
    { id: "e", title: "Long one", url: "https://example.com/long", highlights: ["word ".repeat(400)] },
  ],
  costDollars: { total: 0.007 },
};

beforeEach(() => {
  process.env.EXA_API_KEY = KEY;
  calls = [];
  replies = [];
  events = [];
  resetSearch();
});

afterEach(() => {
  // Whatever happened, no result or event of the test carries the key.
  expect(JSON.stringify(events)).not.toContain(KEY);
});

describe("a search", () => {
  it("sends the query with the key in a header only, and returns numbered, normalized results", async () => {
    replies.push(json(200, RESULTS));
    const outcome = await search({ query: "latest node.js release", include_domains: ["nodejs.org", "GitHub.com"], start_date: "2026-10-01", end_date: "2026-11-14", category: "news" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.exa.ai/search");
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(calls[0].body).toEqual({
      query: "latest node.js release", type: "auto", numResults: 6, contents: { highlights: { maxCharacters: 1200 } }, category: "news",
      includeDomains: ["nodejs.org", "github.com"], startPublishedDate: "2026-10-01T00:00:00.000Z", endPublishedDate: "2026-11-14T23:59:59.999Z",
    });
    expect(JSON.stringify(calls[0].body)).not.toContain(KEY);

    expect(outcome).toMatchObject({ ok: true, summary: "3 sources" });
    expect(outcome.content).toContain('Web search results for "latest node.js release" (3 results, searched 2026-11-14)');
    expect(outcome.content).toContain("[1] Node.js — Releases\nhttps://nodejs.org/en/blog/release/\nnodejs.org · published 2026-11-12\n- Releases Node.js 26.13.1 (LTS) is out with notes.");
    // No title: the site stands in; a date in the future is no date.
    expect(outcome.content).toContain("[2] github.com\nhttps://github.com/nodejs/node/releases\ngithub.com\n- Releases of nodejs/node");
    expect(outcome.content).toContain("Cite the sources you use inline as [n](URL)");
    expect(outcome.content).not.toContain("tiny");
    expect(outcome.content).not.toContain("ftp://");

    const [searching, done] = searchEvents();
    expect(searching).toEqual({ type: "web_search", callId: expect.any(String), query: "latest node.js release", status: "searching" });
    expect(done).toMatchObject({ status: "done", durationMs: 0 });
    expect(done.sources!.map(source => [source.n, source.source, source.date])).toEqual([[1, "nodejs.org", "2026-11-12"], [2, "github.com", null], [3, "example.com", null]]);
    // The chat gets short highlights; the model gets them longer.
    expect(done.sources![2].highlights[0].length).toBeLessThanOrEqual(240);
    expect(outcome.content).toMatch(/\[3\] Long one\n[^\n]+\n[^\n]+\n- (word ){50,}/);
  });

  it("numbers pages per task: a page found again keeps its number", async () => {
    const context = ctx();
    replies.push(json(200, RESULTS));
    await search({ query: "first" }, context);
    replies.push(json(200, { results: [{ title: "New", url: "https://example.org/new" }, { title: "Again", url: "https://github.com/nodejs/node/releases/" }] }));
    const second = await search({ query: "second" }, context);
    expect(second.content).toContain("[4] New");
    expect(second.content).toContain("[2] Again");
    // Another task starts at 1.
    replies.push(json(200, { results: [{ title: "Other", url: "https://example.org/new" }] }));
    expect((await search({ query: "third" })).content).toContain("[1] Other");
  });

  it("with nothing found: says so, and that nothing can be cited", async () => {
    replies.push(json(200, { results: [] }));
    const outcome = await search({ query: "zzqx nothing matches", exclude_domains: ["example.com"] });
    expect(outcome).toMatchObject({ ok: true, summary: "No results" });
    expect(outcome.content).toBe('No results for "zzqx nothing matches" with these filters. Try a broader or rephrased query, or fewer filters. Nothing from this search can be cited.');
    expect(searchEvents().map(event => event.status)).toEqual(["searching", "empty"]);
  });
});

describe("when the search can't run", () => {
  const unavailable = (outcome: { ok: boolean; content: string }) => {
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toMatch(/^WEB_SEARCH_UNAVAILABLE: the search for ".+" did not run/);
    expect(outcome.content).toContain("Don't say you searched the web, and cite no web sources for it.");
    // White-label: the engine is never named, its message never passed on.
    expect(outcome.content.toLowerCase()).not.toContain("exa");
    expect(outcome.content).not.toContain(KEY);
  };

  it("without a key: nothing is sent", async () => {
    delete process.env.EXA_API_KEY;
    expect(searchConfigured()).toBe(false);
    const outcome = await search({ query: "anything" });
    unavailable(outcome);
    expect(outcome.summary).toBe("Web search isn't set up on this server");
    expect(calls).toEqual([]);
    expect(searchEvents().map(event => [event.status, event.reason])).toEqual([["searching", undefined], ["failed", "Web search isn't set up on this server"]]);
  });

  it("a rejected key (401): the reason, never the engine's message, and no retry", async () => {
    replies.push(json(401, { requestId: "r401", error: "Invalid API key. Provide a valid key using 'x-api-key: <key>'. Create a key at https://dashboard.exa.ai/api-keys", tag: "INVALID_API_KEY" }));
    const before = logged.length;
    const outcome = await search({ query: "anything" });
    unavailable(outcome);
    expect(outcome.summary).toBe(SEARCH_REASONS.unauthorized);
    expect(calls).toHaveLength(1);
    const lines = logged.slice(before).join("\n");
    expect(lines).toContain("HTTP 401 INVALID_API_KEY request r401");
    expect(lines).not.toContain("Invalid API key");
    expect(lines).not.toContain("dashboard");
  });

  it("no quota left (402), and the engine's rate limit (429, no retry)", async () => {
    replies.push(json(402, { requestId: "r402", error: "Out of credits", tag: "INSUFFICIENT_CREDITS" }));
    expect((await search({ query: "one" })).summary).toBe(SEARCH_REASONS.quota);
    replies.push(json(429, { error: "Too many requests", tag: "RATE_LIMITED" }, { "retry-after": "12" }));
    const limited = await search({ query: "two" });
    unavailable(limited);
    expect(limited.summary).toBe(SEARCH_REASONS.rate_limited);
    expect(limited.content).toContain("You may try once more later in this task.");
    expect(calls).toHaveLength(2);
  });

  it("a query the engine refuses (400): try a simpler one", async () => {
    replies.push(json(400, { error: "Invalid request body", tag: "INVALID_REQUEST_BODY" }));
    const outcome = await search({ query: "bad filters" });
    expect(outcome.summary).toBe(SEARCH_REASONS.invalid);
    expect(outcome.content).toContain("Try a simpler query or fewer filters.");
  });

  it("a timeout", async () => {
    replies.push(never);
    const outcome = await search({ query: "slow" }, ctx(), { timeoutMs: 40 });
    unavailable(outcome);
    expect(outcome.summary).toBe("The search timed out");
    expect(calls).toHaveLength(1);
  });

  it("a 5xx or a dropped connection is tried once more", async () => {
    replies.push(json(503, { error: "down" }), json(200, { results: [{ title: "Back", url: "https://example.com/back" }] }));
    expect(await search({ query: "flaky" })).toMatchObject({ ok: true, summary: "1 source" });
    replies.push(() => { throw new TypeError("fetch failed"); }, json(200, { results: [{ title: "Back", url: "https://example.com/back" }] }));
    expect(await search({ query: "dropped" })).toMatchObject({ ok: true });
    replies.push(json(500, { error: "down" }), json(502, {}));
    expect((await search({ query: "down" })).summary).toBe(SEARCH_REASONS.unavailable);
    expect(calls).toHaveLength(6);
  });

  it("a reply that isn't a result list", async () => {
    replies.push(() => new Response("<html>gateway</html>", { status: 200 }));
    expect((await search({ query: "html" })).summary).toBe(SEARCH_REASONS.unavailable);
    replies.push(json(200, { nothing: true }));
    expect((await search({ query: "shape" })).summary).toBe(SEARCH_REASONS.unavailable);
  });

  it("stopping the run stops the search (no result is made up)", async () => {
    const controller = new AbortController();
    replies.push(never);
    const pending = search({ query: "stop me" }, ctx(undefined, controller.signal));
    setTimeout(() => controller.abort(new Error("Cancelled")), 20);
    await expect(pending).rejects.toThrow("Cancelled");
    expect(searchEvents().map(event => event.status)).toEqual(["searching"]);
  });
});

describe("limits", () => {
  it(`${TASK_LIMIT} searches per task, ${ACCOUNT_LIMIT} per account, every 10 minutes`, async () => {
    const one = ctx("limit-task");
    for (let index = 0; index < TASK_LIMIT; index++) {
      replies.push(json(200, { results: [{ title: "R", url: `https://example.com/${index}` }] }));
      expect((await search({ query: `q${index}` }, one)).ok).toBe(true);
    }
    const refused = await search({ query: "one too many" }, one);
    expect(refused.summary).toBe(SEARCH_REASONS.limit);
    expect(calls).toHaveLength(TASK_LIMIT);

    // Two tasks of one account share its limit.
    let ok = 0;
    for (let index = 0; index < ACCOUNT_LIMIT + 2; index++) {
      replies.push(json(200, { results: [{ title: "R", url: `https://example.com/s${index}` }] }));
      if ((await search({ query: `s${index}` }, ctx(index % 2 ? "shared-a" : "shared-b"))).ok) ok++;
    }
    expect(ok).toBe(ACCOUNT_LIMIT);
  });
});

describe("input", () => {
  const parse = (input: Record<string, unknown>) => WEB_SEARCH_SCHEMAS.web_search.safeParse(input);
  it("takes a query with optional filters, and refuses what the engine would", () => {
    expect(parse({ query: "  node lts  " })).toMatchObject({ success: true, data: { query: "node lts", num_results: 6 } });
    for (const bad of [
      { query: "" }, { query: "x" }, { query: "q".repeat(401) }, { query: "ok query", num_results: 11 }, { query: "ok query", num_results: 0 },
      { query: "ok query", include_domains: ["not a domain"] }, { query: "ok query", start_date: "2026-13-40" }, { query: "ok query", start_date: "yesterday" },
      { query: "ok query", start_date: "2026-11-02", end_date: "2026-11-01" }, { query: "ok query", category: "company", start_date: "2026-01-01" },
      { query: "ok query", category: "people", exclude_domains: ["x.com"] }, { query: "ok query", category: "videos" },
      { query: "ok query", include_domains: Array.from({ length: 11 }, (_, index) => `site${index}.com`) },
    ]) expect(parse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
    expect(parse({ query: "ok query", include_domains: ["*.nih.gov", "docs.python.org/3/"] }).success).toBe(true);
  });
});

describe("normalizing", () => {
  it("keeps web pages once each, cleans titles and highlights, and drops dates that can't be right", () => {
    const results = normalizeResults(RESULTS, NOW);
    expect(results.map(result => result.url)).toEqual(["https://nodejs.org/en/blog/release/", "https://github.com/nodejs/node/releases", "https://example.com/long"]);
    expect(results[0]).toEqual({ url: "https://nodejs.org/en/blog/release/", title: "Node.js — Releases", source: "nodejs.org", date: "2026-11-12", highlights: ["Releases Node.js 26.13.1 (LTS) is out with notes."] });
    expect(results[2].highlights[0].length).toBeLessThanOrEqual(600);
    expect(results[2].highlights[0].endsWith("…")).toBe(true);
    expect(numberSources("t", results).map(source => source.n)).toEqual([1, 2, 3]);
  });

  it("source URLs: one key per page, links without tracking or credentials", () => {
    expect(canonicalSourceUrl("https://www.Example.com/a/?utm_source=x&b=2&a=1#frag")).toBe("example.com/a?a=1&b=2");
    expect(canonicalSourceUrl("http://example.com/a")).toBe(canonicalSourceUrl("https://example.com/a/"));
    expect(canonicalSourceUrl("javascript:alert(1)")).toBeNull();
    expect(cleanSourceUrl("https://user:pass@example.com/p?gclid=1&q=node#s")).toBe("https://example.com/p?q=node#s");
    expect(sourceDomain("https://www.en.wikipedia.org/wiki/X")).toBe("en.wikipedia.org");
  });
});

describe("white-label", () => {
  it("scrubs the engine's name, host and key variable from platform text", () => {
    expect(brandText("Exa returned an error from https://api.exa.ai/search (EXA_API_KEY)")).toBe("Curialy Search returned an error from [internal endpoint] (engine credential)");
    expect(brandText("an example of exactly that")).toBe("an example of exactly that");
  });
});
