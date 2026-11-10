// The Media Vault: what an account may keep, and the shapes of its API (server/agent/routes.ts,
// server/media/vault.ts, client/src/pages/Media.tsx).

/** One file, any account: an upload is held in the server's memory on its way to storage. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** A free account's vault. The operator and accounts with an active plan have no limit. */
export const FREE_VAULT_BYTES = 250 * 1024 * 1024;
export const FREE_VAULT_FILES = 500;
/** Uploads one account may have in flight at once (each is held in memory until it is stored). */
export const UPLOADS_AT_ONCE = 2;
/** Files one delete request may name; the client sends a larger selection in turns. */
export const DELETE_BATCH = 100;
/** Ids one "select all" answer holds at most (the newest first). */
export const MAX_SELECT_IDS = 20_000;

export type MediaKind = "upload" | "screenshot" | "artifact";
export const MEDIA_KINDS: readonly MediaKind[] = ["upload", "screenshot", "artifact"];
export const isMediaKind = (value: unknown): value is MediaKind => MEDIA_KINDS.includes(value as MediaKind);

/** What an account keeps: every record by kind, and what counts toward the limit (files not known to be gone). */
export type VaultSummary = { total: number; byKind: Record<MediaKind, number>; usedBytes: number; usedFiles: number };

/**
 * The account's limit: none for the operator ("operator") or while a plan lasts ("plan", with its
 * name); otherwise the free vault's bytes and files.
 */
export type VaultQuota = { unlimited: boolean; reason: "operator" | "plan" | null; plan: string | null; maxBytes: number | null; maxFiles: number | null };

/** Whether adding `bytes` would pass the limit (slack: bytes of multipart framing allowed on top). */
export function vaultFull(summary: Pick<VaultSummary, "usedBytes" | "usedFiles">, quota: VaultQuota, bytes = 0, slack = 0) {
  if (quota.unlimited || quota.maxBytes === null || quota.maxFiles === null) return false;
  return summary.usedBytes + bytes > quota.maxBytes + slack || summary.usedFiles >= quota.maxFiles;
}

/**
 * One delete request's outcome, by file id. kept: the record is gone but its copy stays in an
 * earlier storage location; notFound: already deleted, or not this account's; failed: still there;
 * skipped: not tried before the request's time ran out (send them again).
 */
export type MediaDeleteResult = {
  deleted: string[];
  kept: string[];
  notFound: string[];
  failed: { id: string; code: "storage_unavailable" | "storage_rejected" | "error"; error: string }[];
  skipped: string[];
  /** Seconds before storage is worth trying again, when it was unavailable. */
  retryAfter?: number;
};
