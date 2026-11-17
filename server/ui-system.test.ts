import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentEventBody } from "@shared/agent";
import { brandText } from "@shared/brand";
import {
  buildKit, entryText, findEntry, installCommand, packagePath, rankUi, setupRecipe, UI_KIT_URL, UI_SYSTEM_DIR, uiCommandRefusal, uiContext, uiFit, uiSnapshot, uiThemes,
} from "./design-systems/ui-system";
import { uiKitHandler } from "./design-systems/ui-kit-route";
import { checkWorkspace, runUiTool, UI_SCHEMAS, UI_TOOLS, uiDependencyRefusal } from "./agent/ui-system-tools";
import { buildBrief, renderBrief } from "./agent/design/brief";
import { toolsFor } from "./agent/tools";

// Curialy UI on the real snapshot (design-systems/curialy-ui): the snapshot and its repacked packages,
// ranking and build kits measured against the upstream CLI's own kits, the tools on workspaces of
// their own, the package route, the guards against registry look-alikes, when a run builds on the
// system, and the white-label rule: the upstream name appears in nothing the site serves or says.

const LEAK = /astryx|atmeta/i;
const snapshot = uiSnapshot()!;
const workspaces: string[] = [];
afterAll(() => { for (const dir of workspaces) fs.rmSync(dir, { recursive: true, force: true }); });

function workspace(files: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-ui-ws-"));
  workspaces.push(dir);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

let events: AgentEventBody[] = [];
beforeEach(() => { events = []; });
const ctx = (root: string, extra: Record<string, unknown> = {}) => ({ sessionId: "00000000-0000-4000-8000-000000000001", root, callId: "call-1", signal: new AbortController().signal, emit: (event: AgentEventBody) => { events.push(event); }, onFileChange: () => undefined, mode: "agent", ...extra }) as never;
const tool = (root: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => runUiTool("design_system", UI_SCHEMAS.design_system.parse(input), ctx(root, extra));
const scaffold = (root: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => runUiTool("design_template", UI_SCHEMAS.design_template.parse(input), ctx(root, extra));

const V = snapshot.manifest.version;
const url = (name: string) => `${UI_KIT_URL}/${snapshot.manifest.packages[name].file}`;
const PKG = (deps: Record<string, string>) => JSON.stringify({ name: "app", private: true, dependencies: deps });
const GOOD_DEPS = () => ({ "@curialy/ui": url("@curialy/ui"), "@curialy/ui-theme-neutral": url("@curialy/ui-theme-neutral"), "@stylexjs/stylex": "0.19.2", react: "19.3.1", "react-dom": "19.3.1" });

describe("the snapshot", () => {
  it("holds every kind, at one release, with its licence, verification and repacked packages", () => {
    expect(snapshot).not.toBeNull();
    expect(V).toMatch(/^\d+\.\d+\.\d+$/);
    const counts = snapshot.manifest.counts;
    expect(counts.component).toBeGreaterThan(150);
    expect(counts.page).toBeGreaterThan(50);
    expect(counts.block).toBeGreaterThan(600);
    expect(counts.theme).toBe(7);
    expect(counts.doc).toBeGreaterThan(50);
    for (const [kind, count] of Object.entries(counts)) expect(snapshot.entries.filter(entry => entry.kind === kind)).toHaveLength(count as number);
    expect(fs.readFileSync(path.join(UI_SYSTEM_DIR, "LICENSE"), "utf8")).toMatch(/^MIT License[\s\S]*Meta Platforms/);
    expect(snapshot.manifest.verification.signatures).toBe(snapshot.manifest.verification.packages);
    expect(Object.keys(snapshot.manifest.packages).sort()).toEqual(["@curialy/ui", ...uiThemes(snapshot).map(theme => `@curialy/ui-theme-${theme.slug}`)].sort());
    for (const item of Object.values(snapshot.manifest.packages)) {
      const bytes = fs.readFileSync(path.join(UI_SYSTEM_DIR, "packages", item.file));
      expect(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, item.file).toBe(item.integrity);
      expect(item.version).toBe(V);
    }
  });

  it("names only files that exist inside it", () => {
    for (const entry of snapshot.entries) for (const file of [entry.file, entry.dense, entry.skeleton].filter(Boolean) as string[]) expect(entryText(snapshot, file), file).toBeTruthy();
    expect(entryText(snapshot, "../snapshot.json")).toBeNull();
    expect(entryText(snapshot, "components/../../package.json")).toBeNull();
  });

  it("refuses a malformed snapshot rather than serving part of it", () => {
    const dir = workspace({ "snapshot.json": JSON.stringify({ ...snapshot.manifest }), "index.json": JSON.stringify({ version: V, entries: [{ kind: "component", name: "X", title: "X", description: "", keywords: [], file: "../../etc/passwd" }] }) });
    expect(uiSnapshot(dir)).toBeNull();
  });

  it("carries each theme's tokens and its module", () => {
    const themes = uiThemes(snapshot);
    expect(themes.map(theme => theme.slug).sort()).toEqual(["butter", "chocolate", "gothic", "matcha", "neutral", "stone", "y2k"]);
    const neutral = themes.find(theme => theme.slug === "neutral")!;
    expect(neutral.module.file).toBe("src/ui-themes.ts");
    expect(neutral.module.source).toMatch(/from "@curialy\/ui-theme-neutral\/built"/);
    expect(neutral.tokens["--color-accent"]).toHaveProperty("light");
    expect(themes.find(theme => theme.slug === "gothic")!.darkOnly).toBe(true);
  });
});

describe("white label: the upstream name appears nowhere the site serves or says", () => {
  it("is absent from every snapshot file the server reads", () => {
    const served: string[] = [];
    const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else served.push(full); } };
    walk(UI_SYSTEM_DIR);
    const internal = new Set(["README.md", "UPSTREAM.json"].map(file => path.join(UI_SYSTEM_DIR, file)));
    for (const file of served.filter(file => !internal.has(file) && !file.endsWith(".tgz"))) expect(LEAK.test(fs.readFileSync(file, "utf8")), file).toBe(false);
    for (const file of served) expect(LEAK.test(path.relative(UI_SYSTEM_DIR, file)), file).toBe(false);
  });

  it("is absent from every file inside the packages projects install, which keep the MIT licence", () => {
    for (const item of Object.values(snapshot.manifest.packages)) {
      const archive = path.join(UI_SYSTEM_DIR, "packages", item.file);
      const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
      expect(LEAK.test(listing), item.file).toBe(false);
      expect(listing).toMatch(/^package\/LICENSE$/m);
      expect(LEAK.test(execFileSync("tar", ["-xzOf", archive], { encoding: "latin1", maxBuffer: 256 * 1024 * 1024 })), item.file).toBe(false);
      const pkg = JSON.parse(execFileSync("tar", ["-xzOf", archive, "package/package.json"], { encoding: "utf8" }));
      expect(pkg.scripts, item.file).toBeUndefined();
      expect(Object.keys(pkg.peerDependencies ?? {}).some(name => name.startsWith("@curialy/")), item.file).toBe(false);
    }
  });

  it("is absent from the tool definitions, contexts, briefs, recipes and every command's answer", async () => {
    expect(LEAK.test(JSON.stringify(UI_TOOLS))).toBe(false);
    for (const fit of ["project", "requested", "recommended", "available"] as const) for (const mode of ["agent", "chat"] as const) expect(LEAK.test(uiContext(snapshot, fit, mode))).toBe(false);
    for (const theme of uiThemes(snapshot)) for (const framework of ["vite", "next"] as const) expect(LEAK.test(setupRecipe(snapshot, framework, theme.slug)!)).toBe(false);
    const root = workspace({ "package.json": PKG(GOOD_DEPS()) });
    const answers = await Promise.all([
      tool(root, { command: "build", query: "analytics dashboard" }), tool(root, { command: "search", query: "date picker" }), tool(root, { command: "component", name: "Button" }),
      tool(root, { command: "hook", name: "useAnnounce" }), tool(root, { command: "docs" }), tool(root, { command: "docs", name: "getting-started" }), tool(root, { command: "docs", name: "principles" }),
      tool(root, { command: "template", name: "dashboard" }), tool(root, { command: "template", name: "settings", skeleton: true }), tool(root, { command: "themes" }), tool(root, { command: "setup" }), tool(root, { command: "check" }),
      tool(root, { command: "component", name: "Buttn" }), scaffold(root, { name: "kanban-board", path: "src/pages/Board.tsx" }),
    ]);
    for (const answer of answers) expect(LEAK.test(`${answer.content}\n${answer.summary}`), answer.summary).toBe(false);
    expect(LEAK.test(fs.readFileSync(path.join(root, "src/pages/Board.tsx"), "utf8"))).toBe(false);
    for (const text of ["dashboard", "Build an admin dashboard for our SaaS"]) {
      const brief = buildBrief({ root: workspace(), original: text, latest: text, imageAttached: false });
      if (brief) for (const role of ["solo", "architect", "engineer", "reviewer"] as const) expect(LEAK.test(renderBrief(brief, role))).toBe(false);
    }
    for (const command of ["npx astryx init", "npm i @curialy/ui"]) expect(LEAK.test(uiCommandRefusal(command)!)).toBe(false);
    expect(brandText("Built with Astryx (@astryxdesign/core) from astryx.atmeta.com")).not.toMatch(LEAK);
  });
});

describe("ranking and build kits", () => {
  it("answers an exact name first and finds things by what they do", () => {
    expect(rankUi(snapshot, "Button", { kinds: ["component"] })[0].entry.name).toBe("Button");
    expect(rankUi(snapshot, "date range picker", { kinds: ["component"], limit: 3 }).map(item => item.entry.name)).toContain("DateRangeInput");
    expect(rankUi(snapshot, "kanban board", { kinds: ["page"] })[0].entry.name).toBe("kanban-board");
    expect(findEntry(snapshot, "doc", "scaffold")?.name).toBe("layout/scaffold");
    expect(findEntry(snapshot, "doc", "tokens-color")?.name).toBe("tokens/tokens-color");
    expect(findEntry(snapshot, "template", "Dashboard")?.name).toBe("dashboard");
  });

  it("starts from a template the upstream CLI also offers for nearly every idea", () => {
    const kits = JSON.parse(fs.readFileSync(path.join(UI_SYSTEM_DIR, "fixtures/build-kits.json"), "utf8")) as { idea: string; start: string; alternatives: string[]; pages: string[] }[];
    expect(kits.length).toBeGreaterThanOrEqual(40);
    let same = 0;
    let offered = 0;
    for (const kit of kits) {
      const ours = buildKit(snapshot, kit.idea);
      if (ours.start?.name === kit.start) same++;
      if (ours.start && [kit.start, ...kit.alternatives, ...kit.pages].includes(ours.start.name)) offered++;
    }
    // Measured on 0.7.16: 25 of 40 identical, 37 of 40 among the CLI's own candidates.
    expect(same).toBeGreaterThanOrEqual(22);
    expect(offered).toBeGreaterThanOrEqual(34);
  });

  it("falls back to the app shell when no template is the page, and never starts from a showcase", () => {
    const kit = buildKit(snapshot, "user profile page");
    expect(kit.fallback).toBe(true);
    expect(kit.start?.name).toMatch(/^shell-/);
    for (const idea of ["analytics dashboard", "settings page", "ai chat assistant"]) {
      const picked = buildKit(snapshot, idea);
      expect(picked.start?.showcase).toBeFalsy();
      expect(picked.start?.name).not.toBe("theme-showcase");
      expect(picked.blocks.every(block => !block.showcase && !/HookUsage$/.test(block.name))).toBe(true);
    }
  });
});

describe("the design_system tool", () => {
  it("reads a component's docs, and suggests close names for an unknown one", async () => {
    const root = workspace();
    const button = await tool(root, { command: "component", name: "Button" });
    expect(button.ok).toBe(true);
    expect(button.content).toMatch(/import \{Button\} from '@curialy\/ui\/Button'/);
    expect(button.content).toMatch(/## Props/);
    const typo = await tool(root, { command: "component", name: "Buttn" });
    expect(typo.ok).toBe(false);
    expect(typo.content).toMatch(/Closest: .*Button/);
  });

  it("serves the docs tree: topics, a leaf by its short name, and one section", async () => {
    const root = workspace();
    const topics = await tool(root, { command: "docs" });
    expect(topics.content).toMatch(/^principles — /m);
    expect(topics.content).not.toMatch(/^working-with-ai — /m);
    const sectionAnswer = await tool(root, { command: "docs", name: "getting-started", section: "Add your first component" });
    expect(sectionAnswer.ok).toBe(true);
    expect(sectionAnswer.content).toMatch(/^## Add your first component/);
    const long = await tool(root, { command: "docs", name: "author-a-theme" });
    expect(long.content).toMatch(/Sections \(design_system docs name=author-a-theme section=<title>/);
    expect((await tool(root, { command: "docs", name: "getting-started", section: "Nope" })).ok).toBe(false);
  });

  it("builds a kit, shows a template and its skeleton, lists themes and gives the setup from the site", async () => {
    const root = workspace();
    const kit = await tool(root, { command: "build", query: "analytics dashboard" });
    expect(kit.content).toMatch(/^TEMPLATE\ndashboard — /m);
    expect(kit.content).toMatch(/design_template name=dashboard/);
    expect(kit.content).toMatch(/recharts@\^3/);
    expect((await tool(root, { command: "template", name: "dashboard" })).content).toMatch(/from '@curialy\/ui\/Layout'/);
    expect((await tool(root, { command: "template", name: "dashboard", skeleton: true })).content).toMatch(/<Layout/);
    const themes = await tool(root, { command: "themes" });
    expect(themes.content.split("\n").filter(line => /^[a-z0-9]+ \(/.test(line))).toHaveLength(7);
    const setup = await tool(root, { command: "setup", theme: "matcha" });
    expect(setup.content).toContain(`npm install --save-exact ${url("@curialy/ui")} ${url("@curialy/ui-theme-matcha")} @stylexjs/stylex@0.19.2`);
    expect(setup.content).toMatch(/vite@6\.4\.6 @vitejs\/plugin-react@4\.7\.0/);
    expect(setup.content).toMatch(/@import '@curialy\/ui\/styles\.css';/);
    expect(setup.content).toMatch(/never install them from it/);
    expect(setupRecipe(snapshot, "next", "neutral")).toMatch(/LinkProvider component=\{Link\}/);
    expect((await tool(root, { command: "setup", theme: "nope" })).ok).toBe(false);
  });
});

describe("design_template", () => {
  it("writes a template with its marker, says what to install, and never replaces the user's file", async () => {
    const root = workspace({ "package.json": PKG({ react: "19.3.1", "react-dom": "19.3.1" }), "src/pages/Mine.tsx": "export default function Mine() { return null; }\n" });
    const result = await scaffold(root, { name: "dashboard", path: "src/pages/Dashboard.tsx" });
    expect(result.ok).toBe(true);
    const written = fs.readFileSync(path.join(root, "src/pages/Dashboard.tsx"), "utf8");
    expect(written.split("\n")[0]).toMatch(/^\/\/ Scaffolded from the Curialy UI template "dashboard"/);
    expect(written).toMatch(/Copyright \(c\) Meta Platforms/);
    expect(result.content).toContain(`Install first: npm install --save-exact ${url("@curialy/ui")} ${url("@curialy/ui-theme-neutral")}`);
    expect(result.content).toMatch(/It also imports: npm install .*recharts@\^3/);
    expect(events.some(event => event.type === "file_change")).toBe(true);
    expect((await scaffold(root, { name: "settings", path: "src/pages/Dashboard.tsx" })).ok).toBe(true);
    expect((await scaffold(root, { name: "settings", path: "src/pages/Mine.tsx" })).ok).toBe(false);
    expect(fs.readFileSync(path.join(root, "src/pages/Mine.tsx"), "utf8")).toMatch(/function Mine/);
  });

  it("refuses read-only roles, other file types, paths outside the sources and unknown templates", async () => {
    const root = workspace({ "package.json": PKG(GOOD_DEPS()) });
    expect((await scaffold(root, { name: "dashboard", path: "src/D.tsx" }, { readOnly: true })).summary).toBe("Read-only role");
    expect((await scaffold(root, { name: "dashboard", path: "src/D.jsx" })).ok).toBe(false);
    expect((await scaffold(root, { name: "dashboard", path: "../outside.tsx" })).ok).toBe(false);
    expect((await scaffold(root, { name: "dashboard", path: "node_modules/x/D.tsx" })).ok).toBe(false);
    const unknown = await scaffold(root, { name: "dashbord", path: "src/D.tsx" });
    expect(unknown.ok).toBe(false);
    expect(unknown.content).toMatch(/dashboard/);
  });

  it("names the StyleX compiler for templates that call stylex.create", async () => {
    const stylexTemplate = snapshot.entries.find(entry => entry.kind === "page" && entry.stylex);
    expect(stylexTemplate).toBeTruthy();
    const result = await scaffold(workspace({ "package.json": PKG(GOOD_DEPS()) }), { name: stylexTemplate!.name, path: "src/pages/P.tsx" });
    expect(result.content).toMatch(/@stylexjs\/unplugin/);
  });
});

describe("design_system check", () => {
  const setupFiles = () => ({
    "package.json": PKG(GOOD_DEPS()),
    "src/index.css": "@import '@curialy/ui/reset.css';\n@import '@curialy/ui/styles.css';\n",
    "src/ui-themes.ts": "import {neutralTheme as t} from \"@curialy/ui-theme-neutral/built\";\nimport \"@curialy/ui-theme-neutral/theme.css\";\nexport const themes = {neutral: t};\nexport const defaultThemeSlug = \"neutral\";\n",
    "src/main.tsx": "import {Theme} from '@curialy/ui/theme';\nimport {themes, defaultThemeSlug} from './ui-themes';\nimport './index.css';\nexport const root = <Theme theme={themes[defaultThemeSlug]}><div /></Theme>;\n",
  });

  it("passes a correct setup and names the escape hatches in a page", () => {
    const root = workspace({ ...setupFiles(), "src/App.tsx": "import {VStack} from '@curialy/ui/Layout';\nimport {Button} from '@curialy/ui/Button';\nexport default function App() { return <VStack gap={4}><Button label=\"Save\" /></VStack>; }\n" });
    const clean = checkWorkspace(root, snapshot);
    expect(clean.usesSystem).toBe(true);
    expect(clean.findings.filter(finding => finding.level === "fix")).toEqual([]);
    const messy = workspace({ ...setupFiles(), "src/App.tsx": "import {Button} from '@curialy/ui/Button';\nimport {Widget} from '@curialy/ui/MagicWidget';\nexport default function App() { return <div style={{color: '#ff0000', padding: '12px'}}><span>Hi</span><Button label=\"Go\" /></div>; }\n" });
    const found = checkWorkspace(messy, snapshot).findings;
    expect(found.some(item => item.level === "fix" && /MagicWidget is not an entry/.test(item.text))).toBe(true);
    const hatches = found.find(item => /Escape hatches/.test(item.text))!;
    expect(hatches.level).toBe("improve");
    expect(hatches.text).toMatch(/raw <div\/span>/);
    expect(hatches.text).toMatch(/hex color/);
    expect(hatches.text).toMatch(/px value/);
  });

  it("catches registry-sourced or mixed releases, look-alike packages, old React and a missing setup", () => {
    const root = workspace({ "package.json": PKG({ "@curialy/ui": "^0.7.12", "@curialy/ui-theme-neutral": url("@curialy/ui-theme-neutral"), astryx: "0.0.0", react: "18.3.1", "react-dom": "18.3.1" }) });
    const found = checkWorkspace(root, snapshot).findings.map(item => `${item.level}: ${item.text}`).join("\n");
    expect(found).toMatch(/fix: .*would be fetched from the npm registry/);
    expect(found).toMatch(/fix: .*different releases/);
    expect(found).toMatch(/fix: .*look like the design system's but don't come from the site/);
    expect(found).toMatch(/fix: .*react@18\.3\.1: Curialy UI needs React 19/);
    expect(found).toMatch(/fix: .*@stylexjs\/stylex/);
    expect(found).toMatch(/fix: No stylesheet imports/);
    expect(found).toMatch(/fix: No <Theme>/);
    expect(LEAK.test(found)).toBe(false);
  });

  it("says so when the workspace has no Curialy UI yet", async () => {
    expect((await tool(workspace({ "package.json": PKG({ react: "19.3.1" }) }), { command: "check" })).summary).toBe("Curialy UI not installed");
  });
});

describe("packages from the site, never the registry", () => {
  it("refuses look-alikes and registry installs of our names, and leaves the site's URLs and other commands alone", () => {
    for (const command of ["npx astryx init", "npx -y astryx docs", "pnpm dlx astryx", "npm exec -- astryx init", "npx -p astryx astryx", "npm i astryx", "yarn add astryx",
      "npm install @astryxdesign/core @astryxdesign/theme-neutral", "npx @astryxdesign/cli docs", "npm install @curialy/ui", "npm i --save-exact @curialy/ui@0.7.16", "pnpm add @curialy/ui-theme-neutral", "npx @curialy/ui-cli init"]) {
      expect(uiCommandRefusal(command), command).toMatch(/doesn't come from the site/);
    }
    for (const command of [installCommand(snapshot, "neutral")!, "grep -r '@curialy/ui' src", "cat src/ui-themes.ts", "ls node_modules/@curialy/ui", "npm run build", "npx vite build", "npm install recharts@^3.10.1"]) {
      expect(uiCommandRefusal(command), command).toBeNull();
    }
  });

  it("refuses an install while a package.json lists a look-alike or a registry spec of ours", () => {
    expect(uiDependencyRefusal(workspace({ "package.json": PKG({ astryx: "^0.0.0" }) }), "npm install")).toMatch(/not ours/);
    expect(uiDependencyRefusal(workspace({ "package.json": PKG({ "@curialy/ui": "0.7.16" }) }), "cd . && npm ci")).toMatch(/not ours/);
    expect(uiDependencyRefusal(workspace({ "package.json": PKG({ "@curialy/ui": "0.7.16" }) }), "npm run build")).toBeNull();
    expect(uiDependencyRefusal(workspace({ "package.json": PKG(GOOD_DEPS()) }), "npm install")).toBeNull();
  });

  it("serves the listed packages at /ui-kit/ and nothing else", async () => {
    const serve = (file: string, method = "GET") => new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>(resolve => {
      const headers: Record<string, string> = {};
      const chunks: Buffer[] = [];
      let status = 200;
      const res = {
        status(code: number) { status = code; return res; }, type() { return res; }, setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
        send(body: string) { resolve({ status, headers, body: Buffer.from(body) }); }, end() { resolve({ status, headers, body: Buffer.concat(chunks) }); },
        write(chunk: Buffer) { chunks.push(chunk); return true; }, on() { return res; }, once() { return res; }, emit() { return true; }, destroy() { resolve({ status: 500, headers, body: Buffer.alloc(0) }); },
      };
      uiKitHandler({ params: { file }, method } as never, res as never);
    });
    const core = snapshot.manifest.packages["@curialy/ui"];
    expect(packagePath(snapshot, core.file)).toBeTruthy();
    expect(packagePath(snapshot, "../snapshot.json")).toBeNull();
    expect(packagePath(snapshot, "curialy-ui-9.9.9.tgz")).toBeNull();
    const head = await serve(core.file, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("application/gzip");
    expect(Number(head.headers["content-length"])).toBe(core.bytes);
    expect(head.headers["cache-control"]).toMatch(/immutable/);
    expect((await serve("../../etc/passwd")).status).toBe(404);
    expect((await serve("index.json")).status).toBe(404);
  });
});

describe("when a run builds on the design system", () => {
  const intent = (text: string, extra: Partial<{ surface: string; needs: string[]; styles: string[] }> = {}) => ({ ui: true, surface: "general", needs: [], styles: [], original: text.toLowerCase(), latest: text.toLowerCase(), ...extra });
  const empty = { existing: false, framework: null, styling: [], libraries: [] };

  it("recommends it for app surfaces, follows a project that has it, and stays out of brand, other stacks and refusals", () => {
    expect(uiFit(intent("an analytics dashboard", { surface: "dashboard" }), empty)).toBe("recommended");
    expect(uiFit(intent("a settings page for our app"), empty)).toBe("recommended");
    expect(uiFit(intent("a landing page for a coffee brand", { surface: "landing" }), empty)).toBe("none");
    expect(uiFit(intent("a landing page built with curialy ui", { surface: "landing" }), empty)).toBe("requested");
    expect(uiFit(intent("a landing page built with astryx", { surface: "landing" }), empty)).toBe("requested");
    expect(uiFit(intent("an admin dashboard, no curialy ui", { surface: "dashboard" }), empty)).toBe("none");
    expect(uiFit(intent("make the buttons bigger"), { ...empty, existing: true, framework: "React", libraries: ["Curialy UI"] })).toBe("project");
    expect(uiFit(intent("a dashboard", { surface: "dashboard" }), { existing: true, framework: "Vue", styling: [], libraries: [] })).toBe("none");
    expect(uiFit(intent("a dashboard", { surface: "dashboard" }), { existing: true, framework: "React", styling: [], libraries: ["MUI"] })).toBe("none");
    expect(uiFit(intent("a dashboard with tailwind and shadcn", { surface: "dashboard" }), empty)).toBe("none");
    expect(uiFit(intent("a single html file dashboard", { surface: "dashboard" }), empty)).toBe("none");
    expect(uiFit(intent("an anime streaming site", { surface: "media", styles: ["kuro-cinema"] }), empty)).toBe("none");
    expect(uiFit(intent("an online store", { surface: "storefront" }), empty)).toBe("available");
    expect(uiFit({ ...intent("a dashboard", { surface: "dashboard" }), ui: false }, empty)).toBe("none");
    const store = "build a storefront home page for a furniture brand: product grid, story section and newsletter signup";
    expect(uiFit({ ui: true, surface: "storefront", needs: ["forms", "commerce"], styles: [], original: store, latest: store }, empty)).toBe("available");
    expect(uiFit(intent("a landing page for our app with a sign up form", { surface: "landing", needs: ["forms"] }), empty)).toBe("none");
  });

  it("tells the agent the workflow and the package rule, and nothing when it doesn't fit", () => {
    const text = uiContext(snapshot, "recommended", "agent");
    expect(text).toContain(`v${V}`);
    expect(text).toMatch(/design_system build/);
    expect(text).toMatch(/design_template/);
    expect(text).toMatch(/never from the npm registry/);
    expect(text).toMatch(/give it no other name/);
    expect(uiContext(snapshot, "recommended", "chat")).not.toMatch(/design_template/);
    expect(uiContext(snapshot, "none", "agent")).toBe("");
  });

  it("puts the direction into a Curialy UI theme in the brief of an app, and leaves a brand page's brief alone", () => {
    const root = workspace();
    const app = buildBrief({ root, original: "Build an analytics dashboard for our SaaS revenue", latest: "Build an analytics dashboard for our SaaS revenue", imageAttached: false })!;
    expect(app.system).toBe("recommended");
    const solo = renderBrief(app, "solo");
    expect(solo).toMatch(/built on the Curialy UI design system/);
    expect(solo).toMatch(/express it as a Curialy UI theme/);
    expect(renderBrief(app, "architect")).toMatch(/Design direction and Curialy UI theme/);
    expect(renderBrief(app, "reviewer")).toMatch(/run design_system check/);
    const brand = buildBrief({ root, original: "Build a landing page for a small coffee roaster", latest: "Build a landing page for a small coffee roaster", imageAttached: false })!;
    expect(brand.system).toBe("none");
    expect(renderBrief(brand, "solo")).not.toMatch(/Curialy UI/);
  });

  it("offers its tools only to runs it fits: both in agent mode, the docs in chat", () => {
    const names = (opts: { coding: boolean; uiSystem?: boolean }) => toolsFor({ web: false, eager: false, ...opts }).map(item => item.name);
    expect(names({ coding: true, uiSystem: true })).toEqual(expect.arrayContaining(["design_system", "design_template"]));
    expect(names({ coding: false, uiSystem: true })).toContain("design_system");
    expect(names({ coding: false, uiSystem: true })).not.toContain("design_template");
    expect(names({ coding: true })).not.toContain("design_system");
  });
});
