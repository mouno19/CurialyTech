import fs from "node:fs";
import path from "node:path";
import { query } from "../db/pg";
import { storeMedia } from "../media/snowflake";
import { resolveInWorkspace } from "./sandbox";

// Files the agent produces are attached to the chat as artifacts: copied into Curialy Vault so the
// links outlive the scratch workspace. Two sources: explicit attach_files calls, and everything the
// run created or changed (including files written by shell commands, found by diffing a manifest
// of the workspace taken at the start and end of the run).

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".venv", "venv", ".cache", ".pytest_cache", "coverage", ".turbo", ".parcel-cache"]);
const MAX_MANIFEST = 20_000;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const MAX_AUTO_ARTIFACTS = 20;

export type ArtifactKind = "image" | "pdf" | "archive" | "document" | "code" | "data" | "other";
export type ArtifactInfo = { mediaId: string; path: string; filename: string; mimeType: string; sizeBytes: number; kind: ArtifactKind; primary: boolean };

const TYPES: Record<string, [string, ArtifactKind]> = {
  png: ["image/png", "image"], jpg: ["image/jpeg", "image"], jpeg: ["image/jpeg", "image"], gif: ["image/gif", "image"], webp: ["image/webp", "image"], avif: ["image/avif", "image"], svg: ["image/svg+xml", "image"], ico: ["image/x-icon", "image"], bmp: ["image/bmp", "image"],
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
const PRIORITY: Record<ArtifactKind, number> = { pdf: 0, archive: 0, document: 1, image: 1, data: 2, code: 3, other: 4 };
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

/** Copy workspace files into Curialy Vault and describe them for the chat. */
export async function storeArtifacts(sessionId: string, root: string, files: string[], primary: boolean) {
  const stored: ArtifactInfo[] = [];
  const skipped: string[] = [];
  for (let index = 0; index < files.length; index += 4) {
    const batch = files.slice(index, index + 4);
    const results = await Promise.all(batch.map(async requested => {
      try {
        const { absolute, relative } = resolveInWorkspace(root, requested);
        const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat?.isFile()) return { skip: `${requested} (not a file)` };
        if (stat.size > MAX_ARTIFACT_BYTES) return { skip: `${relative} (over ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB)` };
        const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let buffer: Buffer;
        try { buffer = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
        const { mimeType, kind } = classify(relative);
        const media = await storeMedia({ buffer, filename: path.basename(relative), mimeType, kind: "artifact", sessionId });
        await query("UPDATE curialy.file_metadata SET source_path = $2 WHERE id = $1", [media.id, relative]);
        return { info: { mediaId: media.id, path: relative, filename: media.filename, mimeType, sizeBytes: buffer.length, kind, primary } satisfies ArtifactInfo };
      } catch (error) {
        return { skip: `${requested} (${error instanceof Error ? error.message.slice(0, 120) : "error"})` };
      }
    }));
    for (const result of results) {
      if ("info" in result && result.info) stored.push(result.info);
      else if ("skip" in result && result.skip) skipped.push(result.skip);
    }
  }
  return { stored, skipped };
}
