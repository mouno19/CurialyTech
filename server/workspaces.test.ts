import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// What the durable archive, an export and a deploy contain: sources and lockfiles always, build
// output only as the separate 'build' role, never caches, uploads or local secrets.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-ws-"));
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "workspaces");
process.env.AGENT_SANDBOX = "none";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });

// The archive lives in the database: snapshot writes are captured, restores read `archive.rows`.
const archive = vi.hoisted(() => ({ saved: [] as { path: string; role: string; content: Buffer }[], rows: [] as { path: string; content: Buffer; role: string }[], failLoad: false }));
vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes("FROM curialy.workspace_files WHERE session_id = $1 AND role = ANY($2::text[])")) {
      if (archive.failLoad) throw new Error("connection reset");
      return { rows: archive.rows.filter(row => (values[1] as string[]).includes(row.role)) };
    }
    return { rows: [], rowCount: 0 };
  }),
  heartbeatQuery: vi.fn(async () => ({ rows: [] })),
  db: () => ({
    connect: async () => ({
      query: async (text: string, values: unknown[] = []) => {
        if (text.startsWith("INSERT INTO curialy.workspace_files")) {
          for (let index = 0; index < values.length; index += 6) archive.saved.push({ path: values[index + 1] as string, content: values[index + 2] as Buffer, role: values[index + 5] as string });
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
  }),
}));

const { archiveWorkspace, collectWorkspaceFiles, findBuildDirs, isPublishExcluded, isUnbuiltTemplate, snapshotWorkspace, materializeWorkspace } = await import("./agent/workspaces");
// Permission checks mean nothing to root.
const asRoot = process.getuid?.() === 0;

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function workspace(files: Record<string, string>) {
  const root = path.join(tmp, `ws-${++counter}`);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}
const paths = (root: string) => collectWorkspaceFiles(root).files.map(file => file.path).sort();

const VITE_TEMPLATE = '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
const BUILT = '<!doctype html><html><head><script type="module" crossorigin src="./assets/index-BSEziAk6.js"></script></head><body><div id="root"></div></body></html>';

describe("collectWorkspaceFiles", () => {
  it("keeps sources and lockfiles, and leaves out build output next to a manifest, caches and VCS data", () => {
    const root = workspace({
      "package.json": "{}",
      "package-lock.json": "{\"lockfileVersion\":3}",
      "src/App.tsx": "export {}",
      "scripts/build/run.js": "console.log('build')",
      "frontend/package.json": "{}",
      "frontend/src/main.tsx": "export {}",
      "frontend/dist/index.html": BUILT,
      "frontend/dist/assets/index-BSEziAk6.js": "x",
      "dist/server.js": "x",
      "node_modules/react/index.js": "x",
      ".git/HEAD": "ref: refs/heads/main",
      ".tmp/scratch.txt": "x",
      "src/App.tsx.map": "{}",
      "docs/build/notes.md": "kept: no manifest next to this build/ folder",
    });
    expect(paths(root)).toEqual([
      "docs/build/notes.md",
      "frontend/package.json",
      "frontend/src/main.tsx",
      "package-lock.json",
      "package.json",
      "scripts/build/run.js",
      "src/App.tsx",
    ]);
  });

  it("keeps a dist/ folder that is not next to a manifest (a plain static site)", () => {
    const root = workspace({ "dist/index.html": BUILT, "README.md": "# Site" });
    expect(paths(root)).toEqual(["README.md", "dist/index.html"]);
  });

  it("hashes each file and skips symlinks", () => {
    const root = workspace({ "a.txt": "hello" });
    fs.symlinkSync("/etc/hostname", path.join(root, "link.txt"));
    const { files } = collectWorkspaceFiles(root);
    expect(files).toEqual([{ path: "a.txt", content: Buffer.from("hello"), sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }]);
  });

  it.skipIf(asRoot)("fails instead of leaving out a folder it can't read", () => {
    const root = workspace({ "a.txt": "a", "private/b.txt": "b" });
    fs.chmodSync(path.join(root, "private"), 0o000);
    try {
      expect(() => collectWorkspaceFiles(root)).toThrow("The workspace folder private can't be read (EACCES).");
    } finally {
      fs.chmodSync(path.join(root, "private"), 0o755);
    }
  });
});

describe("findBuildDirs", () => {
  it("finds a nested built site and ignores an unbuilt dev-server template", () => {
    const root = workspace({
      "frontend/package.json": "{}",
      "frontend/dist/index.html": BUILT,
      "web/build/index.html": VITE_TEMPLATE,
      "out/index.txt": "no index.html here",
      "node_modules/pkg/dist/index.html": BUILT,
      "a/b/c/dist/index.html": BUILT, // deeper than three levels
    });
    expect(findBuildDirs(root)).toEqual(["frontend/dist"]);
  });

  it("lists the newest build first", () => {
    const root = workspace({ "dist/index.html": BUILT, "site/out/index.html": BUILT });
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(root, "dist/index.html"), old, old);
    expect(findBuildDirs(root)).toEqual(["site/out", "dist"]);
  });
});

describe("isUnbuiltTemplate", () => {
  it("recognises Vite and CRA sources that only work through a dev server", () => {
    expect(isUnbuiltTemplate(VITE_TEMPLATE)).toBe(true);
    expect(isUnbuiltTemplate('<script src="src/index.jsx"></script>')).toBe(true);
    expect(isUnbuiltTemplate('<link rel="icon" href="%PUBLIC_URL%/favicon.ico">')).toBe(true);
    expect(isUnbuiltTemplate(BUILT)).toBe(false);
    expect(isUnbuiltTemplate("<h1>Hello</h1><script src=\"app.js\"></script>")).toBe(false);
  });
});

describe("isPublishExcluded", () => {
  it("never publishes uploads or local secrets, but keeps example env files", () => {
    for (const file of ["attachments/x", "attachments/report.pdf", ".env", "a/.env.local", ".env.production", "api/.env.production.local"]) expect(isPublishExcluded(file), file).toBe(true);
    for (const file of [".env.example", "a/.env.sample", ".env.template", "src/attachments/x.ts", "docs/env.md", "src/.environment.ts"]) expect(isPublishExcluded(file), file).toBe(false);
  });
});

describe("archive and restore", () => {
  const TASK = "00000000-0000-4000-8000-0000000000a9";
  const live = path.join(process.env.AGENT_WORKSPACE_ROOT!, TASK);

  it("archives the sources and, separately, the built site", async () => {
    for (const [file, content] of Object.entries({ "package.json": "{}", "package-lock.json": "{}", "src/App.tsx": "x", "dist/index.html": BUILT, "dist/assets/index-BSEziAk6.js": "js", "dist/assets/index-BSEziAk6.js.map": "{}", "node_modules/x/index.js": "x" })) {
      fs.mkdirSync(path.dirname(path.join(live, file)), { recursive: true });
      fs.writeFileSync(path.join(live, file), content);
    }
    archive.saved.length = 0;
    expect(await snapshotWorkspace(TASK)).toMatchObject({ files: 5 });
    expect(archive.saved.map(file => `${file.role}:${file.path}`).sort()).toEqual([
      "build:dist/assets/index-BSEziAk6.js", "build:dist/index.html", "source:package-lock.json", "source:package.json", "source:src/App.tsx",
    ]);
  });

  it("restores sources and the archived build, and leaves nothing half-restored when it fails", async () => {
    fs.rmSync(live, { recursive: true, force: true });
    archive.rows = archive.saved.map(file => ({ path: file.path, content: file.content, role: file.role }));
    expect(await materializeWorkspace(TASK)).toEqual({ dir: live, restored: 5 });
    expect(fs.readFileSync(path.join(live, "dist/index.html"), "utf8")).toBe(BUILT);
    expect(findBuildDirs(live)).toEqual(["dist"]);
    // Already live: nothing to do.
    expect(await materializeWorkspace(TASK)).toEqual({ dir: live, restored: 0 });

    fs.rmSync(live, { recursive: true, force: true });
    archive.failLoad = true;
    await expect(materializeWorkspace(TASK)).rejects.toThrow("connection reset");
    expect(fs.existsSync(live)).toBe(false);
    archive.failLoad = false;
  });

  it.skipIf(asRoot)("keeps the workspace when part of it can't be read (it is archived on a later sweep)", async () => {
    const other = path.join(process.env.AGENT_WORKSPACE_ROOT!, "00000000-0000-4000-8000-0000000000b1");
    fs.mkdirSync(path.join(other, "src"), { recursive: true });
    fs.writeFileSync(path.join(other, "src/App.tsx"), "x");
    fs.writeFileSync(path.join(other, "src/.init.json"), "{}", { mode: 0o000 });
    await expect(archiveWorkspace("00000000-0000-4000-8000-0000000000b1")).rejects.toThrow("EACCES");
    expect(fs.readdirSync(path.join(other, "src")).sort()).toEqual([".init.json", "App.tsx"]);
  });
});
