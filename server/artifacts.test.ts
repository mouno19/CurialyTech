import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Files a run produced reach the chat even while file storage is down (as workspace files, served
// by the task's file route), and an outage costs no upload storm.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-artifacts-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

const media = vi.hoisted(() => ({ assertStorageAvailable: vi.fn(), storeMedia: vi.fn() }));
const store = vi.hoisted(() => ({ saveArtifactSnapshot: vi.fn() }));
vi.mock("./media/snowflake", () => media);
vi.mock("./agent/store", async importOriginal => ({ ...(await importOriginal<typeof import("./agent/store")>()), saveArtifactSnapshot: store.saveArtifactSnapshot }));

const { storeArtifacts, changedSince } = await import("./agent/artifacts");
const { StorageError, publicStorageMessage } = await import("./media/storage-errors");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TASK = "00000000-0000-4000-8000-0000000000b1";
const root = path.join(tmp, "ws");
for (const [file, content] of Object.entries({ "report.pdf": "%PDF", "chart.png": "png", "data.csv": "a,b", "src/a.ts": "x", "src/b.ts": "y", "notes.md": "# n" })) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

beforeEach(() => {
  media.assertStorageAvailable.mockReset();
  media.storeMedia.mockReset();
  store.saveArtifactSnapshot.mockReset();
  store.saveArtifactSnapshot.mockResolvedValue(undefined);
});

const snapshotPaths = () => store.saveArtifactSnapshot.mock.calls.flatMap(([, files]) => (files as { path: string }[]).map(file => file.path));

describe("storeArtifacts", () => {
  it("describes files as workspace files while storage is known to be down, without uploading", async () => {
    media.assertStorageAvailable.mockImplementation(() => { throw new StorageError("stage_missing", 60); });
    const { stored, skipped } = await storeArtifacts(TASK, root, ["report.pdf", "chart.png"], true);
    expect(media.storeMedia).not.toHaveBeenCalled();
    expect(skipped).toEqual([]);
    expect(stored).toEqual([
      { mediaId: null, source: "workspace", path: "report.pdf", filename: "report.pdf", mimeType: "application/pdf", sizeBytes: 4, kind: "pdf", primary: true },
      { mediaId: null, source: "workspace", path: "chart.png", filename: "chart.png", mimeType: "image/png", sizeBytes: 3, kind: "image", primary: true },
    ]);
    // Kept with the task's archive, so the files outlive the live workspace.
    expect(store.saveArtifactSnapshot).toHaveBeenCalledWith(TASK, [
      expect.objectContaining({ path: "report.pdf", content: Buffer.from("%PDF"), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      expect.objectContaining({ path: "chart.png", content: Buffer.from("png") }),
    ]);
  });

  it("reports files it could neither upload nor keep with the archive as not stored", async () => {
    media.assertStorageAvailable.mockImplementation(() => { throw new StorageError("stage_missing", 60); });
    store.saveArtifactSnapshot.mockRejectedValue(new Error("connection refused"));
    const { stored, skipped } = await storeArtifacts(TASK, root, ["report.pdf", "chart.png"], true);
    expect(stored).toEqual([]);
    expect(skipped).toEqual(["report.pdf (could not be stored)", "chart.png (could not be stored)"]);
  });

  it("stores files in the vault when storage works", async () => {
    media.storeMedia.mockImplementation(async (input: { filename: string; mimeType: string; buffer: Buffer }) => ({ id: `m-${input.filename}`, filename: input.filename, mimeType: input.mimeType, sizeBytes: input.buffer.length, kind: "artifact", stagePath: "artifact/x" }));
    const { stored } = await storeArtifacts(TASK, root, ["data.csv"], false);
    expect(stored).toEqual([{ mediaId: "m-data.csv", source: "vault", path: "data.csv", filename: "data.csv", mimeType: "text/csv", sizeBytes: 3, kind: "data", primary: false }]);
    expect(media.storeMedia).toHaveBeenCalledWith(expect.objectContaining({ kind: "artifact", sessionId: TASK, sourcePath: "data.csv" }));
    expect(store.saveArtifactSnapshot).not.toHaveBeenCalled();
  });

  it("stops uploading once storage turns out to be unavailable", async () => {
    media.storeMedia.mockRejectedValue(new StorageError("unreachable", 10));
    const files = ["report.pdf", "chart.png", "data.csv", "src/a.ts", "src/b.ts", "notes.md"];
    const { stored, skipped } = await storeArtifacts(TASK, root, files, false);
    expect(stored.map(file => [file.path, file.source, file.mediaId])).toEqual(files.map(file => [file, "workspace", null]));
    expect(skipped).toEqual([]);
    expect(media.storeMedia.mock.calls.length).toBeLessThanOrEqual(4); // the first batch only
    expect(snapshotPaths()).toEqual(files);
  });

  it("skips a file storage rejected, with a neutral reason, and paths outside the workspace", async () => {
    media.storeMedia.mockRejectedValue(new StorageError("rejected", 0, "Snowflake PUT failed for @CURIALY_DB.PUBLIC.USER_MEDIA_STAGE"));
    const { stored, skipped } = await storeArtifacts(TASK, root, ["notes.md", "../outside.txt", "src", "missing.txt"], false);
    expect(stored).toEqual([]);
    expect(skipped[0]).toBe(`notes.md (${publicStorageMessage("rejected")})`);
    expect(skipped.slice(1)).toEqual(["../outside.txt (could not be stored)", "src (not a file)", "missing.txt (not a file)"]);
    expect(skipped.join(" ")).not.toMatch(/snowflake|stage|curialy_db/i);
  });
});

describe("changedSince", () => {
  it("lists new and changed files, deliverables first, without lockfiles, maps or uploads", () => {
    const before = new Map([["src/a.ts", { size: 1, mtimeMs: 1 }], ["README.md", { size: 1, mtimeMs: 1 }]]);
    const after = new Map([
      ["src/a.ts", { size: 2, mtimeMs: 2 }], ["README.md", { size: 1, mtimeMs: 1 }], ["out/report.pdf", { size: 9, mtimeMs: 3 }],
      ["package-lock.json", { size: 5, mtimeMs: 3 }], ["dist/app.js.map", { size: 5, mtimeMs: 3 }], ["attachments/upload.png", { size: 5, mtimeMs: 3 }],
      ["data.csv", { size: 3, mtimeMs: 3 }],
    ]);
    expect(changedSince(before, after, ["README.md", "gone.txt"])).toEqual(["out/report.pdf", "README.md", "data.csv", "src/a.ts"]);
  });
});
