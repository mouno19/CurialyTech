import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { currentUser, forgetUser, issueSession, rateLimited } from "./auth";
import { getSettings } from "./credits";
import { query } from "./db/pg";
import { authorizeUrl, exchangeCode, githubProfile, GITHUB_SCOPES, LOGIN_SCOPES, oauthConfigured, saveConnection, type GitHubProfile } from "./services/github";

// GitHub OAuth, two uses of one app and one callback:
// - sign in (or sign up): read:user and user:email only; the account is found or created by GitHub id.
// - connect repositories: adds the repo scope for the signed-in account; its token is stored encrypted.
// The state value is bound to the browser with a short-lived httpOnly cookie that also carries the
// intent and where to go afterwards.

const STATE_COOKIE = "curialy_gh_state";
const CALLBACK_PATH = "/api/auth/callback/github";

function redirectUri(req: Request) {
  // Local development uses the localhost callback registered on the OAuth app; production uses the public origin.
  if (req.hostname === "localhost") return `http://localhost:${req.socket.localPort ?? 3000}${CALLBACK_PATH}`;
  return `${(process.env.PUBLIC_BASE_URL || "https://curialy.tech").replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

/** A malformed value (e.g. a stray "%") reads as absent instead of throwing. */
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decode(rest.join("="));
  }
  return undefined;
}

/** Express 4 does not catch rejected async handlers: one bad request must never take the server down. */
const guarded = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch(error => {
    console.error("[github] sign-in request failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) res.redirect(302, "/login?signin=error");
  });
};

const sameString = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Only paths on this site (never "//host" or a scheme). */
export function safeNext(value: unknown) {
  if (typeof value !== "string" || !/^\/(?![/\\])[\w\-./?=&%#~+:@!$,;]*$/.test(value) || value.length > 300) return "/";
  return value.startsWith("/login") ? "/" : value;
}

type Intent = "login" | "connect";

function begin(req: Request, res: Response, intent: Intent, next: string) {
  const state = randomBytes(24).toString("hex");
  res.cookie(STATE_COOKIE, `${intent}|${state}|${encodeURIComponent(next)}`, { httpOnly: true, secure: req.secure || process.env.NODE_ENV === "production", sameSite: "lax", path: CALLBACK_PATH, maxAge: 10 * 60_000 });
  res.redirect(302, authorizeUrl(redirectUri(req), state, intent === "login" ? LOGIN_SCOPES : GITHUB_SCOPES));
}

type AccountRow = { id: string; banned_at: Date | null };

/** The account for a GitHub identity: the one already linked to it, or a new one when sign-ups are open. */
export async function accountForGitHub(profile: GitHubProfile): Promise<{ id: string } | { refused: "banned" | "closed" }> {
  const { rows } = await query<AccountRow>("SELECT id, banned_at FROM curialy.users WHERE github_id = $1", [profile.id]);
  const displayName = (profile.name || profile.login).slice(0, 100);
  if (rows[0]) {
    if (rows[0].banned_at) return { refused: "banned" };
    await query("UPDATE curialy.users SET login = $2, display_name = $3, avatar_url = $4, email = coalesce($5, email) WHERE id = $1", [rows[0].id, profile.login, displayName, profile.avatarUrl, profile.email]);
    forgetUser(rows[0].id);
    return { id: rows[0].id };
  }
  if (!(await getSettings()).signupsOpen) return { refused: "closed" };
  const { rows: created } = await query<{ id: string }>(
    `INSERT INTO curialy.users (handle, display_name, role, github_id, login, avatar_url, email)
     VALUES ($1, $2, 'user', $3, $4, $5, $6)
     ON CONFLICT (github_id) WHERE github_id IS NOT NULL DO UPDATE SET login = EXCLUDED.login RETURNING id`,
    [`gh:${profile.id}`, displayName, profile.id, profile.login, profile.avatarUrl, profile.email],
  );
  return { id: created[0].id };
}

export function registerGitHubAuth(app: Express) {
  // Sign in or sign up. `next`: where to land afterwards (a path on this site).
  app.get("/api/auth/github/login", (req: Request, res: Response) => {
    if (!oauthConfigured()) return res.redirect(302, "/login?signin=not_configured");
    if (rateLimited(`github-login:${req.ip ?? "unknown"}`, 20)) return res.redirect(302, "/login?signin=busy");
    begin(req, res, "login", safeNext(req.query.next));
  });

  // Connect repositories to the signed-in account.
  app.get("/api/auth/github/start", guarded(async (req: Request, res: Response) => {
    if (!(await currentUser(req))) return res.redirect(302, "/login");
    if (!oauthConfigured()) return res.redirect(302, "/?github=not_configured");
    begin(req, res, "connect", "/");
  }));

  app.get(CALLBACK_PATH, guarded(async (req: Request, res: Response) => {
    const cookie = readCookie(req, STATE_COOKIE) ?? "";
    res.clearCookie(STATE_COOKIE, { path: CALLBACK_PATH });
    // "|" never appears unencoded in the encoded path.
    const [intent, expected, encodedNext] = cookie.split("|");
    const next = safeNext(decode(encodedNext ?? ""));
    const fail = (reason: string) => res.redirect(302, intent === "login" ? `/login?signin=${encodeURIComponent(reason)}` : `/?github=${encodeURIComponent(reason)}`);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if ((intent !== "login" && intent !== "connect") || !expected || !state || !sameString(state, expected)) return fail("state_mismatch");
    if (typeof req.query.error === "string") return fail(req.query.error);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return fail("missing_code");
    try {
      const { token, scopes } = await exchangeCode(code, redirectUri(req));
      if (intent === "login") {
        const account = await accountForGitHub(await githubProfile(token));
        if ("refused" in account) return fail(account.refused);
        await issueSession(req, res, account.id);
        return res.redirect(302, next);
      }
      const user = await currentUser(req);
      if (!user) return res.redirect(302, "/login");
      const granted = new Set(scopes.split(/[,\s]+/).filter(Boolean));
      if (!granted.has("repo")) return fail("missing_repo_scope");
      await saveConnection(user.id, token, scopes);
      res.redirect(302, "/?github=connected");
    } catch (error) {
      console.error(`[github] OAuth ${intent} callback failed:`, error instanceof Error ? error.message : error);
      fail("error");
    }
  }));
}

export { GITHUB_SCOPES };
