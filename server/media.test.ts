import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyStorageError, publicStorageMessage, redact, StorageBreaker, StorageError, type StorageFailure } from "./media/storage-errors";

const KINDS: StorageFailure[] = ["not_configured", "unauthorized", "stage_missing", "unreachable", "object_missing", "rejected"];
const INTERNALS = /snowflake|cortex|sql|stage|curialy_db|warehouse|amazonaws|s3\b|azure|@/i;

describe("classifyStorageError", () => {
  it.each([
    [{ code: "002003", message: "SQL compilation error:\nStage 'CURIALY_DB.PUBLIC.USER_MEDIA_STAGE' does not exist or not authorized." }, "stage_missing"],
    [{ code: "003001", message: "SQL access control error: Insufficient privileges to operate on stage" }, "stage_missing"],
    [{ code: "391707", message: "Stage location not found" }, "stage_missing"],
    [{ sqlState: "02000", message: "no data" }, "stage_missing"],
    [new Error("Object 'USER_MEDIA_STAGE' does not exist or not authorized."), "stage_missing"],
    [{ code: "390100", message: "Incorrect username or password was specified." }, "unauthorized"],
    [{ code: 390303, message: "Invalid OAuth access token." }, "unauthorized"],
    [{ code: "390144", message: "JWT token is invalid." }, "unauthorized"],
    [new Error("Programmatic access token is invalid"), "unauthorized"],
    [{ code: "401001", message: "Network error. Could not reach Snowflake." }, "unreachable"],
    [{ code: "401004", message: "Request to Snowflake failed." }, "unreachable"],
    [Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), "unreachable"],
    [Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" }), "unreachable"],
    [Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "unreachable"],
    [Object.assign(new Error("storage statement timed out"), { name: "TimeoutError" }), "unreachable"],
    [new Error("fetch failed"), "unreachable"],
    [new Error("upstream returned 503"), "unreachable"],
    [new StorageError("object_missing"), "object_missing"],
    [{ status: 404, message: "Not Found" }, "object_missing"],
    [{ status: 503, message: "Slow Down" }, "unreachable"],
    [new Error("File storage is not configured"), "not_configured"],
    [new Error("Unsupported file format"), "rejected"],
    [null, "rejected"],
  ] as [unknown, StorageFailure][])("%o → %s", (error, kind) => {
    expect(classifyStorageError(error)).toBe(kind);
  });
});

describe("public storage messages", () => {
  it("never name the vendor, the database, SQL or the stage", () => {
    for (const kind of KINDS) {
      const error = new StorageError(kind, 5, "Stage '@CURIALY_DB.PUBLIC.USER_MEDIA_STAGE' does not exist (Snowflake 002003)");
      expect(error.message).toBe(publicStorageMessage(kind));
      expect(error.message).not.toMatch(INTERNALS);
    }
    expect(new StorageError("unreachable").unavailable).toBe(true);
    expect(new StorageError("stage_missing").unavailable).toBe(true);
    expect(new StorageError("object_missing").unavailable).toBe(false);
    expect(new StorageError("rejected").unavailable).toBe(false);
  });
});

describe("redact", () => {
  it("keeps the first line and strips URLs, signed parameters and tokens", () => {
    const text = "GET https://sfc-prod.s3.amazonaws.com/stage/x.png?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=deadbeef failed\nsecond line with secrets";
    const out = redact(text);
    expect(out).toBe("GET <url> failed");
    expect(redact("X-Amz-Signature=deadbeef&X-Amz-Expires=3600 rejected")).toBe("X-Amz-Signature=<redacted>&X-Amz-Expires=<redacted> rejected");
    expect(redact("login failed: token=abc123 password=hunter2")).toBe("login failed: token=<redacted> password=<redacted>");
    expect(redact("Authorization: Snowflake Token=\"ver:1-hint:1234-ETMsDgAAAXsecret\"")).not.toContain("ETMsDgAAAXsecret");
    expect(redact("Authorization: Bearer sk-live-abcdef123456")).not.toContain("sk-live-abcdef123456");
    expect(redact("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl rejected")).toBe("jwt <jwt> rejected");
    expect(redact("x".repeat(500))).toHaveLength(240);
  });
});

describe("StorageBreaker", () => {
  let now = 1_000_000;
  const clock = () => now;
  beforeEach(() => { now = 1_000_000; });

  it("opens at once on a configuration failure", () => {
    const breaker = new StorageBreaker(clock);
    breaker.failed("stage_missing");
    expect(breaker.snapshot()).toEqual({ state: "open", kind: "stage_missing", retryAfterSec: 60, since: now });
  });

  it("opens after two network failures within 30 seconds, even with successes in between", () => {
    const spaced = new StorageBreaker(clock);
    spaced.failed("unreachable");
    now += 31_000;
    spaced.failed("unreachable");
    expect(spaced.isOpen).toBe(false);

    const breaker = new StorageBreaker(clock);
    breaker.failed("unreachable");
    expect(breaker.isOpen).toBe(false);
    now += 1000;
    breaker.succeeded(); // e.g. the download link was issued, then the download itself failed
    now += 1000;
    breaker.failed("unreachable");
    expect(breaker.snapshot()).toMatchObject({ state: "open", kind: "unreachable", retryAfterSec: 10 });
  });

  it("is never tripped by a missing object or a rejected file", () => {
    const breaker = new StorageBreaker(clock);
    for (let i = 0; i < 5; i++) {
      breaker.failed("object_missing");
      breaker.failed("rejected");
    }
    expect(breaker.isOpen).toBe(false);
  });

  it("fails fast while open, without probing", async () => {
    const breaker = new StorageBreaker(clock);
    breaker.failed("unauthorized");
    const probe = vi.fn(async () => undefined);
    const attempt = breaker.guard(probe);
    await expect(attempt).rejects.toBeInstanceOf(StorageError);
    await expect(attempt).rejects.toMatchObject({ kind: "unauthorized", retryAfterSec: 60 });
    now += 59_000;
    await expect(breaker.guard(probe)).rejects.toMatchObject({ retryAfterSec: 1 });
    expect(probe).not.toHaveBeenCalled();
  });

  it("lets exactly one probe through after the window, and closes when it succeeds", async () => {
    const breaker = new StorageBreaker(clock);
    breaker.failed("stage_missing");
    now += 60_000;
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const guards = Array.from({ length: 8 }, () => breaker.guard(probe));
    expect(probe).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(guards);
    expect(breaker.snapshot()).toEqual({ state: "ok", kind: null, retryAfterSec: 0, since: null });
    await breaker.guard(probe);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("doubles the window after each failed probe, up to its cap", async () => {
    const config = new StorageBreaker(clock);
    config.failed("stage_missing");
    const windows: number[] = [config.snapshot().retryAfterSec];
    const failing = vi.fn(async () => { throw Object.assign(new Error("does not exist or not authorized"), { code: "002003" }); });
    for (let i = 0; i < 4; i++) {
      now += windows[windows.length - 1] * 1000;
      const guards = [config.guard(failing), config.guard(failing), config.guard(failing)];
      for (const guard of guards) await expect(guard).rejects.toBeInstanceOf(StorageError);
      windows.push(config.snapshot().retryAfterSec);
    }
    expect(windows).toEqual([60, 120, 240, 300, 300]);
    expect(failing).toHaveBeenCalledTimes(4);

    const network = new StorageBreaker(clock);
    network.failed("unreachable");
    network.failed("unreachable");
    const nets: number[] = [network.snapshot().retryAfterSec];
    const down = vi.fn(async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); });
    for (let i = 0; i < 5; i++) {
      now += nets[nets.length - 1] * 1000;
      await expect(network.guard(down)).rejects.toMatchObject({ kind: "unreachable" });
      nets.push(network.snapshot().retryAfterSec);
    }
    expect(nets).toEqual([10, 20, 40, 80, 120, 120]);
  });

  it("keeps failing fast after a probe that fails in an unexpected way", async () => {
    const breaker = new StorageBreaker(clock);
    breaker.failed("stage_missing");
    now += 60_000;
    const odd = vi.fn(async () => { throw new Error("Unexpected response shape"); });
    await expect(breaker.guard(odd)).rejects.toMatchObject({ kind: "stage_missing" });
    await expect(breaker.guard(odd)).rejects.toMatchObject({ kind: "stage_missing" });
    expect(odd).toHaveBeenCalledTimes(1);
    expect(breaker.snapshot().retryAfterSec).toBeGreaterThanOrEqual(60);
  });
});

// ---- snowflake.ts against a fake driver: what reaches storage, the breaker and the logs ----

const sdk = vi.hoisted(() => ({
  created: 0,
  executes: [] as string[],
  answer: (_sql: string): { error?: unknown; rows?: unknown[] } => ({ rows: [] }),
}));

vi.mock("snowflake-sdk", () => ({
  default: {
    configure: () => undefined,
    createConnection: () => {
      sdk.created++;
      let up = false;
      return {
        connect: (done: (error: unknown) => void) => { up = true; done(null); },
        isUp: () => up,
        destroy: (done?: () => void) => { up = false; done?.(); },
        execute: ({ sqlText, complete }: { sqlText: string; complete: (error: unknown, statement: unknown, rows?: unknown[]) => void }) => {
          sdk.executes.push(sqlText);
          const result = sdk.answer(sqlText);
          setImmediate(() => (result.error ? complete(result.error, {}) : complete(null, {}, result.rows ?? [])));
          return { cancel: (done?: () => void) => done?.() };
        },
      };
    },
  },
}));
vi.mock("./db/pg", () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), heartbeatQuery: vi.fn(async () => ({ rows: [] })) }));

const SIGNED = "https://sfc-prod-stage.s3.us-west-2.amazonaws.com/abc/upload/1/a.png?X-Amz-Signature=deadbeef";

describe("media storage (snowflake.ts)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logged: string[];

  async function load(configured = true) {
    for (const name of ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_ROLE", "SNOWFLAKE_PAT"]) vi.stubEnv(name, configured ? `test-${name.toLowerCase()}` : "");
    vi.resetModules();
    return import("./media/snowflake");
  }

  beforeEach(() => {
    sdk.created = 0;
    sdk.executes.length = 0;
    sdk.answer = sql => (sql.includes("GET_PRESIGNED_URL") ? { rows: [{ URL: SIGNED }] } : { rows: [] });
    fetchMock = vi.fn(async () => new Response("bytes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    logged = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const thrown = (fn: () => unknown) => {
    try { fn(); } catch (error) { return error; }
    return null;
  };

  it("does nothing at all when storage is not configured", async () => {
    const sf = await load(false);
    expect(await sf.mediaStatus()).toMatchObject({ ok: false, state: "not_configured", kind: "not_configured" });
    expect(thrown(() => sf.assertStorageAvailable())).toMatchObject({ name: "StorageError", kind: "not_configured" });
    await expect(sf.openStoredObject("upload/1/a.png")).rejects.toMatchObject({ kind: "not_configured" });
    await expect(sf.storeMedia({ buffer: Buffer.from("x"), filename: "a.txt", mimeType: "text/plain", kind: "upload" })).rejects.toMatchObject({ kind: "not_configured" });
    expect(sdk.created).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing object as gone after one fresh link, without tripping the breaker", async () => {
    const sf = await load();
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));
    await expect(sf.openStoredObject("upload/1/a.png")).rejects.toMatchObject({ name: "StorageError", kind: "object_missing" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sdk.executes.filter(sql => sql.includes("GET_PRESIGNED_URL"))).toHaveLength(2);
    expect(await sf.mediaStatus()).toMatchObject({ ok: true, state: "ok" });
  });

  it("stops querying a missing stage: one failure opens the breaker, later calls fail fast", async () => {
    const sf = await load();
    sdk.answer = () => ({ error: Object.assign(new Error("SQL compilation error:\nStage 'CURIALY_DB.PUBLIC.USER_MEDIA_STAGE' does not exist or not authorized."), { code: "002003", sqlState: "02000" }) });
    const first = sf.openStoredObject("upload/1/a.png");
    await expect(first).rejects.toMatchObject({ kind: "stage_missing" });
    await expect(first).rejects.toSatisfy((error: Error) => !INTERNALS.test(error.message));
    const statements = sdk.executes.length;
    for (const key of ["upload/2/b.png", "upload/3/c.png", "upload/4/d.png"]) await expect(sf.openStoredObject(key)).rejects.toMatchObject({ kind: "stage_missing" });
    expect(sdk.executes).toHaveLength(statements);
    expect(fetchMock).not.toHaveBeenCalled();
    const health = await sf.mediaStatus();
    expect(health).toMatchObject({ ok: false, state: "unavailable", kind: "stage_missing" });
    expect(health.retryAfter).toBeGreaterThan(50);
    expect(health.detail).not.toMatch(INTERNALS);
    expect(thrown(() => sf.assertStorageAvailable())).toMatchObject({ kind: "stage_missing" });
    // The log line says what happened, without the statement's URL or credentials.
    expect(logged.join("\n")).toContain("kind=stage_missing code=002003");
    expect(logged.join("\n")).not.toMatch(/https?:\/\//);
  });

  it("opens on repeated download failures even though each download link was issued", async () => {
    const sf = await load();
    fetchMock.mockImplementation(async () => { throw new TypeError("fetch failed"); });
    await expect(sf.openStoredObject("upload/1/a.png")).rejects.toMatchObject({ kind: "unreachable" });
    await expect(sf.openStoredObject("upload/2/b.png")).rejects.toMatchObject({ kind: "unreachable" });
    expect(await sf.mediaStatus()).toMatchObject({ ok: false, state: "unavailable", kind: "unreachable" });
    const statements = sdk.executes.length;
    await expect(sf.openStoredObject("upload/3/c.png")).rejects.toMatchObject({ kind: "unreachable" });
    expect(sdk.executes).toHaveLength(statements);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("probes once when the window has passed, for any number of waiting requests", async () => {
    const sf = await load();
    sdk.answer = () => ({ error: Object.assign(new Error("Insufficient privileges to operate on stage"), { code: "003001" }) });
    await expect(sf.openStoredObject("upload/1/a.png")).rejects.toMatchObject({ kind: "stage_missing" });
    // An operator fixes the grants; the next requests after the window share one probe.
    sdk.answer = sql => (sql.includes("GET_PRESIGNED_URL") ? { rows: [{ URL: SIGNED }] } : { rows: [] });
    vi.setSystemTime(Date.now() + 61_000);
    sdk.executes.length = 0;
    const responses = await Promise.all(["upload/2/b.png", "upload/3/c.png", "upload/4/d.png"].map(key => sf.openStoredObject(key)));
    expect(responses.every(response => response.ok)).toBe(true);
    expect(sdk.executes.filter(sql => sql.startsWith("LIST") && sql.includes("__curialy_probe__"))).toHaveLength(1);
    expect(await sf.mediaStatus()).toMatchObject({ ok: true });
  });
});
