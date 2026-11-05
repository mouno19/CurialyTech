import { createHash, randomBytes } from "node:crypto";
import { query } from "../db/pg";
import { API_KEY_PATTERN, API_KEY_PREFIX_LENGTH, GATEWAY_MODEL_IDS, MAX_ACTIVE_KEYS, type ApiKeyInfo } from "@shared/gateway";

// Developer API keys: `cur_live_` + 32 random hex characters. Only the SHA-256 of a key is stored
// (it is the lookup), with its first characters so the owner can tell keys apart.

export const hashKey = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const newSecret = () => `cur_live_${randomBytes(16).toString("hex")}`;

export class KeyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type KeyRow = { id: string; name: string; key_prefix: string; allowed_models: string[]; status: "active" | "revoked"; created_at: Date; last_used_at: Date | null };
const COLUMNS = "id, name, key_prefix, allowed_models, status, created_at, last_used_at";
const info = (row: KeyRow): ApiKeyInfo => ({
  id: row.id, name: row.name, prefix: row.key_prefix, allowedModels: row.allowed_models, status: row.status,
  createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A new key for `userId`: the secret is returned here once and never again. */
export async function createKey(userId: string, name: string, models: string[]) {
  const allowed = GATEWAY_MODEL_IDS.filter(id => models.includes(id));
  if (!allowed.length) throw new KeyError("Choose at least one model.", 400);
  const secret = newSecret();
  const { rows: [row] } = await query<KeyRow>(
    `INSERT INTO curialy.api_keys (user_id, name, key_hash, key_prefix, allowed_models)
     SELECT $1, $2, $3, $4, $5::jsonb WHERE (SELECT count(*) FROM curialy.api_keys WHERE user_id = $1 AND status = 'active') < $6
     RETURNING ${COLUMNS}`,
    [userId, name, hashKey(secret), secret.slice(0, API_KEY_PREFIX_LENGTH), JSON.stringify(allowed), MAX_ACTIVE_KEYS],
  );
  if (!row) throw new KeyError(`You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use first.`, 409);
  return { key: info(row), secret };
}

/** The account's keys, active first, newest first (revoked ones stay listed). */
export async function listKeys(userId: string) {
  const { rows } = await query<KeyRow>(`SELECT ${COLUMNS} FROM curialy.api_keys WHERE user_id = $1 ORDER BY status = 'revoked', created_at DESC LIMIT 100`, [userId]);
  return rows.map(info);
}

/** Revoke one of the account's keys; it stops working at once. */
export async function revokeKey(userId: string, id: string) {
  if (!UUID.test(id)) throw new KeyError("Key not found.", 404);
  const { rows: [row] } = await query<KeyRow & { key_hash: string }>(
    `UPDATE curialy.api_keys SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}, key_hash`,
    [id, userId],
  );
  if (!row) throw new KeyError("Key not found.", 404);
  lookups.delete(row.key_hash);
  return info(row);
}

export type GatewayKey = { id: string; userId: string; allowedModels: string[]; operator: boolean };

/** Recent lookups by hash, so a busy client is not a database query per request; revoking clears its entry. */
const lookups = new Map<string, { key: GatewayKey | null; until: number }>();
const LOOKUP_TTL_MS = 30_000;

/** The active key behind `secret`, or null (unknown, revoked, or its account is banned). */
export async function findActiveKey(secret: string): Promise<GatewayKey | null> {
  if (!API_KEY_PATTERN.test(secret)) return null;
  const hash = hashKey(secret);
  const cached = lookups.get(hash);
  if (cached && cached.until > Date.now()) return cached.key;
  const { rows: [row] } = await query<{ id: string; user_id: string; allowed_models: string[]; role: string; banned_at: Date | null }>(
    `SELECT k.id, k.user_id, k.allowed_models, u.role, u.banned_at FROM curialy.api_keys k JOIN curialy.users u ON u.id = k.user_id
     WHERE k.key_hash = $1 AND k.status = 'active'`,
    [hash],
  );
  const key = row && !row.banned_at ? { id: row.id, userId: row.user_id, allowedModels: row.allowed_models, operator: row.role === "admin" } : null;
  if (lookups.size > 5000) lookups.clear();
  lookups.set(hash, { key, until: Date.now() + LOOKUP_TTL_MS });
  return key;
}

/** Record use (at most once a minute per key). */
export function touchKey(id: string) {
  query("UPDATE curialy.api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [id]).catch(() => undefined);
}
