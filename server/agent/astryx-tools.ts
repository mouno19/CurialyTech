import type Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import { z } from "zod";
import {
  astryxSnapshot, astryxThemes, buildKit, entryText, findEntry, rankAstryx, setupRecipe, STYLEX_COMPILER, suggestions, themeLine,
  type AstryxEntry, type AstryxKind, type AstryxSnapshot, type SetupFramework,
} from "../design-systems/astryx";
import { listWorkspaceTree, readWorkspaceFile, writeWorkspaceFile } from "./sandbox";
import type { ToolContext, ToolOutcome } from "./tools";

// The agent's way into Astryx: `astryx` answers the Astryx CLI's commands from the server's vetted
// snapshot (read-only, in chat and agent mode alike), and `astryx_scaffold` writes a template into
// the workspace (agent mode, never for read-only roles). `astryx check` reads the workspace's own
// files for the setup and the escape hatches Astryx's agent guidance names. See
// server/design-systems/astryx.ts.

const COMMANDS = ["build", "search", "component", "hook", "docs", "template", "themes", "setup", "check"] as const;

export const ASTRYX_SCHEMAS = {
  astryx: z.object({
    command: z.enum(COMMANDS),
    query: z.string().trim().max(500).optional(),
    name: z.string().trim().max(160).optional(),
    section: z.string().trim().max(160).optional(),
    type: z.enum(["component", "hook", "template", "doc", "theme"]).optional(),
    skeleton: z.boolean().optional(),
    full: z.boolean().optional(),
    framework: z.enum(["vite", "next"]).optional(),
    theme: z.string().trim().max(40).optional(),
  }),
  astryx_scaffold: z.object({
    name: z.string().trim().min(2).max(160),
    path: z.string().trim().min(5).max(300),
  }),
};

export type AstryxToolName = keyof typeof ASTRYX_SCHEMAS;
export const ASTRYX_TOOL_NAMES = Object.keys(ASTRYX_SCHEMAS) as AstryxToolName[];

export const ASTRYX_TOOLS: (Anthropic.Tool & { name: AstryxToolName })[] = [
  {
    name: "astryx",
    description: "The Astryx design system (Meta's open-source React 19 components, page templates, blocks, themes and docs, pinned to one release), answering the Astryx CLI's commands from a vetted copy: never write Astryx code from memory. command: build (query: what the page is for) → the page template to start from, blocks and components for what it lacks; search (query, optional type) → ranked components, hooks, templates, docs and themes; component (name) → props, variants, usage and accessibility; hook (name); docs (name: a topic or route such as principles, tokens, tokens/tokens-color, layout/scaffold, use-a-theme; optional section; full) — without a name, the topics; template (name; skeleton: layout only) → a template's source; themes → the themes with accent, surfaces, type and radius; setup (framework vite|next, theme) → exact pinned installs, CSS imports and theme wiring; check → the workspace's Astryx setup, versions and escape hatches.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", enum: [...COMMANDS] },
        query: { type: "string", description: "build and search: what you need, in words" },
        name: { type: "string", description: "component, hook, docs topic or route, template id" },
        section: { type: "string", description: "docs: one section of a topic, by title" },
        type: { type: "string", enum: ["component", "hook", "template", "doc", "theme"], description: "search: one kind only" },
        skeleton: { type: "boolean", description: "template: the layout skeleton with spatial annotations instead of the source" },
        full: { type: "boolean", description: "docs: the whole topic even when it is long" },
        framework: { type: "string", enum: ["vite", "next"], description: "setup: default from the workspace" },
        theme: { type: "string", description: "setup: a theme slug (default neutral)" },
      },
      required: ["command"],
    },
  },
  {
    name: "astryx_scaffold",
    description: "Write an Astryx page or block template (named by astryx build or search) into the workspace at path, a .tsx file. Keep its frame, gap and padding, and replace its content with the user's. Returns the components it composes and the packages to install, pinned. Run astryx setup first in a project without Astryx.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Template id, e.g. dashboard or settings-sidebar" }, path: { type: "string", description: "e.g. src/pages/Dashboard.tsx" } }, required: ["name", "path"] },
  },
];

/** In chat mode (no workspace changes) only the read-only tool is offered. */
export const ASTRYX_READ_TOOLS: AstryxToolName[] = ["astryx"];

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}\n… (cut at ${max.toLocaleString("en-US")} characters${max >= 20_000 ? "" : ": ask for a section"})` : text);
const one = (text: string, max = 170) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const KIND_LABEL: Record<AstryxKind, string> = { component: "component", hook: "hook", page: "page template", block: "block", doc: "docs", theme: "theme" };

function followUp(entry: AstryxEntry) {
  switch (entry.kind) {
    case "component": return `astryx component ${entry.name}`;
    case "hook": return `astryx hook ${entry.name}`;
    case "page": case "block": return `astryx template ${entry.name}`;
    case "doc": return `astryx docs ${entry.name}`;
    default: return "astryx themes";
  }
}

function packagesLine(snapshot: AstryxSnapshot, entry: AstryxEntry) {
  const ranges = snapshot.manifest.templatePackages;
  return (entry.packages ?? []).map(name => `${name}@${ranges[name] ?? "latest"}`);
}

function unknownName(snapshot: AstryxSnapshot, kinds: AstryxKind[], name: string, what: string): ToolOutcome {
  const close = suggestions(snapshot, kinds, name);
  return { ok: false, content: `No ${what} named "${name}" in Astryx ${snapshot.manifest.version}.${close.length ? ` Closest: ${close.join(", ")}.` : ""} astryx search finds things by what they do.`, summary: `Unknown ${what}` };
}

// ---- docs ----

function section(text: string, wanted: string) {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const parts = text.split(/^(?=## )/m);
  const target = slug(wanted);
  return parts.find(part => part.startsWith("## ") && slug(part.slice(3).split("\n")[0]) === target)
    ?? parts.find(part => part.startsWith("## ") && slug(part.slice(3).split("\n")[0]).includes(target)) ?? null;
}

function docsAnswer(snapshot: AstryxSnapshot, input: z.infer<typeof ASTRYX_SCHEMAS.astryx>): ToolOutcome {
  const v = snapshot.manifest.version;
  if (!input.name) {
    const roots = snapshot.entries.filter(entry => entry.kind === "doc" && !entry.name.includes("/"));
    return {
      ok: true,
      summary: `${roots.length} topics`,
      content: [`Astryx ${v} docs. Read one: astryx docs <name> (then a section, or a child route such as layout/scaffold).`, "", ...roots.map(entry => `${entry.name} — ${one(entry.description, 200)}${entry.children?.length ? ` (${entry.children.length} inside)` : ""}`)].join("\n"),
    };
  }
  const entry = findEntry(snapshot, "doc", input.name);
  if (!entry) return unknownName(snapshot, ["doc"], input.name, "docs topic");
  const full = entryText(snapshot, entry.file) ?? "";
  const children = (entry.children ?? []).map(route => snapshot.entries.find(item => item.kind === "doc" && item.name === route)).filter((item): item is AstryxEntry => Boolean(item));
  const childLines = children.length ? ["", "Inside (astryx docs <route>):", ...children.map(child => `${child.name} — ${one(child.description, 180)}`)] : [];
  if (input.section) {
    const part = section(full, input.section);
    if (!part) return { ok: false, content: `No section "${input.section}" in ${entry.name}. Sections: ${(entry.sections ?? []).join(" · ") || "none (read the whole topic)"}.`, summary: "Unknown section" };
    return { ok: true, content: clip(part.trim(), 24_000), summary: `${entry.name} · ${input.section}` };
  }
  const text = (entry.dense && !input.full ? entryText(snapshot, entry.dense) : null) ?? full;
  if (input.full || text.length <= 9_000 || !entry.sections?.length) return { ok: true, content: clip(`${text.trim()}${childLines.join("\n")}`, 30_000), summary: `${entry.name} (${text.length} chars)` };
  const intro = text.split(/^## /m)[0].trim();
  return {
    ok: true,
    summary: `${entry.name}: ${entry.sections.length} sections`,
    content: [clip(intro, 3_000), "", `Sections (astryx docs name=${entry.name} section=<title>; full: true for all ${text.length.toLocaleString("en-US")} characters):`, ...entry.sections.map(title => `- ${title}`), ...childLines].join("\n"),
  };
}

// ---- build ----

function buildAnswer(snapshot: AstryxSnapshot, idea: string, mode: "agent" | "chat"): ToolOutcome {
  const kit = buildKit(snapshot, idea);
  const lines = [`Build kit for "${idea}" (Astryx ${snapshot.manifest.version})`, "Start from the TEMPLATE, fill it with BLOCKS, and use COMPONENTS only for what is left. Changing a page you already have? Keep it, and use only the blocks and components.", ""];
  if (kit.start) {
    const packages = packagesLine(snapshot, kit.start);
    lines.push(
      "TEMPLATE",
      ...(kit.fallback ? ["No template is this page: start from the app shell and compose the blocks and components below into it."] : []),
      `${kit.start.name} — ${kit.start.title}: ${one(kit.start.description, 260)}`,
      mode === "agent" ? `Scaffold it: astryx_scaffold name=${kit.start.name} path=src/pages/<Page>.tsx, then replace its content; keep its layout and spacing.` : `Read it: astryx template ${kit.start.name} (astryx_scaffold writes it in agent mode).`,
      packages.length ? `It also imports: ${packages.join(", ")}.` : "It needs no packages beyond Astryx.",
      ...(kit.start.stylex ? ["It calls stylex.create() itself: the project needs a StyleX compiler (the scaffold receipt has the lines)."] : []),
      "",
    );
    if (kit.alternatives.length) lines.push("OTHER TEMPLATES (if the layout is wrong)", ...kit.alternatives.map(entry => `${entry.name} — ${one(entry.description, 220)}`), "");
  } else {
    lines.push("No page template matches this idea: compose it from blocks and components below inside the frame (AppShell, Layout). astryx search lists more.", "");
  }
  if (kit.blocks.length) lines.push("BLOCKS for parts the template lacks (astryx template <name> to read one)", ...kit.blocks.map(entry => `${entry.name} — ${one(entry.description, 200)}`), "");
  if (kit.components.length) lines.push("COMPONENTS for what is left (astryx component <name> before using one)", ...kit.components.map(entry => `${entry.name} — ${one(entry.description, 200)}`), "");
  lines.push(`frame: ${kit.frame.join(", ")}`, `foundation: ${kit.foundation.join(", ")}`);
  return { ok: true, content: lines.join("\n"), summary: kit.start ? `start from ${kit.start.name}` : "no template matched" };
}

// ---- check ----

type Finding = { level: "fix" | "improve" | "note"; text: string };

const UI_FILE = /\.(tsx|jsx)$/;
const STYLE_FILE = /\.(css|scss)$/;
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.[^/]+)\/|\.(test|spec|stories)\.[a-z]+$/i;
const MAX_CHECK_FILES = 60;

function exactVersion(spec: unknown) {
  return typeof spec === "string" ? spec.replace(/^[\^~=v]/, "").trim() : "";
}

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

/** Comments and string literals blanked out (same length), so code checks don't fire on prose. */
function codeOnly(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, match => match.replace(/[^\n]/g, " "));
}

export function checkWorkspace(root: string, snapshot: AstryxSnapshot): { findings: Finding[]; files: number; usesAstryx: boolean } {
  const findings: Finding[] = [];
  const v = snapshot.manifest.version;
  let tree: ReturnType<typeof listWorkspaceTree> = [];
  try { tree = listWorkspaceTree(root, ".", 6, 3000); } catch { /* empty */ }
  const files = tree.filter(entry => entry.type === "file" && !SKIP.test(entry.path)).map(entry => entry.path);
  const read = (file: string) => { try { const result = readWorkspaceFile(root, file); return result.exists ? result.content : null; } catch { return null; } };

  // Packages: one release for every @astryxdesign package, React 19, the StyleX peer.
  const manifests = files.filter(file => file.endsWith("package.json")).sort((a, b) => a.split("/").length - b.split("/").length).slice(0, 4);
  let usesAstryx = false;
  for (const file of manifests) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    try { pkg = JSON.parse(read(file) ?? "{}"); } catch { findings.push({ level: "fix", text: `${file} is not valid JSON.` }); continue; }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const astryx = Object.entries(deps).filter(([name]) => name.startsWith("@astryxdesign/"));
    if (deps.astryx) findings.push({ level: "fix", text: `${file} depends on the unscoped package "astryx", which is not Astryx: remove it (the design system is @astryxdesign/core).` });
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) if (/\b(npx|pnpx|bunx|dlx)\s+(-y\s+)?astryx\b/.test(script)) findings.push({ level: "fix", text: `${file} script "${name}" runs the unscoped astryx package: remove it.` });
    if (!astryx.length) continue;
    usesAstryx = true;
    const versions = new Set(astryx.map(([, spec]) => exactVersion(spec)));
    if (versions.size > 1) findings.push({ level: "fix", text: `${file}: @astryxdesign packages at different releases (${astryx.map(([name, spec]) => `${name}@${spec}`).join(", ")}). A theme names the exact Core release it works with: install them all at one version.` });
    const loose = astryx.filter(([, spec]) => /^[\^~]|^(latest|\*|next|canary)$/.test(String(spec)));
    if (loose.length) findings.push({ level: "improve", text: `${file}: pin ${loose.map(([name]) => name).join(", ")} to an exact version (npm install --save-exact …@${v}): Astryx is in beta and patch releases change APIs.` });
    const used = [...versions][0];
    if (versions.size === 1 && used && used !== v) findings.push({ level: "note", text: `${file} uses Astryx ${used}; these docs describe ${v}. Check props against the installed version, or move every @astryxdesign package to ${v}.` });
    if (!deps["@astryxdesign/core"]) findings.push({ level: "fix", text: `${file}: @astryxdesign/core is missing.` });
    if (!deps["@stylexjs/stylex"]) findings.push({ level: "fix", text: `${file}: @stylexjs/stylex (a peer of @astryxdesign/core) is missing: npm install --save-exact @stylexjs/stylex@${snapshot.manifest.install["@stylexjs/stylex"]}.` });
    for (const peer of ["react", "react-dom"]) {
      const major = Number(/(\d+)/.exec(String(deps[peer] ?? ""))?.[1] ?? 0);
      if (!deps[peer]) findings.push({ level: "fix", text: `${file}: ${peer} is missing (Astryx needs React 19).` });
      else if (major && major < 19) findings.push({ level: "fix", text: `${file}: ${peer}@${deps[peer]}: Astryx needs React 19 or later.` });
    }
    if (!astryx.some(([name]) => name.startsWith("@astryxdesign/theme-"))) findings.push({ level: "improve", text: `${file}: no theme package. Every app gets a theme: astryx themes, then astryx setup.` });
    for (const [name] of astryx) if (/^@astryxdesign\/(lab|charts|vega)$/.test(name)) findings.push({ level: "fix", text: `${file}: ${name} has no stable release (canary or internal only): use @astryxdesign/core components, or a chart library inside Card.` });
  }
  if (!usesAstryx) return { findings, files: 0, usesAstryx };

  // Sources: the CSS layers, the theme at the root, and the escape hatches.
  const sources = files.filter(file => UI_FILE.test(file) || STYLE_FILE.test(file) || /\.(ts|js|mjs)$/.test(file)).slice(0, 600);
  const exports = new Set([...(snapshot.manifest.exports ?? []).map(entry => `@astryxdesign/core/${entry}`), ...snapshot.entries.filter(entry => entry.import).map(entry => entry.import as string)]);
  let reset = -1;
  let base = -1;
  let themeCss = false;
  let themeRoot = false;
  let checked = 0;
  const hatches: string[] = [];
  for (const file of sources) {
    const text = read(file);
    if (text === null || text.length > 400_000) continue;
    if (STYLE_FILE.test(file)) {
      const r = text.indexOf("@astryxdesign/core/reset.css");
      const a = text.indexOf("@astryxdesign/core/astryx.css");
      if (r >= 0) reset = r;
      if (a >= 0) base = a;
      if (r >= 0 && a >= 0 && r > a) findings.push({ level: "fix", text: `${file}: reset.css must come before astryx.css (the cascade layers depend on the order).` });
      if (/@astryxdesign\/theme-[a-z0-9-]+\/theme\.css/.test(text)) themeCss = true;
      const apply = /@apply\b/.exec(text);
      if (apply) hatches.push(`${file}:${lineOf(text, apply.index)} @apply`);
      continue;
    }
    if (/@astryxdesign\/theme-[a-z0-9-]+\/theme\.css|\.\/themes?\/[^'"]+\.css/.test(text)) themeCss = true;
    if (/from\s+['"]@astryxdesign\/core\/theme['"]/.test(text) && /<Theme\b/.test(text)) themeRoot = true;
    if (!UI_FILE.test(file) || !/@astryxdesign\//.test(text)) continue;
    if (checked++ >= MAX_CHECK_FILES) continue;
    const code = codeOnly(text);
    // A scaffolded template keeps its own markup: only what changed since it was scaffolded counts.
    const scaffolded = /Scaffolded from the Astryx template "([^"]+)"/.exec(text.slice(0, 400))?.[1];
    const template = scaffolded ? findEntry(snapshot, "template", scaffolded) : null;
    const baseline = new Set((template ? entryText(snapshot, template.file) ?? "" : "").split("\n").map(line => line.trim()).filter(Boolean));
    const lineAt = (index: number) => { const end = text.indexOf("\n", index); return text.slice(text.lastIndexOf("\n", index - 1) + 1, end < 0 ? text.length : end).trim(); };
    // Outside comments (code has them blanked), and not a line the template itself has.
    const fresh = (index: number) => code[index] !== " " && !baseline.has(lineAt(index));
    for (const match of code.matchAll(/from\s+['"](@astryxdesign\/core(?:\/[^'"]*)?)['"]/g)) {
      const spec = match[1];
      const at = `${file}:${lineOf(code, match.index ?? 0)}`;
      if (spec === "@astryxdesign/core") findings.push({ level: "improve", text: `${at}: import each component from its own entry (the path astryx component <Name> prints), not the package root.` });
      else if (/\/(dist|src|lib)\//.test(`${spec}/`)) findings.push({ level: "fix", text: `${at}: ${spec} reaches into the package's files: use its public entry.` });
      else if (!exports.has(spec) && !(snapshot.manifest.exports === undefined && /^@astryxdesign\/core\/(theme|Link|Icon|Layout|Text|Hooks|utils)(\/|$)/.test(spec))) findings.push({ level: "fix", text: `${at}: ${spec} is not an entry of @astryxdesign/core ${v}. astryx search finds the right one.` });
    }
    const tags = [...code.matchAll(/<(div|span)\b/g)].filter(match => fresh(match.index ?? 0));
    if (tags.length) hatches.push(`${file}: ${tags.length} raw <${[...new Set(tags.map(tag => tag[1]))].join("/")}> (lines ${tags.slice(0, 4).map(tag => lineOf(code, tag.index ?? 0)).join(", ")}${tags.length > 4 ? ", …" : ""})`);
    // A quoted colour literal ('#0b5fff'), not an issue number in prose ("PR #1234").
    const hexes = [...text.matchAll(/['"`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})['"`]/g)].filter(match => fresh(match.index ?? 0));
    if (hexes.length) hatches.push(`${file}: ${hexes.length} hex color${hexes.length > 1 ? "s" : ""} (line ${lineOf(code, hexes[0].index ?? 0)})`);
    const px = [...code.matchAll(/\b\d+(\.\d+)?px\b/g)].filter(match => fresh(match.index ?? 0));
    if (px.length) hatches.push(`${file}: ${px.length} px value${px.length > 1 ? "s" : ""} (line ${lineOf(code, px[0].index ?? 0)})`);
    const cssImports = [...code.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].filter(match => !/@astryxdesign\//.test(match[1]));
    if (cssImports.length) hatches.push(`${file}: imports ${cssImports.map(match => match[1]).join(", ")}`);
  }
  if (reset < 0 || base < 0) findings.push({ level: "fix", text: "No stylesheet imports @astryxdesign/core/reset.css and @astryxdesign/core/astryx.css (in that order): components render unstyled. astryx setup has the lines." });
  if (!themeCss) findings.push({ level: "fix", text: "No theme stylesheet is loaded (@astryxdesign/theme-<slug>/theme.css, usually through src/astryx-themes.ts): astryx setup." });
  if (!themeRoot) findings.push({ level: "fix", text: "No <Theme> from @astryxdesign/core/theme wraps the app: astryx setup step 4." });
  if (hatches.length) findings.push({ level: "improve", text: `Escape hatches — replace each with the component (VStack, HStack, Grid, Card, Text…) or a token (spacing props, --color-*, --radius-*) unless it is deliberate:\n  ${hatches.slice(0, 14).join("\n  ")}${hatches.length > 14 ? `\n  … ${hatches.length - 14} more` : ""}` });
  return { findings, files: checked, usesAstryx };
}

function checkAnswer(root: string, snapshot: AstryxSnapshot): ToolOutcome {
  const { findings, files, usesAstryx } = checkWorkspace(root, snapshot);
  if (!usesAstryx) return { ok: true, content: `No package.json in the workspace depends on @astryxdesign/core yet.${findings.length ? `\n${findings.map(item => `[${item.level}] ${item.text}`).join("\n")}` : ""} astryx setup has the steps.`, summary: "Astryx not installed" };
  const order = { fix: 0, improve: 1, note: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const fixes = findings.filter(item => item.level === "fix").length;
  return {
    ok: true,
    content: sorted.length
      ? clip(`Astryx check (${files} UI files, Astryx ${snapshot.manifest.version}): ${fixes} to fix, ${findings.length - fixes} to weigh.\n${sorted.map(item => `[${item.level}] ${item.text}`).join("\n")}`, 6_000)
      : `Astryx check (${files} UI files): setup, versions and sources look right. Build the project and run test_preview_visual.`,
    summary: sorted.length ? `${fixes} fix · ${findings.length - fixes} other` : "clean",
  };
}

// ---- scaffold ----

const MARKER = "Scaffolded from the Astryx template";

function nearestPackage(root: string, file: string) {
  const parts = file.split("/").slice(0, -1);
  for (let depth = parts.length; depth >= 0; depth--) {
    const candidate = [...parts.slice(0, depth), "package.json"].join("/");
    try {
      const found = readWorkspaceFile(root, candidate);
      if (found.exists) return { file: candidate, pkg: JSON.parse(found.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } };
    } catch { /* keep looking */ }
  }
  return null;
}

function scaffold(snapshot: AstryxSnapshot, input: z.infer<typeof ASTRYX_SCHEMAS.astryx_scaffold>, ctx: ToolContext): ToolOutcome {
  if (ctx.readOnly) return { ok: false, content: "This role is read-only: the Engineer scaffolds templates. Name the template in your plan.", summary: "Read-only role" };
  const entry = findEntry(snapshot, "template", input.name);
  if (!entry) return unknownName(snapshot, ["page", "block"], input.name, "template");
  if (entry.unpublished?.length) return { ok: false, content: `${entry.name} imports ${entry.unpublished.join(", ")}, which has no stable release: pick another template (astryx build).`, summary: "Needs an unpublished package" };
  const target = input.path.replace(/^\.?\/+/, "");
  if (!/\.tsx$/.test(target) || /(^|\/)(node_modules|dist|build)\//.test(target) || target.split("/").includes("..")) {
    return { ok: false, content: "path must be a .tsx file in the project's sources (templates are TypeScript; Vite and Next.js build .tsx without extra setup), e.g. src/pages/Dashboard.tsx.", summary: "Bad path" };
  }
  const source = entryText(snapshot, entry.file);
  if (!source) return { ok: false, content: `The snapshot has no source for ${entry.name}.`, summary: "Missing source" };
  const header = `// ${MARKER} "${entry.name}" (v${snapshot.manifest.version}, MIT, github.com/meta/astryx): replace its content, keep its layout and spacing.\n`;
  const content = `${header}${source}`;
  let before: ReturnType<typeof readWorkspaceFile>;
  try { before = readWorkspaceFile(ctx.root, target); } catch (error) { return { ok: false, content: error instanceof Error ? error.message : String(error), summary: "Bad path" }; }
  if (before.exists && !before.content.slice(0, 400).includes(MARKER)) {
    return { ok: false, content: `${before.relative} already exists and is not a scaffold: choose another path, or edit that file yourself (read it first).`, summary: "File exists" };
  }
  const previous = before.exists ? before.content : "";
  const written = writeWorkspaceFile(ctx.root, target, content);
  let added = 0;
  let removed = 0;
  for (const change of diffLines(previous, content)) { if (change.added) added += change.count ?? 0; if (change.removed) removed += change.count ?? 0; }
  const cap = 256 * 1024;
  ctx.emit({ type: "file_change", callId: ctx.callId, path: written.relative, kind: before.exists ? "modify" : "create", before: previous.slice(0, cap), after: content.slice(0, cap), bytesBefore: Buffer.byteLength(previous), bytesAfter: Buffer.byteLength(content), added, removed, truncated: previous.length > cap || content.length > cap });
  ctx.onFileChange(written.relative);

  // What the project still has to install for it, pinned.
  const v = snapshot.manifest.version;
  const found = nearestPackage(ctx.root, written.relative);
  const deps = { ...found?.pkg.dependencies, ...found?.pkg.devDependencies };
  const base = ["@astryxdesign/core", "@stylexjs/stylex", "react", "react-dom"].filter(name => !deps[name]).map(name => `${name}@${snapshot.manifest.install[name]}`);
  const extra = packagesLine(snapshot, entry).filter(spec => !deps[spec.slice(0, spec.lastIndexOf("@"))]);
  const hasTheme = Object.keys(deps).some(name => name.startsWith("@astryxdesign/theme-"));
  const lines = [
    `Wrote ${written.relative} from the ${KIND_LABEL[entry.kind]} "${entry.name}" (${entry.title}). It composes: ${(entry.components ?? []).slice(0, 24).join(", ") || "core primitives"}.`,
    entry.kind === "page" ? "Templates are content only: put it inside your app chrome (AppShell with TopNav or SideNav; astryx component AppShell), export it from your router, and replace every sample text, number and image with the user's." : "Place it where the page needs it and replace its sample content.",
    base.length ? `Install first (pinned): npm install --save-exact ${base.join(" ")}${hasTheme ? "" : ` @astryxdesign/theme-neutral@${v}`}, then astryx setup for the CSS and the theme.` : hasTheme ? "" : `No theme package yet: astryx themes, then astryx setup.`,
    extra.length ? `It also imports: npm install ${extra.join(" ")}` : "",
    entry.stylex && !deps["@stylexjs/unplugin"] ? `This template calls stylex.create() itself, so the build needs a StyleX compiler (without one the page throws "Unexpected 'stylex.create' call at runtime"): ${STYLEX_COMPILER.install}; ${STYLEX_COMPILER.config}. Point it at your own sources only, never at node_modules/@astryxdesign.` : "",
    entry.demoMedia ? `${entry.demoMedia} demo image or video reference${entry.demoMedia > 1 ? "s were" : " was"} replaced with placeholders: put the user's media there.` : "",
    found ? "" : "No package.json found above it: create the project first (astryx setup).",
  ].filter(Boolean);
  return { ok: true, content: lines.join("\n"), summary: `${entry.name} → ${written.relative}` };
}

// ---- Installs that would fetch the unscoped package ----

const INSTALL = /(^|[\s;&|()])(npm\s+(i|install|ci)|pnpm\s+(i|install)|yarn(\s+install)?|bun\s+(i|install))(?=$|[\s;&|)])/;

/**
 * Why an install must not run: a package.json in the workspace depends on the unscoped `astryx`
 * package (not Astryx), so the install would fetch and run it. null when none does.
 */
export function unscopedAstryxDependency(root: string, command: string): string | null {
  if (!INSTALL.test(command)) return null;
  let tree: ReturnType<typeof listWorkspaceTree> = [];
  try { tree = listWorkspaceTree(root, ".", 4, 1500); } catch { return null; }
  for (const entry of tree) {
    if (entry.type !== "file" || !entry.path.endsWith("package.json") || SKIP.test(entry.path)) continue;
    try {
      const found = readWorkspaceFile(root, entry.path);
      if (!found.exists) continue;
      const pkg = JSON.parse(found.content) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        if (pkg[field] && Object.prototype.hasOwnProperty.call(pkg[field], "astryx")) {
          return `Not run: ${entry.path} lists the unscoped package "astryx" in ${field}. That npm package is unrelated to the Astryx design system (@astryxdesign/core), so installing would run someone else's code. Remove it from ${entry.path}, then install again.`;
        }
      }
    } catch { /* not JSON: the install reports it */ }
  }
  return null;
}

// ---- The tools ----

function defaultFramework(root: string): SetupFramework {
  try {
    const pkg = readWorkspaceFile(root, "package.json");
    if (pkg.exists && /"next"\s*:/.test(pkg.content)) return "next";
  } catch { /* no project yet */ }
  return "vite";
}

export async function runAstryxTool(name: AstryxToolName, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const snapshot = astryxSnapshot();
  if (!snapshot) return { ok: false, content: "Astryx isn't available on this server.", summary: "Unavailable" };
  if (name === "astryx_scaffold") return scaffold(snapshot, rawInput as z.infer<typeof ASTRYX_SCHEMAS.astryx_scaffold>, ctx);
  const input = rawInput as z.infer<typeof ASTRYX_SCHEMAS.astryx>;
  const v = snapshot.manifest.version;
  const mode = ctx.mode === "chat" ? "chat" : "agent";
  const needs = (field: "query" | "name") => ({ ok: false, content: `astryx ${input.command} needs ${field}.`, summary: `No ${field}` });

  switch (input.command) {
    case "build":
      return input.query || input.name ? buildAnswer(snapshot, (input.query || input.name)!, mode) : needs("query");
    case "search": {
      const query = input.query || input.name;
      if (!query) return needs("query");
      const kinds: AstryxKind[] | undefined = input.type === "template" ? ["page", "block"] : input.type ? [input.type] : undefined;
      const results = rankAstryx(snapshot, query, { kinds, limit: 12 });
      if (!results.length) return { ok: true, content: `Nothing in Astryx ${v} matches "${query}". Try other words, or astryx build for a page.`, summary: "No results" };
      return { ok: true, summary: `${results.length} results`, content: [`Results for "${query}" (Astryx ${v}):`, ...results.map(({ entry }) => `[${KIND_LABEL[entry.kind]}] ${entry.name}${entry.title !== entry.name && entry.kind !== "component" ? ` (${entry.title})` : ""} — ${one(entry.description)} → ${followUp(entry)}`)].join("\n") };
    }
    case "component":
    case "hook": {
      if (!input.name) return needs("name");
      const entry = findEntry(snapshot, input.command, input.name);
      if (!entry) return unknownName(snapshot, [input.command], input.name, input.command);
      const text = entryText(snapshot, entry.file);
      if (!text) return { ok: false, content: `The snapshot has no docs for ${entry.name}.`, summary: "Missing docs" };
      return { ok: true, content: clip(text.trim(), 24_000), summary: `${entry.name} (${text.length} chars)` };
    }
    case "docs":
      return docsAnswer(snapshot, input);
    case "template": {
      if (!input.name) return needs("name");
      const entry = findEntry(snapshot, "template", input.name);
      if (!entry) return unknownName(snapshot, ["page", "block"], input.name, "template");
      if (input.skeleton && entry.skeleton) return { ok: true, content: entryText(snapshot, entry.skeleton) ?? "", summary: `${entry.name} skeleton` };
      const source = entryText(snapshot, entry.file) ?? "";
      const packages = packagesLine(snapshot, entry);
      return {
        ok: true,
        summary: `${entry.name} (${source.length} chars)`,
        content: [`${entry.title} · ${entry.name} · ${KIND_LABEL[entry.kind]}${entry.category ? ` · ${entry.category}` : ""}`, entry.description, `Composes: ${(entry.components ?? []).join(", ") || "core primitives"}${packages.length ? ` · also imports ${packages.join(", ")}` : ""}${entry.stylex ? " · calls stylex.create(): needs a StyleX compiler" : ""}${entry.unpublished?.length ? ` · needs ${entry.unpublished.join(", ")} (no stable release: don't use)` : ""}`,
          mode === "agent" ? `astryx_scaffold name=${entry.name} path=<file>.tsx writes it into the workspace.${entry.skeleton ? " skeleton: true shows the layout only." : ""}` : "", "", clip(source, 40_000)].filter(line => line !== "").join("\n"),
      };
    }
    case "themes": {
      const themes = astryxThemes(snapshot);
      return { ok: true, summary: `${themes.length} themes`, content: [`Astryx ${v} themes (package @astryxdesign/theme-<slug>@${v}). Pick the base closest to the direction's mood, contrast and type, then derive the direction from it with defineTheme (astryx setup, step 5; astryx docs author-a-theme):`, ...themes.map(themeLine)].join("\n") };
    }
    case "setup": {
      const slug = (input.theme || input.name || "neutral").toLowerCase().replace(/^@astryxdesign\/theme-/, "");
      const recipe = setupRecipe(snapshot, input.framework ?? defaultFramework(ctx.root), slug);
      return recipe ? { ok: true, content: recipe, summary: `setup · ${slug}` } : { ok: false, content: `No theme "${slug}". Themes: ${astryxThemes(snapshot).map(theme => theme.slug).join(", ")}.`, summary: "Unknown theme" };
    }
    case "check":
      return checkAnswer(ctx.root, snapshot);
  }
}
