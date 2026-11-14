import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { db, query } from "../db/pg";
import { encryptionKey, seal, unseal } from "./sealed";

// Connect Canva, per account, through the Canva Connect API: the authorization code flow with PKCE
// (S256) and a state bound to the signed-in account. Only the refresh token is stored, AES-256-GCM
// encrypted (TOKEN_ENCRYPTION_KEY); access tokens (about 4 hours) stay in this process's memory.
// A refresh token is single use: every refresh runs under the connection's row lock and stores its
// successor in the same transaction, so two requests refreshing at once never lose it. No token is
// ever logged.

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const API_BASE = "https://api.canva.com/rest";
const TOKEN_URL = `${API_BASE}/v1/oauth/token`;
const REVOKE_URL = `${API_BASE}/v1/oauth/revoke`;
/** Exactly the scopes enabled for the app in the Canva Developer Portal (CANVA_SCOPES overrides). */
const DEFAULT_SCOPES = ["design:content:read", "design:content:write", "design:meta:read", "folder:read", "asset:read", "asset:write", "profile:read"];
const TIMEOUT_MS = 15_000;
/** A cached access token is renewed this long before it expires. */
const EARLY_MS = 2 * 60_000;

export type CanvaErrorKind = "not_connected" | "reconnect" | "forbidden" | "not_found" | "invalid" | "rate_limited" | "unavailable" | "failed";

/** message: safe to show the user and the agent (never a token). */
export class CanvaError extends Error {
  constructor(readonly kind: CanvaErrorKind, message: string, readonly status?: number, readonly retryAfterSec?: number) {
    super(message);
  }
}

const RECONNECT = "The Canva connection has expired or was revoked. Reconnect Canva (in the sidebar) to use it again.";

export const canvaScopes = () => (process.env.CANVA_SCOPES?.trim() ? process.env.CANVA_SCOPES.trim().split(/\s+/) : DEFAULT_SCOPES);

export function canvaConfig() {
  const clientId = (process.env.CANVA_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CANVA_CLIENT_SECRET ?? "").trim();
  const redirectUri = (process.env.CANVA_REDIRECT_URI ?? "").trim();
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey()) return null;
  return { clientId, clientSecret, redirectUri };
}
export const canvaConfigured = () => canvaConfig() !== null;

function config() {
  const value = canvaConfig();
  if (!value) throw new CanvaError("unavailable", "Canva isn't set up on this server.");
  return value;
}

const basicAuth = () => {
  const { clientId, clientSecret } = config();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
};

// ---- The authorization request ----

/** PKCE: a 128-character verifier (the most allowed) and its S256 challenge. */
export function pkcePair() {
  const verifier = randomBytes(96).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export const randomState = () => randomBytes(32).toString("base64url");

export function authorizeUrl(params: { state: string; challenge: string }) {
  const { clientId, redirectUri } = config();
  const query = new URLSearchParams({
    code_challenge: params.challenge, code_challenge_method: "S256", scope: canvaScopes().join(" "),
    response_type: "code", client_id: clientId, state: params.state, redirect_uri: redirectUri,
  });
  return `${AUTHORIZE_URL}?${query}`;
}

// ---- The token endpoint ----

type TokenSet = { access_token: string; refresh_token?: string; token_type?: string; expires_in?: number; scope?: string };

/** Seconds to wait from a 429's Retry-After (absent: a minute), capped at an hour. */
function retryAfter(response: Response) {
  const header = response.headers.get("retry-after");
  const after = header === null || !header.trim() ? NaN : Number(header);
  return Number.isFinite(after) && after >= 0 ? Math.min(3600, Math.max(1, Math.ceil(after))) : 60;
}

const describeWait = (seconds: number) => (seconds >= 120 ? `about ${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`);

/** Canva answers errors as { code, message }. */
const errorCode = (body: any) => (typeof body?.code === "string" ? body.code : typeof body?.error === "string" ? body.error : "");

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      // Basic authentication, the method Canva recommends (the secret never goes in the body).
      headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new CanvaError("unavailable", "Canva couldn't be reached. Try again in a moment.");
  }
  const body = (await response.json().catch(() => null)) as (TokenSet & { code?: string }) | null;
  if (response.ok && body?.access_token) return body;
  const code = errorCode(body);
  if (response.status === 429) {
    const wait = retryAfter(response);
    throw new CanvaError("rate_limited", `Canva is rate limiting sign-in requests; try again in ${describeWait(wait)}.`, 429, wait);
  }
  // A refresh token that was used, revoked or expired (or a code that was): the user connects again.
  if (code === "invalid_grant") throw new CanvaError("reconnect", RECONNECT, response.status);
  if (response.status >= 500) throw new CanvaError("unavailable", "Canva had a temporary error. Try again in a moment.", response.status);
  // invalid_client, unauthorized_client and the like: this server's credentials, not the user's connection.
  console.error(`[canva] token request refused (${response.status}${code ? ` ${code.slice(0, 40)}` : ""})`);
  throw new CanvaError("unavailable", "Canva refused this server's sign-in request. Try again later.", response.status);
}

export function exchangeCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config().redirectUri });
}

export type CanvaIdentity = { userId: string; teamId: string | null; displayName: string | null };

/** Who signed in: the Canva user and team ids, and the display name (profile:read). */
export async function fetchIdentity(accessToken: string): Promise<CanvaIdentity> {
  const get = async (path: string) => {
    const response = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
    return response?.ok ? ((await response.json().catch(() => null)) as any) : null;
  };
  const me = await get("/v1/users/me");
  const userId = me?.team_user?.user_id;
  if (typeof userId !== "string" || !userId) throw new CanvaError("unavailable", "Canva didn't say which account signed in. Try again in a moment.");
  const profile = await get("/v1/users/me/profile");
  const name = typeof profile?.profile?.display_name === "string" && profile.profile.display_name.trim() ? profile.profile.display_name.trim().slice(0, 200) : null;
  return { userId, teamId: typeof me.team_user.team_id === "string" ? me.team_user.team_id : null, displayName: name };
}

// ---- The stored connection ----

type ConnectionRow = {
  canva_user_id: string; canva_team_id: string | null; display_name: string | null; scopes: string; status: "connected" | "reconnect";
  refresh_ciphertext: Buffer | null; refresh_iv: Buffer | null; refresh_tag: Buffer | null; connected_at: Date; refreshed_at: Date | null;
};

const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const refreshes = new Map<string, Promise<string>>();

const remember = (userId: string, tokens: TokenSet) => {
  accessTokens.set(userId, { token: tokens.access_token, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 14_400) * 1000 });
};

/** Tests: forget cached access tokens. */
export function resetCanvaTokens() {
  accessTokens.clear();
  refreshes.clear();
}

export async function saveConnection(userId: string, tokens: TokenSet, identity: CanvaIdentity) {
  if (!tokens.refresh_token) throw new CanvaError("failed", "Canva didn't return a refresh token, so the connection couldn't be kept. Connect again.");
  const sealed = seal(tokens.refresh_token);
  await query(
    `INSERT INTO curialy.canva_connections (user_id, canva_user_id, canva_team_id, display_name, scopes, status, refresh_ciphertext, refresh_iv, refresh_tag, connected_at, refreshed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, now(), now(), now())
     ON CONFLICT (user_id) DO UPDATE SET canva_user_id = EXCLUDED.canva_user_id, canva_team_id = EXCLUDED.canva_team_id, display_name = EXCLUDED.display_name,
       scopes = EXCLUDED.scopes, status = 'connected', status_reason = NULL, refresh_ciphertext = EXCLUDED.refresh_ciphertext, refresh_iv = EXCLUDED.refresh_iv,
       refresh_tag = EXCLUDED.refresh_tag, connected_at = now(), refreshed_at = now(), updated_at = now()`,
    [userId, identity.userId, identity.teamId, identity.displayName, tokens.scope ?? canvaScopes().join(" "), sealed.ciphertext, sealed.iv, sealed.tag],
  );
  remember(userId, tokens);
}

export type CanvaStatus = {
  configured: boolean;
  connected: boolean;
  /** Connected once, but the refresh token stopped working: connect again. */
  needsReconnect: boolean;
  name: string | null;
  scopes: string[];
  connectedAt: string | null;
};

/** What the account's page shows: never a token. */
export async function connectionStatus(userId: string): Promise<CanvaStatus> {
  const { rows: [row] } = await query<ConnectionRow>("SELECT * FROM curialy.canva_connections WHERE user_id = $1", [userId]);
  return {
    configured: canvaConfigured(),
    connected: row?.status === "connected",
    needsReconnect: row?.status === "reconnect",
    name: row?.display_name ?? null,
    scopes: row ? row.scopes.split(/\s+/).filter(Boolean) : [],
    connectedAt: row?.connected_at.toISOString() ?? null,
  };
}

/** The connected account for the agent (null: not connected, or it needs reconnecting). */
export async function connectedIdentity(userId: string) {
  const { rows: [row] } = await query<Pick<ConnectionRow, "display_name" | "scopes" | "status">>("SELECT display_name, scopes, status FROM curialy.canva_connections WHERE user_id = $1", [userId]);
  return row?.status === "connected" ? { name: row.display_name, scopes: row.scopes.split(/\s+/).filter(Boolean) } : null;
}

async function markReconnect(client: Pick<PoolClient, "query">, userId: string, reason: string) {
  accessTokens.delete(userId);
  await client.query(
    `UPDATE curialy.canva_connections SET status = 'reconnect', status_reason = $2, refresh_ciphertext = NULL, refresh_iv = NULL, refresh_tag = NULL, updated_at = now() WHERE user_id = $1`,
    [userId, reason],
  );
}

/**
 * Exchange the stored refresh token for a new pair under the row's lock: a second request (here or
 * in another process) waits, then reads the token the first one stored. The rotated refresh token
 * is written in the same transaction.
 */
async function refreshLocked(userId: string): Promise<string> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query<ConnectionRow>("SELECT * FROM curialy.canva_connections WHERE user_id = $1 FOR UPDATE", [userId]);
    if (!row) throw new CanvaError("not_connected", "Canva isn't connected to this account. Connect Canva (in the sidebar) first.");
    if (row.status !== "connected" || !row.refresh_ciphertext || !row.refresh_iv || !row.refresh_tag) throw new CanvaError("reconnect", RECONNECT);
    let refreshToken: string;
    try {
      refreshToken = unseal({ ciphertext: row.refresh_ciphertext, iv: row.refresh_iv, tag: row.refresh_tag });
    } catch {
      await markReconnect(client, userId, "unreadable");
      await client.query("COMMIT");
      throw new CanvaError("reconnect", RECONNECT);
    }
    let tokens: TokenSet;
    try {
      tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (error) {
      if (error instanceof CanvaError && error.kind === "reconnect") {
        await markReconnect(client, userId, "refresh_rejected");
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
      throw error;
    }
    const next = tokens.refresh_token ? seal(tokens.refresh_token) : null;
    await client.query(
      `UPDATE curialy.canva_connections SET refresh_ciphertext = COALESCE($2, refresh_ciphertext), refresh_iv = COALESCE($3, refresh_iv), refresh_tag = COALESCE($4, refresh_tag),
         scopes = COALESCE($5, scopes), refreshed_at = now(), updated_at = now() WHERE user_id = $1`,
      [userId, next?.ciphertext ?? null, next?.iv ?? null, next?.tag ?? null, tokens.scope ?? null],
    );
    // Cached before the lock is released, so a disconnect waiting for it revokes this lineage's latest.
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

/** Tests and the live check: a refresh that doesn't share one in progress (only the row lock orders them). */
export const refreshNowForTests = (userId: string) => refreshLocked(userId);

/** Revoke on Canva (the refresh token's whole lineage, and the consent) and delete everything stored. */
export async function disconnectCanva(userId: string) {
  let revoked = false;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query<ConnectionRow>("SELECT * FROM curialy.canva_connections WHERE user_id = $1 FOR UPDATE", [userId]);
    const cached = accessTokens.get(userId)?.token;
    accessTokens.delete(userId);
    if (canvaConfigured() && row) {
      let token: string | null = null;
      if (row.refresh_ciphertext && row.refresh_iv && row.refresh_tag) {
        try { token = unseal({ ciphertext: row.refresh_ciphertext, iv: row.refresh_iv, tag: row.refresh_tag }); } catch { /* unreadable */ }
      }
      for (const value of [token, token ? null : cached].filter((item): item is string => Boolean(item))) {
        const response = await fetch(REVOKE_URL, {
          method: "POST",
          headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: value }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }).catch(() => null);
        if (response?.ok) revoked = true;
        else console.warn(`[canva] token revocation answered ${response?.status ?? "nothing"}; the stored connection is deleted anyway`);
      }
    }
    await client.query("DELETE FROM curialy.canva_connections WHERE user_id = $1", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { revoked };
}

// ---- The REST API ----

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

/**
 * A REST API call with the account's own token. 401: the token is renewed once and the call
 * retried. 400, 403, 404 and 429 come back as CanvaErrors whose message says what to do.
 */
export async function canvaRequest<T = any>(userId: string, method: "GET" | "POST", path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(userId, { force: attempt > 0 });
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      response = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      throw new CanvaError("unavailable", "Canva couldn't be reached. Try again in a moment.");
    }
    if (response.ok) return (await response.json()) as T;
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    const code = errorCode(body);
    const detail = typeof body?.message === "string" ? ` (${body.message.slice(0, 200)})` : "";
    // A token Canva no longer accepts: renew it once (the refresh itself says whether the connection still works).
    if (response.status === 401 && attempt === 0 && method === "GET") continue;
    if (response.status === 401 && attempt === 0 && ["invalid_access_token", "revoked_access_token"].includes(code)) continue;
    if (response.status === 401) throw new CanvaError("forbidden", `Canva didn't accept this connection for that request${detail}. Reconnect Canva if it keeps happening.`, 401);
    if (response.status === 403) {
      const scope = code === "missing_scope" ? " The connection is missing a permission (scope) this needs: it has to be enabled for the app in the Canva Developer Portal, then the user reconnects Canva." : " The connected Canva account may not have access to it.";
      throw new CanvaError("forbidden", `Canva didn't allow this${detail}.${scope}`, 403);
    }
    if (response.status === 404) throw new CanvaError("not_found", `Canva found nothing there${detail}. Check the id.`, 404);
    if (response.status === 429) {
      const wait = retryAfter(response);
      throw new CanvaError("rate_limited", `Canva is rate limiting this account's requests; try again in ${describeWait(wait)}.`, 429, wait);
    }
    if (response.status === 400) throw new CanvaError("invalid", `Canva refused the request${detail}.`, 400);
    if (response.status >= 500) throw new CanvaError("unavailable", "Canva had a temporary error. Try again in a moment.", response.status);
    throw new CanvaError("failed", `Canva refused the request${detail}.`, response.status);
  }
}
