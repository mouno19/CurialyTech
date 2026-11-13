import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Connect Vercel end to end on an in-process server: the sign-in (PKCE, state bound to the account,
// nonce in a signed ID token), the stored refresh token (encrypted, rotated under a row lock), the
// REST errors, and the agent's tools (always the task owner's own token). Vercel is a fake behind
// fetch; the database is the one table these modules use, with Postgres's row lock imitated.

process.env.VERCEL_CLIENT_ID = "cl_test";
process.env.VERCEL_CLIENT_SECRET = "secret_test";
process.env.VERCEL_REDIRECT_URI = "https://curialy.test/auth/vercel/callback";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

type Row = {
  user_id: string; vercel_user_id: string; username: string | null; name: string | null; email: string | null; avatar_url: string | null; scopes: string;
  status: "connected" | "reconnect"; status_reason: string | null; refresh_ciphertext: Buffer | null; refresh_iv: Buffer | null; refresh_tag: Buffer | null;
  connected_at: Date; refreshed_at: Date | null; updated_at: Date;
};

const store = vi.hoisted(() => ({ rows: new Map<string, any>(), locks: new Map<string, Promise<void>>(), owners: {} as Record<string, string>, busy: false }));

vi.mock("./db/pg", () => {
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  const apply = (text: string, values: any[] = []) => {
    const sql = norm(text);
    const row = store.rows.get(values[0]);
    if (sql.startsWith("INSERT INTO curialy.vercel_connections")) {
      const [userId, sub, username, name, email, picture, scopes, ciphertext, iv, tag] = values;
      const now = new Date();
      store.rows.set(userId, { user_id: userId, vercel_user_id: sub, username, name, email, avatar_url: picture, scopes, status: "connected", status_reason: null, refresh_ciphertext: ciphertext, refresh_iv: iv, refresh_tag: tag, connected_at: now, refreshed_at: now, updated_at: now });
      return { rows: [] };
    }
    if (sql === "SELECT * FROM curialy.vercel_connections WHERE user_id = $1") return { rows: row ? [{ ...row }] : [] };
    if (sql === "SELECT name, username, status FROM curialy.vercel_connections WHERE user_id = $1") return { rows: row ? [{ name: row.name, username: row.username, status: row.status }] : [] };
    if (sql.startsWith("UPDATE curialy.vercel_connections SET status = 'reconnect'")) {
      if (row) Object.assign(row, { status: "reconnect", status_reason: values[1], refresh_ciphertext: null, refresh_iv: null, refresh_tag: null });
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE curialy.vercel_connections SET refresh_ciphertext = COALESCE")) {
      const [, ciphertext, iv, tag, scopes] = values;
      if (row) Object.assign(row, { refresh_ciphertext: ciphertext ?? row.refresh_ciphertext, refresh_iv: iv ?? row.refresh_iv, refresh_tag: tag ?? row.refresh_tag, scopes: scopes ?? row.scopes, refreshed_at: new Date() });
      return { rows: [] };
    }
    if (sql === "DELETE FROM curialy.vercel_connections WHERE user_id = $1") {
      store.rows.delete(values[0]);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
  };
  return {
    query: vi.fn(async (text: string, values?: any[]) => apply(text, values)),
    db: () => ({
      connect: async () => {
        let release: (() => void) | null = null;
        const unlock = () => { release?.(); release = null; };
        return {
          query: async (text: string, values: any[] = []) => {
            const sql = norm(text);
            if (sql === "BEGIN") return { rows: [] };
            if (sql === "COMMIT" || sql === "ROLLBACK") { unlock(); return { rows: [] }; }
            if (sql.endsWith("FOR UPDATE")) {
              // Postgres's row lock: the next transaction to ask waits until this one ends.
              const userId = values[0];
              while (store.locks.has(userId)) await store.locks.get(userId);
              store.locks.set(userId, new Promise<void>(resolve => { release = () => { store.locks.delete(userId); resolve(); }; }));
              return apply(sql.replace(/ FOR UPDATE$/, ""), values);
            }
            return apply(text, values);
          },
          release: unlock,
        };
      },
    }),
  };
});

vi.mock("./auth", async importOriginal => {
  const actual = await importOriginal<typeof import("./auth")>();
  const who = (req: { headers: Record<string, unknown> }) => {
    const id = req.headers["x-test-user"];
    return typeof id === "string" ? { id, role: "user" as const, login: id, displayName: id, avatarUrl: null, email: null } : null;
  };
  return { ...actual, currentUser: async (req: never) => who(req), rateLimited: () => store.busy };
});

vi.mock("./agent/store", () => ({ taskOwner: async (id: string) => store.owners[id] ?? null }));

// ---- A fake Vercel ----

type ApiHandler = (url: URL, token: string) => { status: number; body: unknown; headers?: Record<string, string> };
const fake = {
  /** Refresh tokens Vercel would accept now; each is single use. */
  valid: new Set<string>(),
  issued: 0,
  codes: new Map<string, { challenge: string; nonce: string; sub: string; refresh?: boolean }>(),
  tokenRequests: [] as URLSearchParams[],
  revoked: [] as { token: string; authorization: string | null }[],
  apiCalls: [] as { path: string; token: string }[],
  api: null as ApiHandler | null,
  /** Answer the token endpoint like this instead (an outage, a bad client secret). */
  tokenFailure: null as { status: number; body: unknown } | null,
  tokenDelayMs: 15,
};
let signKey: CryptoKey;
let idTokenNonce: (nonce: string) => string = nonce => nonce;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function tokenEndpoint(params: URLSearchParams) {
  fake.tokenRequests.push(params);
  await new Promise(resolve => setTimeout(resolve, fake.tokenDelayMs));
  if (fake.tokenFailure) return json(fake.tokenFailure.status, fake.tokenFailure.body);
  if (params.get("client_id") !== "cl_test" || params.get("client_secret") !== "secret_test") return json(401, { error: "invalid_client" });
  const issue = async (sub: string, nonce: string | null, refresh = true) => {
    const n = ++fake.issued;
    const refreshToken = `vcr_${n}`;
    if (refresh) fake.valid.add(refreshToken);
    const idToken = nonce === null ? undefined : await new SignJWT({ nonce: idTokenNonce(nonce), name: "Jane Doe", preferred_username: "jane", email: "jane@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://vercel.com").setAudience("cl_test").setSubject(sub).setIssuedAt().setExpirationTime("10m").sign(signKey);
    return json(200, { access_token: `vca_${n}`, token_type: "Bearer", expires_in: 3600, scope: "openid profile email offline_access", ...(refresh ? { refresh_token: refreshToken } : {}), ...(idToken ? { id_token: idToken } : {}) });
  };
  if (params.get("grant_type") === "authorization_code") {
    const code = fake.codes.get(params.get("code") ?? "");
    fake.codes.delete(params.get("code") ?? "");
    const verifier = params.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!code || code.challenge !== challenge || params.get("redirect_uri") !== process.env.VERCEL_REDIRECT_URI) return json(400, { error: "invalid_grant" });
    return issue(code.sub, code.nonce, code.refresh !== false);
  }
  if (params.get("grant_type") === "refresh_token") {
    const token = params.get("refresh_token") ?? "";
    if (!fake.valid.delete(token)) return json(400, { error: "invalid_grant", error_description: "The refresh token is invalid." });
    return issue("vercel-user-1", null);
  }
  return json(400, { error: "unsupported_grant_type" });
}

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const headers = new Headers(init.headers);
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  if (url.href === "https://api.vercel.com/login/oauth/token") return tokenEndpoint(new URLSearchParams(String(init.body)));
  if (url.href === "https://api.vercel.com/login/oauth/token/revoke") {
    fake.revoked.push({ token: new URLSearchParams(String(init.body)).get("token") ?? "", authorization: headers.get("authorization") });
    return json(200, {});
  }
  if (url.hostname === "api.vercel.com") {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    fake.apiCalls.push({ path: `${url.pathname}${url.search}`, token });
    const answer = fake.api?.(url, token) ?? { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
    return json(answer.status, answer.body, answer.headers);
  }
  throw new Error(`unexpected request to ${url.href}`);
});

const vercel = await import("./services/vercel");
const { registerVercelAuth } = await import("./auth-vercel");
const { runVercelTool, deploymentRef } = await import("./agent/vercel-tools");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signKey = pair.privateKey as CryptoKey;
  vercel.useJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256" }] }));
  const app = express();
  registerVercelAuth(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  store.rows.clear();
  store.locks.clear();
  store.owners = {};
  store.busy = false;
  Object.assign(fake, { valid: new Set(), issued: 0, codes: new Map(), tokenRequests: [], revoked: [], apiCalls: [], api: null, tokenFailure: null, tokenDelayMs: 15 });
  idTokenNonce = nonce => nonce;
  vercel.resetVercelTokens();
});

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { redirect: "manual", headers });
const cookieOf = (response: Response) => response.headers.getSetCookie().find(cookie => cookie.startsWith("curialy_vercel_oauth="));

/** Start a sign-in as `user` and have "Vercel" approve it: the callback's path, and the cookie to send with it. */
async function approve(user: string, opts: { refresh?: boolean; sub?: string } = {}) {
  const start = await get("/auth/vercel/start", { "x-test-user": user });
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  const code = `code_${randomBytes(6).toString("hex")}`;
  fake.codes.set(code, { challenge: authorize.searchParams.get("code_challenge")!, nonce: authorize.searchParams.get("nonce")!, sub: opts.sub ?? "vercel-user-1", refresh: opts.refresh });
  const cookie = cookieOf(start)!.split(";")[0];
  return { path: `/auth/vercel/callback?code=${code}&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`, cookie, authorize };
}

async function connect(user: string) {
  const { path, cookie } = await approve(user);
  const done = await get(path, { "x-test-user": user, cookie });
  expect(done.headers.get("location")).toBe("/?vercel=connected");
}

const storedToken = (user: string) => {
  const row = store.rows.get(user) as Row | undefined;
  return row?.refresh_ciphertext ? vercel.unseal({ ciphertext: row.refresh_ciphertext, iv: row.refresh_iv!, tag: row.refresh_tag! }) : null;
};

describe("encryption", () => {
  it("round-trips, and refuses tampered data", () => {
    const sealed = vercel.seal("vcr_secret");
    expect(sealed.ciphertext.includes(Buffer.from("vcr_secret"))).toBe(false);
    expect(sealed.iv).toHaveLength(12);
    expect(vercel.unseal(sealed)).toBe("vcr_secret");
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] ^= 1;
    expect(() => vercel.unseal({ ...sealed, ciphertext: flipped })).toThrow();
    expect(vercel.unsealString("not-a-sealed-value")).toBeNull();
    expect(vercel.unsealString(vercel.sealString("hello"))).toBe("hello");
  });

  it("is not configured without a 32-byte key", () => {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    try {
      expect(vercel.vercelConfigured()).toBe(false);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = key;
    }
    expect(vercel.vercelConfigured()).toBe(true);
  });
});

describe("sign-in", () => {
  it("asks for the identity scopes with PKCE (S256), a state and a nonce; the cookie is sealed and scoped to the callback", async () => {
    const start = await get("/auth/vercel/start", { "x-test-user": "user-a" });
    const authorize = new URL(start.headers.get("location")!);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://vercel.com/oauth/authorize");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({ client_id: "cl_test", redirect_uri: process.env.VERCEL_REDIRECT_URI, response_type: "code", scope: "openid profile email offline_access", code_challenge_method: "S256" });
    expect(authorize.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(authorize.searchParams.get("prompt")).toBeNull();
    const cookie = cookieOf(start)!;
    expect(cookie).toMatch(/Path=\/auth\/vercel\/callback/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    // Neither the state nor the nonce can be read from the cookie.
    expect(cookie).not.toContain(authorize.searchParams.get("state")!);
    expect(cookie).not.toContain(authorize.searchParams.get("nonce")!);
    const again = await get("/auth/vercel/start?prompt=consent", { "x-test-user": "user-a" });
    expect(new URL(again.headers.get("location")!).searchParams.get("prompt")).toBe("consent");
  });

  it("needs a signed-in account, and is rate limited", async () => {
    const start = await get("/auth/vercel/start");
    expect(start.headers.get("location")).toBe("/login");
    store.busy = true;
    expect((await get("/auth/vercel/start", { "x-test-user": "user-a" })).headers.get("location")).toBe("/?vercel=busy");
  });

  it("connects: the refresh token is stored encrypted, and the status shows the account and never a token", async () => {
    await connect("user-a");
    const row = store.rows.get("user-a") as Row;
    expect(row).toMatchObject({ vercel_user_id: "vercel-user-1", name: "Jane Doe", username: "jane", email: "jane@example.com", status: "connected", scopes: "openid profile email offline_access" });
    expect(row.refresh_ciphertext!.includes(Buffer.from("vcr_1"))).toBe(false);
    expect(storedToken("user-a")).toBe("vcr_1");
    const exchange = fake.tokenRequests[0];
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code_verifier")).toMatch(/^[\w-]{43}$/);
    const status = await get("/auth/vercel/status", { "x-test-user": "user-a" });
    const text = await status.text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, connected: true, needsReconnect: false, name: "Jane Doe", username: "jane", scopes: ["openid", "profile", "email", "offline_access"] });
    expect(text).not.toMatch(/vc[ar]_/);
    expect((await get("/auth/vercel/status")).status).toBe(401);
  });

  it("refuses a state that doesn't match, without asking Vercel for a token", async () => {
    const { path, cookie } = await approve("user-a");
    const forged = path.replace(/state=[^&]+/, "state=forged");
    const done = await get(forged, { "x-test-user": "user-a", cookie });
    expect(done.headers.get("location")).toBe("/?vercel=state_mismatch");
    expect(fake.tokenRequests).toHaveLength(0);
    expect(store.rows.size).toBe(0);
    // And without the cookie (another browser).
    expect((await get(path, { "x-test-user": "user-a" })).headers.get("location")).toBe("/?vercel=state_mismatch");
  });

  it("completes only for the account that started it", async () => {
    const { path, cookie } = await approve("user-a");
    const done = await get(path, { "x-test-user": "user-b", cookie });
    expect(done.headers.get("location")).toBe("/?vercel=state_mismatch");
    expect(fake.tokenRequests).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it("expires after ten minutes", async () => {
    const { path, cookie } = await approve("user-a");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60_000 });
    try {
      expect((await get(path, { "x-test-user": "user-a", cookie })).headers.get("location")).toBe("/?vercel=state_mismatch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks the nonce in the signed ID token", async () => {
    idTokenNonce = () => "someone-elses-nonce";
    const { path, cookie } = await approve("user-a");
    const done = await get(path, { "x-test-user": "user-a", cookie });
    expect(done.headers.get("location")).toBe("/?vercel=error");
    expect(store.rows.size).toBe(0);
  });

  it("needs offline access (a refresh token)", async () => {
    const { path, cookie } = await approve("user-a", { refresh: false });
    expect((await get(path, { "x-test-user": "user-a", cookie })).headers.get("location")).toBe("/?vercel=no_offline_access");
    expect(store.rows.size).toBe(0);
  });

  it("reports a cancelled consent", async () => {
    const { path, cookie } = await approve("user-a");
    const denied = path.replace(/code=[^&]+/, "error=access_denied");
    expect((await get(denied, { "x-test-user": "user-a", cookie })).headers.get("location")).toBe("/?vercel=denied");
  });

  it("disconnect revokes the token on Vercel and deletes the row; never from another site", async () => {
    await connect("user-a");
    const crossSite = await fetch(`${base}/auth/vercel/disconnect`, { method: "POST", headers: { "x-test-user": "user-a", origin: "https://evil.example" } });
    expect(crossSite.status).toBe(403);
    expect(store.rows.has("user-a")).toBe(true);
    const done = await fetch(`${base}/auth/vercel/disconnect`, { method: "POST", headers: { "x-test-user": "user-a", origin: base } });
    expect(await done.json()).toEqual({ ok: true, revoked: true });
    expect(store.rows.has("user-a")).toBe(false);
    expect(fake.revoked.map(entry => entry.token)).toContain("vcr_1");
    expect(fake.revoked[0].authorization).toBe(`Basic ${Buffer.from("cl_test:secret_test").toString("base64")}`);
    const status = await (await get("/auth/vercel/status", { "x-test-user": "user-a" })).json();
    expect(status).toMatchObject({ connected: false, needsReconnect: false });
  });
});

describe("refreshing", () => {
  it("keeps the access token for its hour, then stores the rotated refresh token", async () => {
    await connect("user-a");
    expect(await vercel.accessToken("user-a")).toBe("vca_1");
    expect(fake.tokenRequests).toHaveLength(1);
    vercel.resetVercelTokens();
    expect(await vercel.accessToken("user-a")).toBe("vca_2");
    expect(fake.tokenRequests[1].get("refresh_token")).toBe("vcr_1");
    expect(storedToken("user-a")).toBe("vcr_2");
    // The used one is gone on Vercel's side; the stored one still works.
    expect(await vercel.accessToken("user-a", { force: true })).toBe("vca_3");
    expect(storedToken("user-a")).toBe("vcr_3");
  });

  it("shares one refresh between requests at the same time", async () => {
    await connect("user-a");
    const tokens = await Promise.all([vercel.accessToken("user-a", { force: true }), vercel.accessToken("user-a", { force: true }), vercel.accessToken("user-a", { force: true })]);
    expect(new Set(tokens)).toEqual(new Set(["vca_2"]));
    expect(fake.tokenRequests.filter(params => params.get("grant_type") === "refresh_token")).toHaveLength(1);
  });

  it("orders refreshes from separate processes with the row lock, so none sends a used token", async () => {
    await connect("user-a");
    const results = await Promise.all([vercel.refreshNowForTests("user-a"), vercel.refreshNowForTests("user-a"), vercel.refreshNowForTests("user-a")]);
    expect(results.sort()).toEqual(["vca_2", "vca_3", "vca_4"]);
    expect(fake.tokenRequests.slice(1).map(params => params.get("refresh_token"))).toEqual(["vcr_1", "vcr_2", "vcr_3"]);
    expect(storedToken("user-a")).toBe("vcr_4");
    expect(store.rows.get("user-a").status).toBe("connected");
  });

  it("a disconnect during a refresh waits for it, and revokes the tokens it got", async () => {
    await connect("user-a");
    fake.tokenDelayMs = 60;
    const refreshing = vercel.refreshNowForTests("user-a");
    await new Promise(resolve => setTimeout(resolve, 15));
    const disconnected = fetch(`${base}/auth/vercel/disconnect`, { method: "POST", headers: { "x-test-user": "user-a" } });
    expect(await refreshing).toBe("vca_2");
    expect(await (await disconnected).json()).toEqual({ ok: true, revoked: true });
    expect(fake.revoked.map(entry => entry.token).sort()).toEqual(["vca_2", "vcr_2"]);
    expect(store.rows.has("user-a")).toBe(false);
    await expect(vercel.accessToken("user-a")).rejects.toMatchObject({ kind: "not_connected" });
  });

  it("a refresh token Vercel no longer accepts marks the connection for reconnecting", async () => {
    await connect("user-a");
    fake.valid.clear();
    vercel.resetVercelTokens();
    await expect(vercel.accessToken("user-a")).rejects.toMatchObject({ kind: "reconnect" });
    expect(store.rows.get("user-a")).toMatchObject({ status: "reconnect", status_reason: "refresh_rejected", refresh_ciphertext: null });
    const status = await (await get("/auth/vercel/status", { "x-test-user": "user-a" })).json();
    expect(status).toMatchObject({ connected: false, needsReconnect: true, name: "Jane Doe" });
    // No further requests with it.
    const before = fake.tokenRequests.length;
    await expect(vercel.vercelGet("user-a", "/v2/user")).rejects.toMatchObject({ kind: "reconnect" });
    expect(fake.tokenRequests).toHaveLength(before);
    // Connecting again restores it.
    await connect("user-a");
    expect(store.rows.get("user-a")).toMatchObject({ status: "connected", status_reason: null });
  });

  it("a refused client (this server's credentials) or an outage leaves the connection as it is", async () => {
    await connect("user-a");
    vercel.resetVercelTokens();
    fake.tokenFailure = { status: 401, body: { error: "invalid_client" } };
    await expect(vercel.accessToken("user-a")).rejects.toMatchObject({ kind: "unavailable" });
    fake.tokenFailure = { status: 503, body: {} };
    await expect(vercel.accessToken("user-a")).rejects.toMatchObject({ kind: "unavailable" });
    expect(store.rows.get("user-a").status).toBe("connected");
    fake.tokenFailure = null;
    expect(await vercel.accessToken("user-a")).toBe("vca_2");
  });

  it("a row that no longer decrypts (the key changed) asks for a reconnect", async () => {
    await connect("user-a");
    vercel.resetVercelTokens();
    store.rows.get("user-a").refresh_tag = Buffer.alloc(16);
    await expect(vercel.accessToken("user-a")).rejects.toMatchObject({ kind: "reconnect" });
    expect(store.rows.get("user-a")).toMatchObject({ status: "reconnect", status_reason: "unreadable" });
  });
});

describe("REST API", () => {
  it("renews a token Vercel stopped accepting once, and retries", async () => {
    await connect("user-a");
    fake.api = (_url, token) => (token === "vca_1" ? { status: 401, body: { error: { message: "invalid token" } } } : { status: 200, body: { user: { username: "jane" } } });
    expect(await vercel.vercelGet("user-a", "/v2/user")).toEqual({ user: { username: "jane" } });
    expect(fake.apiCalls.map(call => call.token)).toEqual(["vca_1", "vca_2"]);
  });

  it("explains 403, 404 and 429", async () => {
    await connect("user-a");
    fake.api = () => ({ status: 403, body: { error: { code: "forbidden", message: "Not authorized" } } });
    await expect(vercel.vercelGet("user-a", "/v10/projects")).rejects.toMatchObject({ kind: "forbidden", status: 403, message: expect.stringMatching(/reconnect Vercel and grant access/) });
    fake.api = () => ({ status: 404, body: {} });
    await expect(vercel.vercelGet("user-a", "/v13/deployments/dpl_x")).rejects.toMatchObject({ kind: "not_found" });
    fake.api = () => ({ status: 429, body: {}, headers: { "retry-after": "42" } });
    await expect(vercel.vercelGet("user-a", "/v7/deployments")).rejects.toMatchObject({ kind: "rate_limited", retryAfterSec: 42, message: expect.stringMatching(/42 seconds/) });
    fake.api = () => ({ status: 429, body: {}, headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 300) } });
    await expect(vercel.vercelGet("user-a", "/v7/deployments")).rejects.toMatchObject({ kind: "rate_limited", message: expect.stringMatching(/about 5 minutes/) });
    fake.api = () => ({ status: 429, body: {} });
    await expect(vercel.vercelGet("user-a", "/v7/deployments")).rejects.toMatchObject({ kind: "rate_limited", retryAfterSec: 60 });
    // None of these is the connection's fault.
    expect(store.rows.get("user-a").status).toBe("connected");
  });
});

describe("agent tools", () => {
  it("always use the task owner's own token", async () => {
    await connect("user-a");
    await connect("user-b");
    store.owners = { "task-a": "user-a", "task-b": "user-b" };
    fake.api = () => ({ status: 200, body: { projects: [], pagination: {} } });
    await runVercelTool("vercel_list_projects", { limit: 5 }, "task-b");
    await runVercelTool("vercel_list_projects", { limit: 5 }, "task-a");
    const projectCalls = fake.apiCalls.filter(call => call.path.startsWith("/v10/projects"));
    expect(projectCalls.map(call => call.token)).toEqual(["vca_2", "vca_1"]);
    const unknown = await runVercelTool("vercel_list_projects", { limit: 5 }, "task-of-nobody");
    expect(unknown).toMatchObject({ ok: false, summary: "Vercel not available" });
  });

  it("lists projects without their environment variables", async () => {
    await connect("user-a");
    store.owners = { task: "user-a" };
    fake.api = url => url.pathname === "/v2/teams"
      ? { status: 200, body: { teams: [{ id: "team_1", slug: "acme", name: "Acme Inc" }] } }
      : { status: 200, body: { projects: [{ id: "prj_1", name: "shop", framework: "nextjs", updatedAt: 1794500000000, env: [{ key: "STRIPE_KEY", value: "sk_live_supersecret" }], link: { type: "github", org: "jane", repo: "shop", productionBranch: "main" }, latestDeployments: [{ uid: "dpl_9", readyState: "ERROR" }], targets: { production: { alias: ["shop.example.com"] } } }], pagination: { next: null } } };
    const result = await runVercelTool("vercel_list_projects", { limit: 20 }, "task");
    expect(result.ok).toBe(true);
    expect(result.content).toContain("shop · prj_1 · nextjs");
    expect(result.content).toContain("git: github jane/shop (production branch main)");
    expect(result.content).toContain("latest deployment: ERROR dpl_9");
    expect(result.content).toContain("production: https://shop.example.com");
    expect(result.content).toContain("Teams (pass one as team for its projects): acme (Acme Inc)");
    expect(result.content).not.toMatch(/supersecret|STRIPE_KEY/);
    await runVercelTool("vercel_list_projects", { team: "team_1", limit: 20 }, "task");
    expect(fake.apiCalls.at(-1)!.path).toContain("teamId=team_1");
    await runVercelTool("vercel_list_projects", { team: "acme", limit: 20 }, "task");
    expect(fake.apiCalls.at(-1)!.path).toContain("slug=acme");
  });

  it("lists deployments and shows one's status", async () => {
    await connect("user-a");
    store.owners = { task: "user-a" };
    const deployment = { uid: "dpl_1", id: "dpl_1", name: "shop", readyState: "ERROR", target: "production", createdAt: 1794500000000, url: "shop-abc.vercel.app", meta: { githubCommitOrg: "jane", githubCommitRepo: "shop", githubCommitRef: "main", githubCommitSha: "1a2b3c4d5e", githubCommitMessage: "Fix the header\n\nlonger body" }, errorCode: "BUILD_FAILED", errorMessage: "Command \"npm run build\" exited with 1", inspectorUrl: "https://vercel.com/jane/shop/abc" };
    fake.api = url => (url.pathname === "/v7/deployments" ? { status: 200, body: { deployments: [deployment], pagination: {} } } : { status: 200, body: deployment });
    const listed = await runVercelTool("vercel_list_deployments", { project: "shop", state: "ERROR", limit: 10 }, "task");
    expect(listed.content).toContain("dpl_1 · shop · ERROR · production");
    expect(listed.content).toContain('jane/shop main 1a2b3c4 "Fix the header"');
    expect(fake.apiCalls.at(-1)!.path).toMatch(/projectId=shop.*state=ERROR|state=ERROR.*projectId=shop/);
    const one = await runVercelTool("vercel_get_deployment", { deployment: "https://shop-abc.vercel.app/some/page" }, "task");
    expect(fake.apiCalls.at(-1)!.path).toBe("/v13/deployments/shop-abc.vercel.app");
    expect(one.content).toContain("State: ERROR · production");
    expect(one.content).toContain('Error: BUILD_FAILED: Command "npm run build" exited with 1');
    expect(one.summary).toBe("shop: ERROR");
  });

  it("reads build logs as their head, errors and tail, and errors alone on request", async () => {
    await connect("user-a");
    store.owners = { task: "user-a" };
    const events = Array.from({ length: 300 }, (_, index) => ({ type: "stdout", created: 1000 + index, payload: { text: `step ${index}`, date: 1000 + index, id: String(index), serial: String(index), deploymentId: "dpl_1" } }));
    events[150] = { type: "stderr", created: 1150, payload: { text: "Error: Cannot find module 'left-pad'", date: 1150, id: "150", serial: "150", deploymentId: "dpl_1" } };
    events.push({ type: "command", created: 2000, payload: { text: "npm run build", date: 2000, id: "c", serial: "c", deploymentId: "dpl_1" } } as never);
    // Read backward: newest first.
    fake.api = () => ({ status: 200, body: [...events].reverse() });
    const digest = await runVercelTool("vercel_build_logs", { deployment: "dpl_1", errors_only: false }, "task");
    const call = new URL(`https://api.vercel.com${fake.apiCalls.at(-1)!.path}`);
    expect(Object.fromEntries(call.searchParams)).toMatchObject({ builds: "1", direction: "backward", follow: "0", limit: "2000" });
    expect(digest.content).toContain("step 0");
    expect(digest.content).toContain("Error: Cannot find module 'left-pad'");
    expect(digest.content).toContain("$ npm run build");
    expect(digest.content).toContain("Pass errors_only: true");
    expect(digest.content).not.toContain("step 100\n");
    const errors = await runVercelTool("vercel_build_logs", { deployment: "dpl_1", errors_only: true }, "task");
    expect(errors.content).toBe("1 error and warning line in the build log of dpl_1:\nError: Cannot find module 'left-pad'");
  });

  it("takes a deployment as an id, a URL or the dashboard's link", () => {
    expect(deploymentRef("dpl_abc")).toBe("dpl_abc");
    expect(deploymentRef("https://shop-abc.vercel.app/x?y")).toBe("shop-abc.vercel.app");
    expect(deploymentRef("shop-abc.vercel.app/path")).toBe("shop-abc.vercel.app");
    expect(deploymentRef("https://vercel.com/jane/shop/J1hXN00qjUeo")).toBe("dpl_J1hXN00qjUeo");
    expect(() => deploymentRef("../../v2/user?x=1")).toThrow(/deployment:/);
  });
});
