import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";

// Single-admin authentication. The password hash and session secret live in the
// service environment: ADMIN_PASSWORD_HASH (see scripts/set-admin-password.mjs) and SESSION_SECRET.

export const ADMIN_COOKIE = "curialy_admin";
const SESSION_DAYS = 7;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

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

export function authConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH) && (process.env.SESSION_SECRET ?? "").length >= 32;
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export async function isAdminRequest(req: Request) {
  if (!authConfigured()) return false;
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"], issuer: "curialy", audience: "curialy-admin" });
    return payload.sub === "admin";
  } catch {
    return false;
  }
}

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 8;
}

const cookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: req.secure || process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export async function loginHandler(req: Request, res: Response) {
  if (!authConfigured()) return res.status(503).json({ error: "Admin login is not configured on this server." });
  const ip = req.ip ?? "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password || !verifyPassword(password, process.env.ADMIN_PASSWORD_HASH!)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  attempts.delete(ip);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuer("curialy")
    .setAudience("curialy-admin")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(sessionKey());
  res.cookie(ADMIN_COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_DAYS * 86_400_000 });
  res.json({ ok: true });
}

export function logoutHandler(req: Request, res: Response) {
  res.clearCookie(ADMIN_COOKIE, cookieOptions(req));
  res.json({ ok: true });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (await isAdminRequest(req)) return next();
  res.status(401).json({ error: "Sign in required." });
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
