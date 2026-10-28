import { randomUUID } from "node:crypto";
import snowflake from "snowflake-sdk";
import { query } from "../db/pg";
import { classifyStorageError, logStorageError, publicStorageMessage, redact, StorageBreaker, StorageError, type StorageFailure } from "./storage-errors";

// User media lives in a Snowflake internal stage; bytes go from memory straight to the stage
// (snowflake-sdk fileStream) and are served through short-lived presigned URLs. Nothing is
// written to the VPS disk, including the driver's own log (routed to stdout / the journal).

const STAGE = process.env.SNOWFLAKE_MEDIA_STAGE || "@CURIALY_DB.PUBLIC.USER_MEDIA_STAGE";
const MAX_BYTES = 25 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15_000;
const STATEMENT_TIMEOUT_MS = 20_000;
const PUT_TIMEOUT_MS = 90_000;
const FETCH_TIMEOUT_MS = 15_000;

snowflake.configure({ logLevel: "ERROR", logFilePath: "STDOUT", additionalLogToConsole: false } as never);

// Two logins may be in play: the media stage can live in its own account (SNOWFLAKE_MEDIA_ACCOUNT
// with its own _USER, _ROLE, _PAT and _WAREHOUSE), while SQL AI_COMPLETE stays on SNOWFLAKE_*.
// Without SNOWFLAKE_MEDIA_ACCOUNT both use SNOWFLAKE_* (and share one connection).
type Login = { prefix: "SNOWFLAKE_" | "SNOWFLAKE_MEDIA_"; account?: string; username?: string; role?: string; token?: string; warehouse: string };

/**
 * Account identifiers arrive in several forms (locator.region.cloud, org-account, or the account's
 * https base URL): all become the bare, lowercase identifier the driver expects.
 */
export function normalizeAccount(raw: string | undefined) {
  const value = raw?.trim().replace(/^https?:\/\//i, "").replace(/\.snowflakecomputing\.(com|cn)(\/.*)?$/i, "").replace(/\/+$/, "").toLowerCase();
  return value || undefined;
}

function login(prefix: Login["prefix"]): Login {
  const env = process.env;
  return { prefix, account: normalizeAccount(env[`${prefix}ACCOUNT`]), username: env[`${prefix}USER`], role: env[`${prefix}ROLE`], token: env[`${prefix}PAT`], warehouse: env[`${prefix}WAREHOUSE`] || "COMPUTE_WH" };
}
const mediaLogin = () => login(process.env.SNOWFLAKE_MEDIA_ACCOUNT ? "SNOWFLAKE_MEDIA_" : "SNOWFLAKE_");
const sqlLogin = () => login("SNOWFLAKE_");
const loginKey = (l: Login) => [l.account, l.username, l.role, l.warehouse].join("|");

/** Account, user and role come from the environment only: no fallback to another account's values. */
function loginStatus(l: Login) {
  const missing = (["ACCOUNT", "USER", "ROLE", "PAT"] as const).filter(name => !process.env[`${l.prefix}${name}`]).map(name => `${l.prefix}${name}`);
  return { ok: missing.length === 0, missing };
}
export const storageConfig = () => loginStatus(mediaLogin());
/** The account the media stage is in now (recorded with every stored file). */
export const mediaAccount = () => mediaLogin().account ?? null;

const withDeadline = <T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void) => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(Object.assign(new Error(`${label} timed out`), { name: "TimeoutError" })); }, ms); }),
  ]).finally(() => clearTimeout(timer));
};

/** One live connection per distinct login, created on first use and replaced when it drops. */
const sessions = new Map<string, { connection: snowflake.Connection | null; connecting: Promise<snowflake.Connection> | null }>();

function connect(l: Login = mediaLogin()) {
  const key = loginKey(l);
  let slot = sessions.get(key);
  if (!slot) {
    slot = { connection: null, connecting: null };
    sessions.set(key, slot);
  }
  const current = slot;
  if (current.connection?.isUp()) return Promise.resolve(current.connection);
  current.connecting ??= (async () => {
    if (!loginStatus(l).ok) throw new StorageError("not_configured");
    const previous = current.connection;
    current.connection = null;
    if (previous) previous.destroy(() => undefined);
    const conn = snowflake.createConnection({
      account: l.account!,
      username: l.username!,
      role: l.role!,
      warehouse: l.warehouse,
      authenticator: "PROGRAMMATIC_ACCESS_TOKEN",
      token: l.token!,
      clientSessionKeepAlive: true,
      sfRetryMaxLoginRetries: 1,
    } as snowflake.ConnectionOptions);
    // The driver's own login retry window is at least five minutes; an interactive server cannot wait that long.
    await withDeadline(new Promise<void>((resolve, reject) => conn.connect(error => (error ? reject(error) : resolve()))), CONNECT_TIMEOUT_MS, "storage login", () => conn.destroy(() => undefined));
    current.connection = conn;
    return conn;
  })().finally(() => {
    current.connecting = null;
  });
  return current.connecting;
}

/** A statement on the media stage's login. */
function run<T = Record<string, unknown>>(sqlText: string, extra: Record<string, unknown> = {}, timeoutMs = STATEMENT_TIMEOUT_MS): Promise<T[]> {
  return connect(mediaLogin()).then(conn => {
    let cancel: (() => void) | undefined;
    return withDeadline(new Promise<T[]>((resolve, reject) => {
      const statement = conn.execute({
        sqlText,
        ...extra,
        complete: (error, _statement, rows) => (error ? reject(error) : resolve((rows ?? []) as T[])),
      } as snowflake.StatementOption);
      cancel = () => statement.cancel(() => undefined);
    }), timeoutMs, "storage statement", () => cancel?.());
  });
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";

const breaker = new StorageBreaker();

const probe = async () => {
  await run(`LIST ${STAGE} PATTERN = '.*__curialy_probe__.*'`, {}, 10_000);
};

/** Run a stage operation behind the breaker: fail fast during an outage, record what happened. */
async function guarded<T>(op: string, work: () => Promise<T>): Promise<T> {
  if (!storageConfig().ok) {
    breaker.failed("not_configured");
    throw new StorageError("not_configured");
  }
  await breaker.guard(probe);
  try {
    const result = await work();
    breaker.succeeded();
    return result;
  } catch (error) {
    const kind = classifyStorageError(error);
    breaker.failed(kind);
    if (!(error instanceof StorageError)) logStorageError(op, error);
    throw error instanceof StorageError ? error : new StorageError(kind, breaker.snapshot().retryAfterSec, redact(String((error as Error)?.message ?? error)));
  }
}

export type MediaHealth = { ok: boolean; state: "ok" | "unavailable" | "not_configured"; kind: StorageFailure | null; retryAfter: number; detail: string };

function healthFromBreaker(): MediaHealth {
  if (!storageConfig().ok) return { ok: false, state: "not_configured", kind: "not_configured", retryAfter: 0, detail: publicStorageMessage("not_configured") };
  const snap = breaker.snapshot();
  if (snap.state === "ok") return { ok: true, state: "ok", kind: null, retryAfter: 0, detail: "File storage is ready." };
  return { ok: false, state: "unavailable", kind: snap.kind, retryAfter: snap.retryAfterSec, detail: publicStorageMessage(snap.kind ?? "unreachable") };
}

let lastProbeAt = 0;
let lastProbe: Promise<unknown> | null = null;

/**
 * Storage health. By default answered from memory (no I/O); `probe` runs one real check, at most
 * every 15 seconds, so a burst of callers costs one query.
 */
export async function mediaStatus(probeNow = false): Promise<MediaHealth> {
  // Once an outage's window has passed, even passive reads (health polls, HEAD) start the single
  // recovery probe in the background, so storage coming back is noticed without anyone asking.
  const recheck = probeNow || breaker.windowPassed();
  if (recheck && storageConfig().ok && Date.now() - lastProbeAt > 15_000) {
    lastProbeAt = Date.now();
    lastProbe ??= probe().then(() => breaker.succeeded(), error => { breaker.failed(classifyStorageError(error)); logStorageError("probe", error); }).finally(() => { lastProbe = null; });
  }
  if (probeNow) await lastProbe;
  return healthFromBreaker();
}

/** Throws StorageError when storage is known to be unavailable (no I/O). */
export function assertStorageAvailable() {
  const health = healthFromBreaker();
  if (!health.ok && !breaker.windowPassed()) throw new StorageError(health.kind ?? "unreachable", health.retryAfter);
}

export type StoredMedia = { id: string; filename: string; mimeType: string; sizeBytes: number; kind: string; stagePath: string };

/** `userId`: the uploader; files a task produces (screenshots, attachments) belong to the task's owner. */
export async function storeMedia(input: { buffer: Buffer; filename: string; mimeType: string; kind: "upload" | "screenshot" | "artifact"; sessionId?: string | null; sourcePath?: string | null; userId?: string | null }): Promise<StoredMedia> {
  if (input.buffer.length > MAX_BYTES) throw new StorageError("rejected", 0, `over ${MAX_BYTES / 1024 / 1024} MB`);
  const id = randomUUID();
  const filename = safeName(input.filename);
  const folder = `${input.kind}/${id}`;
  return guarded("upload", async () => {
    // PUT parses the "local" path only for the target file name; the bytes come from fileStream.
    await run(`PUT 'file:///${filename}' '${STAGE}/${folder}' AUTO_COMPRESS = FALSE OVERWRITE = TRUE`, { fileStream: input.buffer }, PUT_TIMEOUT_MS);
    // The driver decides the final object key (it can introduce a doubled slash), so read it back.
    const listed = await run<{ name: string }>(`LIST '${STAGE}/${folder}'`);
    const key = listed.map(row => row.name).find(name => name.endsWith(`/${filename}`));
    if (!key) throw new StorageError("rejected", 0, "upload could not be confirmed");
    const stagePath = key.slice(key.indexOf("/") + 1); // strip the stage's own name prefix
    try {
      await query(
        `INSERT INTO curialy.file_metadata (id, session_id, kind, filename, mime_type, size_bytes, storage, stage_path, source_path, stage_account, user_id)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, 'snowflake_stage', $7, $8, $9, COALESCE($10::uuid, (SELECT user_id FROM curialy.chat_sessions WHERE id = $2::uuid)))`,
        [id, input.sessionId ?? null, input.kind, filename, input.mimeType, input.buffer.length, stagePath, input.sourcePath ?? null, mediaAccount(), input.userId ?? null],
      );
    } catch (error) {
      // No orphan objects: the row is the only way to find a stored file again.
      await run(`REMOVE '${STAGE}/${stagePath.replace(/'/g, "")}'`).catch(() => undefined);
      throw error;
    }
    return { id, filename, mimeType: input.mimeType, sizeBytes: input.buffer.length, kind: input.kind, stagePath };
  });
}

export type MediaRow = { id: string; filename: string; mime_type: string; size_bytes: number; kind: string; stage_path: string; created_at: Date; session_id: string | null; source_path: string | null; state: string; stage_account: string | null; user_id: string | null };

/**
 * Where a file is, relative to the stage in use now:
 *  - here: recorded in this account (a 404 here really means gone);
 *  - unknown: stored before accounts were recorded; looked up here once, recorded when found, and
 *    otherwise remembered (until restart) as not here, never marked missing;
 *  - elsewhere: recorded in another account (or known not to be here): never looked up here.
 * With no media account configured everything is "here", so guarded() refuses as not configured.
 */
export type Placement = "here" | "unknown" | "elsewhere";
const notHere = new Set<string>();

export function placement(media: Pick<MediaRow, "id" | "stage_account">): Placement {
  const now = mediaAccount();
  if (now === null || media.stage_account === now) return "here";
  if (media.stage_account === null) return notHere.has(media.id) ? "elsewhere" : "unknown";
  return "elsewhere";
}
export const isElsewhere = (media: Pick<MediaRow, "id" | "stage_account">) => placement(media) === "elsewhere";

export async function getMedia(id: string): Promise<MediaRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const { rows } = await query<MediaRow>(
    "SELECT id, filename, mime_type, size_bytes, kind, stage_path, created_at, session_id, source_path, state, stage_account, user_id FROM curialy.file_metadata WHERE id = $1", [id],
  );
  return rows[0];
}

export async function markMediaMissing(id: string) {
  await query("UPDATE curialy.file_metadata SET state = 'missing', missing_at = now() WHERE id = $1 AND state <> 'missing'", [id]);
}

/** An account's files, newest first. */
export async function listMedia(userId: string, limit = 200) {
  // "elsewhere": recorded in another storage account, or known (this process) not to be here.
  const { rows } = await query(
    `SELECT id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", kind, session_id AS "sessionId", created_at AS "createdAt",
            CASE WHEN state = 'stored' AND $2::text IS NOT NULL AND ((stage_account IS NOT NULL AND stage_account <> $2) OR (stage_account IS NULL AND id = ANY($3::uuid[])))
                 THEN 'elsewhere' ELSE state END AS state
     FROM curialy.file_metadata WHERE user_id = $4 ORDER BY created_at DESC LIMIT $1`,
    [limit, mediaAccount(), Array.from(notHere), userId],
  );
  return rows;
}

/** What an account stores (files not known to be gone), for its storage quota. */
export async function mediaUsage(userId: string) {
  const { rows } = await query<{ files: string; bytes: string }>(
    "SELECT count(*) AS files, COALESCE(sum(size_bytes), 0) AS bytes FROM curialy.file_metadata WHERE user_id = $1 AND state <> 'missing'", [userId],
  );
  return { files: Number(rows[0].files), bytes: Number(rows[0].bytes) };
}

// Presigned URLs for immutable objects are reused until shortly before they expire (memory only).
const PRESIGN_TTL_SECONDS = 3600;
const presigned = new Map<string, { url: string; expires: number }>();

/** Presigned HTTPS URL for a staged file (requires the stage to use SNOWFLAKE_SSE encryption). */
export async function presignedUrl(stagePath: string, opts: { fresh?: boolean } = {}) {
  const cached = presigned.get(stagePath);
  if (!opts.fresh && cached && cached.expires - 300_000 > Date.now()) return cached.url;
  return guarded("presign", async () => {
    const rows = await run<{ URL: string }>(`SELECT GET_PRESIGNED_URL(${STAGE}, '${stagePath.replace(/'/g, "")}', ${PRESIGN_TTL_SECONDS}) AS URL`);
    if (!rows[0]?.URL) throw new StorageError("rejected", 0, "no download link returned");
    presigned.delete(stagePath);
    presigned.set(stagePath, { url: rows[0].URL, expires: Date.now() + PRESIGN_TTL_SECONDS * 1000 });
    if (presigned.size > 500) presigned.delete(presigned.keys().next().value!);
    return rows[0].URL;
  });
}

/**
 * Open a staged object for streaming. A 403/404 after a fresh link means the object is gone
 * (StorageError object_missing); network failures and 5xx count as unreachable.
 */
export async function openStoredObject(stagePath: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await presignedUrl(stagePath, { fresh: attempt > 0 });
    let response: Response;
    try {
      response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      if (signal?.aborted) throw error;
      breaker.failed("unreachable");
      throw new StorageError("unreachable", breaker.snapshot().retryAfterSec);
    }
    if (response.ok && response.body) return response;
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 403 || response.status === 404) {
      if (attempt === 0) continue; // an expired cached link looks the same: try once with a fresh one
      throw new StorageError("object_missing");
    }
    breaker.failed("unreachable");
    throw new StorageError("unreachable", breaker.snapshot().retryAfterSec);
  }
  throw new StorageError("object_missing");
}

/**
 * Open a stored file wherever its row says it is: StorageError "elsewhere" for another account's
 * file; an unrecorded file found here is recorded, and one not found here is remembered as elsewhere
 * (not marked missing: its account may come back). A "here" file's 404 stays object_missing.
 */
export async function openMedia(media: Pick<MediaRow, "id" | "stage_path" | "stage_account">, signal?: AbortSignal) {
  const where = placement(media);
  if (where === "elsewhere") throw new StorageError("elsewhere");
  try {
    const response = await openStoredObject(media.stage_path, signal);
    if (where === "unknown") {
      await query("UPDATE curialy.file_metadata SET stage_account = $2 WHERE id = $1 AND stage_account IS NULL", [media.id, mediaAccount()]).catch(() => undefined);
    }
    return response;
  } catch (error) {
    if (where === "unknown" && error instanceof StorageError && error.kind === "object_missing") {
      notHere.add(media.id);
      throw new StorageError("elsewhere");
    }
    throw error;
  }
}

/** A stored file's bytes by id (restoring attachments into a workspace, images for a model), capped. */
export async function loadMediaBytes(id: string) {
  const media = await getMedia(id);
  if (!media || media.state === "missing") throw new StorageError("object_missing");
  return readCapped(await openMedia(media));
}

/** Fetch staged bytes into memory by stage path (no placement check: prefer loadMediaBytes), capped. */
export async function fetchMediaBytes(stagePath: string) {
  return readCapped(await openStoredObject(stagePath));
}

async function readCapped(response: Response) {
  const reader = response.body!.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new StorageError("rejected", 0, "object larger than the upload limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Remove a file: "removed", or "kept" when its bytes are in another storage account (the record
 * goes, the stored copy stays there), or false when there is no such file. Refused (StorageError)
 * while storage is unavailable, so a record is never dropped while its object here remains.
 */
export async function deleteMedia(id: string): Promise<"removed" | "kept" | false> {
  const media = await getMedia(id);
  if (!media) return false;
  let kept = false;
  if (media.state !== "missing") {
    // Always remove from this stage (a no-op when the path is not here), so a file whose account was
    // never recorded cannot be orphaned here; it counts as kept only if nothing was removed and its
    // row says it may live elsewhere.
    const removed = await guarded("delete", () => run(`REMOVE '${STAGE}/${media.stage_path.replace(/'/g, "")}'`));
    kept = removed.length === 0 && placement(media) !== "here";
  }
  presigned.delete(media.stage_path);
  notHere.delete(id);
  await query("DELETE FROM curialy.file_metadata WHERE id = $1", [id]);
  return kept ? "kept" : "removed";
}

// ---- Cortex AI_COMPLETE (models Cortex serves only through SQL, e.g. Gemini 4 Argon) ----
// Uses the SNOWFLAKE_* login (the media stage may be elsewhere). Not streamed: the reply arrives whole.

export type CompletionResult = { text: string; inputTokens: number; outputTokens: number };

/** Short, neutral error text that keeps only what self-healing needs; the raw error goes to the log. */
export function completionError(error: Error) {
  console.error("[cortex] AI_COMPLETE failed:", error.message);
  const lower = error.message.toLowerCase();
  if (/max tokens of \d+ exceeded|too long|context|input length/.test(lower)) return new Error("Chat engine request failed (400): context window exceeded");
  if (/rate|quota|throttl|too many requests/.test(lower)) return new Error("Chat engine request failed (429): rate limited");
  if (/unknown model|unavailable in your region|not available|does not exist/.test(lower)) return new Error("Chat engine request failed (404): model unavailable");
  if (/network|econn|socket|connection|fetch failed|503|502|500|internal error/.test(lower)) return new Error("Chat engine request failed (503): the engine had a temporary error");
  return new Error("Chat engine request failed (400): the engine rejected the request");
}

export async function aiComplete(opts: { model: string; prompt: string; maxTokens: number; signal: AbortSignal; timeoutMs?: number }): Promise<CompletionResult> {
  if (opts.signal.aborted) throw new Error("Cancelled");
  // One deadline and one cancel path for the whole call, connecting included.
  let cancelStatement: (() => void) | null = null;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    // Not phrased as a timeout: an identical retry would only time out again.
    timer = setTimeout(() => { cancelStatement?.(); reject(new Error("The engine took too long to answer. Ask for a shorter reply, or try another model.")); }, opts.timeoutMs ?? 10 * 60_000);
    onAbort = () => { cancelStatement?.(); reject(new Error("Cancelled")); };
    opts.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const conn = await Promise.race([connect(sqlLogin()), stopped]);
    const rows = await Promise.race([stopped, new Promise<{ OUT: unknown }[]>((resolve, reject) => {
      const statement = conn.execute({
        sqlText: "SELECT AI_COMPLETE(model => ?, prompt => ?, model_parameters => PARSE_JSON(?), show_details => TRUE) AS OUT",
        binds: [opts.model, opts.prompt, JSON.stringify({ max_tokens: opts.maxTokens })],
        complete: (error, _statement, result) => (error ? reject(completionError(error)) : resolve((result ?? []) as { OUT: unknown }[])),
      } as snowflake.StatementOption);
      cancelStatement = () => statement.cancel(() => undefined);
    })]);
    const raw = rows[0]?.OUT;
    const details = (typeof raw === "string" ? JSON.parse(raw) : raw) as { choices?: { messages?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
    const text = details?.choices?.[0]?.messages;
    if (typeof text !== "string") throw new Error("Chat engine returned no completion.");
    return { text, inputTokens: details?.usage?.prompt_tokens ?? 0, outputTokens: details?.usage?.completion_tokens ?? 0 };
  } finally {
    clearTimeout(timer);
    if (onAbort) opts.signal.removeEventListener("abort", onAbort);
    stopped.catch(() => undefined); // settled after we are done; never an unhandled rejection
  }
}
