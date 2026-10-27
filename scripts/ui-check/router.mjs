// Answers every request of the page from local data: the built client from disk, /api/* from
// fixtures.mjs. Pure (no Playwright): run.mjs feeds it intercepted requests, the dry run feeds it
// synthetic ones. A reply is { action: "fulfill" | "continue" | "abort", ... } plus how to judge it.
import fs from "node:fs";
import path from "node:path";
import { externalStubPage, FIXTURE_ASSETS, ORIGIN, RESET_HTML } from "./fixtures.mjs";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
  ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".pdf": "application/pdf",
};
export const contentTypeFor = file => CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Public font CDN: passed to the network (default, real glyph metrics) or aborted (UI_CHECK_FONTS=block). */
export const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
/** Third parties the app legitimately shows (GitHub avatars): answered locally, never contacted. */
const STUB_HOSTS = { "avatars.githubusercontent.com": () => ({ type: "image/svg+xml", body: FIXTURE_ASSETS.avatarSvg }) };

/** "/api/agent/tasks/:id/events" -> matcher. A trailing "/*" matches the rest (or nothing). */
export function compileRoute([method, pattern, handle, options = {}]) {
  const keys = [];
  const segments = pattern.split("/").slice(1);
  const rest = segments.at(-1) === "*";
  const source = (rest ? segments.slice(0, -1) : segments).map(segment => {
    if (segment.startsWith(":")) {
      keys.push(segment.slice(1));
      return "/([^/]+)";
    }
    return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  }).join("");
  const regex = new RegExp(`^${source}${rest ? "(?:/(.*))?" : "/?"}$`);
  return { method, pattern, handle, public: Boolean(options.public), regex, keys };
}

/** Collapse ids so unknown routes group: /api/agent/tasks/7d3f.../foo -> /api/agent/tasks/:id/foo */
export function routeTemplate(pathname) {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
}

const bytes = value => (Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? "")));

function sseBody({ sync, events, end }) {
  let out = `event: sync\ndata: ${JSON.stringify(sync)}\n\n`;
  for (const event of events) out += `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
  if (end) out += "event: end\ndata: {}\n\n";
  return out;
}

/**
 * @param {{ publicDir: string, fixtures: ReturnType<import("./fixtures.mjs").createFixtures>, fonts?: "pass" | "block" }} options
 */
export function createRouter({ publicDir, fixtures, fonts = "pass" }) {
  const root = path.resolve(publicDir);
  const origin = new URL(ORIGIN).origin;
  const routes = fixtures.routes.map(compileRoute);
  const cache = new Map();

  const fulfill = (status, type, body, extra = {}) => ({ action: "fulfill", status, headers: { "content-type": type, ...(extra.headers ?? {}) }, body: bytes(body), kind: extra.kind ?? "static", expected: extra.expected ?? status < 400 });
  const json = (status, value, extra = {}) => fulfill(status, "application/json; charset=utf-8", JSON.stringify(value), { ...extra, headers: { "cache-control": "no-store", ...(extra.headers ?? {}) } });

  function readFile(file) {
    if (cache.has(file)) return cache.get(file);
    let data = null;
    try {
      if (fs.statSync(file).isFile()) data = fs.readFileSync(file);
    } catch {
      data = null;
    }
    cache.set(file, data);
    return data;
  }

  function staticFile(url) {
    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      return fulfill(400, "text/plain; charset=utf-8", "Bad path", { kind: "blocked-path" });
    }
    if (relative.includes("\0")) return fulfill(404, "text/plain; charset=utf-8", "Not found", { kind: "blocked-path" });
    const absolute = path.resolve(root, `.${relative}`);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return fulfill(404, "text/plain; charset=utf-8", "Not found", { kind: "blocked-path" });
    const file = relative.endsWith("/") ? path.join(absolute, "index.html") : absolute;
    const data = readFile(file);
    if (data) return fulfill(200, contentTypeFor(file), data, { kind: "static" });
    // Anything that looks like a file is a missing asset; everything else is an app route.
    if (path.posix.extname(relative)) return fulfill(404, "text/plain; charset=utf-8", "Not found", { kind: "missing-static" });
    const index = readFile(path.join(root, "index.html"));
    if (!index) return fulfill(500, "text/plain; charset=utf-8", `No index.html in ${root}`, { kind: "missing-static" });
    return fulfill(200, "text/html; charset=utf-8", index, { kind: "spa" });
  }

  function internal(url) {
    if (url.pathname === "/__ui-check/blank") return fulfill(200, "text/html; charset=utf-8", RESET_HTML, { kind: "internal" });
    if (/^\/__fixtures__\/live-view\/[^/]+$/.test(url.pathname)) return fulfill(200, "text/html; charset=utf-8", FIXTURE_ASSETS.liveViewHtml, { kind: "fixture-page" });
    return fulfill(404, "text/plain; charset=utf-8", "Not found", { kind: "missing-static" });
  }

  function external(request, url) {
    if (FONT_HOSTS.has(url.hostname)) return fonts === "block" ? { action: "abort", errorCode: "blockedbyclient", kind: "font", expected: true } : { action: "continue", kind: "font", expected: true };
    // The branded preview host of UI_CHECK_DEPLOY_URL=branded stands for a first-party proxy.
    if (url.hostname.endsWith(".preview.curialy.test")) return request.resourceType === "document" ? fulfill(200, "text/html; charset=utf-8", FIXTURE_ASSETS.previewSiteHtml, { kind: "fixture-page" }) : fulfill(404, "text/plain; charset=utf-8", "Not found", { kind: "fixture-page", expected: true });
    const stub = STUB_HOSTS[url.hostname];
    if (stub) {
      const { type, body } = stub();
      return fulfill(200, type, body, { kind: "external-stub" });
    }
    // Leaving the fixture world is a finding (white-label: the browser must not contact vendors).
    // Documents get a neutral placeholder so screenshots stay readable; nothing is fetched.
    if (request.resourceType === "document") return fulfill(200, "text/html; charset=utf-8", externalStubPage(url.hostname), { kind: "external", expected: false });
    return { action: "abort", errorCode: "blockedbyclient", kind: "external", expected: false };
  }

  function parseBody(request) {
    const text = request.postData;
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function findRoute(method, pathname) {
    const candidates = method === "HEAD" ? ["HEAD", "GET", "*"] : [method, "*"];
    for (const want of candidates) {
      for (const route of routes) {
        if (route.method !== want) continue;
        const match = route.regex.exec(pathname);
        if (!match) continue;
        const params = {};
        route.keys.forEach((key, index) => {
          try {
            params[key] = decodeURIComponent(match[index + 1]);
          } catch {
            params[key] = match[index + 1];
          }
        });
        return { route, params };
      }
    }
    return null;
  }

  function fromResult(result, method) {
    if (result.sse) return fulfill(200, "text/event-stream; charset=utf-8", sseBody(result.sse), { kind: "sse", headers: { "cache-control": "no-cache" } });
    const status = result.status ?? 200;
    const headers = { "cache-control": "no-store", ...(result.headers ?? {}) };
    if (result.retryAfter) headers["retry-after"] = String(result.retryAfter);
    const expected = status < 400 || Boolean(result.expected);
    let reply;
    if (result.json !== undefined) reply = fulfill(status, "application/json; charset=utf-8", JSON.stringify(result.json), { kind: "api", headers, expected });
    else if (result.body !== undefined) reply = fulfill(status, result.contentType ?? "application/octet-stream", result.body, { kind: "api", headers, expected });
    else reply = fulfill(status, "text/plain; charset=utf-8", "", { kind: "api", headers, expected });
    if (method === "HEAD") reply.body = Buffer.alloc(0);
    return reply;
  }

  function trpc(request, url) {
    const names = decodeURIComponent(url.pathname.replace(/^\/api\/trpc\/?/, "")).split(",").filter(Boolean);
    const batch = url.searchParams.get("batch") === "1";
    let unknown = false;
    const results = names.map(name => {
      const procedure = fixtures.trpc[name];
      if (!procedure) {
        unknown = true;
        return { error: { json: { message: `No fixture for tRPC ${name}`, code: -32004, data: { code: "NOT_FOUND", httpStatus: 404, path: name } } } };
      }
      return { result: { data: { json: procedure(parseBody(request)) } } };
    });
    if (!names.length) return json(404, { error: "No tRPC procedure named" }, { kind: "api-unknown" });
    return json(unknown ? 404 : 200, batch ? results : results[0], { kind: unknown ? "api-unknown" : "trpc" });
  }

  function api(request, url) {
    const method = request.method.toUpperCase();
    const found = findRoute(method, url.pathname);
    if (!found) return json(404, { error: `No fixture for ${method} ${url.pathname}`, code: "ui_check_no_fixture" }, { kind: "api-unknown" });
    if (!fixtures.state.signedIn && !found.route.public) return json(401, { error: "Sign in to continue." }, { kind: "api" });
    const result = found.route.handle({ method, path: url.pathname, params: found.params, query: url.searchParams, body: parseBody(request), url });
    return fromResult(result, method);
  }

  /**
   * @param {{ method: string, url: string, resourceType?: string, postData?: string | null }} request
   */
  function handle(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return { action: "abort", errorCode: "failed", kind: "external", expected: false };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { action: "continue", kind: "other", expected: true };
    if (url.origin !== origin) return external(request, url);
    if (url.pathname === "/api/trpc" || url.pathname.startsWith("/api/trpc/")) return trpc(request, url);
    if (url.pathname.startsWith("/api/")) return api(request, url);
    if (url.pathname.startsWith("/__fixtures__/") || url.pathname.startsWith("/__ui-check/")) return internal(url);
    return staticFile(url);
  }

  return { handle, routes, root };
}
