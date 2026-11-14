import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventBody } from "@shared/agent";

// Connect Canva end to end on an in-process server: the sign-in (PKCE S256, exactly the enabled
// scopes, a state bound to the account, Basic client authentication), the stored refresh token
// (encrypted, rotated under a row lock), the REST errors, and the agent's tools (the task owner's
// own token; creating a design only after the user approves exactly what it will be). Canva is a
// fake behind fetch; the database is the one table these modules use, with Postgres's row lock imitated.

process.env.CANVA_CLIENT_ID = "OC-test";
process.env.CANVA_CLIENT_SECRET = "cnvca-test-secret";
process.env.CANVA_REDIRECT_URI = "https://curialy.test/auth/canva/callback";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
delete process.env.CANVA_SCOPES;

const store = vi.hoisted(() => ({ rows: new Map<string, any>(), locks: new Map<string, Promise<void>>(), owners: {} as Record<string, string> }));

vi.mock("./db/pg", () => {
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  const apply = (text: string, values: any[] = []) => {
    const sql = norm(text);
    const row = store.rows.get(values[0]);
    if (sql.startsWith("INSERT INTO curialy.canva_connections")) {
      const [userId, canvaUser, team, name, scopes, ciphertext, iv, tag] = values;
      const now = new Date();
      store.rows.set(userId, { user_id: userId, canva_user_id: canvaUser, canva_team_id: team, display_name: name, scopes, status: "connected", status_reason: null, refresh_ciphertext: ciphertext, refresh_iv: iv, refresh_tag: tag, connected_at: now, refreshed_at: now });
      return { rows: [] };
    }
    if (sql === "SELECT * FROM curialy.canva_connections WHERE user_id = $1") return { rows: row ? [{ ...row }] : [] };
    if (sql === "SELECT display_name, scopes, status FROM curialy.canva_connections WHERE user_id = $1") return { rows: row ? [{ display_name: row.display_name, scopes: row.scopes, status: row.status }] : [] };
    if (sql.startsWith("UPDATE curialy.canva_connections SET status = 'reconnect'")) {
      if (row) Object.assign(row, { status: "reconnect", status_reason: values[1], refresh_ciphertext: null, refresh_iv: null, refresh_tag: null });
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE curialy.canva_connections SET refresh_ciphertext = COALESCE")) {
      const [, ciphertext, iv, tag, scopes] = values;
      if (row) Object.assign(row, { refresh_ciphertext: ciphertext ?? row.refresh_ciphertext, refresh_iv: iv ?? row.refresh_iv, refresh_tag: tag ?? row.refresh_tag, scopes: scopes ?? row.scopes, refreshed_at: new Date() });
      return { rows: [] };
    }
    if (sql === "DELETE FROM curialy.canva_connections WHERE user_id = $1") { store.rows.delete(values[0]); return { rows: [] }; }
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
  return { ...actual, currentUser: async (req: never) => who(req), rateLimited: () => false };
});

vi.mock("./agent/store", () => ({ taskOwner: async (id: string) => store.owners[id] ?? null }));

// ---- A fake Canva ----

const BASIC = `Basic ${Buffer.from("OC-test:cnvca-test-secret").toString("base64")}`;
const fake = {
  valid: new Set<string>(),
  issued: 0,
  codes: new Map<string, { challenge: string; user: string }>(),
  tokenRequests: [] as { params: URLSearchParams; authorization: string | null }[],
  revoked: [] as { token: string; authorization: string | null }[],
  apiCalls: [] as { method: string; path: string; token: string; body: any }[],
  api: null as null | ((method: string, url: URL, body: any) => { status: number; body: unknown; headers?: Record<string, string> }),
  tokenFailure: null as { status: number; body: unknown } | null,
  tokenDelayMs: 15,
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const tokenUser = new Map<string, string>();

async function tokenEndpoint(params: URLSearchParams, authorization: string | null) {
  fake.tokenRequests.push({ params, authorization });
  await new Promise(resolve => setTimeout(resolve, fake.tokenDelayMs));
  if (fake.tokenFailure) return json(fake.tokenFailure.status, fake.tokenFailure.body);
  if (authorization !== BASIC) return json(401, { code: "invalid_client", message: "Client secret is invalid" });
  const issue = (user: string) => {
    const n = ++fake.issued;
    fake.valid.add(`rt_${n}`);
    tokenUser.set(`at_${n}`, user);
    return json(200, { access_token: `at_${n}`, refresh_token: `rt_${n}`, token_type: "Bearer", expires_in: 14400, scope: "design:content:read design:content:write design:meta:read folder:read asset:read asset:write profile:read" });
  };
  if (params.get("grant_type") === "authorization_code") {
    const code = fake.codes.get(params.get("code") ?? "");
    fake.codes.delete(params.get("code") ?? "");
    const challenge = createHash("sha256").update(params.get("code_verifier") ?? "").digest("base64url");
    if (!code || code.challenge !== challenge || params.get("redirect_uri") !== process.env.CANVA_REDIRECT_URI) return json(400, { code: "invalid_grant", message: "Invalid code" });
    return issue(code.user);
  }
  if (params.get("grant_type") === "refresh_token") {
    if (!fake.valid.delete(params.get("refresh_token") ?? "")) return json(400, { code: "invalid_grant", message: "Invalid refresh token" });
    return issue("canva-user-1");
  }
  return json(400, { code: "unsupported_grant_type", message: "?" });
}

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const headers = new Headers(init.headers);
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  if (url.href === "https://api.canva.com/rest/v1/oauth/token") return tokenEndpoint(new URLSearchParams(String(init.body)), headers.get("authorization"));
  if (url.href === "https://api.canva.com/rest/v1/oauth/revoke") {
    fake.revoked.push({ token: new URLSearchParams(String(init.body)).get("token") ?? "", authorization: headers.get("authorization") });
    return json(200, {});
  }
  if (url.hostname === "api.canva.com") {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const path = url.pathname.replace(/^\/rest/, "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    fake.apiCalls.push({ method: init.method ?? "GET", path: `${path}${url.search}`, token, body });
    if (path === "/v1/users/me") return json(200, { team_user: { user_id: tokenUser.get(token) ?? "canva-user-1", team_id: "team-1" } });
    if (path === "/v1/users/me/profile") return json(200, { profile: { display_name: "Jane Canva" } });
    const answer = fake.api?.(init.method ?? "GET", url, body) ?? { status: 404, body: { code: "not_found", message: "Not found" } };
    return json(answer.status, answer.body, answer.headers);
  }
  throw new Error(`unexpected request to ${url.href}`);
});

const canva = await import("./services/canva");
const { registerCanvaAuth } = await import("./auth-canva");
const { runCanvaTool, CANVA_SCHEMAS } = await import("./agent/canva-tools");
const requests = await import("./agent/requests");
const { unseal } = await import("./services/sealed");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  registerCanvaAuth(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  store.rows.clear();
  store.locks.clear();
  store.owners = {};
  Object.assign(fake, { valid: new Set(), issued: 0, codes: new Map(), tokenRequests: [], revoked: [], apiCalls: [], api: null, tokenFailure: null, tokenDelayMs: 15 });
  tokenUser.clear();
  canva.resetCanvaTokens();
  requests.resetRequests();
});

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { redirect: "manual", headers });
const cookieOf = (response: Response) => response.headers.getSetCookie().find(cookie => cookie.startsWith("curialy_canva_oauth="));

async function approve(user: string) {
  const start = await get("/auth/canva/start", { "x-test-user": user });
  const authorize = new URL(start.headers.get("location")!);
  const code = `code_${randomBytes(6).toString("hex")}`;
  fake.codes.set(code, { challenge: authorize.searchParams.get("code_challenge")!, user: `canva-${user}` });
  return { path: `/auth/canva/callback?code=${code}&state=${encodeURIComponent(authorize.searchParams.get("state")!)}`, cookie: cookieOf(start)!.split(";")[0], authorize, start };
}
async function connect(user: string) {
  const { path, cookie } = await approve(user);
  expect((await get(path, { "x-test-user": user, cookie })).headers.get("location")).toBe("/?canva=connected");
}
const storedToken = (user: string) => {
  const row = store.rows.get(user);
  return row?.refresh_ciphertext ? unseal({ ciphertext: row.refresh_ciphertext, iv: row.refresh_iv, tag: row.refresh_tag }) : null;
};

describe("sign-in", () => {
  it("asks for exactly the enabled scopes with PKCE S256 and a state; the verifier stays sealed on the server side", async () => {
    const { authorize, start } = await approve("user-a");
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://www.canva.com/api/oauth/authorize");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      code_challenge_method: "S256", response_type: "code", client_id: "OC-test", redirect_uri: process.env.CANVA_REDIRECT_URI,
      scope: "design:content:read design:content:write design:meta:read folder:read asset:read asset:write profile:read",
    });
    expect(authorize.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    const cookie = cookieOf(start)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/auth\/canva\/callback/);
    expect(cookie).not.toContain(authorize.searchParams.get("state")!);
    expect((await get("/auth/canva/start")).headers.get("location")).toBe("/login");
  });

  it("connects: Basic client authentication, the refresh token stored encrypted, the status names the account and holds no token", async () => {
    await connect("user-a");
    const exchange = fake.tokenRequests[0];
    expect(exchange.authorization).toBe(BASIC);
    expect(exchange.params.get("client_secret")).toBeNull();
    expect(exchange.params.get("code_verifier")).toMatch(/^[\w-]{128}$/);
    const row = store.rows.get("user-a");
    expect(row).toMatchObject({ canva_user_id: "canva-user-a", canva_team_id: "team-1", display_name: "Jane Canva", status: "connected" });
    expect(row.refresh_ciphertext.includes(Buffer.from("rt_1"))).toBe(false);
    expect(storedToken("user-a")).toBe("rt_1");
    const text = await (await get("/auth/canva/status", { "x-test-user": "user-a" })).text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, connected: true, needsReconnect: false, name: "Jane Canva" });
    expect(text).not.toMatch(/\b(rt|at)_\d/);
  });

  it("refuses a state that doesn't match, or another account's sign-in, without asking Canva for a token", async () => {
    const { path, cookie } = await approve("user-a");
    expect((await get(path.replace(/state=[^&]+/, "state=forged"), { "x-test-user": "user-a", cookie })).headers.get("location")).toBe("/?canva=state_mismatch");
    expect((await get(path, { "x-test-user": "user-b", cookie })).headers.get("location")).toBe("/?canva=state_mismatch");
    expect(fake.tokenRequests).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it("disconnect revokes the refresh token on Canva and deletes the row; never from another site", async () => {
    await connect("user-a");
    expect((await fetch(`${base}/auth/canva/disconnect`, { method: "POST", headers: { "x-test-user": "user-a", origin: "https://evil.example" } })).status).toBe(403);
    const done = await fetch(`${base}/auth/canva/disconnect`, { method: "POST", headers: { "x-test-user": "user-a", origin: base } });
    expect(await done.json()).toEqual({ ok: true, revoked: true });
    expect(fake.revoked).toEqual([{ token: "rt_1", authorization: BASIC }]);
    expect(store.rows.has("user-a")).toBe(false);
  });
});

describe("refreshing", () => {
  it("stores the rotated refresh token, and shares one refresh between requests at the same time", async () => {
    await connect("user-a");
    canva.resetCanvaTokens();
    const tokens = await Promise.all([canva.accessToken("user-a"), canva.accessToken("user-a"), canva.accessToken("user-a")]);
    expect(new Set(tokens)).toEqual(new Set(["at_2"]));
    expect(fake.tokenRequests.filter(entry => entry.params.get("grant_type") === "refresh_token")).toHaveLength(1);
    expect(storedToken("user-a")).toBe("rt_2");
  });

  it("orders refreshes from separate processes with the row lock, so none sends a used token", async () => {
    await connect("user-a");
    const results = await Promise.all([canva.refreshNowForTests("user-a"), canva.refreshNowForTests("user-a"), canva.refreshNowForTests("user-a")]);
    expect(results.sort()).toEqual(["at_2", "at_3", "at_4"]);
    expect(fake.tokenRequests.slice(1).map(entry => entry.params.get("refresh_token"))).toEqual(["rt_1", "rt_2", "rt_3"]);
    expect(storedToken("user-a")).toBe("rt_4");
  });

  it("an invalid refresh token marks the connection for reconnecting; a refused client secret or an outage doesn't", async () => {
    await connect("user-a");
    canva.resetCanvaTokens();
    fake.tokenFailure = { status: 401, body: { code: "invalid_client", message: "Client secret is invalid" } };
    await expect(canva.accessToken("user-a")).rejects.toMatchObject({ kind: "unavailable" });
    fake.tokenFailure = { status: 503, body: {} };
    await expect(canva.accessToken("user-a")).rejects.toMatchObject({ kind: "unavailable" });
    expect(store.rows.get("user-a").status).toBe("connected");
    fake.tokenFailure = null;
    fake.valid.clear();
    await expect(canva.accessToken("user-a")).rejects.toMatchObject({ kind: "reconnect" });
    expect(store.rows.get("user-a")).toMatchObject({ status: "reconnect", status_reason: "refresh_rejected", refresh_ciphertext: null });
    expect(await (await get("/auth/canva/status", { "x-test-user": "user-a" })).json()).toMatchObject({ connected: false, needsReconnect: true });
  });
});

describe("REST API", () => {
  it("renews a token Canva stopped accepting once; explains 403 (a missing scope) and 429", async () => {
    await connect("user-a");
    fake.api = (_method, _url) => (fake.apiCalls.at(-1)!.token === "at_1" ? { status: 401, body: { code: "invalid_access_token", message: "expired" } } : { status: 200, body: { items: [] } });
    expect(await canva.canvaRequest("user-a", "GET", "/v1/designs")).toEqual({ items: [] });
    expect(fake.apiCalls.filter(call => call.path.startsWith("/v1/designs")).map(call => call.token)).toEqual(["at_1", "at_2"]);
    fake.api = () => ({ status: 403, body: { code: "missing_scope", message: "Missing folder:write" } });
    await expect(canva.canvaRequest("user-a", "POST", "/v1/folders/move", { body: {} })).rejects.toMatchObject({ kind: "forbidden", message: expect.stringMatching(/Developer Portal/) });
    fake.api = () => ({ status: 429, body: { code: "too_many_requests", message: "slow down" }, headers: { "retry-after": "30" } });
    await expect(canva.canvaRequest("user-a", "GET", "/v1/designs")).rejects.toMatchObject({ kind: "rate_limited", retryAfterSec: 30, message: expect.stringMatching(/30 seconds/) });
    expect(store.rows.get("user-a").status).toBe("connected");
  });
});

describe("agent tools", () => {
  const runContext = (taskId = "task-a") => {
    const events: AgentEventBody[] = [];
    return { events, ctx: { sessionId: taskId, emit: (body: AgentEventBody) => { events.push(body); }, signal: new AbortController().signal } };
  };
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(check()).toBe(true);
  };
  const approvalOf = (events: AgentEventBody[]) => events.find(event => event.type === "approval_request") as Extract<AgentEventBody, { type: "approval_request" }> | undefined;
  const parse = (input: unknown) => CANVA_SCHEMAS.canva_create_design.parse(input);
  const created = { design: { id: "DAF123", title: "Launch post", design_types: [], created_at: 1794600000, updated_at: 1794600000, urls: { edit_url: "https://www.canva.com/design/DAF123/edit?token=x", view_url: "https://www.canva.com/design/DAF123/view?token=y" } } };

  it("always use the task owner's own token", async () => {
    await connect("user-a");
    await connect("user-b");
    store.owners = { "task-a": "user-a", "task-b": "user-b" };
    fake.api = () => ({ status: 200, body: { items: [{ id: "D1", title: "Poster", design_types: ["poster"], page_count: 1, updated_at: 1794600000 }] } });
    const listed = await runCanvaTool("canva_list_designs", CANVA_SCHEMAS.canva_list_designs.parse({ query: "poster" }), runContext("task-b").ctx);
    expect(listed.content).toContain("- Poster · D1 · poster · 1 page(s)");
    await runCanvaTool("canva_list_designs", CANVA_SCHEMAS.canva_list_designs.parse({}), runContext("task-a").ctx);
    expect(fake.apiCalls.filter(call => call.path.startsWith("/v1/designs")).map(call => call.token)).toEqual(["at_2", "at_1"]);
    expect(fake.apiCalls.find(call => call.path.startsWith("/v1/designs?"))!.path).toContain("query=poster");
    expect(await runCanvaTool("canva_list_designs", {}, runContext("task-of-nobody").ctx)).toMatchObject({ ok: false, summary: "Canva not connected" });
  });

  it("creates a design only after the user approves the exact title, type and size, then returns the edit link", async () => {
    await connect("user-a");
    store.owners = { "task-a": "user-a" };
    fake.api = method => (method === "POST" ? { status: 200, body: created } : { status: 404, body: {} });
    const { events, ctx } = runContext();
    const done = runCanvaTool("canva_create_design", parse({ title: "Launch post", width: 1080, height: 1350 }), ctx);
    await until(() => Boolean(approvalOf(events)));
    const approval = approvalOf(events)!;
    expect(approval).toMatchObject({ service: "Canva", once: true, title: 'Create the Canva design "Launch post"' });
    expect(approval.details).toEqual(expect.arrayContaining(["Title: Launch post", "Type: custom size", "Size: 1080 × 1350 px", "Content: blank (no text or images)"]));
    expect(fake.apiCalls.some(call => call.method === "POST")).toBe(false);
    // "Approve all in this task" isn't offered for Canva: an answer saying so counts once.
    requests.answerRequest("task-a", approval.requestId, { decision: "approved_task" });
    const result = await done;
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Open it in Canva to edit: https://www.canva.com/design/DAF123/edit?token=x");
    expect(fake.apiCalls.filter(call => call.method === "POST")).toEqual([expect.objectContaining({ path: "/v1/designs", body: { type: "type_and_asset", design_type: { type: "custom", width: 1080, height: 1350 }, title: "Launch post" } })]);
    expect(events.find(event => event.type === "approval_result")).toMatchObject({ decision: "approved" });
    // The next one asks again.
    const next = runContext();
    const second = runCanvaTool("canva_create_design", parse({ title: "Deck", preset: "presentation" }), next.ctx);
    await until(() => Boolean(approvalOf(next.events)));
    expect(approvalOf(next.events)!.details).toEqual(expect.arrayContaining(["Type: Presentation (Canva preset)", "Size: Canva's standard size for a presentation"]));
    requests.answerRequest("task-a", approvalOf(next.events)!.requestId, { decision: "denied" });
    expect(await second).toMatchObject({ ok: false, declined: true });
    expect(fake.apiCalls.filter(call => call.method === "POST")).toHaveLength(1);
  });

  it("refuses a folder without folder:write before asking, and checks Canva's size limits", async () => {
    await connect("user-a");
    store.owners = { "task-a": "user-a" };
    const { events, ctx } = runContext();
    const result = await runCanvaTool("canva_create_design", parse({ title: "In a folder", preset: "doc", folder_id: "FAF1" }), ctx);
    expect(result).toMatchObject({ ok: false, summary: "Folder needs folder:write" });
    expect(events).toEqual([]);
    expect(() => parse({ title: "Huge", width: 8000, height: 8000 })).toThrow(/25,000,000/);
    expect(() => parse({ title: "Both", preset: "doc", width: 100, height: 100 })).toThrow(/either preset/);
    expect(() => parse({ title: "Tiny", width: 10, height: 100 })).toThrow();
    expect(() => parse({ title: "Half", width: 500 })).toThrow(/both width and height/);
  });

  it("work with any backend behind the interface (an MCP backend later)", async () => {
    await connect("user-a");
    store.owners = { "task-a": "user-a" };
    const calls: string[] = [];
    const backend = {
      name: "test backend",
      scopes: async () => ["folder:read"],
      listDesigns: async () => { calls.push("listDesigns"); return { designs: [{ id: "X1", title: "From the other backend", types: [], pageCount: null, createdAt: null, updatedAt: null, editUrl: null, viewUrl: null }], continuation: null }; },
      getDesign: async () => { throw new Error("unused"); },
      listFolder: async (folderId: string) => { calls.push(`listFolder:${folderId}`); return { items: [{ kind: "folder" as const, id: "F1", name: "Brand", updatedAt: null }], continuation: null }; },
      createDesign: async () => { throw new Error("unused"); },
      moveToFolder: async () => { throw new Error("unused"); },
    };
    expect((await runCanvaTool("canva_list_designs", CANVA_SCHEMAS.canva_list_designs.parse({}), runContext().ctx, () => backend)).content).toContain("From the other backend");
    expect((await runCanvaTool("canva_list_folder", CANVA_SCHEMAS.canva_list_folder.parse({}), runContext().ctx, () => backend)).content).toContain("- folder · Brand · F1");
    expect(calls).toEqual(["listDesigns", "listFolder:root"]);
    expect(fake.apiCalls.filter(call => call.path.startsWith("/v1/designs") || call.path.startsWith("/v1/folders"))).toEqual([]);
  });
});
