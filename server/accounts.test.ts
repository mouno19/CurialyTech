import { SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

// Accounts: which session cookies sign a browser in (and which don't), where GitHub sign-in may send
// the browser afterwards, and how a GitHub identity finds or creates its account.

const SECRET = "test-only-session-secret-0123456789abcdef";
const db = vi.hoisted(() => ({ users: new Map<string, Record<string, unknown>>(), inserted: [] as unknown[][], signupsOpen: true }));

vi.mock("./db/pg", () => {
  const run = async (text: string, values: unknown[] = []) => {
    if (text.startsWith("SELECT id, role, login, display_name")) return { rows: db.users.has(values[0] as string) ? [db.users.get(values[0] as string)] : [] };
    if (text.startsWith("SELECT id, banned_at FROM curialy.users WHERE github_id = $1")) return { rows: [...db.users.values()].filter(row => row.github_id === values[0]) };
    if (text.includes("FROM curialy.app_settings")) return { rows: [{ value: { signupsOpen: db.signupsOpen } }] };
    if (text.startsWith("SELECT count(*)::int AS n FROM curialy.users WHERE signup_network = $1")) {
      return { rows: [{ n: [...db.users.values()].filter(row => Buffer.isBuffer(row.signup_network) && (row.signup_network as Buffer).equals(values[0] as Buffer)).length }] };
    }
    if (text.startsWith("INSERT INTO curialy.users")) {
      db.inserted.push(values);
      db.users.set(`new-${db.inserted.length}`, { id: `new-${db.inserted.length}`, github_id: values[2], signup_network: values[6], free_allowance_withheld: values[7] });
      return { rows: [{ id: "new-user" }] };
    }
    return { rows: [], rowCount: 1 };
  };
  return { query: vi.fn(run), db: () => ({ connect: async () => ({ query: run, release: () => undefined }) }), adminUserId: async () => "operator" };
});

const auth = await import("./auth");
const github = await import("./auth-github");

const key = new TextEncoder().encode(SECRET);
const token = (claims: { sub: string; ver?: number; aud: string }) =>
  new SignJWT(claims.ver === undefined ? {} : { ver: claims.ver }).setProtectedHeader({ alg: "HS256" }).setSubject(claims.sub).setIssuer("curialy").setAudience(claims.aud).setIssuedAt().setExpirationTime("1h").sign(key);
const request = (cookie: string) => ({ headers: { cookie } }) as unknown as Request;
const row = (patch: Record<string, unknown>) => ({ role: "user", login: "ada", display_name: "Ada", avatar_url: null, email: null, banned_at: null, session_version: 0, ...patch });

beforeAll(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("ADMIN_PASSWORD_HASH", "scrypt:x:y");
});

beforeEach(() => {
  db.users.clear();
  db.inserted.length = 0;
  db.signupsOpen = true;
  db.users.set("u1", row({ id: "u1" }));
  db.users.set("operator", row({ id: "operator", role: "admin", login: "mouno19" }));
});

describe("sessions", () => {
  it("signs in with a valid account session and with the operator's earlier cookie", async () => {
    expect(await auth.currentUser(request(`${auth.USER_COOKIE}=${await token({ sub: "u1", ver: 0, aud: "curialy-user" })}`))).toMatchObject({ id: "u1", role: "user" });
    expect(await auth.currentUser(request(`${auth.ADMIN_COOKIE}=${await token({ sub: "admin", aud: "curialy-admin" })}`))).toMatchObject({ id: "operator", role: "admin" });
  });

  it("refuses a revoked session, a banned account, an unknown account and a cookie signed for something else", async () => {
    db.users.set("u2", row({ id: "u2", session_version: 3 }));
    db.users.set("u3", row({ id: "u3", banned_at: new Date() }));
    for (const cookie of [
      `${auth.USER_COOKIE}=${await token({ sub: "u2", ver: 2, aud: "curialy-user" })}`,
      `${auth.USER_COOKIE}=${await token({ sub: "u3", ver: 0, aud: "curialy-user" })}`,
      `${auth.USER_COOKIE}=${await token({ sub: "nobody", ver: 0, aud: "curialy-user" })}`,
      `${auth.USER_COOKIE}=${await token({ sub: "u1", ver: 0, aud: "curialy-admin" })}`,
      `${auth.ADMIN_COOKIE}=${await token({ sub: "u1", aud: "curialy-admin" })}`,
      `${auth.USER_COOKIE}=not-a-token`,
    ]) {
      expect(await auth.currentUser(request(cookie)), cookie.slice(0, 40)).toBeNull();
    }
  });
});

describe("where sign-in returns to", () => {
  it("allows paths on this site only", () => {
    expect(github.safeNext("/tasks/abc?tab=preview")).toBe("/tasks/abc?tab=preview");
    for (const unsafe of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", 42, "/login?x=1"]) expect(github.safeNext(unsafe)).toBe("/");
  });
});

describe("GitHub identities", () => {
  const profile = { id: 4242, login: "ada", name: "Ada Lovelace", avatarUrl: null, email: "ada@example.com" };

  it("gives the free allowance to the first three accounts from one network, and not to the ones after", async () => {
    for (const id of [801, 802, 803, 804]) await github.accountForGitHub({ ...profile, id }, "203.0.113.7");
    // The same network, arriving IPv4-mapped; and another network.
    await github.accountForGitHub({ ...profile, id: 805 }, "::ffff:203.0.113.7");
    await github.accountForGitHub({ ...profile, id: 806 }, "198.51.100.20");
    expect(db.inserted.map(values => values[7])).toEqual([false, false, false, true, true, false]);
    // Only a hash is kept, never the address.
    expect(Buffer.isBuffer(db.inserted[0][6])).toBe(true);
    expect(JSON.stringify(db.inserted)).not.toContain("203.0.113.7");
    // A local or unknown address counts toward nothing.
    await github.accountForGitHub({ ...profile, id: 807 }, "127.0.0.1");
    expect(db.inserted.at(-1)!.slice(6)).toEqual([null, false]);
  });

  it("never re-counts a returning account", async () => {
    db.users.set("u9", row({ id: "u9", github_id: 909 }));
    expect(await github.accountForGitHub({ ...profile, id: 909 }, "203.0.113.7")).toEqual({ id: "u9" });
    expect(db.inserted).toEqual([]);
  });

  it("finds the account already linked to the GitHub id, and refuses a banned one", async () => {
    db.users.set("u1", row({ id: "u1", github_id: 4242 }));
    expect(await github.accountForGitHub(profile)).toEqual({ id: "u1" });
    db.users.set("u1", row({ id: "u1", github_id: 4242, banned_at: new Date() }));
    expect(await github.accountForGitHub(profile)).toEqual({ refused: "banned" });
    expect(db.inserted).toEqual([]);
  });

  it("creates a free account (never an admin) while sign-ups are open, and none when they're closed", async () => {
    expect(await github.accountForGitHub({ ...profile, id: 777 })).toEqual({ id: "new-user" });
    expect(db.inserted[0]).toEqual(["gh:777", "Ada Lovelace", 777, "ada", null, "ada@example.com", null, false]);
    db.signupsOpen = false;
    const { getSettings } = await import("./credits");
    // The settings cache: wait it out instead of reaching into the module.
    vi.useFakeTimers({ now: Date.now() + 60_000, shouldAdvanceTime: true });
    try {
      expect((await getSettings()).signupsOpen).toBe(false);
      expect(await github.accountForGitHub({ ...profile, id: 778 })).toEqual({ refused: "closed" });
    } finally {
      vi.useRealTimers();
    }
  });
});
