import { randomUUID } from "node:crypto";
import snowflake from "snowflake-sdk";
import { query } from "../db/pg";

// User media lives in a Snowflake internal stage; bytes go from memory straight to the stage
// (snowflake-sdk fileStream) and are served through short-lived presigned URLs. Nothing is
// written to the VPS disk, including the driver's own log (routed to stdout / the journal).

const STAGE = process.env.SNOWFLAKE_MEDIA_STAGE || "@CURIALY_DB.PUBLIC.USER_MEDIA_STAGE";
const MAX_BYTES = 25 * 1024 * 1024;

snowflake.configure({ logLevel: "ERROR", logFilePath: "STDOUT", additionalLogToConsole: false } as never);

let connection: snowflake.Connection | null = null;
let connecting: Promise<snowflake.Connection> | null = null;

function connect() {
  if (connection?.isUp()) return Promise.resolve(connection);
  connecting ??= new Promise<snowflake.Connection>((resolve, reject) => {
    const token = process.env.SNOWFLAKE_PAT;
    if (!token) return reject(new Error("SNOWFLAKE_PAT is not configured."));
    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT || "kxjnkhs-lk29580",
      username: process.env.SNOWFLAKE_USER || "CORTEX_CLI_USER",
      role: process.env.SNOWFLAKE_ROLE || "CORTEX_CLI_ROLE",
      warehouse: process.env.SNOWFLAKE_WAREHOUSE || "COMPUTE_WH",
      authenticator: "PROGRAMMATIC_ACCESS_TOKEN",
      token,
      clientSessionKeepAlive: true,
    } as snowflake.ConnectionOptions);
    conn.connect(error => (error ? reject(error) : resolve(conn)));
  }).then(conn => {
    connection = conn;
    return conn;
  }).finally(() => {
    connecting = null;
  });
  return connecting;
}

function run<T = Record<string, unknown>>(sqlText: string, extra: Record<string, unknown> = {}): Promise<T[]> {
  return connect().then(conn => new Promise<T[]>((resolve, reject) => {
    conn.execute({
      sqlText,
      ...extra,
      complete: (error, _statement, rows) => (error ? reject(error) : resolve((rows ?? []) as T[])),
    } as snowflake.StatementOption);
  }));
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";

let readyCache: { at: number; ok: boolean; detail: string } | null = null;

export async function mediaStatus(force = false) {
  if (!force && readyCache && Date.now() - readyCache.at < 60_000) return readyCache;
  try {
    await run(`LIST ${STAGE} PATTERN = '.*__curialy_probe__.*'`);
    readyCache = { at: Date.now(), ok: true, detail: `${STAGE} reachable` };
  } catch (error) {
    readyCache = { at: Date.now(), ok: false, detail: error instanceof Error ? error.message.split("\n")[0].slice(0, 220) : "Stage unavailable" };
  }
  return readyCache;
}

export type StoredMedia = { id: string; filename: string; mimeType: string; sizeBytes: number; kind: string; stagePath: string };

export async function storeMedia(input: { buffer: Buffer; filename: string; mimeType: string; kind: "upload" | "screenshot" | "artifact"; sessionId?: string | null }): Promise<StoredMedia> {
  if (input.buffer.length > MAX_BYTES) throw new Error(`Files are limited to ${MAX_BYTES / 1024 / 1024} MB.`);
  const id = randomUUID();
  const filename = safeName(input.filename);
  const folder = `${input.kind}/${id}`;
  // PUT parses the "local" path only for the target file name; the bytes come from fileStream.
  await run(`PUT 'file:///${filename}' '${STAGE}/${folder}' AUTO_COMPRESS = FALSE OVERWRITE = TRUE`, { fileStream: input.buffer });
  // The driver decides the final object key (it can introduce a doubled slash), so read it back.
  const listed = await run<{ name: string }>(`LIST '${STAGE}/${folder}'`);
  const key = listed.map(row => row.name).find(name => name.endsWith(`/${filename}`));
  if (!key) throw new Error("Upload to the media stage could not be confirmed.");
  const stagePath = key.slice(key.indexOf("/") + 1); // strip the stage's own name prefix
  await query(
    `INSERT INTO curialy.file_metadata (id, session_id, kind, filename, mime_type, size_bytes, storage, stage_path)
     VALUES ($1, $2, $3, $4, $5, $6, 'snowflake_stage', $7)`,
    [id, input.sessionId ?? null, input.kind, filename, input.mimeType, input.buffer.length, stagePath],
  );
  return { id, filename, mimeType: input.mimeType, sizeBytes: input.buffer.length, kind: input.kind, stagePath };
}

export async function getMedia(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const { rows } = await query<{ id: string; filename: string; mime_type: string; size_bytes: number; kind: string; stage_path: string; created_at: Date }>(
    "SELECT id, filename, mime_type, size_bytes, kind, stage_path, created_at FROM curialy.file_metadata WHERE id = $1", [id],
  );
  return rows[0];
}

export async function listMedia(limit = 200) {
  const { rows } = await query("SELECT id, filename, mime_type AS \"mimeType\", size_bytes AS \"sizeBytes\", kind, session_id AS \"sessionId\", created_at AS \"createdAt\" FROM curialy.file_metadata ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows;
}

/** Presigned HTTPS URL for a staged file (requires the stage to use SNOWFLAKE_SSE encryption). */
export async function presignedUrl(stagePath: string, ttlSeconds = 3600) {
  const rows = await run<{ URL: string }>(`SELECT GET_PRESIGNED_URL(${STAGE}, '${stagePath.replace(/'/g, "")}', ${Math.max(60, Math.min(604_800, ttlSeconds))}) AS URL`);
  if (!rows[0]?.URL) throw new Error("Snowflake returned no presigned URL.");
  return rows[0].URL;
}

/** Fetch staged bytes into memory (used to restore attachments into an agent workspace). */
export async function fetchMediaBytes(stagePath: string) {
  const response = await fetch(await presignedUrl(stagePath, 300));
  if (!response.ok) throw new Error(`Stage download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteMedia(id: string) {
  const media = await getMedia(id);
  if (!media) return false;
  await run(`REMOVE '${STAGE}/${media.stage_path.replace(/'/g, "")}'`).catch(() => undefined);
  await query("DELETE FROM curialy.file_metadata WHERE id = $1", [id]);
  return true;
}
