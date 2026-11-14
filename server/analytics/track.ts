import { createHmac, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { currentUser, rateLimited } from "../auth";
import { query } from "../db/pg";
import { countryForLanguage, countryForZone } from "./geo";

// Page views for the operator's Analytics page, reported by the site's own script. No cookie and no
// IP address is kept: a visitor is a keyed hash of the address and the browser that changes every
// day (unique visitors per day, never linkable from one day to the next). The country comes from the
// browser's time zone. Bots and browsers that ask not to be tracked (Do Not Track, Global Privacy
// Control) are left out: the script doesn't send, and the server drops what bots send.

// Only browsers that run the site's script send hits; these still do (crawlers, headless test tools).
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|embedly|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|uptime/i;
const RETENTION_DAYS = 400;

/** HMAC key for the visitor hash: from SESSION_SECRET when set, else random for this process. */
let visitorKey: Buffer | null = null;
const key = () => (visitorKey ??= process.env.SESSION_SECRET ? createHmac("sha256", process.env.SESSION_SECRET).update("curialy-analytics-visitor").digest() : randomBytes(32));

export function visitorHash(ip: string, userAgent: string, day = new Date().toISOString().slice(0, 10)) {
  return createHmac("sha256", key()).update(`${day}|${ip}|${userAgent}`).digest("hex").slice(0, 20);
}

/** /tasks/<uuid> → /tasks/:id and the like, so a page is one row however many tasks there are. */
export function pageOf(path: string) {
  const clean = path.split(/[?#]/)[0].replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1").slice(0, 200) || "/";
  return clean
    .replace(/^\/tasks\/[^/]+/, "/tasks/:id")
    .replace(/^\/pay\/[^/]+/, "/pay/:code")
    .replace(/^\/p\/[^/]+.*/, "/p/:id")
    .replace(/^\/r\/[^/]+/, "/r/:code")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id");
}

const FRIENDLY: [RegExp, string][] = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yandex\./, "Yandex"], [/(^|\.)baidu\.com$/, "Baidu"],
  [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, "X"], [/(^|\.)facebook\.com$|^fb\.me$|^l\.facebook\.com$/, "Facebook"], [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"], [/(^|\.)reddit\.com$/, "Reddit"], [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"], [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)t\.me$|(^|\.)telegram\.(org|me)$/, "Telegram"], [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"], [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)news\.ycombinator\.com$/, "Hacker News"], [/(^|\.)producthunt\.com$/, "Product Hunt"],
];

/** Where a visit came from: its campaign, its referral code, the site that linked here, or direct. */
export function sourceOf(hit: { referrer?: string; utmSource?: string | null; ref?: string | null }, ownHost: string) {
  const utm = hit.utmSource?.trim().toLowerCase().slice(0, 60);
  if (utm) return { source: utm, referrerHost: null as string | null };
  const ref = hit.ref?.trim().toUpperCase();
  if (ref && /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(ref)) return { source: `ref:${ref}`, referrerHost: null };
  let host: string | null = null;
  try {
    host = hit.referrer ? new URL(hit.referrer).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch { /* not a URL */ }
  if (!host || host === ownHost.replace(/^www\./, "")) return { source: "direct", referrerHost: null };
  const friendly = FRIENDLY.find(([pattern]) => pattern.test(host!))?.[1];
  return { source: friendly ?? host, referrerHost: host };
}

export function deviceOf(userAgent: string, width?: number) {
  const ua = userAgent;
  const device = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua) ? "Tablet" : /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua) || (width !== undefined && width < 600) ? "Mobile" : "Desktop";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other";
  return { device, browser, os };
}

const text = (max: number) => z.string().trim().max(max).optional().nullable();
const hitSchema = z.object({
  viewId: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/),
  path: z.string().max(2000).regex(/^\//),
  entry: z.boolean(),
  referrer: z.string().max(2000).optional(),
  utmSource: text(100), utmMedium: text(100), utmCampaign: text(150), ref: text(40),
  timeZone: z.string().max(64).optional(), language: z.string().max(35).optional(),
  returning: z.boolean().optional(),
  width: z.number().int().min(0).max(20_000).optional(),
});

const leaveSchema = z.object({ viewId: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/), ms: z.number().int().min(0).max(24 * 3_600_000) });

/** sendBeacon may post its JSON as text: read either. */
function body(req: Request) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body;
}

export function analyticsCollectRouter() {
  const router = Router();
  router.post("/hit", (req: Request, res: Response) => {
    res.status(204).end();
    const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 400);
    const ip = req.ip ?? "unknown";
    if (!userAgent || BOT.test(userAgent) || rateLimited(`analytics:${ip}`, 600)) return;
    const parsed = hitSchema.safeParse(body(req));
    if (!parsed.success) return;
    const hit = parsed.data;
    if (hit.path.startsWith("/api/") || hit.path.startsWith("/auth/")) return;
    void (async () => {
      const user = await currentUser(req).catch(() => null);
      const { source, referrerHost } = hit.entry ? sourceOf(hit, req.hostname) : { source: null, referrerHost: null };
      const { device, browser, os } = deviceOf(userAgent, hit.width);
      const country = countryForZone(hit.timeZone) ?? countryForLanguage(hit.language);
      await query(
        `INSERT INTO curialy.page_views (view_id, visitor, repeat_visitor, entry, user_id, operator, path, page, source, referrer_host, utm_medium, utm_campaign, country, device, browser, os, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT (view_id) DO NOTHING`,
        [hit.viewId, visitorHash(ip, userAgent), hit.returning === true, hit.entry, user?.id ?? null, user?.role === "admin", hit.path.split(/[?#]/)[0].slice(0, 300), pageOf(hit.path), source, referrerHost,
          hit.entry ? hit.utmMedium?.slice(0, 60) || null : null, hit.entry ? hit.utmCampaign?.slice(0, 100) || null : null, country, device, browser, os, hit.language?.slice(0, 35) || null],
      );
    })().catch(error => console.error("[analytics] hit not recorded:", error instanceof Error ? error.message : error));
  });

  // Time on the page, when the browser leaves it (or opens the next one).
  router.post("/leave", (req: Request, res: Response) => {
    res.status(204).end();
    const parsed = leaveSchema.safeParse(body(req));
    if (!parsed.success || rateLimited(`analytics-leave:${req.ip ?? "unknown"}`, 600)) return;
    void query("UPDATE curialy.page_views SET duration_ms = $2 WHERE view_id = $1 AND duration_ms IS NULL AND at > now() - interval '1 day'", [parsed.data.viewId, parsed.data.ms])
      .catch(error => console.error("[analytics] time on page not recorded:", error instanceof Error ? error.message : error));
  });
  return router;
}

/** Page views older than RETENTION_DAYS are deleted, once a day. */
export function startAnalyticsSweep() {
  const sweep = () => void query(`DELETE FROM curialy.page_views WHERE at < now() - interval '${RETENTION_DAYS} days'`).catch(() => undefined);
  const timer = setInterval(sweep, 24 * 3_600_000);
  timer.unref?.();
  setTimeout(sweep, 60_000).unref?.();
}
