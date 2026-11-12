import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { query } from "../db/pg";

// A published preview is served on this site (`/p/<id>/…`), never on the host that builds it.
// The page is sandboxed so project code cannot read this site's cookies or call its API.
// The preview is temporary: once the row is removed or its window has passed, the address is gone.

const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'self'";
const HTML_LIMIT = 2_000_000;

export function publicPreviewPath(id: string) {
  return `/p/${id}/`;
}

export function publicPreviewUrl(id: string, origin = process.env.PUBLIC_BASE_URL || "https://curialy.tech") {
  return `${origin.replace(/\/+$/, "")}${publicPreviewPath(id)}`;
}

/** Only the hosting upstream we stored may be fetched. */
export function previewUpstream(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".onrender.com")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Keep redirects inside the preview's path on this site. */
export function rewritePreviewLocation(location: string, upstream: URL, prefix: string) {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (location.startsWith(upstream.origin)) {
    const rest = location.slice(upstream.origin.length);
    return `${base.replace(/\/$/, "")}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }
  if (location.startsWith("/") && !location.startsWith("//")) return `${base.replace(/\/$/, "")}${location}`;
  return location;
}

/** Point a built site's root-relative assets at the preview path. */
export function rewritePreviewHtml(html: string, upstream: URL, prefix: string) {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  // Root-relative paths first, then the upstream origin: replacing the origin first would
  // turn it into a root-relative path and the next pass would prefix it again.
  let out = html.replace(/\b(href|src|action)=(["'])\/(?!\/)/gi, `$1=$2${base}`);
  out = out.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${base}`);
  out = out.split(upstream.origin).join(base.replace(/\/$/, ""));
  if (/<head[^>]*>/i.test(out) && !/<base\s/i.test(out)) out = out.replace(/<head[^>]*>/i, match => `${match}<base href="${base}">`);
  return out;
}

type PreviewRow = { upstream_url: string | null; url: string | null; status: string; expires_at: Date; deleted_at: Date | null };

function gone(why: string) {
  return `<!doctype html><meta charset="utf-8"><title>Preview unavailable</title><body style="font:15px system-ui;padding:2rem;color:#14130f;background:#f3efe6">This preview is no longer live (${why}). Start a new one from the task's Preview tab.</body>`;
}

export async function servePublishedPreview(req: Request, res: Response) {
  const id = String(req.params.id ?? "");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", PREVIEW_CSP);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).type("html").send(gone("not found"));
    return;
  }
  const { rows } = await query<PreviewRow>(
    "SELECT upstream_url, url, status, expires_at, deleted_at FROM curialy.deployments WHERE id = $1",
    [id],
  );
  const row = rows[0];
  const live = row && !row.deleted_at && row.status === "live" && row.expires_at.getTime() > Date.now();
  const upstream = live ? previewUpstream(row.upstream_url) ?? previewUpstream(row.url) : null;
  if (!upstream) {
    res.status(410).type("html").send(gone(row ? (row.deleted_at ? "removed" : row.status === "live" ? "expired" : row.status) : "not found"));
    return;
  }
  const rest = (req.originalUrl || req.url).replace(new RegExp(`^/p/${id}`, "i"), "") || "/";
  const target = new URL(rest.startsWith("/") ? rest : `/${rest}`, upstream);
  const headers = new Headers();
  const accept = req.get("accept");
  if (accept) headers.set("accept", accept);
  const language = req.get("accept-language");
  if (language) headers.set("accept-language", language);
  const type = req.get("content-type");
  if (type && req.method !== "GET" && req.method !== "HEAD") headers.set("content-type", type);
  try {
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) as ReadableStream : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
      signal: AbortSignal.timeout(60_000),
    } as RequestInit);
    res.status(response.status);
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      res.setHeader("Location", rewritePreviewLocation(location, upstream, publicPreviewPath(id)));
      res.end();
      return;
    }
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    const cache = response.headers.get("cache-control");
    if (cache) res.setHeader("Cache-Control", cache);
    if (contentType.includes("text/html") && response.status === 200) {
      const bytes = Buffer.from(await response.arrayBuffer());
      const html = bytes.length <= HTML_LIMIT ? rewritePreviewHtml(bytes.toString("utf8"), upstream, publicPreviewPath(id)) : bytes.toString("utf8");
      res.send(html);
      return;
    }
    if (!response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
  } catch (error) {
    console.error(`[deploy] preview ${id} did not respond:`, error instanceof Error ? error.message : error);
    if (!res.headersSent) res.status(502).type("html").send(gone("unavailable"));
  }
}
