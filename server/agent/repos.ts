import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { query } from "../db/pg";
import { branchHead, githubApi, GitHubError, repoDetails } from "../services/github";
import { randomUUID } from "node:crypto";
import { resolveInWorkspace, runCommand, SandboxError, WORKSPACE_ROOT } from "./sandbox";

// Working on a user's existing GitHub repository.
//
// Security model: the GitHub token never enters the sandbox. The app process fetches the repo into
// a fresh directory before the sandbox has touched it (token passed only via environment-scoped git
// config, never argv or .git/config). After that, git runs only inside the sandbox (to list what
// changed), and pushes go through the GitHub REST API from this process, so no git command ever runs
// with app privileges over files or hooks the agent could have planted.

const MAX_REPO_KB = 600_000;
const MAX_PUSH_FILE = 25 * 1024 * 1024;
const MAX_PUSH_TOTAL = 80 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;

export type LinkedRepo = { fullName: string; url: string; branch: string; baseSha: string; repoPath: string; pushed: Record<string, string>; deleted: string[] };

export async function linkedRepo(sessionId: string): Promise<LinkedRepo | null> {
  const { rows } = await query<{ github_repo: string; github_repo_url: string; github_branch: string; github_base_sha: string; github_repo_path: string; github_pushed: Record<string, string>; github_deleted: string[] }>(
    `SELECT github_repo, github_repo_url, github_branch, github_base_sha, github_repo_path, github_pushed, github_deleted
     FROM curialy.chat_sessions WHERE id = $1 AND github_mode = 'linked'`, [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  return { fullName: row.github_repo, url: row.github_repo_url, branch: row.github_branch, baseSha: row.github_base_sha, repoPath: row.github_repo_path, pushed: row.github_pushed ?? {}, deleted: row.github_deleted ?? [] };
}

/** Run git as the app user with credentials only in the environment, hooks disabled, no user/system config. */
function appGit(args: string[], cwd: string, token: string | null, onOutput?: (chunk: string) => void) {
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/nonexistent",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "protocol.allow",
    GIT_CONFIG_VALUE_1: "never",
    GIT_CONFIG_KEY_2: "protocol.https.allow",
    GIT_CONFIG_VALUE_2: "always",
  };
  if (token) {
    env.GIT_CONFIG_COUNT = "4";
    env.GIT_CONFIG_KEY_3 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_3 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return new Promise<string>((resolve, reject) => {
    // umask 002 so the sandbox user (same group, setgid workspace) can edit what we fetch.
    const child = spawn("/bin/sh", ["-c", 'umask 002 && exec git "$@"', "git", ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { const text = data.toString(); stderr += text; onOutput?.(text); });
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve(stdout.trim()) : reject(new Error(`git ${args[0]} failed (${code}): ${stderr.trim().split("\n").slice(-3).join(" ").replace(/x-access-token:[^@\s]+/g, "***")}`))));
  });
}

/**
 * Fetch `fullName` at an exact commit and move it into the empty directory `dest`.
 * Git runs only in a fresh staging directory owned by this process (never in a directory the
 * sandbox user owns), so git's ownership checks stay on and no agent-planted config is ever read.
 * Returns the number of tracked files.
 */
async function fetchCheckout(dest: string, fullName: string, branch: string, sha: string, token: string, onOutput?: (chunk: string) => void) {
  if (!SHA.test(sha)) throw new Error("Invalid commit sha.");
  const staging = path.join(WORKSPACE_ROOT, `.staging-${randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o2770 });
  try {
    await appGit(["init", "--quiet", "--initial-branch", branch], staging, null);
    await appGit(["remote", "add", "origin", `https://github.com/${fullName}.git`], staging, null);
    await appGit(["fetch", "--depth", "20", "--no-tags", "--progress", "origin", sha], staging, token, onOutput);
    await appGit(["checkout", "--quiet", "-B", branch, sha], staging, null);
    await appGit(["update-ref", `refs/remotes/origin/${branch}`, sha], staging, null);
    await appGit(["branch", "--quiet", "--set-upstream-to", `origin/${branch}`], staging, null).catch(() => undefined);
    const tracked = await appGit(["ls-files"], staging, null).then(out => (out ? out.split("\n").length : 0));
    for (const entry of fs.readdirSync(staging)) fs.renameSync(path.join(staging, entry), path.join(dest, entry));
    return tracked;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function cloneIntoWorkspace(opts: { sessionId: string; root: string; fullName: string; branch?: string; token: string; onOutput?: (chunk: string) => void }) {
  const existing = await linkedRepo(opts.sessionId);
  if (existing) {
    if (existing.fullName.toLowerCase() === opts.fullName.toLowerCase()) return { ...existing, alreadyLinked: true, files: 0 };
    throw new SandboxError(`This task is already linked to ${existing.fullName}. Start a new task to work on another repository.`);
  }
  const details = await repoDetails(opts.token, opts.fullName);
  if (details.size_kb > MAX_REPO_KB) throw new SandboxError(`${details.full_name} is ${Math.round(details.size_kb / 1024)} MB; repositories over ${MAX_REPO_KB / 1024} MB are not supported on this server.`);
  const branch = opts.branch || details.default_branch;
  const sha = await branchHead(opts.token, details.full_name, branch);
  if (!sha) throw new SandboxError(`Branch ${branch} does not exist in ${details.full_name}.`);

  // Clone into the workspace root when it is empty, otherwise into a sub-folder named after the repo.
  const occupied = fs.readdirSync(opts.root).length > 0;
  const repoPath = occupied ? details.name : ".";
  const dest = occupied ? path.join(opts.root, details.name) : opts.root;
  if (occupied) {
    if (fs.existsSync(dest)) throw new SandboxError(`${details.name}/ already exists in the workspace.`);
    fs.mkdirSync(dest, { mode: 0o2775 });
  }
  opts.onOutput?.(`Fetching ${details.full_name}@${branch} (${sha.slice(0, 7)}) into ${repoPath === "." ? "the workspace root" : `${repoPath}/`}…\n`);
  let files = 0;
  try {
    files = await fetchCheckout(dest, details.full_name, branch, sha, opts.token, opts.onOutput);
  } catch (error) {
    if (dest !== opts.root) fs.rmSync(dest, { recursive: true, force: true });
    else for (const entry of fs.readdirSync(dest)) fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
    throw error;
  }
  await query(
    `UPDATE curialy.chat_sessions SET github_mode = 'linked', github_repo = $2, github_repo_url = $3, github_branch = $4, github_base_sha = $5,
       github_repo_path = $6, github_pushed = '{}', github_deleted = '[]', updated_at = now() WHERE id = $1`,
    [opts.sessionId, details.full_name, details.html_url, branch, sha, repoPath],
  );
  return { fullName: details.full_name, url: details.html_url, branch, baseSha: sha, repoPath, pushed: {}, deleted: [], alreadyLinked: false, files, details };
}

export type RepoChanges = { changed: string[]; deleted: string[] };

/** What differs from the base commit, computed by git inside the sandbox (which has no credentials). */
export async function computeChanges(root: string, repo: LinkedRepo, signal?: AbortSignal): Promise<RepoChanges> {
  if (!SHA.test(repo.baseSha)) throw new Error("Invalid base sha.");
  const repoDir = repo.repoPath === "." ? "." : repo.repoPath;
  const command = `cd -- ${JSON.stringify(repoDir)} && { git -c core.quotepath=off diff --name-status -z --no-renames ${repo.baseSha} -- . 2>/dev/null; printf '\\0::untracked::\\0'; git ls-files -z --others --exclude-standard 2>/dev/null; }`;
  const result = await runCommand({ root, command, timeoutSec: 120, signal, onOutput: () => undefined });
  if (result.exitCode !== 0) throw new Error(`Could not list repository changes (git exit ${result.exitCode}).`);
  const [diffPart, untrackedPart = ""] = result.output.split("\0::untracked::\0");
  const tokens = diffPart.split("\0").filter(Boolean);
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const [status, file] = [tokens[index], tokens[index + 1]];
    if (status.startsWith("D")) deleted.add(file);
    else changed.add(file);
  }
  for (const file of untrackedPart.split("\0").filter(Boolean)) changed.add(file);
  const clean = (file: string) => !file.startsWith(".git/") && file !== ".git" && !file.includes("\0");
  return { changed: Array.from(changed).filter(clean), deleted: Array.from(deleted).filter(clean) };
}

function readRepoFile(root: string, repo: LinkedRepo, file: string) {
  const relative = repo.repoPath === "." ? file : path.join(repo.repoPath, file);
  const { absolute } = resolveInWorkspace(root, relative);
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return null; // symlinks, directories and vanished files are never pushed
  if (stat.size > MAX_PUSH_FILE) throw new SandboxError(`${file} is larger than ${MAX_PUSH_FILE / 1024 / 1024} MB.`);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    return { content: fs.readFileSync(fd), executable: (stat.mode & 0o111) !== 0 };
  } finally {
    fs.closeSync(fd);
  }
}

export async function commitAndPush(opts: { sessionId: string; root: string; repo: LinkedRepo; token: string; message: string; branch?: string; signal?: AbortSignal; onOutput?: (chunk: string) => void }) {
  const { repo, token } = opts;
  const target = opts.branch?.trim() || repo.branch;
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(target) || target.includes("..")) throw new SandboxError("Invalid branch name.");
  const changes = await computeChanges(opts.root, repo, opts.signal);
  if (!changes.changed.length && !changes.deleted.length) return { nothingToPush: true as const, branch: target };

  // Fast-forward only: accept the remote head if it is our base or our own previous push to this branch.
  const remoteHead = await branchHead(token, repo.fullName, target);
  let parent = repo.baseSha;
  if (remoteHead && remoteHead !== repo.baseSha && remoteHead !== repo.pushed[target]) {
    throw new SandboxError(`${repo.fullName}@${target} has new commits that are not in the workspace. Push to a new branch (e.g. curialy/${Date.now().toString(36)}) and open a pull request instead.`);
  }
  if (remoteHead) parent = remoteHead;

  const baseCommit = await githubApi<{ tree: { sha: string } }>(token, `/repos/${repo.fullName}/git/commits/${repo.baseSha}`);
  const entries: { path: string; mode: string; type: "blob"; sha: string | null }[] = [];
  let total = 0;
  opts.onOutput?.(`Uploading ${changes.changed.length} changed file(s), deleting ${changes.deleted.length}…\n`);
  for (let index = 0; index < changes.changed.length; index += 6) {
    const batch = changes.changed.slice(index, index + 6).map(file => ({ file, data: readRepoFile(opts.root, repo, file) })).filter(item => item.data);
    for (const item of batch) total += item.data!.content.length;
    if (total > MAX_PUSH_TOTAL) throw new SandboxError(`Changes exceed ${MAX_PUSH_TOTAL / 1024 / 1024} MB; push a smaller set of files.`);
    const blobs = await Promise.all(batch.map(item => githubApi<{ sha: string }>(token, `/repos/${repo.fullName}/git/blobs`, { method: "POST", body: JSON.stringify({ content: item.data!.content.toString("base64"), encoding: "base64" }) })));
    batch.forEach((item, i) => entries.push({ path: item.file, mode: item.data!.executable ? "100755" : "100644", type: "blob", sha: blobs[i].sha }));
  }
  for (const file of changes.deleted) entries.push({ path: file, mode: "100644", type: "blob", sha: null });

  const tree = await githubApi<{ sha: string }>(token, `/repos/${repo.fullName}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }) });
  const commit = await githubApi<{ sha: string; html_url: string }>(token, `/repos/${repo.fullName}/git/commits`, { method: "POST", body: JSON.stringify({ message: opts.message, tree: tree.sha, parents: [parent] }) });
  try {
    if (remoteHead) await githubApi(token, `/repos/${repo.fullName}/git/refs/heads/${target}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    else await githubApi(token, `/repos/${repo.fullName}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${target}`, sha: commit.sha }) });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) throw new SandboxError(`GitHub rejected the update to ${target} (not a fast-forward or protected branch). Push to a new branch and open a pull request.`);
    throw error;
  }
  await query(`UPDATE curialy.chat_sessions SET github_pushed = github_pushed || jsonb_build_object($2::text, $3::text), github_pushed_at = now(), updated_at = now() WHERE id = $1`, [opts.sessionId, target, commit.sha]);
  repo.pushed[target] = commit.sha;
  return {
    nothingToPush: false as const, branch: target, commitSha: commit.sha, commitUrl: `${repo.url}/commit/${commit.sha}`,
    compareUrl: target === repo.branch ? `${repo.url}/commit/${commit.sha}` : `${repo.url}/compare/${repo.branch}...${encodeURIComponent(target)}`,
    changed: entries.filter(entry => entry.sha).length, deleted: changes.deleted.length,
  };
}

// ---- Snapshots: only the edits are archived (the repo itself can always be re-fetched) ----

export async function linkedSnapshotFiles(sessionId: string, root: string, repo: LinkedRepo) {
  const changes = await computeChanges(root, repo);
  const files: { path: string; content: Buffer }[] = [];
  for (const file of changes.changed) {
    const data = readRepoFile(root, repo, file);
    if (data && data.content.length <= 2 * 1024 * 1024) files.push({ path: repo.repoPath === "." ? file : path.join(repo.repoPath, file), content: data.content });
  }
  await query("UPDATE curialy.chat_sessions SET github_deleted = $2 WHERE id = $1", [sessionId, JSON.stringify(changes.deleted)]);
  return files;
}

/** Rebuild an archived linked workspace: re-fetch the base commit, then re-apply the saved edits. */
export async function restoreLinkedRepo(root: string, repo: LinkedRepo, token: string) {
  const dest = repo.repoPath === "." ? root : path.join(root, repo.repoPath);
  if (dest !== root) fs.mkdirSync(dest, { recursive: true, mode: 0o2775 });
  await fetchCheckout(dest, repo.fullName, repo.branch, repo.baseSha, token);
  for (const file of repo.deleted) {
    const relative = repo.repoPath === "." ? file : path.join(repo.repoPath, file);
    try {
      const { absolute } = resolveInWorkspace(root, relative);
      if (fs.lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) fs.unlinkSync(absolute);
    } catch { /* already gone or outside the workspace */ }
  }
}
