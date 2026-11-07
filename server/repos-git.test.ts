import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// A linked repository with real git, against a local bare repository standing in for GitHub (the
// clone's fetches are pointed at it; GitHub's REST calls are recorded). Covers what changes a push
// sends (modes, submodules and symlinks), bringing a moved branch into the workspace without losing
// edits, and the checks that stop a push before anything is written.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-repos-git-"));
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "workspaces");
process.env.AGENT_SANDBOX = "none";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });
const BARE = path.join(tmp, "remote.git");
const UPSTREAM = path.join(tmp, "upstream");

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" }).trim();
const headOf = () => sh(BARE, "rev-parse", "main");

const record = vi.hoisted(() => ({ queries: [] as { text: string; values: unknown[] }[], trees: [] as { files: unknown[]; baseTree?: string }[], commits: [] as { parents: string[] }[], refs: [] as string[] }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  // The app's git (appGit) fetches from the local bare repository instead of github.com.
  const spawn = ((command: string, argv: string[], opts: Record<string, any>) => {
    if (command === "/bin/sh" && argv[2] === "git") {
      const args = [...argv];
      if (args[3] === "remote" && args[4] === "add") args[6] = BARE;
      return actual.spawn(command, args, { ...opts, env: { ...opts.env, GIT_CONFIG_VALUE_1: "always" } });
    }
    return actual.spawn(command, argv, opts);
  }) as typeof actual.spawn;
  return { ...actual, spawn };
});
vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    record.queries.push({ text, values });
    return { rows: [], rowCount: 1 };
  }),
}));
vi.mock("./services/github", async importOriginal => ({
  ...(await importOriginal<typeof import("./services/github")>()),
  repoDetails: async (_token: string, fullName: string) => ({ full_name: fullName, name: fullName.split("/")[1], html_url: `https://github.com/${fullName}`, default_branch: "main", size_kb: 1 }),
  branchHead: async () => headOf(),
  writeTree: vi.fn(async (_token: string, _repo: string, files: unknown[], opts: { baseTree?: string }) => {
    record.trees.push({ files, baseTree: opts.baseTree });
    return "tree-sha";
  }),
  githubCall: vi.fn(async (_token: string, url: string, init: RequestInit = {}) => {
    if (url.includes("/git/commits/")) return { tree: { sha: `tree-of-${url.split("/").pop()}` } };
    if (url.endsWith("/git/commits")) {
      record.commits.push(JSON.parse(String(init.body)));
      return { sha: "c0ffee0000000000000000000000000000000000", html_url: "https://github.com/x/commit/c0ffee" };
    }
    record.refs.push(`${init.method} ${url}`);
    return {};
  }),
}));

const { cloneIntoWorkspace, commitAndPush, computeChanges, syncWithRemote } = await import("./agent/repos");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
/** A fresh "GitHub" repository and a task workspace with it cloned at the root. */
async function setup() {
  fs.rmSync(BARE, { recursive: true, force: true });
  fs.rmSync(UPSTREAM, { recursive: true, force: true });
  sh(tmp, "init", "--quiet", "--bare", "--initial-branch", "main", BARE);
  // GitHub serves any reachable commit by id (a sync fetches the old base too).
  sh(BARE, "config", "uploadpack.allowAnySHA1InWant", "true");
  sh(tmp, "clone", "--quiet", BARE, UPSTREAM);
  fs.writeFileSync(path.join(UPSTREAM, "README.md"), "v1\n");
  fs.writeFileSync(path.join(UPSTREAM, "a.txt"), "a\nb\nc\n");
  fs.writeFileSync(path.join(UPSTREAM, "run.sh"), "#!/bin/sh\necho run\n", { mode: 0o755 });
  fs.symlinkSync("a.txt", path.join(UPSTREAM, "link"));
  sh(UPSTREAM, "add", "-A");
  // A submodule entry (a gitlink) without its folder, as such repositories are cloned here.
  sh(UPSTREAM, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},sub`);
  sh(UPSTREAM, "commit", "--quiet", "-m", "init");
  sh(UPSTREAM, "push", "--quiet", "origin", "main");
  const root = path.join(process.env.AGENT_WORKSPACE_ROOT!, `ws-${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  const cloned = await cloneIntoWorkspace({ sessionId: "s1", root, fullName: "octo/app", token: "token", onOutput: () => undefined });
  const repo = { fullName: "octo/app", url: "https://github.com/octo/app", branch: "main", baseSha: cloned.baseSha, repoPath: ".", pushed: {} as Record<string, string>, deleted: [] as string[] };
  return { root, repo };
}
/** Someone else pushes to main on "GitHub". */
function pushUpstream(change: (dir: string) => void) {
  change(UPSTREAM);
  // The submodule entry has no folder here: leave it out, or "add -A" would delete it.
  sh(UPSTREAM, "add", "--all", "--", ".", ":(exclude)sub");
  sh(UPSTREAM, "commit", "--quiet", "-m", "upstream");
  sh(UPSTREAM, "push", "--quiet", "origin", "main");
}

beforeEach(() => {
  record.queries.length = 0;
  record.trees.length = 0;
  record.commits.length = 0;
  record.refs.length = 0;
});

describe("what a push sends", () => {
  it("keeps submodules and symlinks as GitHub has them, and sends each file's mode", async () => {
    const { root, repo } = await setup();
    // As in the sandbox: no symlink, no submodule folder (only files sync).
    fs.rmSync(path.join(root, "link"));
    fs.writeFileSync(path.join(root, "a.txt"), "a\nB\nc\n");
    fs.writeFileSync(path.join(root, "new.sh"), "#!/bin/sh\n", { mode: 0o755 });
    fs.chmodSync(path.join(root, "new.sh"), 0o755);
    // A new symlink made in the sandbox is never pushed either.
    fs.symlinkSync("README.md", path.join(root, "readme-link"));
    const changes = await computeChanges(root, repo);
    expect(changes.changed.sort()).toEqual(["a.txt", "new.sh"]);
    expect(changes.deleted).toEqual([]);
    expect(changes.kept.sort()).toEqual(["link", "readme-link"]);
    expect(changes.modes).toMatchObject({ "a.txt": "100644", "new.sh": "100755" });
    await commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "edit", scopes: "repo,workflow" });
    expect(record.trees[0].baseTree).toBe(`tree-of-${repo.baseSha}`);
    expect(record.trees[0].files).toEqual(expect.arrayContaining([expect.objectContaining({ path: "new.sh", mode: "100755" }), expect.objectContaining({ path: "a.txt", mode: "100644" })]));
    expect(JSON.stringify(record.trees[0].files)).not.toMatch(/"link"|"sub"/);
  });

  it("refuses workflow files without the workflow permission, before anything is written", async () => {
    const { root, repo } = await setup();
    fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    fs.writeFileSync(path.join(root, ".github/workflows/ci.yml"), "on: push\n");
    await expect(commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "ci", scopes: "read:user,repo,user:email" })).rejects.toThrow(/workflow permission/);
    expect(record.trees).toEqual([]);
    expect(record.commits).toEqual([]);
    await commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "ci", scopes: "read:user,repo,user:email,workflow" });
    expect(record.trees).toHaveLength(1);
  });
});

describe("a branch that moved on GitHub", () => {
  it("brings the new commits into the workspace, keeping its edits, and moves the base", async () => {
    const { root, repo } = await setup();
    const before = repo.baseSha;
    fs.writeFileSync(path.join(root, "a.txt"), "a\nb\nc\nmine\n");
    fs.writeFileSync(path.join(root, "notes.md"), "mine\n");
    pushUpstream(dir => {
      fs.writeFileSync(path.join(dir, "README.md"), "v2\n");
      fs.writeFileSync(path.join(dir, "b.txt"), "theirs\n");
    });
    const result = await syncWithRemote({ sessionId: "s1", root, repo, token: "token" });
    expect(result).toMatchObject({ updated: true, conflicts: [], head: headOf() });
    // What came from GitHub as it is (not this run's work).
    expect(result.upstreamOnly.sort()).toEqual(["README.md", "b.txt"]);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe("v2\n");
    expect(fs.readFileSync(path.join(root, "b.txt"), "utf8")).toBe("theirs\n");
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("a\nb\nc\nmine\n");
    expect(fs.readFileSync(path.join(root, "notes.md"), "utf8")).toBe("mine\n");
    expect(fs.statSync(path.join(root, "run.sh")).mode & 0o111).not.toBe(0);
    expect(repo.baseSha).toBe(headOf());
    expect(repo.baseSha).not.toBe(before);
    expect(record.queries.find(entry => entry.text.startsWith("UPDATE curialy.chat_sessions SET github_base_sha"))?.values).toEqual(["s1", headOf(), "main"]);
    // The clone's own history agrees: only the workspace's edits differ from the new base.
    const changes = await computeChanges(root, repo);
    expect(changes.changed.sort()).toEqual(["a.txt", "notes.md"]);
    expect(changes.deleted).toEqual([]);
  });

  it("leaves conflicts marked and listed when both sides changed the same lines", async () => {
    const { root, repo } = await setup();
    fs.writeFileSync(path.join(root, "a.txt"), "a\nMINE\nc\n");
    pushUpstream(dir => fs.writeFileSync(path.join(dir, "a.txt"), "a\nTHEIRS\nc\n"));
    const result = await syncWithRemote({ sessionId: "s1", root, repo, token: "token" });
    expect(result.conflicts).toEqual(["a.txt"]);
    const merged = fs.readFileSync(path.join(root, "a.txt"), "utf8");
    expect(merged).toContain("<<<<<<<");
    expect(merged).toContain("MINE");
    expect(merged).toContain("THEIRS");
    // The markers never reach GitHub: the next push stops until they are resolved.
    await expect(commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "x", scopes: "repo,workflow" })).rejects.toThrow(/a\.txt still has conflict markers/);
    expect(record.trees).toEqual([]);
    fs.writeFileSync(path.join(root, "a.txt"), "a\nMINE and THEIRS\nc\n");
    await commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "x", scopes: "repo,workflow" });
    expect(record.trees).toHaveLength(1);
  });

  it("never merges for the Export dialog: nobody is there to resolve conflicts", async () => {
    const { root, repo } = await setup();
    fs.writeFileSync(path.join(root, "notes.md"), "mine\n");
    pushUpstream(dir => fs.writeFileSync(path.join(dir, "README.md"), "v2\n"));
    await expect(commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "x", scopes: "repo,workflow", autoSync: false })).rejects.toThrow(/Ask the agent to bring the workspace up to date/);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe("v1\n");
  });

  it("pushes on top of the new head after bringing the workspace up to date", async () => {
    const { root, repo } = await setup();
    fs.writeFileSync(path.join(root, "notes.md"), "mine\n");
    pushUpstream(dir => fs.writeFileSync(path.join(dir, "README.md"), "v2\n"));
    const pushed = await commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "notes", scopes: "repo,workflow" });
    expect(pushed).toMatchObject({ nothingToPush: false, synced: headOf() });
    expect(record.commits[0].parents).toEqual([headOf()]);
    expect(record.trees[0].baseTree).toBe(`tree-of-${headOf()}`);
    expect(record.trees[0].files).toEqual([expect.objectContaining({ path: "notes.md" })]);
  });

  it("refuses a push to another branch that has commits the workspace lacks", async () => {
    const { root, repo } = await setup();
    fs.writeFileSync(path.join(root, "notes.md"), "mine\n");
    pushUpstream(dir => fs.writeFileSync(path.join(dir, "README.md"), "v2\n"));
    // branchHead answers with main's head for any branch here: "feature" exists and moved.
    await expect(commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "x", branch: "feature", scopes: "repo,workflow" })).rejects.toThrow(/has commits this workspace doesn't have/);
    expect(record.trees).toEqual([]);
  });
});
