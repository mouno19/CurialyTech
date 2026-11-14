import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { PoolClient } from "pg";
import { db, query } from "../db/pg";
import { encryptionKey, seal, unseal } from "./sealed";

// Sign in with Vercel, per account, so the agent can read that account's Vercel projects. The
// authorization code flow with PKCE (S256), a state bound to the signed-in account and a nonce
// checked in the signed ID token. Only the refresh token is stored, encrypted with AES-256-GCM
// (TOKEN_ENCRYPTION_KEY); access tokens (an hour each) stay in this process's memory. A refresh
// token is single use: every refresh runs under the connection's row lock and stores its successor
// in the same transaction, so two requests refreshing at once never lose it. No token is logged.

const AUTHORIZE_URL = "https://vercel.com/oauth/authorize";
const TOKEN_URL = "https://api.vercel.com/login/oauth/token";
const REVOKE_URL = "https://api.vercel.com/login/oauth/token/revoke";
const API_BASE = "https://api.vercel.com";
const ISSUER = "https://vercel.com";
/** Identity and a refresh token. What the token may read is the app's permissions, granted on Vercel's consent page. */
export const VERCEL_SCOPES = ["openid", "profile", "email", "offline_access"];
const TIMEOUT_MS = 15_000;
/** A cached access token is renewed this long before it expires. */
const EARLY_MS = 2 * 60_000;

export type VercelErrorKind = "not_connected" | "reconnect" | "forbidden" | "not_found" | "rate_limited" | "unavailable" | "failed";

/** message: safe to show the user and the agent (never a token, never a URL with one). */
export class VercelError extends Error {
  constructor(readonly kind: VercelErrorKind, message: string, readonly status?: number, readonly retryAfterSec?: number) {
    super(message);
  }
}

const RECONNECT = "The Vercel connection has expired or was revoked. Reconnect Vercel (in the sidebar) to use it again.";

export function vercelConfig() {
  const clientId = (process.env.VERCEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.VERCEL_CLIENT_SECRET ?? "").trim();
  const redirectUri = (process.env.VERCEL_REDIRECT_URI ?? "").trim();
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey()) return null;
  return { clientId, clientSecret, redirectUri };
}
export const vercelConfigured = () => vercelConfig() !== null;

function config() {
  const value = vercelConfig();
  if (!value) throw new VercelError("unavailable", "Vercel isn't set up on this server.");
  return value;
}

// ---- Encryption (AES-256-GCM, shared with the account's saved secrets) ----

export { seal, sealString, unseal, unsealString, type Sealed } from "./sealed";

// ---- The authorization request ----

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** PKCE: a 43-character verifier and its S256 challenge. */
export function pkcePair() {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export const randomToken = () => base64url(randomBytes(32));

/** consent: show Vercel's consent screen again (to change what was granted) even when it was given before. */
export function authorizeUrl(params: { state: string; nonce: string; challenge: string; consent?: boolean }) {
  const { clientId, redirectUri } = config();
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: VERCEL_SCOPES.join(" "),
    state: params.state, nonce: params.nonce, code_challenge: params.challenge, code_challenge_method: "S256",
  });
  if (params.consent) query.set("prompt", "consent");
  return `${AUTHORIZE_URL}?${query}`;
}

// ---- The token endpoint ----

type TokenSet = { access_token: string; token_type?: string; id_token?: string; expires_in?: number; scope?: string; refresh_token?: string };

/** Seconds to wait from a 429's Retry-After or X-RateLimit-Reset (unix seconds), capped at an hour. */
function retryAfter(response: Response) {
  const header = response.headers.get("retry-after");
  const after = header === null || !header.trim() ? NaN : Number(header);
  if (Number.isFinite(after) && after >= 0) return Math.min(3600, Math.max(1, Math.ceil(after)));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.min(3600, Math.max(1, Math.ceil(reset - Date.now() / 1000)));
  return 60;
}

const describeWait = (seconds: number) => (seconds >= 120 ? `about ${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`);

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret } = config();
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      // client_secret_post: the app accepts it and client_secret_basic.
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new VercelError("unavailable", "Vercel couldn't be reached. Try again in a moment.");
  }
  const body = (await response.json().catch(() => null)) as (TokenSet & { error?: string }) | null;
  if (response.ok && body?.access_token) return body;
  if (response.status === 429) {
    const wait = retryAfter(response);
    throw new VercelError("rate_limited", `Vercel is rate limiting sign-in requests; try again in ${describeWait(wait)}.`, 429, wait);
  }
  // A refresh token that was used, revoked or expired, or a code that was: the user has to connect again.
  if (body?.error === "invalid_grant") throw new VercelError("reconnect", RECONNECT, response.status);
  if (response.status >= 500) throw new VercelError("unavailable", "Vercel had a temporary error. Try again in a moment.", response.status);
  // invalid_client and the like: this server's app credentials, not the user's connection (kept as it is).
  console.error(`[vercel] token request refused (${response.status}${typeof body?.error === "string" ? ` ${body.error.slice(0, 60)}` : ""})`);
  throw new VercelError("unavailable", "Vercel refused this server's sign-in request. Try again later.", response.status);
}

export function exchangeCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config().redirectUri });
}

let jwks: JWTVerifyGetKey | null = null;

export type VercelIdentity = { sub: string; name: string | null; username: string | null; email: string | null; picture: string | null };

/** The ID token's signature (Vercel's published keys), issuer, audience, expiry and our nonce. */
export async function verifyIdToken(idToken: string, nonce: string): Promise<VercelIdentity> {
  jwks ??= createRemoteJWKSet(new URL("https://vercel.com/.well-known/jwks"));
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: config().clientId });
  if (typeof payload.nonce !== "string" || payload.nonce !== nonce) throw new VercelError("failed", "The Vercel sign-in didn't match this request.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new VercelError("failed", "The Vercel sign-in didn't name an account.");
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null);
  return { sub: payload.sub, name: text(payload.name), username: text(payload.preferred_username), email: text(payload.email), picture: text(payload.picture) };
}

/** The signed-in user from the userinfo endpoint: for a sign-in that came back without an ID token. */
export async function userInfo(accessToken: string): Promise<VercelIdentity> {
  const response = await fetch(`${API_BASE}/login/oauth/userinfo`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  const body = response?.ok ? ((await response.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (typeof body?.sub !== "string" || !body.sub) throw new VercelError("unavailable", "Vercel didn't say which account signed in. Try again in a moment.", response?.status);
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null);
  return { sub: body.sub, name: text(body.name), username: text(body.preferred_username), email: text(body.email), picture: text(body.picture) };
}

/** Tests: use these keys instead of Vercel's. */
export function useJwksForTests(keys: JWTVerifyGetKey | null) {
  jwks = keys;
}

// ---- The stored connection ----

type ConnectionRow = {
  vercel_user_id: string; username: string | null; name: string | null; email: string | null; avatar_url: string | null; scopes: string;
  status: "connected" | "reconnect"; refresh_ciphertext: Buffer | null; refresh_iv: Buffer | null; refresh_tag: Buffer | null; connected_at: Date; refreshed_at: Date | null;
};

/** The current access token of each connected account, by account (never stored). */
const accessTokens = new Map<string, { token: string; expiresAt: number }>();
/** Refreshes in progress here, by account: requests that need one at the same time share it. */
const refreshes = new Map<string, Promise<string>>();

const remember = (userId: string, tokens: TokenSet) => {
  accessTokens.set(userId, { token: tokens.access_token, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000 });
};

/** Tests: forget cached access tokens. */
export function resetVercelTokens() {
  accessTokens.clear();
  refreshes.clear();
}

/** Store (or replace) the account's connection after a completed sign-in. */
export async function saveConnection(userId: string, tokens: TokenSet, identity: VercelIdentity) {
  if (!tokens.refresh_token) throw new VercelError("failed", "Vercel didn't grant offline access, so the connection couldn't be kept. Connect again and allow every requested permission.");
  const sealed = seal(tokens.refresh_token);
  await query(
    `INSERT INTO curialy.vercel_connections (user_id, vercel_user_id, username, name, email, avatar_url, scopes, status, refresh_ciphertext, refresh_iv, refresh_tag, connected_at, refreshed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'connected', $8, $9, $10, now(), now(), now())
     ON CONFLICT (user_id) DO UPDATE SET vercel_user_id = EXCLUDED.vercel_user_id, username = EXCLUDED.username, name = EXCLUDED.name, email = EXCLUDED.email,
       avatar_url = EXCLUDED.avatar_url, scopes = EXCLUDED.scopes, status = 'connected', status_reason = NULL, refresh_ciphertext = EXCLUDED.refresh_ciphertext,
       refresh_iv = EXCLUDED.refresh_iv, refresh_tag = EXCLUDED.refresh_tag, connected_at = now(), refreshed_at = now(), updated_at = now()`,
    [userId, identity.sub, identity.username, identity.name, identity.email, identity.picture, tokens.scope ?? VERCEL_SCOPES.join(" "), sealed.ciphertext, sealed.iv, sealed.tag],
  );
  remember(userId, tokens);
}

export type VercelStatus = {
  configured: boolean;
  connected: boolean;
  /** Connected once, but the refresh token stopped working: connect again. */
  needsReconnect: boolean;
  name: string | null; username: string | null; email: string | null; avatarUrl: string | null;
  scopes: string[];
  connectedAt: string | null;
};

/** What the account's page shows: never a token. */
export async function connectionStatus(userId: string): Promise<VercelStatus> {
  const { rows: [row] } = await query<ConnectionRow>("SELECT * FROM curialy.vercel_connections WHERE user_id = $1", [userId]);
  return {
    configured: vercelConfigured(),
    connected: row?.status === "connected",
    needsReconnect: row?.status === "reconnect",
    name: row?.name ?? null, username: row?.username ?? null, email: row?.email ?? null, avatarUrl: row?.avatar_url ?? null,
    scopes: row ? row.scopes.split(/\s+/).filter(Boolean) : [],
    connectedAt: row?.connected_at.toISOString() ?? null,
  };
}

/** The connected account's identity for the agent (null: not connected, or it needs reconnecting). */
export async function connectedIdentity(userId: string) {
  const { rows: [row] } = await query<Pick<ConnectionRow, "name" | "username" | "status">>("SELECT name, username, status FROM curialy.vercel_connections WHERE user_id = $1", [userId]);
  return row?.status === "connected" ? { name: row.name, username: row.username } : null;
}

/** Mark the connection as needing a new sign-in; its refresh token is dropped (it no longer works). */
async function markReconnect(client: Pick<PoolClient, "query">, userId: string, reason: string) {
  accessTokens.delete(userId);
  await client.query(
    `UPDATE curialy.vercel_connections SET status = 'reconnect', status_reason = $2, refresh_ciphertext = NULL, refresh_iv = NULL, refresh_tag = NULL, updated_at = now() WHERE user_id = $1`,
    [userId, reason],
  );
}

/**
 * Exchange the stored refresh token for a new pair, under the row's lock: a second request (here
 * or in another process) waits, then reads the token the first one stored. The new refresh token
 * is written in the same transaction, before anything else can run.
 */
async function refreshLocked(userId: string): Promise<string> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query<ConnectionRow>("SELECT * FROM curialy.vercel_connections WHERE user_id = $1 FOR UPDATE", [userId]);
    if (!row) throw new VercelError("not_connected", "Vercel isn't connected to this account. Connect Vercel (in the sidebar) first.");
    if (row.status !== "connected" || !row.refresh_ciphertext || !row.refresh_iv || !row.refresh_tag) throw new VercelError("reconnect", RECONNECT);
    let refreshToken: string;
    try {
      refreshToken = unseal({ ciphertext: row.refresh_ciphertext, iv: row.refresh_iv, tag: row.refresh_tag });
    } catch {
      // A key that changed, or a tampered row: unusable, so it can only be connected again.
      await markReconnect(client, userId, "unreadable");
      await client.query("COMMIT");
      throw new VercelError("reconnect", RECONNECT);
    }
    let tokens: TokenSet;
    try {
      tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (error) {
      if (error instanceof VercelError && error.kind === "reconnect") {
        await markReconnect(client, userId, "refresh_rejected");
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
      throw error;
    }
    // Rotated: the old token no longer works, so the new one is saved now, in this transaction.
    const next = tokens.refresh_token ? seal(tokens.refresh_token) : null;
    await client.query(
      `UPDATE curialy.vercel_connections SET refresh_ciphertext = COALESCE($2, refresh_ciphertext), refresh_iv = COALESCE($3, refresh_iv), refresh_tag = COALESCE($4, refresh_tag),
         scopes = COALESCE($5, scopes), refreshed_at = now(), updated_at = now() WHERE user_id = $1`,
      [userId, next?.ciphertext ?? null, next?.iv ?? null, next?.tag ?? null, tokens.scope ?? null],
    );
    // Cached before the lock is released, so a disconnect waiting for it revokes this access token too.
    remember(userId, tokens);
    await client.query("COMMIT");
    return tokens.access_token;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The account's access token: the cached one while it has more than two minutes left, else a fresh one. */
export async function accessToken(userId: string, opts: { force?: boolean } = {}): Promise<string> {
  const cached = accessTokens.get(userId);
  if (!opts.force && cached && cached.expiresAt - EARLY_MS > Date.now()) return cached.token;
  let pending = refreshes.get(userId);
  if (!pending) {
    pending = refreshLocked(userId).finally(() => refreshes.delete(userId));
    refreshes.set(userId, pending);
  }
  return pending;
}

/** Tests and the live check: a refresh that doesn't share one already in progress (only the row lock orders them). */
export const refreshNowForTests = (userId: string) => refreshLocked(userId);

/** Revoke the grant on Vercel (the refresh token, and so its access tokens) and delete everything stored. */
export async function disconnectVercel(userId: string) {
  const config = vercelConfig();
  let revoked = false;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    // Under the row's lock: a refresh in progress finishes first, so the token revoked is the latest one.
    const { rows: [row] } = await client.query<ConnectionRow>("SELECT * FROM curialy.vercel_connections WHERE user_id = $1 FOR UPDATE", [userId]);
    const cached = accessTokens.get(userId)?.token;
    accessTokens.delete(userId);
    if (config && row) {
      const tokens: string[] = [];
      if (row.refresh_ciphertext && row.refresh_iv && row.refresh_tag) {
        try { tokens.push(unseal({ ciphertext: row.refresh_ciphertext, iv: row.refresh_iv, tag: row.refresh_tag })); } catch { /* unreadable: nothing to revoke */ }
      }
      if (cached) tokens.push(cached);
      const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      for (const token of tokens) {
        const response = await fetch(REVOKE_URL, {
          method: "POST",
          headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }).catch(() => null);
        if (response?.ok) revoked = true;
        else console.warn(`[vercel] token revocation answered ${response?.status ?? "nothing"}; the stored connection is deleted anyway`);
      }
    }
    await client.query("DELETE FROM curialy.vercel_connections WHERE user_id = $1", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { revoked };
}

// ---- The REST API (read only) ----

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * GET a REST API path with the account's own token. 401: the token is renewed once and the request
 * retried. 403, 404 and 429 come back as VercelErrors whose message says what to do.
 */
export async function vercelGet<T = any>(userId: string, path: string, params: Query = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(userId, { force: attempt > 0 });
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VercelError("unavailable", "Vercel couldn't be reached. Try again in a moment.");
    }
    if (response.ok) return (await response.json()) as T;
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const detail = typeof body?.error?.message === "string" ? ` (${body.error.message.slice(0, 200)})` : "";
    // A token Vercel no longer accepts (revoked, say): renew it once. The refresh itself says
    // whether the connection still works; a fresh token refused again is this request's problem.
    if (response.status === 401 && attempt === 0) continue;
    if (response.status === 401) throw new VercelError("forbidden", `Vercel didn't accept this connection for that request${detail}. Reconnect Vercel if it keeps happening.`, 401);
    if (response.status === 403) {
      throw new VercelError("forbidden", `Vercel didn't allow this${detail}. The connection can only read what was granted on Vercel's consent screen: reconnect Vercel and grant access to the team or project, or ask the app's owner to enable the Projects and Deployments read permissions for the app.`, 403);
    }
    if (response.status === 404) throw new VercelError("not_found", `Vercel found nothing there${detail}. Check the id, name or team.`, 404);
    if (response.status === 429) {
      const wait = retryAfter(response);
      throw new VercelError("rate_limited", `Vercel is rate limiting this account's requests; try again in ${describeWait(wait)}.`, 429, wait);
    }
    if (response.status >= 500) throw new VercelError("unavailable", "Vercel had a temporary error. Try again in a moment.", response.status);
    throw new VercelError("failed", `Vercel refused the request${detail}.`, response.status);
  }
}
