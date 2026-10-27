import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { query } from "../db/pg";
import { ensureWorkspace, removeWorkspace, workspacePath, writeWorkspaceBytes } from "./sandbox";
import { idleWorkspaces, loadWorkspaceSnapshot, saveWorkspaceSnapshot, updateAgentTask, type SnapshotRole } from "./store";
import { linkedRepo, linkedSnapshotFiles, restoreLinkedRepo } from "./repos";
import { getConnection } from "../services/github";

// Workspaces on the VPS are scratch space only. The durable copy of an agent's files is the
// snapshot in Tiger; the directory is removed once a session has been idle for IDLE_MINUTES
// and rebuilt from the snapshot if the user follows up later.

const IDLE_MINUTES = Number(process.env.AGENT_WORKSPACE_IDLE_MINUTES || 60);
// Never part of a project's sources.
const SKIP_DIRS = new Set(["node_modules", ".git", ".tmp", ".next", ".nuxt", ".svelte-kit", "__pycache__", ".venv", "venv", ".cache", ".pytest_cache", "coverage", ".turbo", ".parcel-cache"]);
/** Folders that are build output when they sit next to a project manifest (a scripts/build/ folder is kept). */
const OUTPUT_DIRS = new Set(["dist", "build", "out", "target"]);
const MANIFESTS = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "pom.xml", "build.gradle", "go.mod"];
const NOISE_FILES = /(\.map|\.tsbuildinfo|\.DS_Store)$/;

function isOutputDir(parent: string, name: string) {
  return OUTPUT_DIRS.has(name) && MANIFESTS.some(file => fs.existsSync(path.join(parent, file)));
}

/** Uploads staged for the agent and local secrets: never pushed to GitHub or a preview repository. */
export const isPublishExcluded = (file: string) => /^(attachments\/|(.*\/)?\.env(\.(?!example$|sample$|template$)[^/]+)?$)/.test(file);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;
const MAX_FILES = 3000;
/** The built site kept with the archive so an archived preview is known and restorable. */
const BUILD_DIR_NAMES = new Set(["dist", "build", "out"]);
const MAX_BUILD_FILES = 600;
const MAX_BUILD_BYTES = 15 * 1024 * 1024;

/** The project's sources (build output folders and caches left out), as exported, deployed and archived. */
export function collectWorkspaceFiles(root: string) {
  const files: { path: string; content: Buffer; sha256: string }[] = [];
  let total = 0;
  let skipped = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Build output is kept separately (role 'build', see buildFor); lockfiles and sources stay.
        if (!SKIP_DIRS.has(entry.name) && !isOutputDir(dir, entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || NOISE_FILES.test(entry.name)) continue; // symlinks and special files are never archived
      const size = fs.statSync(full).size;
      if (size > MAX_FILE || total + size > MAX_TOTAL || files.length >= MAX_FILES) {
        skipped++;
        continue;
      }
      const content = fs.readFileSync(full);
      total += size;
      files.push({ path: path.relative(root, full), content, sha256: createHash("sha256").update(content).digest("hex") });
    }
  };
  walk(root);
  return { files, total, skipped };
}

/**
 * Built web output in the workspace: dist/, build/ or out/ folders (up to three levels deep, e.g.
 * frontend/dist) that contain an index.html which is not an unbuilt template. Newest first.
 */
export function findBuildDirs(root: string, maxDepth = 3) {
  const found: { dir: string; mtimeMs: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (BUILD_DIR_NAMES.has(entry.name)) {
        const index = path.join(full, "index.html");
        const stat = fs.lstatSync(index, { throwIfNoEntry: false });
        if (stat?.isFile() && !isUnbuiltTemplate(fs.readFileSync(index, "utf8"))) found.push({ dir: path.relative(root, full), mtimeMs: stat.mtimeMs });
        continue;
      }
      if (depth < maxDepth) walk(full, depth + 1);
    }
  };
  walk(root, 1);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).map(item => item.dir);
}

/** A source index.html that only works through a dev server (Vite root, CRA public/). */
export function isUnbuiltTemplate(html: string) {
  return /<script[^>]+src=["']\/?src\/[^"']+\.(t|j)sx?["']/i.test(html) || html.includes("%PUBLIC_URL%");
}

function collectBuildFiles(root: string, dir: string) {
  const files: { path: string; content: Buffer; sha256: string; role: SnapshotRole }[] = [];
  let total = 0;
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || entry.name.endsWith(".map")) continue;
      const size = fs.statSync(full).size;
      if (files.length >= MAX_BUILD_FILES || total + size > MAX_BUILD_BYTES || size > MAX_FILE) continue;
      const content = fs.readFileSync(full);
      total += size;
      files.push({ path: path.relative(root, full), content, sha256: createHash("sha256").update(content).digest("hex"), role: "build" });
    }
  };
  walk(path.join(root, dir));
  return files;
}

export async function snapshotWorkspace(taskId: string) {
  const root = workspacePath(taskId);
  if (!fs.existsSync(root)) return null;
  const repo = await linkedRepo(taskId);
  if (repo) {
    // Linked GitHub repo: archive only the agent's edits (plus anything outside the repo folder);
    // the unchanged repository is re-fetched from GitHub on restore.
    const edits = await linkedSnapshotFiles(taskId, root, repo);
    const outside = repo.repoPath === "." ? [] : collectWorkspaceFiles(root).files.filter(file => !file.path.startsWith(`${repo.repoPath}/`));
    const sources = [...edits, ...outside].map(file => ({ path: file.path, content: file.content, sha256: createHash("sha256").update(file.content).digest("hex") }));
    const files = [...sources, ...buildFor(root, sources)];
    await saveWorkspaceSnapshot(taskId, files);
    return { files: files.length, bytes: files.reduce((sum, file) => sum + file.content.length, 0), skipped: 0 };
  }
  const result = collectWorkspaceFiles(root);
  const build = buildFor(root, result.files);
  await saveWorkspaceSnapshot(taskId, [...result.files, ...build]);
  return { files: result.files.length + build.length, bytes: result.total + build.reduce((sum, file) => sum + file.content.length, 0), skipped: result.skipped };
}

/** The newest built site, unless its paths are already archived as sources. */
function buildFor(root: string, sources: { path: string }[]) {
  const dir = findBuildDirs(root)[0];
  if (!dir) return [];
  const taken = new Set(sources.map(file => file.path));
  return collectBuildFiles(root, dir).filter(file => !taken.has(file.path));
}

export type ArchivedBuild = { dir: string; fileCount: number; bytes: number; kind: "build" | "static" };

/**
 * A web build recorded in the archive (role 'build' rows), or a plain static site among the archived
 * sources. Answers from the snapshot only; nothing is restored.
 */
export async function findArchivedBuild(taskId: string): Promise<ArchivedBuild | null> {
  const { rows: builds } = await query<{ path: string }>(
    "SELECT path FROM curialy.workspace_files WHERE session_id = $1 AND role = 'build' AND (path = 'index.html' OR path LIKE '%/index.html') ORDER BY length(path) LIMIT 1",
    [taskId],
  );
  if (builds[0]) {
    const dir = path.posix.dirname(builds[0].path);
    const prefix = `${dir.replace(/[\\%_]/g, char => `\\${char}`)}/%`;
    const { rows: [stats] } = await query<{ files: string; bytes: string }>(
      "SELECT count(*) AS files, COALESCE(sum(size_bytes), 0) AS bytes FROM curialy.workspace_files WHERE session_id = $1 AND role = 'build' AND ($2 = '.' OR path LIKE $3)",
      [taskId, dir, prefix],
    );
    return { dir, fileCount: Number(stats?.files ?? 0), bytes: Number(stats?.bytes ?? 0), kind: "build" };
  }
  // A plain static site among the sources: a root index.html that is not a dev-server template.
  const { rows: [index] } = await query<{ content: Buffer }>("SELECT content FROM curialy.workspace_files WHERE session_id = $1 AND role = 'source' AND path = 'index.html'", [taskId]);
  if (index && !isUnbuiltTemplate(index.content.toString("utf8"))) {
    const { rows: [stats] } = await query<{ files: string; bytes: string }>("SELECT count(*) AS files, COALESCE(sum(size_bytes), 0) AS bytes FROM curialy.workspace_files WHERE session_id = $1", [taskId]);
    return { dir: ".", fileCount: Number(stats?.files ?? 0), bytes: Number(stats?.bytes ?? 0), kind: "static" };
  }
  return null;
}

// One workspace operation at a time per task (archive, restore): a sweep must never delete a
// directory that is being restored, and a restore must never read a half-written archive.
const workspaceLocks = new Map<string, Promise<unknown>>();
export async function withWorkspaceLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const previous = workspaceLocks.get(taskId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  workspaceLocks.set(taskId, next);
  try {
    return await next;
  } finally {
    if (workspaceLocks.get(taskId) === next) workspaceLocks.delete(taskId);
  }
}
export const isWorkspaceLocked = (taskId: string) => workspaceLocks.has(taskId);

/** Make sure a session's workspace exists on disk, restoring it from the vault if it was archived. */
export async function materializeWorkspace(taskId: string) {
  const dir = workspacePath(taskId);
  if (fs.existsSync(dir)) return { dir, restored: 0 };
  const root = ensureWorkspace(taskId);
  try {
    const repo = await linkedRepo(taskId);
    if (repo) {
      const connection = await getConnection().catch(() => null);
      if (!connection) throw new Error(`Reconnect GitHub to restore ${repo.fullName} into this workspace.`);
      await restoreLinkedRepo(root, repo, connection.token);
    }
    // Sources and the archived build, so a restored workspace can be previewed again.
    const files = await loadWorkspaceSnapshot(taskId, ["source", "build"]);
    for (const file of files) writeWorkspaceBytes(root, file.path, file.content);
    return { dir: root, restored: files.length };
  } catch (error) {
    // Never leave a half-restored directory: it would later be snapshotted over the good vault copy.
    removeWorkspace(taskId);
    throw error;
  }
}

export async function archiveWorkspace(taskId: string) {
  await snapshotWorkspace(taskId);
  removeWorkspace(taskId);
  await updateAgentTask(taskId, { workspaceState: "archived" });
}

/** Restore an archived workspace (for previews) without starting a run. Idempotent. */
export async function restoreWorkspace(taskId: string) {
  return withWorkspaceLock(taskId, async () => {
    const result = await materializeWorkspace(taskId);
    await query("UPDATE curialy.chat_sessions SET workspace_state = 'live', last_activity_at = now() WHERE id = $1", [taskId]);
    return result;
  });
}

let sweeping = false;

export function startWorkspaceSweeper(isBusy: (taskId: string) => boolean) {
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const id of await idleWorkspaces(IDLE_MINUTES)) {
        if (isBusy(id) || isWorkspaceLocked(id)) continue;
        await withWorkspaceLock(id, async () => {
          // Re-check inside the lock: a restore or a new run may have touched it since the query.
          const { rows } = await query<{ idle: boolean }>(
            "SELECT (workspace_state = 'live' AND last_activity_at < now() - ($2 || ' minutes')::interval) AS idle FROM curialy.chat_sessions WHERE id = $1", [id, String(IDLE_MINUTES)],
          );
          if (!rows[0]?.idle || isBusy(id)) return;
          await archiveWorkspace(id);
        }).catch(error => console.error(`[workspaces] archive ${id} failed:`, error.message));
      }
    } catch (error) {
      console.error("[workspaces] sweep failed:", error instanceof Error ? error.message : error);
    } finally {
      sweeping = false;
    }
  };
  const timer = setInterval(() => void sweep(), 5 * 60_000);
  timer.unref();
  void sweep();
}
