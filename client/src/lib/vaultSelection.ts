import { DELETE_BATCH, type MediaDeleteResult } from "@shared/media";

// Choosing many Media Vault files, and deleting them in turns of DELETE_BATCH.

/**
 * Toggle `id`. With `range` (Shift+click) and an anchor in view, every file between the anchor and
 * `id` takes the new state of `id` (in the order shown).
 */
export function toggleSelection(selected: ReadonlySet<string>, order: readonly string[], id: string, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(id);
  const from = range && anchor !== null ? order.indexOf(anchor) : -1;
  const to = order.indexOf(id);
  if (from < 0 || to < 0) {
    if (on) next.add(id);
    else next.delete(id);
    return next;
  }
  const [low, high] = from < to ? [from, to] : [to, from];
  for (let index = low; index <= high; index++) {
    if (on) next.add(order[index]);
    else next.delete(order[index]);
  }
  return next;
}

/** Everything deleting many files did, added up over the turns. stopped: why it ended early. */
export type DeleteOutcome = MediaDeleteResult & { stopped: "storage" | "error" | null; error: unknown };

/**
 * Delete `ids` in turns of DELETE_BATCH through `send`, reporting how many have been handled. Files
 * a turn had no time for go first in the next one. Stops at the first turn that finds storage down
 * (the rest would only fail), that fails outright, or that got to none of its files.
 */
export async function deleteInTurns(ids: readonly string[], send: (batch: string[]) => Promise<MediaDeleteResult>, onProgress?: (handled: number) => void): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: [], kept: [], notFound: [], failed: [], skipped: [], stopped: null, error: null };
  const add = (result: Partial<MediaDeleteResult>) => {
    outcome.deleted.push(...(result.deleted ?? []));
    outcome.kept.push(...(result.kept ?? []));
    outcome.notFound.push(...(result.notFound ?? []));
    outcome.failed.push(...(result.failed ?? []));
    if (result.retryAfter) outcome.retryAfter = result.retryAfter;
  };
  const pending = [...ids];
  while (pending.length) {
    const batch = pending.splice(0, DELETE_BATCH);
    let result: MediaDeleteResult;
    try {
      result = await send(batch);
    } catch (error) {
      // A 503 still says what it did with each file (nothing deleted, every file failed).
      const data = (error as { data?: Partial<MediaDeleteResult> } | null)?.data;
      if (data && Array.isArray(data.failed)) add(data);
      outcome.stopped = (error as { code?: string } | null)?.code === "storage_unavailable" ? "storage" : "error";
      outcome.error = error;
      outcome.skipped = pending;
      onProgress?.(ids.length - pending.length);
      return outcome;
    }
    add(result);
    const again = (result.skipped ?? []).filter(id => batch.includes(id));
    pending.unshift(...again);
    onProgress?.(ids.length - pending.length);
    if (outcome.failed.some(failure => failure.code === "storage_unavailable")) {
      outcome.stopped = "storage";
      outcome.skipped = pending;
      return outcome;
    }
    if (again.length === batch.length) {
      outcome.stopped = "error";
      outcome.error = new Error("Deleting is taking too long right now. Try again in a moment.");
      outcome.skipped = pending;
      return outcome;
    }
  }
  return outcome;
}

/** Files gone from the vault after a delete (deleted, removed from the list, or already gone). */
export const goneCount = (outcome: Pick<MediaDeleteResult, "deleted" | "kept" | "notFound">) => outcome.deleted.length + outcome.kept.length + outcome.notFound.length;
