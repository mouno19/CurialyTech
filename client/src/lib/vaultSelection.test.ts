import { describe, expect, it } from "vitest";
import { DELETE_BATCH, type MediaDeleteResult } from "@shared/media";
import { deleteInTurns, goneCount, toggleSelection } from "./vaultSelection";

const order = ["a", "b", "c", "d", "e"];
const ids = (set: Set<string>) => [...set].sort();

describe("toggleSelection", () => {
  it("toggles one file, and with Shift gives every file up to the anchor the clicked file's new state", () => {
    expect(ids(toggleSelection(new Set(), order, "b", null, false))).toEqual(["b"]);
    expect(ids(toggleSelection(new Set(["b"]), order, "e", "b", true))).toEqual(["b", "c", "d", "e"]);
    // Shift-clicking a chosen file clears the range back to the anchor.
    expect(ids(toggleSelection(new Set(["a", "b", "c", "d"]), order, "b", "d", true))).toEqual(["a"]);
    // Backwards works too; an anchor no longer shown is a plain toggle.
    expect(ids(toggleSelection(new Set(), order, "a", "c", true))).toEqual(["a", "b", "c"]);
    expect(ids(toggleSelection(new Set(), order, "c", "gone", true))).toEqual(["c"]);
  });

  it("never changes the set it was given", () => {
    const before = new Set(["a"]);
    toggleSelection(before, order, "e", "a", true);
    expect(ids(before)).toEqual(["a"]);
  });
});

describe("deleteInTurns", () => {
  const many = Array.from({ length: DELETE_BATCH * 2 + 5 }, (_, n) => `f${n}`);
  const ok = (batch: string[]): MediaDeleteResult => ({ deleted: batch, kept: [], notFound: [], failed: [], skipped: [] });

  it("sends the selection in turns of DELETE_BATCH and adds up what each turn did", async () => {
    const sent: number[] = [];
    const progress: number[] = [];
    const outcome = await deleteInTurns(many, async batch => { sent.push(batch.length); return ok(batch); }, handled => progress.push(handled));
    expect(sent).toEqual([DELETE_BATCH, DELETE_BATCH, 5]);
    expect(progress).toEqual([DELETE_BATCH, DELETE_BATCH * 2, many.length]);
    expect(goneCount(outcome)).toBe(many.length);
    expect(outcome.stopped).toBeNull();
  });

  it("sends the files a turn had no time for again, first, and stops if a turn gets to none", async () => {
    const sent: string[][] = [];
    const outcome = await deleteInTurns(many, async batch => {
      sent.push(batch);
      // The first turn only gets to half of its files.
      return sent.length === 1 ? { ...ok(batch.slice(0, 50)), skipped: batch.slice(50) } : ok(batch);
    });
    expect(sent[1].slice(0, 50)).toEqual(many.slice(50, 100));
    expect(goneCount(outcome)).toBe(many.length);
    expect(outcome.stopped).toBeNull();

    const stuck = await deleteInTurns(["a", "b"], async batch => ({ ...ok([]), skipped: batch }));
    expect(stuck).toMatchObject({ stopped: "error", skipped: ["a", "b"] });
  });

  it("stops at the turn that finds storage down: the rest would only fail", async () => {
    let turns = 0;
    const outcome = await deleteInTurns(many, async batch => {
      turns++;
      return { ...ok(batch.slice(1)), failed: [{ id: batch[0], code: "storage_unavailable", error: "File storage is unavailable." }], retryAfter: 30 };
    });
    expect(turns).toBe(1);
    expect(outcome).toMatchObject({ stopped: "storage", retryAfter: 30 });
    expect(outcome.deleted).toHaveLength(DELETE_BATCH - 1);
  });

  it("keeps what a refused turn reports (a 503 names every file it couldn't delete) and why it stopped", async () => {
    const refusal = Object.assign(new Error("File storage isn't available right now, so nothing was deleted."), {
      code: "storage_unavailable",
      data: { deleted: [], kept: [], notFound: [], failed: [{ id: "f0", code: "storage_unavailable", error: "down" }] },
    });
    let turns = 0;
    const outcome = await deleteInTurns(many, async batch => {
      turns++;
      if (turns === 2) throw refusal;
      return ok(batch);
    });
    expect(turns).toBe(2);
    expect(outcome).toMatchObject({ stopped: "storage", error: refusal });
    expect(outcome.deleted).toHaveLength(DELETE_BATCH);
    expect(outcome.failed).toHaveLength(1);

    const offline = await deleteInTurns(["x"], async () => { throw Object.assign(new Error("Can't reach the server."), { code: "network" }); });
    expect(offline).toMatchObject({ stopped: "error", deleted: [] });
  });
});
