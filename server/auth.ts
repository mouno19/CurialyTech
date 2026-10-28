import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { adminUserId, query } from "./db/pg";

// Accounts sign in with GitHub (auth-github.ts) and get a signed session cookie naming the account.
// The operator can also sign in with the admin password (ADMIN_PASSWORD_HASH, see
// scripts/set-admin-password.mjs), which opens the operator account. SESSION_SECRET signs both.

export const ADMIN_COOKIE = "curialy_admin";
export const USER_COOKIE = "curialy_session";
const ADMIN_SESSION_DAYS = 7;
const USER_SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export type AppUser = {
  id: string;
  role: "admin" | "user";
  login: string | null;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
};

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, saltB64, hashB64] = stored.split(":");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionKey() {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters).");
  return new TextEncoder().encode(secret);
}

/** Sessions can be signed (SESSION_SECRET). Password sign-in additionally needs ADMIN_PASSWORD_HASH. */
export const sessionsConfigured = () => (process.env.SESSION_SECRET ?? "").length >= 32;
export function authConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH) && sessionsConfigured();
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type UserRow = { id: string; role: string; login: string | null; display_name: string; avatar_url: string | null; email: string | null; banned_at: Date | null; session_version: number };

const userOf = (row: UserRow): AppUser => ({
  id: row.id, role: row.role === "admin" ? "admin" : "user", login: row.login, displayName: row.display_name, avatarUrl: row.avatar_url, email: row.email,
});

// Accounts are read on every request (event streams too); a ban or a signed-out-everywhere takes effect within this.
const USER_TTL_MS = 5_000;
const userCache = new Map<string, { at: number; row: UserRow | null }>();

async function loadUser(id: string) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.row;
  const { rows } = await query<UserRow>("SELECT id, role, login, display_name, avatar_url, email, banned_at, session_version FROM curialy.users WHERE id = $1", [id]);
  const row = rows[0] ?? null;
  userCache.set(id, { at: Date.now(), row });
  if (userCache.size > 5000) userCache.delete(userCache.keys().next().value!);
  return row;
}

/** Forget a cached account (after a ban, a role change or "sign out everywhere"). */
export const forgetUser = (id: string) => userCache.delete(id);

const resolved = new WeakMap<Request, Promise<AppUser | null>>();

/** The signed-in account, or null. Banned accounts and revoked sessions are signed out. */
export function currentUser(req: Request): Promise<AppUser | null> {
  let pending = resolved.get(req);
  if (!pending) {
    pending = resolveUser(req).catch(() => null);
    resolved.set(req, pending);
  }
  return pending;
}

async function resolveUser(req: Request): Promise<AppUser | null> {
  if (!sessionsConfigured()) return null;
  const token = readCookie(req, USER_COOKIE);
  if (token) {
    try {
      const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"], issuer: "curialy", audience: "curialy-user" });
      const row = typeof payload.sub === "string" ? await loadUser(payload.sub) : null;
      if (row && !row.banned_at && payload.ver === row.session_version) return userOf(row);
    } catch {
      // fall through to the operator cookie
    }
  }
  // Operator sessions from before accounts existed stay valid until they expire.
  const legacy = readCookie(req, ADMIN_COOKIE);
  if (legacy && authConfigured()) {
    try {
      const { payload } = await jwtVerify(legacy, sessionKey(), { algorithms: ["HS256"], issuer: "curialy", audience: "curialy-admin" });
      if (payload.sub === "admin") {
        const row = await loadUser(await adminUserId());
        if (row && !row.banned_at) return userOf(row);
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function isAdminRequest(req: Request) {
  return (await currentUser(req))?.role === "admin";
}

const cookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: req.secure || process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

/** Sign the browser in as this account (replacing any earlier session). */
export async function issueSession(req: Request, res: Response, userId: string) {
  const { rows } = await query<{ session_version: number }>("UPDATE curialy.users SET last_login_at = now(), last_seen_at = now() WHERE id = $1 RETURNING session_version", [userId]);
  if (!rows[0]) throw new Error("Account not found.");
  const days = USER_SESSION_DAYS;
  const token = await new SignJWT({ ver: rows[0].session_version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("curialy")
    .setAudience("curialy-user")
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(sessionKey());
  res.cookie(USER_COOKIE, token, { ...cookieOptions(req), maxAge: days * 86_400_000 });
  res.clearCookie(ADMIN_COOKIE, cookieOptions(req));
  forgetUser(userId);
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/** At most `limit` attempts per key in ten minutes. */
export function rateLimited(key: string, limit = 8) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    if (attempts.size > 20_000) attempts.delete(attempts.keys().next().value!);
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

export async function loginHandler(req: Request, res: Response) {
  if (!authConfigured()) return res.status(503).json({ error: "Operator sign-in is not configured on this server." });
  const ip = req.ip ?? "unknown";
  if (rateLimited(`password:${ip}`)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  // Copy/paste and mobile keyboards often add surrounding whitespace.
  const password = typeof req.body?.password === "string" ? req.body.password.trim() : "";
  if (!password || !verifyPassword(password, process.env.ADMIN_PASSWORD_HASH!)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  attempts.delete(`password:${ip}`);
  await issueSession(req, res, await adminUserId());
  res.json({ ok: true });
}

export function logoutHandler(req: Request, res: Response) {
  res.clearCookie(USER_COOKIE, cookieOptions(req));
  res.clearCookie(ADMIN_COOKIE, cookieOptions(req));
  res.json({ ok: true });
}

const accounts = new WeakMap<Request, AppUser>();

/** The account a requireUser/requireAdmin route runs for. */
export function accountOf(req: Request): AppUser {
  const user = accounts.get(req);
  if (!user) throw new Error("accountOf() used on a route without requireUser.");
  return user;
}

let lastSeen = new Map<string, number>();
function touch(userId: string) {
  const now = Date.now();
  if ((lastSeen.get(userId) ?? 0) > now - 5 * 60_000) return;
  lastSeen.set(userId, now);
  if (lastSeen.size > 20_000) lastSeen = new Map();
  query("UPDATE curialy.users SET last_seen_at = now() WHERE id = $1", [userId]).catch(() => undefined);
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "Sign in required." });
  accounts.set(req, user);
  touch(user.id);
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "Sign in required." });
  if (user.role !== "admin") return res.status(403).json({ error: "Only the operator can do this." });
  accounts.set(req, user);
  next();
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax). */
export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {
    // fall through
  }
  res.status(403).json({ error: "Cross-origin request rejected." });
}
