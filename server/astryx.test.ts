import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentEventBody } from "@shared/agent";
import {
  ASTRYX_DIR, astryxCommandRefusal, astryxContext, astryxFit, astryxSnapshot, astryxThemes, buildKit, entryText, findEntry, rankAstryx, setupRecipe,
} from "./design-systems/astryx";
import { ASTRYX_SCHEMAS, checkWorkspace, runAstryxTool, unscopedAstryxDependency } from "./agent/astryx-tools";
import { buildBrief, renderBrief } from "./agent/design/brief";
import { toolsFor } from "./agent/tools";

// Astryx on the real snapshot (design-systems/astryx): the snapshot itself, ranking and build kits
// measured against the official CLI's kits, the tools on workspaces of their own, the guard against
// the unrelated unscoped `astryx` npm package, and when a run builds on Astryx at all.

const snapshot = astryxSnapshot()!;
const workspaces: string[] = [];
afterAll(() => { for (const dir of workspaces) fs.rmSync(dir, { recursive: true, force: true }); });

function workspace(files: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-astryx-ws-"));
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
const astryx = (root: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => runAstryxTool("astryx", ASTRYX_SCHEMAS.astryx.parse(input), ctx(root, extra));
const scaffold = (root: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => runAstryxTool("astryx_scaffold", ASTRYX_SCHEMAS.astryx_scaffold.parse(input), ctx(root, extra));

const V = snapshot.manifest.version;
const PKG = (deps: Record<string, string>) => JSON.stringify({ name: "app", private: true, dependencies: deps });
const GOOD_DEPS = { "@astryxdesign/core": V, "@astryxdesign/theme-neutral": V, "@stylexjs/stylex": "0.19.2", react: "19.3.1", "react-dom": "19.3.1" };

describe("the snapshot", () => {
  it("holds every kind the CLI serves, at one release, with its licence and verification", () => {
    expect(snapshot).not.toBeNull();
    expect(V).toMatch(/^\d+\.\d+\.\d+$/);
    expect(snapshot.manifest.cli).toBe(V);
    const counts = snapshot.manifest.counts;
    expect(counts.component).toBeGreaterThan(150);
    expect(counts.page).toBeGreaterThan(50);
    expect(counts.block).toBeGreaterThan(600);
    expect(counts.theme).toBe(7);
    expect(counts.doc).toBeGreaterThan(50);
    for (const [kind, count] of Object.entries(counts)) expect(snapshot.entries.filter(entry => entry.kind === kind)).toHaveLength(count as number);
    expect(fs.readFileSync(path.join(ASTRYX_DIR, "LICENSE"), "utf8")).toMatch(/^MIT License[\s\S]*Meta Platforms/);
    const verified = snapshot.manifest.verification;
    expect(verified.signatures).toBe(verified.packages);
    expect(Object.values(verified.integrity).every(value => value.startsWith("sha512-"))).toBe(true);
    for (const [name, version] of Object.entries(snapshot.manifest.install)) if (name.startsWith("@astryxdesign/")) expect(version).toBe(V);
  });

  it("names only files that exist inside it, and keeps no CLI runner that would fetch the unscoped package", () => {
    for (const entry of snapshot.entries) {
      for (const file of [entry.file, entry.dense, entry.skeleton].filter(Boolean) as string[]) {
        const text = entryText(snapshot, file);
        expect(text, file).toBeTruthy();
      }
    }
    for (const entry of snapshot.entries.filter(item => item.kind === "doc" || item.kind === "component" || item.kind === "hook")) {
      expect(entryText(snapshot, entry.file), entry.file).not.toMatch(/\bnpx\s+(-y\s+)?astryx\b/);
    }
    expect(entryText(snapshot, "../snapshot.json")).toBeNull();
    expect(entryText(snapshot, "components/../../package.json")).toBeNull();
  });

  it("refuses a malformed snapshot rather than serving part of it", () => {
    const dir = workspace({ "snapshot.json": JSON.stringify({ ...snapshot.manifest }), "index.json": JSON.stringify({ version: V, entries: [{ kind: "component", name: "X", title: "X", description: "", keywords: [], file: "../../etc/passwd" }] }) });
    expect(astryxSnapshot(dir)).toBeNull();
  });

  it("carries each theme's tokens and the module `theme add` generates", () => {
    const themes = astryxThemes(snapshot);
    expect(themes.map(theme => theme.slug).sort()).toEqual(["butter", "chocolate", "gothic", "matcha", "neutral", "stone", "y2k"]);
    const neutral = themes.find(theme => theme.slug === "neutral")!;
    expect(neutral.module.source).toMatch(/from "@astryxdesign\/theme-neutral\/built"/);
    expect(neutral.module.source).toMatch(/import "@astryxdesign\/theme-neutral\/theme\.css"/);
    expect(neutral.tokens["--color-accent"]).toHaveProperty("light");
    expect(String(neutral.tokens["--font-family-body"])).toMatch(/Figtree/);
    expect(themes.find(theme => theme.slug === "gothic")!.darkOnly).toBe(true);
  });
});

describe("ranking and build kits", () => {
  it("answers an exact name first and finds things by what they do", () => {
    expect(rankAstryx(snapshot, "Button", { kinds: ["component"] })[0].entry.name).toBe("Button");
    expect(rankAstryx(snapshot, "date range picker", { kinds: ["component"], limit: 3 }).map(item => item.entry.name)).toContain("DateRangeInput");
    expect(rankAstryx(snapshot, "kanban board", { kinds: ["page"] })[0].entry.name).toBe("kanban-board");
    expect(findEntry(snapshot, "doc", "scaffold")?.name).toBe("layout/scaffold");
    expect(findEntry(snapshot, "doc", "tokens-color")?.name).toBe("tokens/tokens-color");
    expect(findEntry(snapshot, "template", "Dashboard")?.name).toBe("dashboard");
  });

  it("starts from a template the official CLI also offers for nearly every idea", () => {
    const kits = JSON.parse(fs.readFileSync(path.join(ASTRYX_DIR, "fixtures/build-kits.json"), "utf8")) as { idea: string; start: string; alternatives: string[]; pages: string[] }[];
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

describe("the astryx tool", () => {
  it("reads a component's docs, and suggests close names for an unknown one", async () => {
    const root = workspace();
    const button = await astryx(root, { command: "component", name: "Button" });
    expect(button.ok).toBe(true);
    expect(button.content).toMatch(/import \{Button\} from '@astryxdesign\/core\/Button'/);
    expect(button.content).toMatch(/## Props/);
    const typo = await astryx(root, { command: "component", name: "Buttn" });
    expect(typo.ok).toBe(false);
    expect(typo.content).toMatch(/Closest: .*Button/);
  });

  it("serves the docs tree: topics, a leaf by its short name, and one section", async () => {
    const root = workspace();
    const topics = await astryx(root, { command: "docs" });
    expect(topics.content).toMatch(/^principles — /m);
    expect(topics.content).toMatch(/^tokens — /m);
    const section = await astryx(root, { command: "docs", name: "getting-started", section: "Add your first component" });
    expect(section.ok).toBe(true);
    expect(section.content).toMatch(/^## Add your first component/);
    const long = await astryx(root, { command: "docs", name: "author-a-theme" });
    expect(long.content).toMatch(/Sections \(astryx docs name=author-a-theme section=<title>/);
    const missing = await astryx(root, { command: "docs", name: "getting-started", section: "Nope" });
    expect(missing.ok).toBe(false);
  });

  it("builds a kit, shows a template and its skeleton, lists themes and gives the pinned setup", async () => {
    const root = workspace();
    const kit = await astryx(root, { command: "build", query: "analytics dashboard" });
    expect(kit.content).toMatch(/^TEMPLATE\ndashboard — /m);
    expect(kit.content).toMatch(/astryx_scaffold name=dashboard/);
    expect(kit.content).toMatch(/recharts@\^3/);
    const source = await astryx(root, { command: "template", name: "dashboard" });
    expect(source.content).toMatch(/from '@astryxdesign\/core\/Layout'/);
    const skeleton = await astryx(root, { command: "template", name: "dashboard", skeleton: true });
    expect(skeleton.content).toMatch(/<Layout/);
    const themes = await astryx(root, { command: "themes" });
    expect(themes.content.split("\n").filter(line => /^[a-z0-9]+ \(/.test(line))).toHaveLength(7);
    const setup = await astryx(root, { command: "setup", theme: "matcha" });
    expect(setup.content).toContain(`npm install --save-exact @astryxdesign/core@${V} @astryxdesign/theme-matcha@${V} @stylexjs/stylex@0.19.2`);
    expect(setup.content).toMatch(/vite@6\.4\.6 @vitejs\/plugin-react@4\.7\.0/);
    expect(setup.content).toMatch(/@astryxdesign\/theme-matcha\/built/);
    expect(setup.content).toMatch(/Never install the unscoped package `astryx`/);
    expect(setupRecipe(snapshot, "next", "neutral")).toMatch(/LinkProvider component=\{Link\}/);
    expect((await astryx(root, { command: "setup", theme: "nope" })).ok).toBe(false);
  });
});

describe("astryx_scaffold", () => {
  it("writes a template with its marker, lists what to install, and never replaces the user's file", async () => {
    const root = workspace({ "package.json": PKG({ react: "19.3.1", "react-dom": "19.3.1" }), "src/pages/Mine.tsx": "export default function Mine() { return null; }\n" });
    const result = await scaffold(root, { name: "dashboard", path: "src/pages/Dashboard.tsx" });
    expect(result.ok).toBe(true);
    const written = fs.readFileSync(path.join(root, "src/pages/Dashboard.tsx"), "utf8");
    expect(written.split("\n")[0]).toMatch(/^\/\/ Scaffolded from the Astryx template "dashboard"/);
    expect(result.content).toContain(`npm install --save-exact @astryxdesign/core@${V} @stylexjs/stylex@0.19.2`);
    expect(result.content).toMatch(/It also imports: npm install .*recharts@\^3/);
    expect(events.some(event => event.type === "file_change")).toBe(true);
    // Scaffolding again over its own copy is fine; over the user's file it is refused.
    expect((await scaffold(root, { name: "settings", path: "src/pages/Dashboard.tsx" })).ok).toBe(true);
    const refused = await scaffold(root, { name: "settings", path: "src/pages/Mine.tsx" });
    expect(refused.ok).toBe(false);
    expect(fs.readFileSync(path.join(root, "src/pages/Mine.tsx"), "utf8")).toMatch(/function Mine/);
  });

  it("refuses read-only roles, other file types, paths outside the sources and unknown templates", async () => {
    const root = workspace({ "package.json": PKG(GOOD_DEPS) });
    expect((await scaffold(root, { name: "dashboard", path: "src/D.tsx" }, { readOnly: true })).summary).toBe("Read-only role");
    expect((await scaffold(root, { name: "dashboard", path: "src/D.jsx" })).ok).toBe(false);
    expect((await scaffold(root, { name: "dashboard", path: "../outside.tsx" })).ok).toBe(false);
    expect((await scaffold(root, { name: "dashboard", path: "node_modules/x/D.tsx" })).ok).toBe(false);
    const unknown = await scaffold(root, { name: "dashbord", path: "src/D.tsx" });
    expect(unknown.ok).toBe(false);
    expect(unknown.content).toMatch(/dashboard/);
  });

  it("names the StyleX compiler for templates that call stylex.create", async () => {
    const stylexTemplate = snapshot.entries.find(entry => entry.kind === "page" && (entry as { stylex?: boolean }).stylex);
    expect(stylexTemplate).toBeTruthy();
    const root = workspace({ "package.json": PKG(GOOD_DEPS) });
    const result = await scaffold(root, { name: stylexTemplate!.name, path: "src/pages/P.tsx" });
    expect(result.content).toMatch(/StyleX/);
  });
});

describe("astryx check", () => {
  const setupFiles = {
    "package.json": PKG(GOOD_DEPS),
    "src/index.css": "@import '@astryxdesign/core/reset.css';\n@import '@astryxdesign/core/astryx.css';\n",
    "src/astryx-themes.ts": "import {neutralTheme as t} from \"@astryxdesign/theme-neutral/built\";\nimport \"@astryxdesign/theme-neutral/theme.css\";\nexport const themes = {neutral: t};\nexport const defaultThemeSlug = \"neutral\";\n",
    "src/main.tsx": "import {Theme} from '@astryxdesign/core/theme';\nimport {themes, defaultThemeSlug} from './astryx-themes';\nimport './index.css';\nexport const root = <Theme theme={themes[defaultThemeSlug]}><div /></Theme>;\n",
  };

  it("passes a correct setup and names the escape hatches in a page", () => {
    const root = workspace({ ...setupFiles, "src/App.tsx": "import {VStack} from '@astryxdesign/core/Layout';\nimport {Button} from '@astryxdesign/core/Button';\nexport default function App() { return <VStack gap={4}><Button label=\"Save\" /></VStack>; }\n" });
    const clean = checkWorkspace(root, snapshot);
    expect(clean.usesAstryx).toBe(true);
    expect(clean.findings.filter(finding => finding.level === "fix")).toEqual([]);
    const messy = workspace({ ...setupFiles, "src/App.tsx": "import {Button} from '@astryxdesign/core/Button';\nimport {Widget} from '@astryxdesign/core/MagicWidget';\nexport default function App() { return <div style={{color: '#ff0000', padding: '12px'}}><span>Hi</span><Button label=\"Go\" /></div>; }\n" });
    const found = checkWorkspace(messy, snapshot).findings;
    expect(found.some(item => item.level === "fix" && /MagicWidget is not an entry/.test(item.text))).toBe(true);
    const hatches = found.find(item => /Escape hatches/.test(item.text))!;
    expect(hatches.level).toBe("improve");
    expect(hatches.text).toMatch(/raw <div\/span>/);
    expect(hatches.text).toMatch(/hex color/);
    expect(hatches.text).toMatch(/px value/);
  });

  it("catches mixed releases, the unscoped package, old React and a missing setup", () => {
    const root = workspace({ "package.json": PKG({ "@astryxdesign/core": "^0.7.12", "@astryxdesign/theme-neutral": V, astryx: "0.0.0", react: "18.3.1", "react-dom": "18.3.1" }) });
    const found = checkWorkspace(root, snapshot).findings.map(item => `${item.level}: ${item.text}`).join("\n");
    expect(found).toMatch(/fix: .*different releases/);
    expect(found).toMatch(/fix: .*unscoped package "astryx"/);
    expect(found).toMatch(/fix: .*react@18\.3\.1: Astryx needs React 19/);
    expect(found).toMatch(/fix: .*@stylexjs\/stylex/);
    expect(found).toMatch(/fix: No stylesheet imports/);
    expect(found).toMatch(/fix: No <Theme>/);
  });

  it("says so when the workspace has no Astryx yet", async () => {
    const result = await astryx(workspace({ "package.json": PKG({ react: "19.3.1" }) }), { command: "check" });
    expect(result.summary).toBe("Astryx not installed");
  });
});

describe("the unscoped astryx package", () => {
  it("refuses running or installing it, and leaves Astryx's own packages and other commands alone", () => {
    for (const command of ["npx astryx init", "npx -y astryx docs", "pnpm dlx astryx", "bunx astryx@latest build", "yarn dlx astryx", "npm exec astryx", "npm exec -- astryx init", "npx -p astryx astryx", "cd app && npx astryx component Button", "npm i astryx", "npm install -D astryx@latest", "yarn add astryx", "pnpm add astryx"]) {
      expect(astryxCommandRefusal(command), command).toMatch(/unrelated/);
    }
    for (const command of ["npm install --save-exact @astryxdesign/core@0.7.16 @astryxdesign/theme-neutral@0.7.16", "npx @astryxdesign/cli@0.7.16 docs", "grep -r astryx src", "cat src/astryx-themes.ts", "ls node_modules/@astryxdesign", "npm run build", "npx astryx-tools"]) {
      expect(astryxCommandRefusal(command), command).toBeNull();
    }
  });

  it("refuses an install while a package.json lists it", () => {
    const root = workspace({ "package.json": PKG({ astryx: "^0.0.0", react: "19.3.1" }) });
    expect(unscopedAstryxDependency(root, "npm install")).toMatch(/package\.json lists the unscoped package "astryx"/);
    expect(unscopedAstryxDependency(root, "cd . && npm ci")).toMatch(/unscoped/);
    expect(unscopedAstryxDependency(root, "npm run build")).toBeNull();
    expect(unscopedAstryxDependency(workspace({ "package.json": PKG(GOOD_DEPS) }), "npm install")).toBeNull();
  });
});

describe("when a run builds on Astryx", () => {
  const intent = (text: string, extra: Partial<{ surface: string; needs: string[]; styles: string[] }> = {}) => ({ ui: true, surface: "general", needs: [], styles: [], original: text.toLowerCase(), latest: text.toLowerCase(), ...extra });
  const empty = { existing: false, framework: null, styling: [], libraries: [] };

  it("recommends it for app surfaces, follows a project that has it, and stays out of brand, other stacks and refusals", () => {
    expect(astryxFit(intent("an analytics dashboard", { surface: "dashboard" }), empty)).toBe("recommended");
    expect(astryxFit(intent("a settings page for our app"), empty)).toBe("recommended");
    expect(astryxFit(intent("a landing page for a coffee brand", { surface: "landing" }), empty)).toBe("none");
    expect(astryxFit(intent("a landing page built with astryx", { surface: "landing" }), empty)).toBe("requested");
    expect(astryxFit(intent("an admin dashboard, no astryx", { surface: "dashboard" }), empty)).toBe("none");
    expect(astryxFit(intent("make the buttons bigger"), { ...empty, existing: true, framework: "React", libraries: ["Astryx"] })).toBe("project");
    expect(astryxFit(intent("a dashboard", { surface: "dashboard" }), { existing: true, framework: "Vue", styling: [], libraries: [] })).toBe("none");
    expect(astryxFit(intent("a dashboard", { surface: "dashboard" }), { existing: true, framework: "React", styling: [], libraries: ["MUI"] })).toBe("none");
    expect(astryxFit(intent("a dashboard with tailwind and shadcn", { surface: "dashboard" }), empty)).toBe("none");
    expect(astryxFit(intent("a single html file dashboard", { surface: "dashboard" }), empty)).toBe("none");
    expect(astryxFit(intent("an anime streaming site", { surface: "media", styles: ["kuro-cinema"] }), empty)).toBe("none");
    expect(astryxFit(intent("an online store", { surface: "storefront" }), empty)).toBe("available");
    expect(astryxFit({ ...intent("a dashboard", { surface: "dashboard" }), ui: false }, empty)).toBe("none");
  });

  it("tells the agent the workflow and the safety rule, and nothing when it doesn't fit", () => {
    const text = astryxContext(snapshot, "recommended", "agent");
    expect(text).toContain(`v${V}`);
    expect(text).toMatch(/astryx build/);
    expect(text).toMatch(/astryx_scaffold/);
    expect(text).toMatch(/Never run `npx astryx`/);
    expect(astryxContext(snapshot, "recommended", "chat")).not.toMatch(/astryx_scaffold/);
    expect(astryxContext(snapshot, "none", "agent")).toBe("");
  });

  it("puts the direction into an Astryx theme in the brief of an app, and leaves a brand page's brief alone", () => {
    const root = workspace();
    const app = buildBrief({ root, original: "Build an analytics dashboard for our SaaS revenue", latest: "Build an analytics dashboard for our SaaS revenue", imageAttached: false })!;
    expect(app.system).toBe("recommended");
    const solo = renderBrief(app, "solo");
    expect(solo).toMatch(/built on the Astryx design system/);
    expect(solo).toMatch(/express it as an Astryx theme/);
    expect(renderBrief(app, "architect")).toMatch(/Design direction and Astryx theme/);
    expect(renderBrief(app, "reviewer")).toMatch(/run astryx check/);
    const brand = buildBrief({ root, original: "Build a landing page for a small coffee roaster", latest: "Build a landing page for a small coffee roaster", imageAttached: false })!;
    expect(brand.system).toBe("none");
    expect(renderBrief(brand, "solo")).not.toMatch(/Astryx/);
  });

  it("offers its tools only to runs it fits: both in agent mode, the docs in chat", () => {
    const names = (opts: { coding: boolean; astryx?: boolean }) => toolsFor({ web: false, eager: false, ...opts }).map(tool => tool.name);
    expect(names({ coding: true, astryx: true })).toEqual(expect.arrayContaining(["astryx", "astryx_scaffold"]));
    expect(names({ coding: false, astryx: true })).toContain("astryx");
    expect(names({ coding: false, astryx: true })).not.toContain("astryx_scaffold");
    expect(names({ coding: true })).not.toContain("astryx");
  });
});

describe("brand surfaces with a form", () => {
  it("leaves a storefront or landing page with a newsletter signup to its own design", () => {
    const empty = { existing: false, framework: null, styling: [], libraries: [] };
    const text = "build a storefront home page for a furniture brand: product grid, story section and newsletter signup";
    expect(astryxFit({ ui: true, surface: "storefront", needs: ["forms", "commerce"], styles: [], original: text, latest: text }, empty)).toBe("available");
    const landing = "a landing page for our app with a sign up form";
    expect(astryxFit({ ui: true, surface: "landing", needs: ["forms"], styles: [], original: landing, latest: landing }, empty)).toBe("none");
  });
});
