import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { query } from "../db/pg";
import { branchHead, describeGitHubError, EmptyRepositoryError, githubCall, GitHubError, repoDetails, throwIfAborted, workflowFilesBlocked, workflowScopeMessage, writeTree, type TreeFile } from "../services/github";
import { randomUUID } from "node:crypto";
import { SYNC_SKIP } from "./e2b";
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
 * historyOnly: move only the .git (checked out, so its index matches the commit) into a folder
 * whose files are kept as they are. Returns the number of tracked files.
 */
async function fetchCheckout(dest: string, fullName: string, branch: string, sha: string, token: string, onOutput?: (chunk: string) => void, opts: { historyOnly?: boolean } = {}) {
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
    if (opts.historyOnly) {
      fs.renameSync(path.join(staging, ".git"), path.join(dest, ".git"));
      return tracked;
    }
    for (const entry of fs.readdirSync(staging)) {
      const from = path.join(staging, entry);
      const to = path.join(dest, entry);
      // A folder the destination already has (a restored root keeps attachments/): merged into it.
      if (fs.lstatSync(to, { throwIfNoEntry: false })?.isDirectory()) {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      } else {
        fs.renameSync(from, to);
      }
    }
    return tracked;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Whether the clone at `dir` still has its working tree: anything but folders outside its .git
 * (dependency and cache folders, and the root's attachments/, are not the clone's).
 */
function hasWorkingTree(dir: string, atRoot: boolean) {
  const walk = (current: string, top: boolean): boolean => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return false; }
    return entries.some(entry => {
      if (!entry.isDirectory()) return true;
      if (entry.name === ".git" || SYNC_SKIP.has(entry.name) || (atRoot && top && entry.name === "attachments")) return false;
      return walk(path.join(current, entry.name), false);
    });
  };
  return walk(dir, true);
}

/**
 * A linked clone whose folder was deleted (the sandbox mirrors deletions, and agents sometimes delete
 * a clone to "clone it again"): its history and empty folders go, then the commit it was cloned at
 * is fetched back into place. Only called when nothing of its working tree is left.
 */
async function restoreClone(root: string, repo: LinkedRepo, token: string, onOutput?: (chunk: string) => void) {
  const atRoot = repo.repoPath === ".";
  const dest = atRoot ? root : resolveInWorkspace(root, repo.repoPath).absolute;
  const stat = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory()) throw new SandboxError(`${repo.repoPath} is not a folder; remove it, then clone again.`);
  if (atRoot) {
    // Only the uploads stay; dependency folders are rebuilt in the sandbox (and tracked ones come back with the fetch).
    for (const entry of fs.readdirSync(root)) if (entry !== "attachments") fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  } else {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { mode: 0o2775 });
  }
  onOutput?.(`Restoring ${repo.fullName}@${repo.branch} (${repo.baseSha.slice(0, 7)}) into ${atRoot ? "the workspace root" : `${repo.repoPath}/`}: its files were deleted…\n`);
  return fetchCheckout(dest, repo.fullName, repo.branch, repo.baseSha, token, onOutput);
}

/**
 * replace: the user switched the task to this repository (a follow-up that picked another one). It
 * is cloned next to the linked one (into the first free folder), which stays in the workspace as
 * plain files, and the link moves only once the fetch has succeeded. Never set from an agent's own
 * tool call.
 */
export async function cloneIntoWorkspace(opts: { sessionId: string; root: string; fullName: string; branch?: string; token: string; onOutput?: (chunk: string) => void; replace?: boolean }) {
  const existing = await linkedRepo(opts.sessionId);
  const switching = Boolean(existing && opts.replace && existing.fullName.toLowerCase() !== opts.fullName.toLowerCase());
  if (existing && !switching) {
    if (existing.fullName.toLowerCase() !== opts.fullName.toLowerCase()) throw new SandboxError(`This task is already linked to ${existing.fullName}. Start a new task to work on another repository.`);
    const dest = existing.repoPath === "." ? opts.root : path.join(opts.root, existing.repoPath);
    if (hasWorkingTree(dest, existing.repoPath === ".")) {
      // Its files are here but its history is not (the folder was deleted, then made again): git
      // there can't list the changes, so the history of the commit it was cloned at goes back in.
      if (fs.lstatSync(path.join(dest, ".git"), { throwIfNoEntry: false })) return { ...existing, alreadyLinked: true, restored: false, historyRestored: false, files: 0, earlierPushes: [] as string[] };
      opts.onOutput?.(`Restoring ${existing.fullName}'s history (${existing.baseSha.slice(0, 7)}) in ${existing.repoPath === "." ? "the workspace root" : `${existing.repoPath}/`}; its files stay as they are…\n`);
      const files = await fetchCheckout(dest, existing.fullName, existing.branch, existing.baseSha, opts.token, opts.onOutput, { historyOnly: true });
      return { ...existing, alreadyLinked: true, restored: false, historyRestored: true, files, earlierPushes: [] as string[] };
    }
    const files = await restoreClone(opts.root, existing, opts.token, opts.onOutput);
    // Its pushes are on GitHub but not in the restored files: building on them again would undo them,
    // so the push record goes (a push to those branches is then refused, not silently reverting).
    await query("UPDATE curialy.chat_sessions SET github_pushed = '{}', github_deleted = '[]', updated_at = now() WHERE id = $1", [opts.sessionId]);
    return { ...existing, pushed: {}, deleted: [], alreadyLinked: true, restored: true, historyRestored: false, files, earlierPushes: Object.keys(existing.pushed) };
  }
  const details = await repoDetails(opts.token, opts.fullName);
  if (details.size_kb > MAX_REPO_KB) throw new SandboxError(`${details.full_name} is ${Math.round(details.size_kb / 1024)} MB; repositories over ${MAX_REPO_KB / 1024} MB are not supported on this server.`);
  const branch = opts.branch || details.default_branch;
  const sha = await branchHead(opts.token, details.full_name, branch).catch(error => {
    if (error instanceof EmptyRepositoryError) throw new SandboxError(error.message);
    throw error;
  });
  if (!sha) throw new SandboxError(`Branch ${branch} does not exist in ${details.full_name}.`);

  // Clone into the workspace root when it is empty, otherwise into a sub-folder named after the repo
  // (on a switch, the first free one of name, owner-name, name-2 … name-9).
  const occupied = fs.readdirSync(opts.root).length > 0;
  let repoPath = ".";
  if (occupied) {
    const owner = details.full_name.split("/")[0];
    const names = switching ? [details.name, `${owner}-${details.name}`, ...Array.from({ length: 8 }, (_, index) => `${details.name}-${index + 2}`)] : [details.name];
    // An empty folder (left by a clone cut short by a restart) is as good as none.
    const isFree = (name: string) => {
      const stat = fs.lstatSync(path.join(opts.root, name), { throwIfNoEntry: false });
      return !stat || (stat.isDirectory() && fs.readdirSync(path.join(opts.root, name)).length === 0);
    };
    const free = names.find(isFree);
    if (!free) throw new SandboxError(`${details.name}/ already exists in the workspace.`);
    repoPath = free;
  }
  const dest = occupied ? path.join(opts.root, repoPath) : opts.root;
  if (occupied) fs.mkdirSync(dest, { recursive: true, mode: 0o2775 });
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
  // On a switch into another folder than the repository's name: that folder may hold an earlier copy.
  const taken = repoPath !== "." && repoPath !== details.name ? details.name : null;
  return { fullName: details.full_name, url: details.html_url, branch, baseSha: sha, repoPath, pushed: {}, deleted: [], alreadyLinked: false, restored: false, historyRestored: false, files, details, replaced: switching ? existing! : null, taken, earlierPushes: [] as string[] };
}

/**
 * changed / deleted: regular files that differ from the base commit. modes: the mode each changed
 * file has in the sandbox (the executable bit travels). kept: submodules and symlinks, which never
 * reach the sandbox (only files sync), so they are left exactly as GitHub has them.
 */
export type RepoChanges = { changed: string[]; deleted: string[]; modes: Record<string, "100644" | "100755">; kept: string[] };

/** What differs from the base commit, computed by git inside the sandbox (which has no credentials). */
export async function computeChanges(root: string, repo: LinkedRepo, signal?: AbortSignal): Promise<RepoChanges> {
  if (!SHA.test(repo.baseSha)) throw new Error("Invalid base sha.");
  const repoDir = repo.repoPath === "." ? "." : repo.repoPath;
  // NUL-separated (-z) so any file name (spaces, tabs, quotes, newlines) survives intact. The raw
  // diff carries both modes; untracked executables are listed separately; both git commands'
  // exit codes come last, so a listing that failed is never read as "nothing changed".
  const command = `cd -- ${JSON.stringify(repoDir)} && { git -c core.quotepath=off diff --raw -z --no-renames --abbrev=40 ${repo.baseSha} -- . 2>/dev/null; d=$?; printf '\\0::untracked::\\0'; git ls-files -z --others --exclude-standard 2>/dev/null; u=$?; printf '\\0::exec::\\0'; git ls-files -z --others --exclude-standard 2>/dev/null | xargs -0 -r sh -c 'for f; do if [ -L "$f" ]; then printf "L%s\\0" "$f"; elif [ -f "$f" ] && [ -x "$f" ]; then printf "X%s\\0" "$f"; fi; done' sh; printf '\\0::exit::%s:%s' "$d" "$u"; }`;
  const result = await runCommand({ root, command, timeoutSec: 120, signal, onOutput: () => undefined, raw: true, sync: "push" });
  const exits = /\0::exit::(\d+):(\d+)$/.exec(result.output);
  if (result.exitCode !== 0 || !exits || exits[1] !== "0" || exits[2] !== "0") throw new Error(`Could not list repository changes (git exit ${exits && exits[1] !== "0" ? exits[1] : exits?.[2] ?? result.exitCode}).`);
  const body = result.output.slice(0, exits.index);
  const [diffPart, rest = ""] = body.split("\0::untracked::\0");
  const [untrackedPart, execPart = ""] = rest.split("\0::exec::\0");
  const changed = new Set<string>();
  const deleted = new Set<string>();
  const kept = new Set<string>();
  const modes: Record<string, "100644" | "100755"> = {};
  const tokens = diffPart.split("\0");
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const meta = tokens[index];
    const file = tokens[index + 1];
    if (!meta.startsWith(":") || !file) continue;
    const [srcMode, dstMode, , , status = ""] = meta.slice(1).split(" ");
    if ([srcMode, dstMode].some(mode => mode === "160000" || mode === "120000")) {
      kept.add(file);
      continue;
    }
    if (status.startsWith("D")) {
      deleted.add(file);
    } else {
      changed.add(file);
      if (dstMode === "100755" || dstMode === "100644") modes[file] = dstMode;
    }
  }
  const probed = execPart.split("\0").filter(Boolean);
  const executables = new Set(probed.filter(entry => entry.startsWith("X")).map(entry => entry.slice(1)));
  const links = new Set(probed.filter(entry => entry.startsWith("L")).map(entry => entry.slice(1)));
  for (const file of untrackedPart.split("\0").filter(Boolean)) {
    // A new symlink, or a nested repository (listed as "folder/"), is never pushed: kept as it is.
    if (links.has(file) || file.endsWith("/")) {
      kept.add(file);
      continue;
    }
    changed.add(file);
    modes[file] = executables.has(file) ? "100755" : "100644";
  }
  const clean = (file: string) => !/(^|\/)\.git(\/|$)/.test(file) && !file.includes("\0");
  return { changed: Array.from(changed).filter(clean), deleted: Array.from(deleted).filter(clean), modes, kept: Array.from(kept) };
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

/** upstreamOnly: files a sync before the push took from GitHub as they are (the repository's, not this run's work). */
export type PushResult =
  | { nothingToPush: true; branch: string; synced?: string }
  | { nothingToPush: false; branch: string; commitSha: string; commitUrl: string; compareUrl: string; changed: number; deleted: number; synced?: string; kept: string[]; upstreamOnly: string[] };

/**
 * Commit every change in the clone and push it. To the task's own branch after it moved on GitHub
 * (someone pushed meanwhile), the workspace is brought up to date first (syncWithRemote), keeping
 * its edits; conflicts stop the push with the files listed. scopes: the connection's OAuth scopes,
 * so workflow files fail with a clear reason before anything is uploaded.
 */
export async function commitAndPush(opts: { sessionId: string; root: string; repo: LinkedRepo; token: string; message: string; branch?: string; signal?: AbortSignal; onOutput?: (chunk: string) => void; scopes?: string | null; autoSync?: boolean }): Promise<PushResult> {
  const { repo, token } = opts;
  const target = opts.branch?.trim() || repo.branch;
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(target) || target.includes("..") || /(^|\/)\.|\.lock(\/|$)|\/$|^\/|\/\//.test(target)) throw new SandboxError("Invalid branch name.");
  // A clone whose files are gone would read as every file deleted: pushing that empties the repository.
  const dest = repo.repoPath === "." ? opts.root : path.join(opts.root, repo.repoPath);
  if (!hasWorkingTree(dest, repo.repoPath === ".")) throw new SandboxError(`${repo.fullName}'s files are gone from the workspace, so a push would delete them on GitHub. Restore them with github_clone_to_workspace first.`);
  let changes = await computeChanges(opts.root, repo, opts.signal);
  if (!changes.changed.length && !changes.deleted.length) return { nothingToPush: true, branch: target };
  const workflows = workflowFilesBlocked([...changes.changed, ...changes.deleted], opts.scopes);
  if (workflows.length) throw new SandboxError(workflowScopeMessage(workflows));

  // Fast-forward only: the remote head must be our base or our own previous push to this branch.
  let remoteHead = await branchHead(token, repo.fullName, target);
  let synced: string | undefined;
  let upstreamOnly: string[] = [];
  if (remoteHead && remoteHead !== repo.baseSha && remoteHead !== repo.pushed[target]) {
    if (target !== repo.branch) throw new SandboxError(`${repo.fullName}@${target} has commits this workspace doesn't have. Push to a new branch name instead, or to ${repo.branch} (which brings the workspace up to date first).`);
    // Someone has to be there to resolve conflicts: only the agent's own pushes merge.
    if (opts.autoSync === false) throw new SandboxError(`${repo.fullName}@${target} has new commits on GitHub that this workspace doesn't have. Ask the agent to bring the workspace up to date (it keeps its edits), or push to a new branch.`);
    const sync = await syncWithRemote({ sessionId: opts.sessionId, root: opts.root, repo, token, signal: opts.signal, onOutput: opts.onOutput });
    if (sync.conflicts.length) throw new SandboxError(conflictMessage(repo, sync.conflicts));
    synced = sync.head;
    upstreamOnly = sync.upstreamOnly;
    remoteHead = sync.head;
    changes = await computeChanges(opts.root, repo, opts.signal);
    if (!changes.changed.length && !changes.deleted.length) return { nothingToPush: true, branch: target, synced };
  }
  const parent = remoteHead ?? repo.baseSha;
  const limits = { signal: opts.signal, waitOutLimits: true };
  const paths = [...changes.changed, ...changes.deleted];
  // A conflict a sync left (its markers) must be resolved first, never pushed.
  const unresolved = changes.changed.filter(file => hasSyncConflict(readRepoFile(opts.root, repo, file)?.content));
  if (unresolved.length) throw new SandboxError(`${unresolved.slice(0, 10).join(", ")}${unresolved.length > 10 ? ` and ${unresolved.length - 10} more` : ""} still ${unresolved.length === 1 ? "has" : "have"} conflict markers from bringing the workspace up to date (<<<<<<< HEAD … >>>>>>> … (Workspace edits)). Resolve them, keeping both sides' intent, then push again.`);
  try {
    const baseCommit = await githubCall<{ tree: { sha: string } }>(token, `/repos/${repo.fullName}/git/commits/${repo.baseSha}`, {}, limits);
    const files: TreeFile[] = [];
    let total = 0;
    for (const file of changes.changed) {
      const data = readRepoFile(opts.root, repo, file);
      if (!data) continue; // vanished, or not a regular file here
      total += data.content.length;
      if (total > MAX_PUSH_TOTAL) throw new SandboxError(`Changes exceed ${MAX_PUSH_TOTAL / 1024 / 1024} MB; push a smaller set of files.`);
      files.push({ path: file, content: data.content, mode: changes.modes[file] ?? (data.executable ? "100755" : "100644") });
    }
    for (const file of changes.deleted) files.push({ path: file, delete: true });
    opts.onOutput?.(`Uploading ${files.length - changes.deleted.length} changed file(s), deleting ${changes.deleted.length}…\n`);
    const tree = await writeTree(token, repo.fullName, files, { ...limits, baseTree: baseCommit.tree.sha });
    const commit = await githubCall<{ sha: string; html_url: string }>(token, `/repos/${repo.fullName}/git/commits`, { method: "POST", body: JSON.stringify({ message: opts.message, tree, parents: [parent] }) }, limits);
    // Last check before the point of no return: a cancelled run leaves the branch untouched.
    throwIfAborted(opts.signal);
    try {
      if (remoteHead) await githubCall(token, `/repos/${repo.fullName}/git/refs/heads/${target}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }, limits);
      else await githubCall(token, `/repos/${repo.fullName}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${target}`, sha: commit.sha }) }, limits);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422) throw new SandboxError(`GitHub rejected the update to ${target}: ${/protected/i.test(error.message) ? "the branch is protected" : "it is not a fast-forward (the branch moved again)"}. Push to a new branch and open a pull request${/protected/i.test(error.message) ? "" : ", or push again"}.`);
      throw error;
    }
    await query(`UPDATE curialy.chat_sessions SET github_pushed = github_pushed || jsonb_build_object($2::text, $3::text), github_pushed_at = now(), updated_at = now() WHERE id = $1`, [opts.sessionId, target, commit.sha]);
    repo.pushed[target] = commit.sha;
    return {
      nothingToPush: false, branch: target, commitSha: commit.sha, commitUrl: `${repo.url}/commit/${commit.sha}`,
      compareUrl: target === repo.branch ? `${repo.url}/commit/${commit.sha}` : `${repo.url}/compare/${repo.branch}...${encodeURIComponent(target)}`,
      changed: files.length - changes.deleted.length, deleted: changes.deleted.length, synced, kept: changes.kept, upstreamOnly,
    };
  } catch (error) {
    if (error instanceof GitHubError) throw new SandboxError(describeGitHubError(error, { repo: repo.fullName, paths, scopes: opts.scopes }));
    throw error;
  }
}

/** The markers syncWithRemote's merge leaves in a conflicting file (its cherry-pick names the edits commit). */
const SYNC_CONFLICT = /^<{7} HEAD$[^]*^>{7} [0-9a-f]{7,40} \(Workspace edits\)$/m;
const hasSyncConflict = (content: Buffer | undefined) => Boolean(content && content.length <= 4 * 1024 * 1024 && !content.includes(0) && SYNC_CONFLICT.test(content.toString("utf8")));

const conflictMessage = (repo: LinkedRepo, conflicts: string[]) =>
  `${repo.fullName}@${repo.branch} moved on GitHub, and bringing the workspace up to date left conflicts in ${conflicts.length} file(s): ${conflicts.slice(0, 10).join(", ")}${conflicts.length > 10 ? ` and ${conflicts.length - 10} more` : ""}. Resolve the conflict markers (<<<<<<<, =======, >>>>>>>) in them, keeping both sides' intent, then push again.`;

/** Copy what `from` (a git directory) has that `to` lacks: pack files and loose objects. */
function copyObjects(from: string, to: string) {
  const walk = (relative: string) => {
    const source = path.join(from, "objects", relative);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(path.join(to, "objects", next), { recursive: true, mode: 0o2775 });
        walk(next);
      } else if (entry.isFile() && !fs.existsSync(path.join(to, "objects", next))) {
        fs.copyFileSync(path.join(source, entry.name), path.join(to, "objects", next));
      }
    }
  };
  walk("");
}

/** Write a ref as git does (a loose ref file), replacing a packed one by shadowing it. */
function writeRef(gitDir: string, ref: string, sha: string) {
  const file = path.join(gitDir, ...ref.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o2775 });
  fs.writeFileSync(file, `${sha}\n`, { mode: 0o664 });
}

/**
 * Bring a linked clone up to date with its branch on GitHub, keeping the workspace's edits. In a
 * fresh folder of this process (as a clone is; git never runs in one the sandbox can reach), the
 * edits are committed on the old base from this copy's files, then re-applied onto the new head
 * (a three-way merge). The merged files go back into the workspace, conflicts with markers; the
 * clone's history gets the new objects, an index of the new head and its refs; the task's base
 * becomes the new head. The sandbox picks it all up at its next command.
 */
export async function syncWithRemote(opts: { sessionId: string; root: string; repo: LinkedRepo; token: string; signal?: AbortSignal; onOutput?: (chunk: string) => void }) {
  const { repo, token } = opts;
  const head = await branchHead(token, repo.fullName, repo.branch);
  if (!head) throw new SandboxError(`${repo.fullName} no longer has a branch ${repo.branch}.`);
  if (head === repo.baseSha) return { head, updated: false, conflicts: [] as string[], files: 0, upstreamOnly: [] as string[] };
  const dest = repo.repoPath === "." ? opts.root : resolveInWorkspace(opts.root, repo.repoPath).absolute;
  const gitDir = path.join(dest, ".git");
  if (!fs.lstatSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) throw new SandboxError(`${repo.fullName}'s history is missing from the workspace; call github_clone_to_workspace first, then sync.`);
  const changes = await computeChanges(opts.root, repo, opts.signal);
  // Files in dependency and cache folders never come back from the sandbox: not edits to carry over.
  const cache = (file: string) => file.split("/").slice(0, -1).some(part => SYNC_SKIP.has(part));
  const edits = changes.changed.filter(file => !cache(file)).map(file => ({ file, data: readRepoFile(opts.root, repo, file) }));
  const missing = edits.filter(edit => !edit.data).map(edit => edit.file);
  if (missing.length) throw new SandboxError(`Can't bring the workspace up to date: ${missing.slice(0, 5).join(", ")} ${missing.length === 1 ? "wasn't" : "weren't"} brought back from the sandbox (over its size limits). Delete or shrink ${missing.length === 1 ? "it" : "them"}, or push to a new branch instead.`);
  opts.onOutput?.(`${repo.fullName}@${repo.branch} moved to ${head.slice(0, 7)}: bringing the workspace up to date, keeping its edits…\n`);
  throwIfAborted(opts.signal);
  const staging = path.join(WORKSPACE_ROOT, `.staging-${randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o2770 });
  const git = (args: string[], tokenFor: string | null = null) => appGit(["-c", "user.name=Curialy", "-c", "user.email=agent@curialy.tech", ...args], staging, tokenFor);
  try {
    await appGit(["init", "--quiet", "--initial-branch", repo.branch], staging, null);
    await appGit(["remote", "add", "origin", `https://github.com/${repo.fullName}.git`], staging, null);
    await appGit(["fetch", "--depth", "50", "--no-tags", "--progress", "origin", head, repo.baseSha], staging, token, opts.onOutput)
      .catch(() => { throw new SandboxError(`Couldn't fetch ${repo.fullName}'s new commits together with the one this workspace started from (its history may have been rewritten). Push to a new branch instead.`); });
    // Stopped meanwhile: nothing has been written to the workspace yet.
    throwIfAborted(opts.signal);
    // The workspace's edits as one commit on its base, from this copy's files.
    await git(["checkout", "--quiet", "-B", "curialy-edits", repo.baseSha]);
    for (const { file, data } of edits) {
      const target = path.join(staging, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.writeFileSync(target, data!.content, { mode: data!.executable || changes.modes[file] === "100755" ? 0o775 : 0o664 });
    }
    for (const file of changes.deleted) fs.rmSync(path.join(staging, file), { force: true });
    await git(["add", "--all", "--", "."]);
    await git(["commit", "--quiet", "--allow-empty", "--no-verify", "-m", "Workspace edits"]);
    const editsCommit = await git(["rev-parse", "HEAD"]);
    // Onto the new head: a three-way merge of the edits (none: the workspace simply moves to it).
    await git(["checkout", "--quiet", "-B", repo.branch, head]);
    const hasEdits = edits.length > 0 || changes.deleted.length > 0;
    const picked = hasEdits ? await git(["cherry-pick", "--no-commit", editsCommit]).then(() => true, () => false) : true;
    const conflicts = (await git(["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean);
    // A failure that is not a conflict leaves the edits unapplied: nothing may be written back then.
    if (!picked && !conflicts.length) throw new SandboxError(`Couldn't bring the workspace up to date: git could not re-apply its edits onto ${repo.fullName}'s new commits. Nothing was changed; push to a new branch instead.`);
    // Every file the edits or the new commits touched goes back into the workspace, as merged.
    const upstream = (await git(["diff", "--name-only", "-z", "--no-renames", repo.baseSha, head])).split("\0").filter(Boolean);
    const touched = new Set([...upstream, ...changes.changed, ...changes.deleted]);
    throwIfAborted(opts.signal);
    let written = 0;
    for (const file of touched) {
      if (/(^|\/)\.git(\/|$)/.test(file)) continue;
      const from = path.join(staging, file);
      const { absolute } = resolveInWorkspace(dest, file);
      const stat = fs.lstatSync(from, { throwIfNoEntry: false });
      if (stat?.isFile()) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o2775 });
        if (fs.lstatSync(absolute, { throwIfNoEntry: false })?.isDirectory()) fs.rmSync(absolute, { recursive: true, force: true });
        fs.writeFileSync(absolute, fs.readFileSync(from), { mode: stat.mode & 0o111 ? 0o775 : 0o664 });
        fs.chmodSync(absolute, stat.mode & 0o111 ? 0o775 : 0o664);
        written++;
      } else if (!stat && fs.lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) {
        fs.unlinkSync(absolute);
        written++;
      }
    }
    // The clone's history: the new objects, an index of the new head, its branch and remote refs.
    await git(["reset", "--quiet"]);
    copyObjects(path.join(staging, ".git"), gitDir);
    const shallow = [path.join(gitDir, "shallow"), path.join(staging, ".git", "shallow")].flatMap(file => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [])).filter(line => SHA.test(line));
    if (shallow.length) fs.writeFileSync(path.join(gitDir, "shallow"), `${[...new Set(shallow)].join("\n")}\n`, { mode: 0o664 });
    fs.copyFileSync(path.join(staging, ".git", "index"), path.join(gitDir, "index"));
    writeRef(gitDir, `refs/heads/${repo.branch}`, head);
    writeRef(gitDir, `refs/remotes/origin/${repo.branch}`, head);
    fs.writeFileSync(path.join(gitDir, "HEAD"), `ref: refs/heads/${repo.branch}\n`, { mode: 0o664 });
    // The task's base is the new head; a push to this branch from before is part of its history now.
    await query("UPDATE curialy.chat_sessions SET github_base_sha = $2, github_pushed = github_pushed - $3::text, updated_at = now() WHERE id = $1", [opts.sessionId, head, repo.branch]);
    repo.baseSha = head;
    delete repo.pushed[repo.branch];
    // Files taken from GitHub as they are: the repository's state, not this run's work (workspace-relative).
    const mine = new Set([...changes.changed, ...changes.deleted]);
    const upstreamOnly = upstream.filter(file => !mine.has(file)).map(file => (repo.repoPath === "." ? file : `${repo.repoPath}/${file}`));
    return { head, updated: true, conflicts, files: written, upstreamOnly };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
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
