import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { adminUserId, query } from "../db/pg";

// GitHub OAuth connection + repository helpers. The user's token is stored in Tiger encrypted with
// AES-256-GCM (key in GITHUB_TOKEN_KEY); it is only ever decrypted inside this process and is
// never handed to the agent sandbox.

export const GITHUB_SCOPES = ["read:user", "user:email", "repo"];

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The branch has commits this workspace didn't push: replacing its files would revert them. */
export class RemoteChangedError extends GitHubError {
  constructor(readonly branch: string) {
    super(`${branch} has commits that weren't pushed from this workspace.`, 409);
  }
}

function tokenKey() {
  const raw = process.env.GITHUB_TOKEN_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("GITHUB_TOKEN_KEY must be 32 random bytes, base64-encoded.");
  return key;
}

export function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptToken(parts: { ciphertext: Buffer; iv: Buffer; tag: Buffer }) {
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), parts.iv);
  decipher.setAuthTag(parts.tag);
  return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]).toString("utf8");
}

export async function githubApi<T = any>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "curialy-ai", ...(init.headers ?? {}) },
  });
  const data: any = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new GitHubError(`GitHub ${init.method ?? "GET"} ${path} failed (${response.status}): ${data?.message ?? "error"}${data?.errors ? ` ${JSON.stringify(data.errors).slice(0, 200)}` : ""}`, response.status);
  return data as T;
}

// ---- OAuth ----

export function oauthConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.GITHUB_TOKEN_KEY);
}

/** Signing in only reads the profile; repository access is asked for separately, when it is needed. */
export const LOGIN_SCOPES = ["read:user", "user:email"];

export function authorizeUrl(redirectUri: string, state: string, scopes = GITHUB_SCOPES) {
  const params = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID!, redirect_uri: redirectUri, scope: scopes.join(" "), state, allow_signup: "true" });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export type GitHubProfile = { id: number; login: string; name: string | null; avatarUrl: string | null; email: string | null };

/** The GitHub account a token belongs to, with its primary verified email when the profile hides it. */
export async function githubProfile(token: string): Promise<GitHubProfile> {
  const user = await githubApi<{ id: number; login: string; name: string | null; avatar_url: string; email: string | null }>(token, "/user");
  let email = user.email;
  if (!email) {
    const emails = await githubApi<{ email: string; primary: boolean; verified: boolean }[]>(token, "/user/emails").catch(() => []);
    email = emails.find(entry => entry.primary && entry.verified)?.email ?? null;
  }
  return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url ?? null, email };
}

export async function exchangeCode(code: string, redirectUri: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new GitHubError(`GitHub token exchange failed: ${data?.error_description ?? data?.error ?? response.status}`, response.status);
  return { token: data.access_token as string, scopes: String(data.scope ?? "") };
}

/** Store an account's repository connection (one per account). */
export async function saveConnection(userId: string, token: string, scopes: string) {
  const profile = await githubProfile(token);
  const user = { id: profile.id, login: profile.login, name: profile.name, avatar_url: profile.avatarUrl };
  const email = profile.email;
  const encrypted = encryptToken(token);
  await query(
    `INSERT INTO curialy.github_connections (user_id, github_id, login, name, email, avatar_url, scopes, token_ciphertext, token_iv, token_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id) DO UPDATE SET github_id = EXCLUDED.github_id, login = EXCLUDED.login, name = EXCLUDED.name, email = EXCLUDED.email,
       avatar_url = EXCLUDED.avatar_url, scopes = EXCLUDED.scopes, token_ciphertext = EXCLUDED.token_ciphertext, token_iv = EXCLUDED.token_iv,
       token_tag = EXCLUDED.token_tag, updated_at = now()`,
    [userId, user.id, user.login, user.name, email, user.avatar_url, scopes, encrypted.ciphertext, encrypted.iv, encrypted.tag],
  );
  return { login: user.login };
}

export type GitHubConnection = { login: string; name: string | null; email: string | null; avatarUrl: string | null; scopes: string; connectedAt: string };

/** An account's repository connection (its own GitHub token; never another account's). */
export async function getConnection(userId: string): Promise<(GitHubConnection & { token: string }) | null> {
  const { rows } = await query<{ login: string; name: string | null; email: string | null; avatar_url: string | null; scopes: string; connected_at: Date; token_ciphertext: Buffer; token_iv: Buffer; token_tag: Buffer }>(
    "SELECT * FROM curialy.github_connections WHERE user_id = $1", [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    login: row.login, name: row.name, email: row.email, avatarUrl: row.avatar_url, scopes: row.scopes, connectedAt: row.connected_at.toISOString(),
    token: decryptToken({ ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag }),
  };
}

export async function disconnect(userId: string) {
  const connection = await getConnection(userId).catch(() => null);
  if (connection && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    // Revoke the grant on GitHub's side too, so the token stops working everywhere.
    const basic = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64");
    await fetch(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/grant`, {
      method: "DELETE",
      headers: { authorization: `Basic ${basic}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "curialy-ai" },
      body: JSON.stringify({ access_token: connection.token }),
    }).catch(() => undefined);
  }
  await query("DELETE FROM curialy.github_connections WHERE user_id = $1", [userId]);
}

/** Token for an account's repo operations: its connection, else (operator only) the optional GITHUB_TOKEN fallback. */
export async function repoToken(userId: string) {
  const connection = await getConnection(userId).catch(() => null);
  if (connection) return { token: connection.token, login: connection.login };
  if (process.env.GITHUB_TOKEN && userId === (await adminUserId())) {
    const user = await githubApi<{ login: string }>(process.env.GITHUB_TOKEN, "/user");
    return { token: process.env.GITHUB_TOKEN, login: user.login };
  }
  return null;
}

// ---- Repositories ----

export const isValidRepoName = (name: string) => /^[A-Za-z0-9._-]{1,100}$/.test(name) && !/^\.+$/.test(name);

export async function createRepo(token: string, repoName: string, isPrivate: boolean, description = "Created by Curialy AI") {
  if (!isValidRepoName(repoName)) throw new GitHubError("Repository names may only contain letters, digits, '.', '-' and '_'.", 422);
  // auto_init gives the repo a first commit; the Git Data API cannot write to an empty repository.
  return githubApi<{ full_name: string; html_url: string; default_branch: string; owner: { login: string }; name: string; private: boolean }>(
    token, "/user/repos", { method: "POST", body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: true, description }) },
  );
}

/** Stop before the next external write once a run was cancelled. */
export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Cancelled");
}

/**
 * Commit `files` as the complete tree of `branch` (files not listed are removed) and push it.
 * Uses the Git Data API: blobs → tree → commit → ref update. With a signal, a cancel stops it before
 * the next write (the ref update is the point of no return). With `onlyOver` (branch → the commit
 * this workspace last pushed there), a branch whose head is anything else is left untouched.
 */
export async function pushProjectToRepo(token: string, fullName: string, files: { path: string; content: Buffer }[], message: string, branch?: string, signal?: AbortSignal, onlyOver?: Record<string, string>) {
  throwIfAborted(signal);
  const repo = await githubApi<{ default_branch: string; html_url: string }>(token, `/repos/${fullName}`);
  const target = branch ?? repo.default_branch;
  const ref = await githubApi<{ object: { sha: string } }>(token, `/repos/${fullName}/git/ref/heads/${encodeURIComponent(target)}`);
  // Checked before any write; the non-forced ref update below also fails if the head moves meanwhile.
  if (onlyOver && onlyOver[target] !== ref.object.sha) throw new RemoteChangedError(target);
  const tree: { path: string; mode: string; type: string; sha: string }[] = [];
  // Small concurrency keeps large projects reasonably fast without tripping secondary rate limits.
  for (let index = 0; index < files.length; index += 6) {
    throwIfAborted(signal);
    const batch = files.slice(index, index + 6);
    const blobs = await Promise.all(batch.map(file => githubApi<{ sha: string }>(token, `/repos/${fullName}/git/blobs`, { method: "POST", body: JSON.stringify({ content: file.content.toString("base64"), encoding: "base64" }) })));
    batch.forEach((file, i) => tree.push({ path: file.path, mode: "100644", type: "blob", sha: blobs[i].sha }));
  }
  throwIfAborted(signal);
  const createdTree = await githubApi<{ sha: string }>(token, `/repos/${fullName}/git/trees`, { method: "POST", body: JSON.stringify({ tree }) });
  const commit = await githubApi<{ sha: string; html_url: string }>(token, `/repos/${fullName}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: createdTree.sha, parents: [ref.object.sha] }) });
  throwIfAborted(signal);
  await githubApi(token, `/repos/${fullName}/git/refs/heads/${encodeURIComponent(target)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return { branch: target, commitSha: commit.sha, commitUrl: `${repo.html_url}/commit/${commit.sha}`, repoUrl: repo.html_url };
}

/** Delete a repo if the token allows it; otherwise archive it (the `repo` scope cannot delete). */
export async function retireRepo(token: string, fullName: string) {
  try {
    await githubApi(token, `/repos/${fullName}`, { method: "DELETE" });
    return "deleted" as const;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return "gone" as const;
    if (error instanceof GitHubError && error.status === 403) {
      await githubApi(token, `/repos/${fullName}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
      return "archived" as const;
    }
    throw error;
  }
}

// ---- Repository discovery (UI picker + agent tools) ----

export type RepoSummary = { id: number; name: string; full_name: string; private: boolean; default_branch: string; description: string | null; updated_at: string; language: string | null; size_kb: number; html_url: string };

const toSummary = (repo: any): RepoSummary => ({
  id: repo.id, name: repo.name, full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch, description: repo.description,
  updated_at: repo.updated_at, language: repo.language, size_kb: repo.size, html_url: repo.html_url,
});

export async function listRepos(token: string, perPage = 50) {
  const repos = await githubApi<any[]>(token, `/user/repos?sort=updated&per_page=${Math.min(100, perPage)}&affiliation=owner,collaborator`);
  return repos.map(toSummary);
}

/**
 * Resolve what a user typed ("easyeps", "EasyEPS", "mouno19/easyeps") to one of their repositories.
 * Exact full-name or name matches win; otherwise a unique case-insensitive substring match.
 */
export async function resolveRepo(token: string, query: string) {
  const wanted = query.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (wanted.includes("/")) {
    const repo = await githubApi<any>(token, `/repos/${wanted}`);
    return { repo: toSummary(repo), candidates: [] as RepoSummary[] };
  }
  const repos = await githubApi<any[]>(token, "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member").then(list => list.map(toSummary));
  const lower = wanted.toLowerCase();
  const exact = repos.filter(repo => repo.name.toLowerCase() === lower);
  if (exact.length === 1) return { repo: exact[0], candidates: [] };
  const partial = (exact.length ? exact : repos.filter(repo => repo.name.toLowerCase().includes(lower) || repo.name.toLowerCase().replace(/[-_.]/g, "").includes(lower.replace(/[-_.\s]/g, ""))));
  if (partial.length === 1) return { repo: partial[0], candidates: [] };
  return { repo: null, candidates: partial.slice(0, 10) };
}

export async function repoDetails(token: string, fullName: string) {
  const [repo, branches, languages] = await Promise.all([
    githubApi<any>(token, `/repos/${fullName}`),
    githubApi<{ name: string; commit: { sha: string }; protected: boolean }[]>(token, `/repos/${fullName}/branches?per_page=30`).catch(() => []),
    githubApi<Record<string, number>>(token, `/repos/${fullName}/languages`).catch(() => ({})),
  ]);
  return { ...toSummary(repo), open_issues: repo.open_issues_count, topics: repo.topics ?? [], branches: branches.map(branch => ({ name: branch.name, sha: branch.commit.sha, protected: branch.protected })), languages };
}

export async function branchHead(token: string, fullName: string, branch: string) {
  try {
    const ref = await githubApi<{ object: { sha: string } }>(token, `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

export async function createPullRequest(token: string, fullName: string, input: { title: string; body: string; head: string; base: string; draft?: boolean }) {
  return githubApi<{ number: number; html_url: string; state: string }>(token, `/repos/${fullName}/pulls`, { method: "POST", body: JSON.stringify(input) });
}
