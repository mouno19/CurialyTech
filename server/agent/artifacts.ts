import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertStorageAvailable, storeMedia } from "../media/snowflake";
import { saveArtifactSnapshot } from "./store";
import { StorageError } from "../media/storage-errors";
import { resolveInWorkspace } from "./sandbox";

// Files the agent produces are attached to the chat as artifacts: copied into Curialy Vault so the
// links outlive the scratch workspace. Two sources: explicit attach_files calls, and everything the
// run created or changed (including files written by shell commands, found by diffing a manifest
// of the workspace taken at the start and end of the run).

const SKIP_DIRS = new Set(["node_modules", ".git", ".tmp", ".next", "__pycache__", ".venv", "venv", ".cache", ".pytest_cache", "coverage", ".turbo", ".parcel-cache"]);
const MAX_MANIFEST = 20_000;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const MAX_AUTO_ARTIFACTS = 20;

export type ArtifactKind = "image" | "audio" | "video" | "pdf" | "archive" | "document" | "code" | "data" | "other";
/** source "workspace": not in the Vault (storage was unavailable); the file is served from the task's workspace. */
export type ArtifactInfo = { mediaId: string | null; source: "vault" | "workspace"; path: string; filename: string; mimeType: string; sizeBytes: number; kind: ArtifactKind; primary: boolean };

const TYPES: Record<string, [string, ArtifactKind]> = {
  png: ["image/png", "image"], jpg: ["image/jpeg", "image"], jpeg: ["image/jpeg", "image"], gif: ["image/gif", "image"], webp: ["image/webp", "image"], avif: ["image/avif", "image"], svg: ["image/svg+xml", "image"], ico: ["image/x-icon", "image"], bmp: ["image/bmp", "image"],
  mp3: ["audio/mpeg", "audio"], wav: ["audio/wav", "audio"], ogg: ["audio/ogg", "audio"], oga: ["audio/ogg", "audio"], opus: ["audio/ogg", "audio"], m4a: ["audio/mp4", "audio"], aac: ["audio/aac", "audio"], flac: ["audio/flac", "audio"], weba: ["audio/webm", "audio"],
  mp4: ["video/mp4", "video"], webm: ["video/webm", "video"], mov: ["video/quicktime", "video"],
  pdf: ["application/pdf", "pdf"],
  zip: ["application/zip", "archive"], gz: ["application/gzip", "archive"], tgz: ["application/gzip", "archive"], tar: ["application/x-tar", "archive"], "7z": ["application/x-7z-compressed", "archive"], rar: ["application/vnd.rar", "archive"],
  md: ["text/markdown", "document"], markdown: ["text/markdown", "document"], txt: ["text/plain", "document"], rtf: ["application/rtf", "document"], html: ["text/html", "document"], htm: ["text/html", "document"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "document"], odt: ["application/vnd.oasis.opendocument.text", "document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data"], csv: ["text/csv", "data"], tsv: ["text/tab-separated-values", "data"], json: ["application/json", "data"], jsonl: ["application/x-ndjson", "data"], xml: ["application/xml", "data"], yaml: ["text/yaml", "data"], yml: ["text/yaml", "data"], sql: ["text/plain", "data"], parquet: ["application/octet-stream", "data"],
};
const CODE = /^(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|sh|bash|css|scss|vue|svelte|toml|ini|dockerfile|gradle|lua|r|dart|scala)$/i;

export function classify(file: string): { mimeType: string; kind: ArtifactKind } {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (TYPES[ext]) return { mimeType: TYPES[ext][0], kind: TYPES[ext][1] };
  if (CODE.test(ext) || /^(Dockerfile|Makefile)$/i.test(path.basename(file))) return { mimeType: "text/plain", kind: "code" };
  return { mimeType: "application/octet-stream", kind: "other" };
}

// Deliverables first, then data, then code; lock files and maps last.
const PRIORITY: Record<ArtifactKind, number> = { pdf: 0, archive: 0, audio: 0, video: 0, document: 1, image: 1, data: 2, code: 3, other: 4 };
const NOISE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock|.*\.map|.*\.tsbuildinfo|\.DS_Store)$/;

export type Manifest = Map<string, { size: number; mtimeMs: number }>;

export function workspaceManifest(root: string): Manifest {
  const files: Manifest = new Map();
  if (!fs.existsSync(root)) return files;
  const walk = (dir: string) => {
    if (files.size >= MAX_MANIFEST) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          files.set(path.relative(root, full), { size: stat.size, mtimeMs: stat.mtimeMs });
        } catch { /* vanished */ }
        if (files.size >= MAX_MANIFEST) return;
      }
    }
  };
  walk(root);
  return files;
}

/** Files that are new or changed between two manifests, deliverables first. */
export function changedSince(before: Manifest, after: Manifest, alsoChanged: Iterable<string> = []) {
  const changed = new Set<string>();
  for (const [file, info] of Array.from(after.entries())) {
    const previous = before.get(file);
    if (!previous || previous.size !== info.size || previous.mtimeMs !== info.mtimeMs) changed.add(file);
  }
  for (const file of Array.from(alsoChanged)) if (after.has(file)) changed.add(file);
  return Array.from(changed)
    .filter(file => !NOISE.test(file) && !file.startsWith("attachments/"))
    .sort((a, b) => PRIORITY[classify(a).kind] - PRIORITY[classify(b).kind] || a.localeCompare(b));
}

// ---- Read-only guard (Dev Team Architect/Reviewer commands) ----
// Commands run as the sandbox user, which can write the shared workspace, so read-only roles are
// enforced by snapshotting source files before a command and reverting whatever it changed.

const SNAPSHOT_FILE_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_TOTAL_BYTES = 32 * 1024 * 1024;

// Build output and lock files may change (a Reviewer has to build to test); source may not.
const GENERATED = /^(dist|build|out|target|\.svelte-kit|\.output|test-results|playwright-report|htmlcov)\//;
const guardedFile = (file: string) => !GENERATED.test(file) && !NOISE.test(file);

export type Snapshot = { manifest: Manifest; contents: Map<string, Buffer> };

export function sourceSnapshot(root: string): Snapshot {
  const manifest = workspaceManifest(root);
  const contents = new Map<string, Buffer>();
  let total = 0;
  for (const [file, info] of Array.from(manifest.entries())) {
    if (!guardedFile(file)) manifest.delete(file);
    else if (info.size > SNAPSHOT_FILE_BYTES || total + info.size > SNAPSHOT_TOTAL_BYTES) continue;
    try { contents.set(file, fs.readFileSync(path.join(root, file))); total += info.size; } catch { /* vanished */ }
  }
  return { manifest, contents };
}

/** Undo changes made since the snapshot: delete new files, restore changed/deleted ones (with their mtimes). */
export function revertWorkspace(root: string, snapshot: Snapshot): { reverted: string[]; unreverted: string[] } {
  const after = workspaceManifest(root);
  const reverted: string[] = [];
  const unreverted: string[] = [];
  const restore = (file: string, info: { mtimeMs: number }) => {
    const saved = snapshot.contents.get(file);
    if (!saved) return unreverted.push(file);
    try {
      const absolute = path.join(root, file);
      try { if (fs.readFileSync(absolute).equals(saved)) { fs.utimesSync(absolute, new Date(), new Date(info.mtimeMs)); return; } } catch { /* missing: rewrite */ }
      fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o2775 });
      fs.rmSync(absolute, { force: true }); // unlink + recreate also works when the command chmod-ed the file
      fs.writeFileSync(absolute, saved, { mode: 0o664 });
      fs.utimesSync(absolute, new Date(), new Date(info.mtimeMs));
      reverted.push(file);
    } catch {
      unreverted.push(file);
    }
  };
  for (const [file, info] of Array.from(after.entries())) {
    if (!guardedFile(file)) continue;
    const previous = snapshot.manifest.get(file);
    if (!previous) {
      try { fs.rmSync(path.join(root, file), { force: true }); reverted.push(file); } catch { unreverted.push(file); }
    } else if (previous.size !== info.size || previous.mtimeMs !== info.mtimeMs) restore(file, previous);
  }
  for (const [file, info] of Array.from(snapshot.manifest.entries())) if (!after.has(file)) restore(file, info);
  return { reverted, unreverted };
}

/**
 * Copy workspace files into Curialy Vault and describe them for the chat. While file storage is
 * unavailable nothing is attempted: the files are described as workspace files instead (served from
 * the workspace, or its archive, by /tasks/:id/file), so an outage costs no uploads and no errors.
 */
export async function storeArtifacts(sessionId: string, root: string, files: string[], primary: boolean) {
  const stored: ArtifactInfo[] = [];
  const skipped: string[] = [];
  const keep: { path: string; content: Buffer; sha256: string }[] = [];
  let storageDown = false;
  try { assertStorageAvailable(); } catch (error) { storageDown = error instanceof StorageError && error.unavailable; }
  for (let index = 0; index < files.length; index += 4) {
    const batch = files.slice(index, index + 4);
    const results = await Promise.all(batch.map(async requested => {
      try {
        const { absolute, relative } = resolveInWorkspace(root, requested);
        const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat?.isFile()) return { skip: `${requested} (not a file)` };
        if (stat.size > MAX_ARTIFACT_BYTES) return { skip: `${relative} (over ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB)` };
        const { mimeType, kind } = classify(relative);
        const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let buffer: Buffer;
        try { buffer = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
        const fallback = () => {
          keep.push({ path: relative, content: buffer, sha256: createHash("sha256").update(buffer).digest("hex") });
          return { info: { mediaId: null, source: "workspace", path: relative, filename: path.basename(relative), mimeType, sizeBytes: stat.size, kind, primary } satisfies ArtifactInfo };
        };
        if (storageDown) return fallback();
        try {
          const media = await storeMedia({ buffer, filename: path.basename(relative), mimeType, kind: "artifact", sessionId, sourcePath: relative });
          return { info: { mediaId: media.id, source: "vault", path: relative, filename: media.filename, mimeType, sizeBytes: buffer.length, kind, primary } satisfies ArtifactInfo };
        } catch (error) {
          if (error instanceof StorageError && error.unavailable) {
            storageDown = true; // stop trying for the rest of the batch
            return fallback();
          }
          throw error;
        }
      } catch (error) {
        return { skip: `${requested} (${error instanceof StorageError ? error.message : "could not be stored"})` };
      }
    }));
    for (const result of results) {
      if ("info" in result && result.info) stored.push(result.info);
      else if ("skip" in result && result.skip) skipped.push(result.skip);
    }
  }
  // Files only "kept in the workspace" need a durable copy before the workspace is ever archived.
  if (keep.length) {
    await saveArtifactSnapshot(sessionId, keep).catch(error => {
      console.error(`[artifacts] ${sessionId}: could not keep ${keep.length} attachment(s) with the archive:`, error instanceof Error ? error.message : error);
      for (const file of keep) {
        const index = stored.findIndex(item => item.source === "workspace" && item.path === file.path);
        if (index >= 0) stored.splice(index, 1);
        skipped.push(`${file.path} (could not be stored)`);
      }
    });
  }
  return { stored, skipped };
}
