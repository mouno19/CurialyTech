import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { currentUser, forgetUser, issueSession, rateLimited } from "./auth";
import { getSettings } from "./credits";
import { db, query } from "./db/pg";
import { FREE_ACCOUNTS_PER_NETWORK, networkHash, signupNetwork } from "./signup-network";
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

/**
 * The account for a GitHub identity: the one already linked to it, or a new one when sign-ups are
 * open. A new account remembers (as a keyed hash) the network it was created from; past the first
 * few from one network, accounts start without the free allowance. `address`: the visitor's address.
 */
export async function accountForGitHub(profile: GitHubProfile, address?: string | null): Promise<{ id: string } | { refused: "banned" | "closed" }> {
  const { rows } = await query<AccountRow>("SELECT id, banned_at FROM curialy.users WHERE github_id = $1", [profile.id]);
  const displayName = (profile.name || profile.login).slice(0, 100);
  if (rows[0]) {
    if (rows[0].banned_at) return { refused: "banned" };
    await query("UPDATE curialy.users SET login = $2, display_name = $3, avatar_url = $4, email = coalesce($5, email) WHERE id = $1", [rows[0].id, profile.login, displayName, profile.avatarUrl, profile.email]);
    forgetUser(rows[0].id);
    return { id: rows[0].id };
  }
  const settings = await getSettings();
  if (!settings.signupsOpen) return { refused: "closed" };
  const network = signupNetwork(address);
  if (!network) console.warn("[auth] sign-up from a non-public address: no network recorded");
  const hash = network ? networkHash(network) : null;
  // Counted and created under one lock per network, so parallel sign-ups can't share a free place.
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    let withheld = false;
    if (hash) {
      await client.query("SELECT pg_advisory_xact_lock(7718003, $1)", [hash.readInt32BE(0)]);
      const { rows: [counted] } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM curialy.users WHERE signup_network = $1", [hash]);
      withheld = counted.n >= FREE_ACCOUNTS_PER_NETWORK;
    }
    // xmax = 0 on a row this statement inserted (not one the conflict clause updated).
    const { rows: created } = await client.query<{ id: string; inserted: boolean }>(
      `INSERT INTO curialy.users (handle, display_name, role, github_id, login, avatar_url, email, signup_network, free_allowance_withheld)
       VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8)
       ON CONFLICT (github_id) WHERE github_id IS NOT NULL DO UPDATE SET login = EXCLUDED.login RETURNING id, (xmax = 0) AS inserted`,
      [`gh:${profile.id}`, displayName, profile.id, profile.login, profile.avatarUrl, profile.email, hash, withheld],
    );
    // The welcome credits: once, with the account, and not for an account that starts without the free credits.
    if (created[0].inserted && !withheld && settings.welcomeCredits > 0) {
      await client.query("UPDATE curialy.users SET bonus_credits = bonus_credits + $2 WHERE id = $1", [created[0].id, settings.welcomeCredits]);
      await client.query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail) VALUES ($1, 'welcome', $2, 'welcome credits')", [created[0].id, settings.welcomeCredits]);
    }
    await client.query("COMMIT");
    return { id: created[0].id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function registerGitHubAuth(app: Express) {
  // Sign in or sign up. `next`: where to land afterwards (a path on this site).
  app.get("/api/auth/github/login", (req: Request, res: Response) => {
    if (!oauthConfigured()) return res.redirect(302, "/login?signin=not_configured");
    if (rateLimited(`github-login:${req.ip ?? "unknown"}`, 20)) return res.redirect(302, "/login?signin=busy");
    begin(req, res, "login", safeNext(req.query.next));
  });

  // Connect repositories to the signed-in account (or reconnect for new permissions); `next`: the
  // page to come back to (a task the user was working on), else the home page with a notice.
  app.get("/api/auth/github/start", guarded(async (req: Request, res: Response) => {
    if (!(await currentUser(req))) return res.redirect(302, "/login");
    if (!oauthConfigured()) return res.redirect(302, "/?github=not_configured");
    begin(req, res, "connect", safeNext(req.query.next));
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
        const account = await accountForGitHub(await githubProfile(token), req.ip);
        if ("refused" in account) return fail(account.refused);
        await issueSession(req, res, account.id);
        return res.redirect(302, next);
      }
      const user = await currentUser(req);
      if (!user) return res.redirect(302, "/login");
      const granted = new Set(scopes.split(/[,\s]+/).filter(Boolean));
      if (!granted.has("repo")) return fail("missing_repo_scope");
      await saveConnection(user.id, token, scopes);
      res.redirect(302, next === "/" ? "/?github=connected" : next);
    } catch (error) {
      console.error(`[github] OAuth ${intent} callback failed:`, error instanceof Error ? error.message : error);
      fail("error");
    }
  }));
}

export { GITHUB_SCOPES };
