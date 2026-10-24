import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { isAdminRequest } from "./auth";
import { authorizeUrl, exchangeCode, GITHUB_SCOPES, oauthConfigured, saveConnection } from "./services/github";

// GitHub OAuth for the operator account. The state value is bound to the browser with a short-lived
// httpOnly cookie, and the callback additionally requires the admin session.

const STATE_COOKIE = "curialy_gh_state";
const CALLBACK_PATH = "/api/auth/callback/github";

function redirectUri(req: Request) {
  // Local development uses the localhost callback registered on the OAuth app; production uses the public origin.
  if (req.hostname === "localhost") return `http://localhost:${req.socket.localPort ?? 3000}${CALLBACK_PATH}`;
  return `${(process.env.PUBLIC_BASE_URL || "https://curialy.tech").replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

const sameString = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function registerGitHubAuth(app: Express) {
  app.get("/api/auth/github/start", async (req: Request, res: Response) => {
    if (!(await isAdminRequest(req))) return res.redirect(302, "/login");
    if (!oauthConfigured()) return res.redirect(302, "/?github=not_configured");
    const state = randomBytes(24).toString("hex");
    res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: req.secure || process.env.NODE_ENV === "production", sameSite: "lax", path: CALLBACK_PATH, maxAge: 10 * 60_000 });
    res.redirect(302, authorizeUrl(redirectUri(req), state));
  });

  app.get(CALLBACK_PATH, async (req: Request, res: Response) => {
    const expected = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: CALLBACK_PATH });
    if (!(await isAdminRequest(req))) return res.redirect(302, "/login");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!expected || !state || !sameString(state, expected)) return res.redirect(302, "/?github=state_mismatch");
    if (typeof req.query.error === "string") return res.redirect(302, `/?github=${encodeURIComponent(req.query.error)}`);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return res.redirect(302, "/?github=missing_code");
    try {
      const { token, scopes } = await exchangeCode(code, redirectUri(req));
      const granted = new Set(scopes.split(/[,\s]+/).filter(Boolean));
      if (!granted.has("repo")) return res.redirect(302, "/?github=missing_repo_scope");
      await saveConnection(token, scopes);
      res.redirect(302, "/?github=connected");
    } catch (error) {
      console.error("[github] OAuth callback failed:", error instanceof Error ? error.message : error);
      res.redirect(302, "/?github=error");
    }
  });
}

export { GITHUB_SCOPES };
