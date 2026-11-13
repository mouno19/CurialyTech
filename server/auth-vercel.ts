import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { currentUser, rateLimited, sameOriginOnly } from "./auth";
import { safeNext } from "./auth-github";
import {
  authorizeUrl, connectionStatus, disconnectVercel, exchangeCode, pkcePair, randomToken, saveConnection, sealString, unsealString, userInfo, VercelError, vercelConfigured, verifyIdToken,
} from "./services/vercel";

// Connect Vercel to the signed-in account (it never signs anyone in here). The state, nonce and
// PKCE verifier travel in a short-lived httpOnly cookie sealed with TOKEN_ENCRYPTION_KEY, bound
// to the account that started: the callback completes only for that same signed-in account.

const STATE_COOKIE = "curialy_vercel_oauth";
const CALLBACK_PATH = "/auth/vercel/callback";
const STATE_TTL_MS = 10 * 60_000;

type Pending = { userId: string; state: string; nonce: string; verifier: string; next: string; at: number };

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** The sealed cookie, if it opens, is complete and is less than ten minutes old. */
function readPending(value: string | undefined): Pending | null {
  const text = value ? unsealString(value) : null;
  if (!text) return null;
  try {
    const saved = JSON.parse(text) as Partial<Pending>;
    const fields = [saved.userId, saved.state, saved.nonce, saved.verifier, saved.next];
    if (!fields.every(field => typeof field === "string" && field) || typeof saved.at !== "number" || Date.now() - saved.at > STATE_TTL_MS) return null;
    return saved as Pending;
  } catch {
    return null;
  }
}

const sameString = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Never a token: VercelError messages are written for the user, anything else is cut short. */
const describe = (error: unknown) => (error instanceof VercelError ? `${error.kind}: ${error.message}` : error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown error");

/** Express 4 does not catch rejected async handlers. */
const guarded = (fn: (req: Request, res: Response) => Promise<unknown>, json = false) => (req: Request, res: Response) => {
  fn(req, res).catch(error => {
    console.error("[vercel] request failed:", describe(error));
    if (res.headersSent) return;
    if (json) res.status(500).json({ error: "Something went wrong with the Vercel connection. Try again in a moment." });
    else res.redirect(302, "/?vercel=error");
  });
};

export function registerVercelAuth(app: Express) {
  // Connect (or reconnect) Vercel. next: the page to come back to. prompt=consent: show Vercel's
  // consent screen again, to grant access to other teams or projects.
  app.get("/auth/vercel/start", guarded(async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.redirect(302, "/login");
    if (!vercelConfigured()) return res.redirect(302, "/?vercel=not_configured");
    if (rateLimited(`vercel-connect:${user.id}`, 20)) return res.redirect(302, "/?vercel=busy");
    const { verifier, challenge } = pkcePair();
    const pending: Pending = { userId: user.id, state: randomToken(), nonce: randomToken(), verifier, next: safeNext(req.query.next), at: Date.now() };
    res.cookie(STATE_COOKIE, sealString(JSON.stringify(pending)), {
      httpOnly: true, secure: req.secure || process.env.NODE_ENV === "production", sameSite: "lax", path: CALLBACK_PATH, maxAge: STATE_TTL_MS,
    });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, authorizeUrl({ state: pending.state, nonce: pending.nonce, challenge, consent: req.query.prompt === "consent" }));
  }));

  app.get(CALLBACK_PATH, guarded(async (req, res) => {
    const pending = readPending(readCookie(req, STATE_COOKIE));
    res.clearCookie(STATE_COOKIE, { path: CALLBACK_PATH });
    res.setHeader("Cache-Control", "no-store");
    const fail = (reason: string) => res.redirect(302, `/?vercel=${encodeURIComponent(reason)}`);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!pending || !state || !sameString(state, pending.state)) return fail("state_mismatch");
    const user = await currentUser(req);
    if (!user) return res.redirect(302, "/login");
    // Started by another account in this browser (signed out and in since): never connect it here.
    if (user.id !== pending.userId) return fail("state_mismatch");
    if (typeof req.query.error === "string") return fail(req.query.error === "access_denied" ? "denied" : "error");
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return fail("missing_code");
    try {
      const tokens = await exchangeCode(code, pending.verifier);
      // Without a refresh token the connection would end within the hour.
      if (!tokens.refresh_token) return fail("no_offline_access");
      const identity = tokens.id_token ? await verifyIdToken(tokens.id_token, pending.nonce) : await userInfo(tokens.access_token);
      await saveConnection(user.id, tokens, identity);
      res.redirect(302, pending.next === "/" ? "/?vercel=connected" : pending.next);
    } catch (error) {
      console.error("[vercel] connect callback failed:", describe(error));
      fail(error instanceof VercelError && error.kind === "rate_limited" ? "busy" : "error");
    }
  }));

  // What the sidebar shows: "Connected as <name>" or "Connect Vercel". Never a token.
  app.get("/auth/vercel/status", guarded(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    res.json(await connectionStatus(user.id));
  }, true));

  // Revoke the grant on Vercel and delete everything stored for it.
  app.post("/auth/vercel/disconnect", sameOriginOnly, guarded(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    const { revoked } = await disconnectVercel(user.id);
    res.json({ ok: true, revoked });
  }, true));
}
