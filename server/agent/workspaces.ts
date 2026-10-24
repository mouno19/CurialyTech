import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureWorkspace, removeWorkspace, workspacePath, writeWorkspaceBytes } from "./sandbox";
import { idleWorkspaces, loadWorkspaceSnapshot, saveWorkspaceSnapshot, updateAgentTask } from "./store";

// Workspaces on the VPS are scratch space only. The durable copy of an agent's files is the
// snapshot in Tiger; the directory is removed once a session has been idle for IDLE_MINUTES
// and rebuilt from the snapshot if the user follows up later.

const IDLE_MINUTES = Number(process.env.AGENT_WORKSPACE_IDLE_MINUTES || 60);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".cache", ".pytest_cache", "coverage"]);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;
const MAX_FILES = 3000;

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
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks and special files are never archived
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

export async function snapshotWorkspace(taskId: string) {
  const root = workspacePath(taskId);
  if (!fs.existsSync(root)) return null;
  const result = collectWorkspaceFiles(root);
  await saveWorkspaceSnapshot(taskId, result.files);
  return { files: result.files.length, bytes: result.total, skipped: result.skipped };
}

/** Make sure a session's workspace exists on disk, restoring it from Tiger if it was archived. */
export async function materializeWorkspace(taskId: string) {
  const dir = workspacePath(taskId);
  if (fs.existsSync(dir)) return { dir, restored: 0 };
  const root = ensureWorkspace(taskId);
  const files = await loadWorkspaceSnapshot(taskId);
  for (const file of files) writeWorkspaceBytes(root, file.path, file.content);
  return { dir: root, restored: files.length };
}

export async function archiveWorkspace(taskId: string) {
  await snapshotWorkspace(taskId);
  removeWorkspace(taskId);
  await updateAgentTask(taskId, { workspaceState: "archived" });
}

let sweeping = false;

export function startWorkspaceSweeper(isRunning: (taskId: string) => boolean) {
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const id of await idleWorkspaces(IDLE_MINUTES)) {
        if (isRunning(id)) continue;
        await archiveWorkspace(id).catch(error => console.error(`[workspaces] archive ${id} failed:`, error.message));
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
