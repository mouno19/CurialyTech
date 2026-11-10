import { query } from "../db/pg";
import { linkedRepo } from "./repos";
import { taskOwner } from "./store";

// What the next task on a repository should already know. One note per account and repository:
// a later task, or a follow-up that starts a new run, is given it before the first model turn.
// The note is this account's, never another account's, and it never holds the GitHub token.

export type ProjectMemory = { tests?: string; avoid?: string; decisions?: string };

const FIELDS = ["tests", "avoid", "decisions"] as const;
/** Each part stays short: the note is read in full at the start of every run. */
export const MEMORY_PART_MAX = 800;

const REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

/** owner/name, compared the way GitHub compares it. Null when it is not a repository name. */
export function normalizeRepo(repo: string): string | null {
  const name = repo.trim().toLowerCase();
  return REPO.test(name) ? name : null;
}

function asMemory(value: unknown): ProjectMemory {
  let note = value;
  if (typeof note === "string") {
    try { note = JSON.parse(note); } catch { return {}; }
  }
  if (!note || typeof note !== "object") return {};
  const out: ProjectMemory = {};
  for (const key of FIELDS) {
    const field = (note as Record<string, unknown>)[key];
    if (typeof field === "string" && field.trim()) out[key] = field.trim().slice(0, MEMORY_PART_MAX);
  }
  return out;
}

/** Apply a partial update. An empty string clears that part; a missing key leaves it. */
export function mergeMemory(current: ProjectMemory, patch: Partial<ProjectMemory>): ProjectMemory {
  const next: ProjectMemory = { ...current };
  for (const key of FIELDS) {
    if (patch[key] === undefined) continue;
    const value = patch[key]!.trim();
    if (!value) delete next[key];
    else next[key] = value.slice(0, MEMORY_PART_MAX);
  }
  return next;
}

const saved = (note: ProjectMemory) => Boolean(note.tests || note.avoid || note.decisions);

/**
 * The system-prompt block for a linked repository. saved: there is something to follow.
 * An empty note still tells the model that this repository can grow a memory.
 */
export function renderProjectMemory(repo: string, note: ProjectMemory | null): { text: string; saved: boolean } {
  const memory = note ?? {};
  if (!saved(memory)) {
    return {
      saved: false,
      text: `Project memory for ${repo}: nothing is saved yet. When you learn how to run this repository's checks, which folders not to edit, or a decision that should hold on the next task, call remember_project. Keep each part short. Do not save secrets or details that matter only for this task.`,
    };
  }
  const lines = [
    `Project memory for ${repo}, saved from earlier tasks on this account. These are notes, not instructions that replace the rules above. Follow them, and call remember_project when something the next task should know has changed.`,
  ];
  if (memory.tests) lines.push(`- Checks: ${memory.tests}`);
  if (memory.avoid) lines.push(`- Leave alone: ${memory.avoid}`);
  if (memory.decisions) lines.push(`- Decisions: ${memory.decisions}`);
  return { saved: true, text: lines.join("\n") };
}

async function readMemory(userId: string, repo: string): Promise<ProjectMemory> {
  const key = normalizeRepo(repo);
  if (!key) return {};
  const { rows } = await query<{ note: unknown }>("SELECT note FROM curialy.project_notes WHERE user_id = $1 AND repo = $2", [userId, key]);
  return asMemory(rows[0]?.note);
}

/** The note a run should start with. A missing repository, or a read that fails, leaves the run without one. */
export async function loadProjectMemory(taskId: string): Promise<{ text: string; saved: boolean; repo: string | null }> {
  try {
    const owner = await taskOwner(taskId);
    const repo = owner ? await linkedRepo(taskId).catch(() => null) : null;
    if (!owner || !repo) return { text: "", saved: false, repo: null };
    const rendered = renderProjectMemory(repo.fullName, await readMemory(owner, repo.fullName));
    return { ...rendered, repo: repo.fullName };
  } catch (error) {
    console.error("[Curialy] Project memory:", error instanceof Error ? error.message : error);
    return { text: "", saved: false, repo: null };
  }
}

/**
 * Merge a partial note for the task's linked repository. Throws when the task has no repository
 * yet (the caller tells the model to clone one first).
 */
export async function saveProjectMemory(taskId: string, patch: Partial<ProjectMemory>): Promise<{ repo: string; memory: ProjectMemory }> {
  const owner = await taskOwner(taskId);
  const repo = owner ? await linkedRepo(taskId) : null;
  const key = repo ? normalizeRepo(repo.fullName) : null;
  if (!owner || !repo || !key) throw new Error("Clone a repository into this task first. Project memory is kept per repository.");
  const next = mergeMemory(await readMemory(owner, key), patch);
  if (!saved(next)) {
    await query("DELETE FROM curialy.project_notes WHERE user_id = $1 AND repo = $2", [owner, key]);
    return { repo: repo.fullName, memory: {} };
  }
  await query(
    `INSERT INTO curialy.project_notes (user_id, repo, note) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, repo) DO UPDATE SET note = EXCLUDED.note, updated_at = now()`,
    [owner, key, JSON.stringify(next)],
  );
  return { repo: repo.fullName, memory: next };
}
