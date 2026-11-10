import { FREE_VAULT_BYTES, FREE_VAULT_FILES, type MediaDeleteResult, type VaultQuota, type VaultSummary } from "@shared/media";
import { activePlan } from "../credits";
import { query } from "../db/pg";
import { deleteMedia, ownedMedia } from "./snowflake";
import { redact, StorageError } from "./storage-errors";

// What an account keeps in its Media Vault and how much it may keep: free accounts have a bounded
// vault; the operator and accounts with an active plan have none. Deleting many files at once.

type VaultRow = {
  total: string; upload: string; screenshot: string; artifact: string; used_files: string; used_bytes: string;
  plan_id: string | null; plan_expires_at: Date | null; plan_credits_per_window: number | null;
};

/** The account's vault in one read: counts by kind, what counts toward the limit, and the limit. */
export async function vaultState(user: { id: string; role: string }): Promise<{ summary: VaultSummary; quota: VaultQuota }> {
  const { rows: [row] } = await query<VaultRow>(
    `SELECT count(f.id) AS total, count(f.id) FILTER (WHERE f.kind = 'upload') AS upload,
            count(f.id) FILTER (WHERE f.kind = 'screenshot') AS screenshot, count(f.id) FILTER (WHERE f.kind = 'artifact') AS artifact,
            count(f.id) FILTER (WHERE f.state <> 'missing') AS used_files, COALESCE(sum(f.size_bytes) FILTER (WHERE f.state <> 'missing'), 0) AS used_bytes,
            u.plan_id, u.plan_expires_at, u.plan_credits_per_window
     FROM curialy.users u LEFT JOIN curialy.file_metadata f ON f.user_id = u.id WHERE u.id = $1 GROUP BY u.id`,
    [user.id],
  );
  const count = (value: string | undefined) => Number(value ?? 0);
  const summary: VaultSummary = {
    total: count(row?.total),
    byKind: { upload: count(row?.upload), screenshot: count(row?.screenshot), artifact: count(row?.artifact) },
    usedBytes: count(row?.used_bytes),
    usedFiles: count(row?.used_files),
  };
  return { summary, quota: quotaFor(user, row ? activePlan(row) : null) };
}

export function quotaFor(user: { role: string }, plan: { name: string } | null): VaultQuota {
  if (user.role === "admin") return { unlimited: true, reason: "operator", plan: null, maxBytes: null, maxFiles: null };
  if (plan) return { unlimited: true, reason: "plan", plan: plan.name, maxBytes: null, maxFiles: null };
  return { unlimited: false, reason: null, plan: null, maxBytes: FREE_VAULT_BYTES, maxFiles: FREE_VAULT_FILES };
}

/** The 413 body for a full free vault. */
export function vaultFullError(quota: VaultQuota) {
  const limit = `${Math.round((quota.maxBytes ?? FREE_VAULT_BYTES) / 1024 / 1024)} MB or ${quota.maxFiles ?? FREE_VAULT_FILES} files`;
  return { error: `Your Media Vault is full: a free account keeps up to ${limit}. Delete files you no longer need, or get a plan for unlimited storage.`, code: "quota" };
}

/**
 * Delete the account's files among `ids`, a few at a time. Only its own files are touched; the
 * rest are reported as not found. A file storage can't delete now stays, and is reported as failed.
 * No file is started after `budgetMs`, so the answer comes well within the proxy's 60 s: the rest
 * are reported as skipped.
 */
export async function deleteFiles(userId: string, ids: string[], { concurrency = 5, budgetMs = 40_000 } = {}): Promise<MediaDeleteResult> {
  const deadline = Date.now() + budgetMs;
  const unique = [...new Set(ids.map(id => id.toLowerCase()))];
  const rows = await ownedMedia(userId, unique);
  const owned = new Set(rows.map(row => row.id));
  const result: MediaDeleteResult = { deleted: [], kept: [], notFound: unique.filter(id => !owned.has(id)), failed: [], skipped: [] };
  let retryAfter = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (Date.now() > deadline) {
        result.skipped.push(row.id);
        continue;
      }
      try {
        const outcome = await deleteMedia(row);
        (outcome === "removed" ? result.deleted : outcome === "kept" ? result.kept : result.notFound).push(row.id);
      } catch (error) {
        if (error instanceof StorageError) {
          if (error.unavailable) retryAfter = Math.max(retryAfter, error.retryAfterSec || 30);
          result.failed.push({ id: row.id, code: error.unavailable ? "storage_unavailable" : "storage_rejected", error: error.message });
        } else {
          console.error("[vault] delete:", error instanceof Error ? `${error.name}: ${redact(error.message)}` : redact(String(error)));
          result.failed.push({ id: row.id, code: "error", error: "This file couldn't be deleted." });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  if (retryAfter) result.retryAfter = retryAfter;
  return result;
}
