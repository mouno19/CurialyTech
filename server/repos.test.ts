import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// A linked repository whose folder was deleted (agents sometimes delete a clone to "clone it
// again") is fetched back at the commit it was cloned at, instead of being reported as cloned.
// git is faked: the fetch writes a fixed tree, so nothing here touches the network.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-repos-"));
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "workspaces");
process.env.AGENT_SANDBOX = "none";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });

const BASE = "8c26822aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const state = vi.hoisted(() => ({ linked: null as null | Record<string, unknown>, git: [] as string[][] }));
vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string) => (text.includes("FROM curialy.chat_sessions WHERE id = $1 AND github_mode = 'linked'") && state.linked ? { rows: [state.linked] } : { rows: [], rowCount: 0 })),
}));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  // spawn("/bin/sh", ["-c", "umask 002 && exec git \"$@\"", "git", ...args], { cwd })
  const spawn = (_command: string, argv: string[], opts: { cwd: string }) => {
    const args = argv.slice(3);
    state.git.push(args);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    let stdout = "";
    if (args[0] === "init") {
      fs.mkdirSync(path.join(opts.cwd, ".git"), { recursive: true });
      fs.writeFileSync(path.join(opts.cwd, ".git/HEAD"), "ref: refs/heads/main\n");
    }
    if (args[0] === "checkout") {
      fs.mkdirSync(path.join(opts.cwd, "src"), { recursive: true });
      fs.writeFileSync(path.join(opts.cwd, "README.md"), "fetched");
      fs.writeFileSync(path.join(opts.cwd, "src/main.ts"), "fetched");
    }
    if (args[0] === "ls-files") stdout = "README.md\nsrc/main.ts\n";
    setImmediate(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("close", 0);
    });
    return child;
  };
  return { ...actual, spawn };
});

vi.mock("./services/github", async importOriginal => ({
  ...(await importOriginal<typeof import("./services/github")>()),
  repoDetails: async (_token: string, fullName: string) => ({ full_name: fullName, name: fullName.split("/")[1], html_url: `https://github.com/${fullName}`, default_branch: "main", size_kb: 100 }),
  branchHead: async () => "1111111111111111111111111111111111111111",
}));

const { cloneIntoWorkspace, commitAndPush } = await import("./agent/repos");
const { query } = await import("./db/pg");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function workspace(files: Record<string, string>, dirs: string[] = []) {
  const root = path.join(process.env.AGENT_WORKSPACE_ROOT!, `ws-${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}
const link = (repoPath: string) => {
  state.linked = { github_repo: "myself-tsuki/muzu-new", github_repo_url: "https://github.com/myself-tsuki/muzu-new", github_branch: "main", github_base_sha: BASE, github_repo_path: repoPath, github_pushed: { "fix/menu": "7556826c" }, github_deleted: [] };
};
const clone = (root: string, fullName = "myself-tsuki/muzu-new") => cloneIntoWorkspace({ sessionId: "s1", root, fullName, token: "token", onOutput: () => undefined });

beforeEach(() => {
  state.linked = null;
  state.git = [];
});

describe("cloneIntoWorkspace on a linked task", () => {
  it("restores a sub-folder clone whose files were deleted, at the commit it was cloned at", async () => {
    // What the sandbox's `rm -rf muzu-new` left: the history (never deleted here) and empty folders.
    const root = workspace({ "attachments/a.png": "x", "muzu-new/.git/HEAD": "old", "muzu-new/.git/objects/pack/p.pack": "old" }, ["muzu-new/src/empty", "muzu-new/.git/refs/heads"]);
    link("muzu-new");
    const result = await clone(root);
    expect(result).toMatchObject({ alreadyLinked: true, restored: true, files: 2, repoPath: "muzu-new", baseSha: BASE, pushed: {}, earlierPushes: ["fix/menu"] });
    expect(state.git.find(args => args[0] === "fetch")).toContain(BASE);
    expect(fs.readFileSync(path.join(root, "muzu-new/README.md"), "utf8")).toBe("fetched");
    expect(fs.readFileSync(path.join(root, "muzu-new/.git/HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(fs.existsSync(path.join(root, "muzu-new/.git/objects/pack/p.pack"))).toBe(false);
    expect(fs.existsSync(path.join(root, "muzu-new/src/empty"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "attachments/a.png"), "utf8")).toBe("x");
  });

  it("forgets the push record of a restored clone, so pushing on top of those commits is refused instead of undoing them", async () => {
    const root = workspace({ "muzu-new/.git/HEAD": "old" });
    link("muzu-new");
    vi.mocked(query).mockClear();
    await clone(root);
    expect(vi.mocked(query).mock.calls.some(([text]) => String(text).startsWith("UPDATE curialy.chat_sessions SET github_pushed = '{}'"))).toBe(true);
  });

  it("restores a root clone, keeping the attachments", async () => {
    const root = workspace({ ".git/HEAD": "old", "attachments/a.png": "x" }, ["src"]);
    link(".");
    expect(await clone(root)).toMatchObject({ restored: true, files: 2 });
    expect(fs.readFileSync(path.join(root, "src/main.ts"), "utf8")).toBe("fetched");
    expect(fs.readFileSync(path.join(root, "attachments/a.png"), "utf8")).toBe("x");
  });

  it("answers 'already cloned' while any of the working tree is left, without fetching", async () => {
    const root = workspace({ "attachments/a.png": "x", "muzu-new/.git/HEAD": "old", "muzu-new/.gitignore": "dist" });
    link("muzu-new");
    expect(await clone(root)).toMatchObject({ alreadyLinked: true, restored: false, files: 0 });
    expect(state.git).toEqual([]);
    expect(fs.readFileSync(path.join(root, "muzu-new/.git/HEAD"), "utf8")).toBe("old");
  });

  it("still refuses another repository", async () => {
    const root = workspace({ "muzu-new/README.md": "r" });
    link("muzu-new");
    await expect(clone(root, "someone/else")).rejects.toThrow("already linked to myself-tsuki/muzu-new");
  });

  it("refuses to push a clone whose files are gone (it would delete them all on GitHub)", async () => {
    const root = workspace({ "muzu-new/.git/HEAD": "old" }, ["muzu-new/src"]);
    const repo = { fullName: "myself-tsuki/muzu-new", url: "https://github.com/myself-tsuki/muzu-new", branch: "main", baseSha: BASE, repoPath: "muzu-new", pushed: {}, deleted: [] };
    await expect(commitAndPush({ sessionId: "s1", root, repo, token: "token", message: "x" })).rejects.toThrow("files are gone from the workspace");
  });

  it("clones into an empty folder a clone cut short left behind", async () => {
    const root = workspace({ "attachments/a.png": "x" }, ["site"]);
    const result = await cloneIntoWorkspace({ sessionId: "s1", root, fullName: "octo/site", token: "token", onOutput: () => undefined });
    expect(result).toMatchObject({ repoPath: "site", taken: null });
    expect(fs.readFileSync(path.join(root, "site/README.md"), "utf8")).toBe("fetched");
  });

  it("switches into a free folder when the repository's name is taken", async () => {
    const root = workspace({ "muzu-new/README.md": "edited", "site/notes.md": "mine" });
    link("muzu-new");
    const result = await cloneIntoWorkspace({ sessionId: "s1", root, fullName: "octo/site", token: "token", onOutput: () => undefined, replace: true });
    expect(result).toMatchObject({ repoPath: "octo-site", taken: "site" });
    expect(fs.readFileSync(path.join(root, "octo-site/README.md"), "utf8")).toBe("fetched");
    expect(fs.readFileSync(path.join(root, "site/notes.md"), "utf8")).toBe("mine");
  });

  it("gives a clone whose history is missing its history back, keeping its files", async () => {
    // The folder was deleted in the sandbox (history and all), then made again without .git.
    const root = workspace({ "muzu-new/README.md": "edited", "muzu-new/src/new.ts": "mine" });
    link("muzu-new");
    const result = await clone(root);
    expect(result).toMatchObject({ alreadyLinked: true, restored: false, historyRestored: true, files: 2 });
    expect(state.git.find(args => args[0] === "fetch")).toContain(BASE);
    expect(fs.readFileSync(path.join(root, "muzu-new/.git/HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(fs.readFileSync(path.join(root, "muzu-new/README.md"), "utf8")).toBe("edited");
    expect(fs.readFileSync(path.join(root, "muzu-new/src/new.ts"), "utf8")).toBe("mine");
    expect(fs.existsSync(path.join(root, "muzu-new/src/main.ts"))).toBe(false);
  });

  it("switches to another repository when the user asked: cloned next to the old one, which keeps its files", async () => {
    const root = workspace({ "muzu-new/README.md": "edited", "muzu-new/.git/HEAD": "old" });
    link("muzu-new");
    vi.mocked(query).mockClear();
    const result = await cloneIntoWorkspace({ sessionId: "s1", root, fullName: "octo/site", token: "token", onOutput: () => undefined, replace: true });
    expect(result).toMatchObject({ fullName: "octo/site", repoPath: "site", alreadyLinked: false, replaced: { fullName: "myself-tsuki/muzu-new", repoPath: "muzu-new" } });
    expect(fs.readFileSync(path.join(root, "site/README.md"), "utf8")).toBe("fetched");
    expect(fs.readFileSync(path.join(root, "muzu-new/README.md"), "utf8")).toBe("edited");
    // The link moved to the new repository, with a fresh push history.
    const update = vi.mocked(query).mock.calls.find(([text]) => String(text).startsWith("UPDATE curialy.chat_sessions SET github_mode = 'linked'"));
    expect(update?.[1]).toEqual(["s1", "octo/site", "https://github.com/octo/site", "main", "1111111111111111111111111111111111111111", "site"]);
  });
});
