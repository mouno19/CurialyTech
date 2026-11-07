import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { query } from "../db/pg";
import { ensureWorkspace, refreshWorkspace, removeWorkspace, shareWorkspaceFiles, workspacePath, writeWorkspaceBytes } from "./sandbox";
import { idleWorkspaces, loadWorkspaceSnapshot, saveWorkspaceSnapshot, updateAgentTask, type SnapshotRole } from "./store";
import { linkedRepo, linkedSnapshotFiles, restoreLinkedRepo } from "./repos";
import { getConnection } from "../services/github";
import { taskOwner } from "./store";

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

/** A folder's entries. One that can't be read fails the walk: it is never silently left out of an archive, export or deploy. */
function readDir(root: string, dir: string) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new Error(`The workspace folder ${path.relative(root, dir) || "."} can't be read (${code ?? "error"}).`);
  }
}

/** The project's sources, current with the task's cloud sandbox and readable here (see shareWorkspaceFiles). */
export async function readWorkspaceFiles(root: string) {
  await refreshWorkspace(root);
  await shareWorkspaceFiles(root, SKIP_DIRS);
  return collectWorkspaceFiles(root);
}

/** The project's sources (build output folders and caches left out), as exported, deployed and archived. */
/** exclude: a folder (relative to the root) left out, e.g. a linked repository archived as edits only. */
export function collectWorkspaceFiles(root: string, opts: { exclude?: string } = {}) {
  const files: { path: string; content: Buffer; sha256: string }[] = [];
  let total = 0;
  let skipped = 0;
  const skippedPaths: string[] = [];
  const excluded = opts.exclude ? path.join(root, opts.exclude) : null;
  const walk = (dir: string) => {
    const entries = readDir(root, dir);
    // Uploads last: when the limits run out, it is their files that are left out (Vault keeps them).
    if (dir === root) entries.sort((a, b) => Number(a.name === "attachments") - Number(b.name === "attachments"));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === excluded) continue;
        // Build output is kept separately (role 'build', see buildFor); lockfiles and sources stay.
        if (!SKIP_DIRS.has(entry.name) && !isOutputDir(dir, entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || NOISE_FILES.test(entry.name)) continue; // symlinks and special files are never archived
      const size = fs.statSync(full).size;
      if (size > MAX_FILE || total + size > MAX_TOTAL || files.length >= MAX_FILES) {
        skipped++;
        skippedPaths.push(path.relative(root, full));
        continue;
      }
      const content = fs.readFileSync(full);
      total += size;
      files.push({ path: path.relative(root, full), content, sha256: createHash("sha256").update(content).digest("hex") });
    }
  };
  walk(root);
  return { files, total, skipped, skippedPaths };
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
    for (const entry of readDir(root, current)) {
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

/** Tasks whose repository's changes could not be listed (logged once each). */
const unreadableRepos = new Set<string>();

export async function snapshotWorkspace(taskId: string) {
  const root = workspacePath(taskId);
  if (!fs.existsSync(root)) return null;
  // What a cloud sandbox changed since its last command is part of the archive too.
  await refreshWorkspace(root);
  await shareWorkspaceFiles(root, SKIP_DIRS);
  const repo = await linkedRepo(taskId);
  // Next to a sub-folder repository, everything else (uploads, other projects, a repository the task
  // switched away from) is archived whole, within its own limits. Uploads over them are safe in Vault
  // already; any other file over them keeps the workspace on this server. Checked first, so a sweep
  // that can't archive never opens a sandbox to list the repository's changes.
  const outside = repo && repo.repoPath !== "." ? collectWorkspaceFiles(root, { exclude: repo.repoPath }) : null;
  const lost = outside ? outside.skippedPaths.filter(file => !file.startsWith("attachments/")) : [];
  if (lost.length) throw new Error(`Could not archive ${lost.length} file(s) outside ${repo!.repoPath}/ (over the limits, e.g. ${lost[0]}); the workspace stays on this server.`);
  // A repository git ran on but could not read (a damaged .git, "git exit 1") is archived whole
  // below, like an unlinked workspace, instead of failing on every sweep while the files stay on
  // this server. A sandbox that could not run git at all ("git exit null") is retried next sweep.
  const edits = repo ? await linkedSnapshotFiles(taskId, root, repo).catch(error => {
    if (!/\(git exit \d+\)/.test(error instanceof Error ? error.message : "")) throw error;
    if (!unreadableRepos.has(taskId)) console.warn(`[workspaces] ${taskId}: archiving the whole workspace, its repository's changes could not be listed: ${error instanceof Error ? error.message : error}`);
    unreadableRepos.add(taskId);
    return null;
  }) : null;
  if (repo && edits) {
    // Linked GitHub repo: archive only the agent's edits (plus everything outside the repo folder);
    // the unchanged repository is re-fetched from GitHub on restore.
    const sources = [...edits, ...(outside?.files ?? [])].map(file => ({ path: file.path, content: file.content, sha256: createHash("sha256").update(file.content).digest("hex") }));
    const files = [...sources, ...buildFor(root, sources)];
    await saveWorkspaceSnapshot(taskId, files);
    return { files: files.length, bytes: files.reduce((sum, file) => sum + file.content.length, 0), skipped: 0 };
  }
  const result = collectWorkspaceFiles(root);
  // Archived whole, a linked workspace replaces its edits-only archive and is then removed: only
  // when every file made it (on restore, files left out would come back at the base commit).
  if (repo && result.skipped) throw new Error(`Could not archive the whole workspace (${result.skipped} files over the limits); it stays on this server.`);
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
      const owner = await taskOwner(taskId);
      const connection = owner ? await getConnection(owner).catch(() => null) : null;
      if (!connection) throw new Error(`Reconnect GitHub to restore ${repo.fullName} into this workspace.`);
      await restoreLinkedRepo(root, repo, connection.token);
    }
    // Sources, the archived build (so it can be previewed again) and outage-kept attachments.
    const files = await loadWorkspaceSnapshot(taskId, ["source", "build", "artifact"]);
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
