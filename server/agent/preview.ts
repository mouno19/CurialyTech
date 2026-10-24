import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Request, Response } from "express";
import { resolveInWorkspace, workspacePath } from "./sandbox";

// Previews of what the agent builds, served at
//   /api/workspace/preview/<taskId>/<token>/<path>
// from the task's workspace (static build output) or, while the visual-test tool is running,
// proxied to a dev server inside the sandbox. The URL carries a signed, expiring token instead of
// the admin cookie so the cloud browser (Browserbase) can load it too.
//
// Agent-built code is untrusted and would otherwise run on the curialy.tech origin, so every
// response carries `Content-Security-Policy: sandbox …` (opaque origin: no access to the app's
// cookies, storage or same-origin API calls); cookies and auth headers are never forwarded to a
// proxied dev server and Set-Cookie is never passed back.

const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'self'";
const BUILD_DIRS = ["dist", "build", "out", "public", "."];

function secret() {
  const value = process.env.SESSION_SECRET ?? "";
  if (value.length < 32) throw new Error("SESSION_SECRET must be configured for previews.");
  return value;
}

export function previewToken(taskId: string, ttlSeconds = TOKEN_TTL_SECONDS) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const mac = createHmac("sha256", secret()).update(`preview:${taskId}:${expires}`).digest("base64url").slice(0, 32);
  return `${expires.toString(36)}.${mac}`;
}

export function verifyPreviewToken(taskId: string, token: string) {
  const [expiresPart, mac] = token.split(".");
  const expires = parseInt(expiresPart ?? "", 36);
  if (!mac || !Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const expected = createHmac("sha256", secret()).update(`preview:${taskId}:${expires}`).digest("base64url").slice(0, 32);
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function previewBaseUrl(taskId: string, origin = process.env.PUBLIC_BASE_URL || "https://curialy.tech") {
  return `${origin.replace(/\/+$/, "")}/api/workspace/preview/${taskId}/${previewToken(taskId)}/`;
}

/** Find the directory to serve: an explicit one, else the first of dist/build/out/public/. with an index.html. */
export function detectPreviewRoot(taskId: string, preferred?: string) {
  const root = workspacePath(taskId);
  if (!fs.existsSync(root)) return null;
  const candidates = preferred ? [preferred] : BUILD_DIRS;
  for (const candidate of candidates) {
    try {
      const { absolute, relative } = resolveInWorkspace(root, candidate);
      if (fs.lstatSync(path.join(absolute, "index.html"), { throwIfNoEntry: false })?.isFile()) return { dir: relative, absolute };
    } catch { /* outside the workspace: ignore */ }
  }
  return null;
}

/** Absolute asset paths ("/assets/x.js") would resolve against curialy.tech instead of the preview. */
export function absoluteAssetWarnings(indexHtml: string) {
  const hits = Array.from(indexHtml.matchAll(/\b(?:src|href)=["'](\/(?!\/)[^"']*)["']/g)).map(match => match[1]).filter(ref => !ref.startsWith("/api/workspace/preview/"));
  return Array.from(new Set(hits)).slice(0, 5);
}

// ---- Live dev servers (registered only while the visual-test tool is running) ----

const liveServers = new Map<string, number>();
export const registerLiveServer = (taskId: string, port: number) => liveServers.set(taskId, port);
export const unregisterLiveServer = (taskId: string) => liveServers.delete(taskId);

export function waitForPort(port: number, timeoutMs: number, signal: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  return new Promise<boolean>(resolve => {
    const attempt = () => {
      if (signal.aborted || Date.now() > deadline) return resolve(false);
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); setTimeout(attempt, 500); });
    };
    attempt();
  });
}

const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
const STRIP_REQUEST = new Set(["cookie", "authorization", "x-forwarded-for", "x-real-ip", "x-forwarded-proto", "origin", "referer"]);

function proxy(req: Request, res: Response, port: number, subPath: string) {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) if (!HOP_HEADERS.has(key) && !STRIP_REQUEST.has(key)) headers[key] = value;
  headers.host = `127.0.0.1:${port}`;
  const upstream = http.request({ host: "127.0.0.1", port, method: req.method, path: subPath + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""), headers, timeout: 30_000 }, response => {
    const out: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(response.headers)) if (value !== undefined && !HOP_HEADERS.has(key) && key !== "set-cookie" && key !== "content-security-policy" && key !== "x-frame-options") out[key] = value as string | string[];
    // Keep redirects inside the preview path.
    if (typeof out.location === "string" && out.location.startsWith("/")) out.location = `${req.baseUrl}${out.location}`;
    res.writeHead(response.statusCode ?? 502, { ...out, "content-security-policy": PREVIEW_CSP });
    response.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
  upstream.on("error", error => { if (!res.headersSent) res.status(502).type("text/plain").send(`Preview server error: ${error.message}`); else res.end(); });
  req.pipe(upstream);
}

/** Express handler mounted at /api/workspace/preview/:taskId/:token */
export function previewHandler(req: Request, res: Response) {
  const { taskId, token } = req.params as { taskId: string; token: string };
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", PREVIEW_CSP);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!/^[0-9a-f-]{36}$/i.test(taskId) || !verifyPreviewToken(taskId, token)) return res.status(403).type("text/plain").send("Preview link expired or invalid.");
  const subPath = decodeURIComponent(req.path || "/");
  const port = liveServers.get(taskId);
  if (port) return proxy(req, res, port, subPath);
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  const preferred = typeof req.query.dir === "string" ? req.query.dir : undefined;
  const site = detectPreviewRoot(taskId, preferred);
  if (!site) return res.status(404).type("text/plain").send("No built web output found (looked for index.html in dist/, build/, out/, public/ and the workspace root).");
  const root = workspacePath(taskId);
  const relative = path.join(site.dir, subPath.replace(/^\/+/, ""));
  let target: string | null = null;
  try {
    const { absolute } = resolveInWorkspace(root, relative);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (stat?.isFile()) target = absolute;
    else if (stat?.isDirectory() && fs.lstatSync(path.join(absolute, "index.html"), { throwIfNoEntry: false })?.isFile()) target = path.join(absolute, "index.html");
  } catch {
    return res.status(400).type("text/plain").send("Invalid path.");
  }
  // Single-page apps: unknown extension-less routes fall back to index.html.
  if (!target && !path.extname(subPath) && fs.lstatSync(path.join(site.absolute, "index.html"), { throwIfNoEntry: false })?.isFile()) target = path.join(site.absolute, "index.html");
  if (!target) return res.status(404).type("text/plain").send("Not found in preview build.");
  res.sendFile(target, { dotfiles: "deny" }, error => { if (error && !res.headersSent) res.status(404).end(); });
}
