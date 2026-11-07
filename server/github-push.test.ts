import { afterEach, describe, expect, it, vi } from "vitest";

// Pushing a project through the Git Data API: text files travel inside a few tree requests
// (chunked, chained with base_tree) instead of one blob request each, and binary files get one blob
// request each. A run's push (waitOutLimits) spaces those and waits out GitHub's rate-limit answers;
// a push someone is waiting on (Export) fails at once instead.

const { pushProjectToRepo, GitHubError } = await import("./services/github");

type Call = { method: string; path: string; body: any; at: number };

type Limit = { path: string; method?: string; times?: number; status?: number; message?: string; headers?: Record<string, string>; onLimit?: () => void };

const SECONDARY = "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";

/** A fake GitHub API; `limit` answers the matching requests (the first `times` of them, default all) with a rate limit. */
function fakeGitHub(opts: { limit?: Limit } = {}) {
  const calls: Call[] = [];
  let trees = 0;
  let limited = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace("https://api.github.com", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body, at: Date.now() });
    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
    const limit = opts.limit;
    if (limit && path.includes(limit.path) && (!limit.method || limit.method === method) && limited < (limit.times ?? Infinity)) {
      limited++;
      limit.onLimit?.();
      return json({ message: limit.message ?? SECONDARY }, limit.status ?? 403, limit.headers ?? { "retry-after": "0" });
    }
    if (method === "GET" && path === "/repos/octo/site") return json({ default_branch: "main", html_url: "https://github.com/octo/site" });
    if (method === "GET" && path.startsWith("/repos/octo/site/git/ref/heads/")) return json({ object: { sha: "head0" } });
    if (method === "POST" && path === "/repos/octo/site/git/blobs") return json({ sha: `blob${calls.filter(call => call.path.endsWith("/git/blobs")).length}` });
    if (method === "POST" && path === "/repos/octo/site/git/trees") return json({ sha: `tree${++trees}` });
    if (method === "POST" && path === "/repos/octo/site/git/commits") return json({ sha: "commit1", html_url: "https://github.com/octo/site/commit/commit1" });
    if (method === "PATCH" && path.startsWith("/repos/octo/site/git/refs/heads/")) return json({ object: { sha: body.sha } });
    return json({ message: "unexpected" }, 500);
  }));
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const blobCalls = (calls: Call[]) => calls.filter(call => call.path.endsWith("/git/blobs"));
const binary = (index: number) => ({ path: `img/${index}.png`, content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, index]) });

describe("pushing a project to GitHub", () => {
  it("sends text files inside the tree request and only binary files as blobs", async () => {
    const calls = fakeGitHub();
    const files = [
      { path: "index.html", content: Buffer.from("<!doctype html><h1>Hi</h1>\n") },
      { path: "src/app.js", content: Buffer.from("console.log('é');\n") },
      { path: "logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]) },
    ];
    const pushed = await pushProjectToRepo("token", "octo/site", files, "Curialy preview");
    expect(pushed).toMatchObject({ branch: "main", commitSha: "commit1" });
    expect(calls.filter(call => call.path.endsWith("/git/blobs"))).toHaveLength(1);
    const trees = calls.filter(call => call.path.endsWith("/git/trees"));
    expect(trees).toHaveLength(1);
    expect(trees[0].body.base_tree).toBeUndefined();
    expect(trees[0].body.tree).toEqual([
      { path: "index.html", mode: "100644", type: "blob", content: "<!doctype html><h1>Hi</h1>\n" },
      { path: "src/app.js", mode: "100644", type: "blob", content: "console.log('é');\n" },
      { path: "logo.png", mode: "100644", type: "blob", sha: "blob1" },
    ]);
    expect(calls.find(call => call.path.endsWith("/git/commits"))!.body).toEqual({ message: "Curialy preview", tree: "tree1", parents: ["head0"] });
  });

  it("splits a large project into chained tree requests: a few writes, not one per file", async () => {
    const calls = fakeGitHub();
    const files = Array.from({ length: 445 }, (_, index) => ({ path: `src/file${index}.ts`, content: Buffer.from(`export const value${index} = "${"x".repeat(9000)}";\n`) }));
    await pushProjectToRepo("token", "octo/site", files, "Curialy preview");
    const writes = calls.filter(call => call.method !== "GET");
    expect(calls.filter(call => call.path.endsWith("/git/blobs"))).toHaveLength(0);
    const trees = calls.filter(call => call.path.endsWith("/git/trees"));
    expect(trees.length).toBeGreaterThan(1);
    expect(trees.length).toBeLessThan(5);
    // Each chunk builds on the one before, so the final tree holds every file and nothing else.
    expect(trees[0].body.base_tree).toBeUndefined();
    trees.slice(1).forEach((tree, index) => expect(tree.body.base_tree).toBe(`tree${index + 1}`));
    expect(trees.flatMap(tree => tree.body.tree.map((entry: { path: string }) => entry.path))).toHaveLength(445);
    expect(calls.find(call => call.path.endsWith("/git/commits"))!.body.tree).toBe(`tree${trees.length}`);
    expect(writes.length).toBeLessThan(8);
  });

  it("waits out a secondary rate limit in a run's push and carries on", async () => {
    const calls = fakeGitHub({ limit: { path: "/git/trees", times: 1 } });
    await pushProjectToRepo("token", "octo/site", [{ path: "a.txt", content: Buffer.from("a") }], "Curialy preview", { waitOutLimits: true });
    expect(calls.filter(call => call.path.endsWith("/git/trees"))).toHaveLength(2);
    expect(calls.some(call => call.path.endsWith("/git/commits"))).toBe(true);
  });

  it("gives up after four waits, and at once on a wait longer than a run should hold for", async () => {
    let calls = fakeGitHub({ limit: { path: "/git/trees", status: 429 } });
    await expect(pushProjectToRepo("token", "octo/site", [{ path: "a.txt", content: Buffer.from("a") }], "m", { waitOutLimits: true })).rejects.toBeInstanceOf(GitHubError);
    expect(calls.filter(call => call.path.endsWith("/git/trees"))).toHaveLength(5);

    const reset = String(Math.floor(Date.now() / 1000) + 3600);
    calls = fakeGitHub({ limit: { path: "/git/trees", message: "API rate limit exceeded", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } } });
    const error = await pushProjectToRepo("token", "octo/site", [{ path: "a.txt", content: Buffer.from("a") }], "m", { waitOutLimits: true }).catch(failure => failure);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.retryAfterMs).toBeGreaterThan(3 * 60_000);
    expect(calls.filter(call => call.path.endsWith("/git/trees"))).toHaveLength(1);
    expect(calls.some(call => call.path.endsWith("/git/commits"))).toBe(false);
  });

  it("fails at once on a rate limit when nobody asked it to wait (an Export request)", async () => {
    const calls = fakeGitHub({ limit: { path: "/git/trees", times: 1 } });
    const error = await pushProjectToRepo("token", "octo/site", [{ path: "a.txt", content: Buffer.from("a") }], "m").catch(failure => failure);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.message).toMatch(/secondary rate limit/);
    expect(calls.filter(call => call.path.endsWith("/git/trees"))).toHaveLength(1);
  });

  it("stops before the ref update when the run is cancelled during a wait", async () => {
    const controller = new AbortController();
    const calls = fakeGitHub({ limit: { path: "/git/refs/heads/", method: "PATCH", times: 1, status: 429, headers: { "retry-after": "30" }, onLimit: () => controller.abort() } });
    await expect(pushProjectToRepo("token", "octo/site", [{ path: "a.txt", content: Buffer.from("a") }], "m", { waitOutLimits: true, signal: controller.signal })).rejects.toThrow();
    expect(calls.filter(call => call.method === "PATCH")).toHaveLength(1);
  });

  it("spaces a run's binary uploads past the first twenty, and not an Export's", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const files = Array.from({ length: 22 }, (_, index) => binary(index));
    let calls = fakeGitHub();
    const pushed = pushProjectToRepo("token", "octo/site", files, "Curialy preview", { waitOutLimits: true });
    await vi.advanceTimersByTimeAsync(5_000);
    await pushed;
    const times = blobCalls(calls).map(call => call.at - calls[0].at);
    expect(times).toHaveLength(22);
    expect(times.slice(0, 20).every(at => at === 0)).toBe(true);
    expect(times.slice(20)).toEqual([1_000, 2_000]);

    calls = fakeGitHub();
    await pushProjectToRepo("token", "octo/site", files, "Update from Curialy AI");
    expect(blobCalls(calls).every(call => call.at === calls[0].at)).toBe(true);
  });
});

describe("GitHub failures, in words that say what to do", () => {
  it("explains a revoked connection, organization restrictions, rate limits and refused writes", async () => {
    const { describeGitHubError, workflowFilesBlocked } = await import("./services/github");
    expect(describeGitHubError(new GitHubError("GitHub GET /user failed (401): Bad credentials", 401))).toMatch(/Reconnect GitHub/);
    expect(describeGitHubError(new GitHubError("Resource protected by organization SAML enforcement", 403), { repo: "acme/app" })).toMatch(/acme uses single sign-on/);
    expect(describeGitHubError(new GitHubError("the `acme` organization has enabled OAuth App access restrictions", 403), { repo: "acme/app" })).toMatch(/owner must approve Curialy/);
    expect(describeGitHubError(new GitHubError("secondary rate limit", 403, 120_000))).toMatch(/wait 2 minute/);
    const treeWrite = new GitHubError("GitHub POST /repos/octo/app/git/trees failed (404): Not Found", 404);
    expect(describeGitHubError(treeWrite, { repo: "octo/app", paths: [".github/workflows/ci.yml", "src/a.ts"], scopes: "repo" })).toMatch(/workflow permission/);
    // With the permission there, a refused write is about access, not workflows.
    expect(describeGitHubError(treeWrite, { repo: "octo/app", paths: [".github/workflows/ci.yml"], scopes: "repo,workflow" })).toMatch(/can probably only read it/);
    expect(describeGitHubError(treeWrite, { repo: "octo/app", paths: ["src/a.ts"] })).toMatch(/can probably only read it/);
    // A 404 on a read is a missing repository or commit, never "read-only access".
    const read = new GitHubError("GitHub GET /repos/octo/gone failed (404): Not Found", 404);
    expect(describeGitHubError(read, { repo: "octo/gone", paths: ["src/a.ts"] })).toBe(read.message);
    // Workflow files: blocked only when the scopes are known and lack it.
    expect(workflowFilesBlocked([".github/workflows/ci.yml", ".github/dependabot.yml"], "read:user,repo,user:email")).toEqual([".github/workflows/ci.yml"]);
    expect(workflowFilesBlocked([".github/workflows/ci.yml"], "repo workflow")).toEqual([]);
    expect(workflowFilesBlocked([".github/workflows/ci.yml"], null)).toEqual([]);
  });

  it("returns the pull request that is already open instead of failing", async () => {
    const { createPullRequest } = await import("./services/github");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = String(url).replace("https://api.github.com", "");
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      if (init.method === "POST" && path === "/repos/octo/site/pulls") return json({ message: "Validation Failed", errors: [{ message: "A pull request already exists for octo:fix." }] }, 422);
      if (path.startsWith("/repos/octo/site/pulls?state=open&head=octo%3Afix&base=main")) return json([{ number: 7, html_url: "https://github.com/octo/site/pull/7", state: "open" }]);
      return json({ message: "unexpected" }, 500);
    }));
    expect(await createPullRequest("token", "octo/site", { title: "Fix", body: "", head: "fix", base: "main" })).toMatchObject({ number: 7, existing: true });
  });

  it("lists repositories past the first page, organizations' included", async () => {
    const { listRepos } = await import("./services/github");
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(String(url));
      const page = Number(new URL(String(url)).searchParams.get("page"));
      const repos = Array.from({ length: page === 1 ? 100 : 20 }, (_, index) => ({ id: page * 1000 + index, name: `r${page}-${index}`, full_name: `o/r${page}-${index}`, private: false, default_branch: "main", description: null, updated_at: "2026-11-01", language: null, size: 1, html_url: "x" }));
      return new Response(JSON.stringify(repos), { status: 200, headers: { "content-type": "application/json" } });
    }));
    expect(await listRepos("token", 300)).toHaveLength(120);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("affiliation=owner,collaborator,organization_member");
  });
});
