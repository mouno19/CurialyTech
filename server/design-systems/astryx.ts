import fs from "node:fs";
import path from "node:path";
import { tokens as searchTokens } from "../components/search";

// Astryx (github.com/meta/astryx, MIT): Meta's open-source React 19 design system, for the agent.
// The server reads a pinned, vetted snapshot of what the Astryx CLI serves (design-systems/astryx,
// written by scripts/astryx/snapshot.mjs, which runs the CLI once in a no-network jail): component
// and hook docs, the docs tree, page and block templates, and the seven first-party themes. No
// Astryx code runs here, and the task sandboxes can't run the CLI (it needs Node 22.13; they run
// Node 20), so the astryx tools answer its commands from this snapshot. Projects install the
// packages themselves, at the snapshot's exact versions.

export const ASTRYX_DIR = process.env.ASTRYX_DIR || path.resolve(process.cwd(), "design-systems/astryx");
const RECHECK_MS = 60_000;

export type AstryxKind = "component" | "hook" | "page" | "block" | "doc" | "theme";

export type AstryxEntry = {
  kind: AstryxKind;
  name: string;
  title: string;
  description: string;
  keywords: string[];
  category: string | null;
  /** Snapshot-relative path of the entry's text (docs, dense docs, template source, theme facts). */
  file: string;
  group?: string;
  import?: string | null;
  props?: string[];
  /** Docs: child routes and the ## sections of the text. */
  children?: string[];
  sections?: string[];
  /** Docs: a token-efficient variant of the text, when the CLI has one that is materially shorter. */
  dense?: string;
  /** Templates: the components the source composes, the component a block demonstrates, its packages. */
  components?: string[];
  exampleFor?: string | null;
  showcase?: boolean;
  ready?: boolean;
  packages?: string[];
  /** Templates importing an @astryxdesign package that has no stable release (never offered). */
  unpublished?: string[];
  /** External packages the snapshot has no version range for. */
  unpinned?: string[];
  demoMedia?: number;
  skeleton?: string;
  /** The template calls stylex.create() itself: the project needs a StyleX compiler (STYLEX_COMPILER). */
  stylex?: boolean;
};

/** A StyleX compiler for Vite projects (checked in a task sandbox: Node 20, Vite 6, React 19). */
export const STYLEX_COMPILER = {
  install: "npm install -D --save-exact @stylexjs/unplugin@0.19.2 unplugin@2",
  config: "vite.config.ts: import stylex from '@stylexjs/unplugin'; then plugins: [stylex.vite(), react()]",
};

export type AstryxManifest = {
  version: string;
  cli: string;
  generatedAt: string;
  license: string;
  source: string;
  install: Record<string, string>;
  peers: Record<string, string>;
  templatePackages: Record<string, string>;
  frame: string[];
  foundation: string[];
  counts: Partial<Record<AstryxKind, number>>;
  /** @astryxdesign/core's public entries ("Button", "theme", "reset.css"), from its package.json exports. */
  exports?: string[];
  verification: { packages: number; signatures: number; attestations: number; installScripts: string[]; integrity: Record<string, string> };
};

export type ThemeValue = string | { light: string; dark: string };
export type AstryxTheme = {
  slug: string;
  name: string;
  description: string;
  package: string;
  version: string;
  tokens: Record<string, ThemeValue>;
  schemes: string[];
  darkOnly: boolean;
  fonts: string[];
  /** The module `astryx theme add <slug>` generates (src/astryx-themes.ts). */
  module: { file: string; source: string };
};

type Field = { terms: Map<string, number>; length: number; weight: number };
type Prepared = { entry: AstryxEntry; fields: Field[]; key: string; titleKey: string };

export type AstryxSnapshot = {
  dir: string;
  manifest: AstryxManifest;
  entries: AstryxEntry[];
  byKey: Map<string, AstryxEntry>;
  /** Exact names first: "ThemeShowcase" (a block) and "theme-showcase" (a page) share a normalized key. */
  byName: Map<string, AstryxEntry>;
  prepared: Prepared[];
  idf: Map<string, number>;
  averages: number[];
  signature: string;
};

const KINDS: AstryxKind[] = ["component", "hook", "page", "block", "doc", "theme"];
/** Field weights for ranking: what an entry is called counts most, then what it is about. */
const WEIGHTS = { name: 5, title: 3, keywords: 3, category: 2, exampleFor: 2, description: 1, components: 0.4 };
const SAFE_FILE = /^(components|hooks|docs|templates\/(pages|blocks)|themes)\/[A-Za-z0-9._-]+$/;

/** "DateRangeInputWithPresets" → "Date Range Input With Presets"; "layout/side-panels" → "layout side panels". */
export const splitName = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[/_.-]+/g, " ");
const keyOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const entryKey = (kind: AstryxKind | "template", name: string) => `${kind === "page" || kind === "block" ? "template" : kind}:${keyOf(name)}`;

function counts(words: string[]) {
  const map = new Map<string, number>();
  for (const word of words) map.set(word, (map.get(word) ?? 0) + 1);
  return map;
}

function prepare(entry: AstryxEntry): Prepared {
  const field = (text: string, weight: number): Field => {
    const words = searchTokens(text);
    return { terms: counts(words), length: words.length, weight };
  };
  return {
    entry,
    key: keyOf(entry.name),
    titleKey: keyOf(entry.title),
    fields: [
      field(splitName(entry.name), WEIGHTS.name),
      field(entry.title, WEIGHTS.title),
      field(entry.keywords.join(" "), WEIGHTS.keywords),
      field(entry.category ?? "", WEIGHTS.category),
      field(entry.exampleFor ? splitName(entry.exampleFor) : "", WEIGHTS.exampleFor),
      field(entry.description, WEIGHTS.description),
      field((entry.components ?? []).map(splitName).join(" "), WEIGHTS.components),
    ],
  };
}

function validEntry(value: unknown): value is AstryxEntry {
  const entry = value as AstryxEntry;
  return Boolean(entry) && KINDS.includes(entry.kind) && typeof entry.name === "string" && typeof entry.title === "string" && typeof entry.description === "string"
    && Array.isArray(entry.keywords) && typeof entry.file === "string" && SAFE_FILE.test(entry.file);
}

let cached: AstryxSnapshot | null = null;
let cachedDir = "";
let checkedAt = 0;
let warned = false;

/** The snapshot, re-read when its files change; null when there is none (the tools are then not offered). */
export function astryxSnapshot(dir = ASTRYX_DIR): AstryxSnapshot | null {
  const now = Date.now();
  if (cachedDir === dir && now - checkedAt < RECHECK_MS) return cached;
  checkedAt = now;
  cachedDir = dir;
  let signature: string;
  try {
    signature = ["snapshot.json", "index.json"].map(file => { const stat = fs.statSync(path.join(dir, file)); return `${stat.size}:${stat.mtimeMs}`; }).join("|");
  } catch {
    cached = null;
    return null;
  }
  if (cached && cached.signature === signature && cached.dir === dir) return cached;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8")) as AstryxManifest;
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as { version: string; entries: unknown[] };
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || index.version !== manifest.version || !Array.isArray(index.entries)) throw new Error("version mismatch");
    const entries = index.entries.filter(validEntry);
    if (entries.length !== index.entries.length) throw new Error(`${index.entries.length - entries.length} malformed entries`);
    const byKey = new Map<string, AstryxEntry>();
    const byName = new Map<string, AstryxEntry>();
    for (const entry of entries) {
      byName.set(`${entry.kind === "page" || entry.kind === "block" ? "template" : entry.kind}:${entry.name}`, entry);
      if (byKey.has(entryKey(entry.kind, entry.name))) continue;
      byKey.set(entryKey(entry.kind, entry.name), entry);
      // Docs answer to their last route segment too ("principles", "layout/scaffold" → "scaffold") unless taken.
      if (entry.kind === "doc") { const leaf = entry.name.split("/").pop()!; if (!byKey.has(`doc:${keyOf(leaf)}`)) byKey.set(`doc:${keyOf(leaf)}`, entry); }
    }
    const prepared = entries.map(prepare);
    const df = new Map<string, number>();
    for (const item of prepared) for (const term of new Set(item.fields.flatMap(f => [...f.terms.keys()]))) df.set(term, (df.get(term) ?? 0) + 1);
    const total = prepared.length;
    const idf = new Map([...df].map(([term, n]) => [term, Math.log(1 + (total - n + 0.5) / (n + 0.5))]));
    const averages = prepared[0]?.fields.map((_, i) => prepared.reduce((sum, item) => sum + item.fields[i].length, 0) / Math.max(1, total)) ?? [];
    cached = { dir, manifest, entries, byKey, byName, prepared, idf, averages, signature };
    warned = false;
  } catch (error) {
    if (!warned) console.error("[astryx] snapshot unreadable:", error instanceof Error ? error.message : error);
    warned = true;
    cached = null;
  }
  return cached;
}

export const astryxAvailable = () => astryxSnapshot() !== null;

/** An entry's text from the snapshot (only files the index names: nothing from a request reaches a path). */
export function entryText(snapshot: AstryxSnapshot, file: string | undefined): string | null {
  if (!file || !SAFE_FILE.test(file)) return null;
  const full = path.join(snapshot.dir, file);
  if (!full.startsWith(snapshot.dir + path.sep)) return null;
  try { return fs.readFileSync(full, "utf8"); } catch { return null; }
}

export function findEntry(snapshot: AstryxSnapshot, kind: "component" | "hook" | "doc" | "template" | "theme", name: string): AstryxEntry | null {
  const wanted = name.trim().replace(/^\/+|\/+$/g, "");
  return snapshot.byName.get(`${kind}:${wanted}`) ?? snapshot.byKey.get(entryKey(kind, wanted)) ?? null;
}

// ---- Ranking ----------------------------------------------------------------------

export type Ranked = { entry: AstryxEntry; score: number };

/**
 * BM25F over name, title, keywords, category and description, the way the CLI's own search weighs a
 * name above prose; an exact name answers first. Deterministic: equal scores keep the index order.
 */
export function rankAstryx(snapshot: AstryxSnapshot, query: string, opts: { kinds?: AstryxKind[]; limit?: number } = {}): Ranked[] {
  const terms = [...new Set(searchTokens(query))];
  const whole = keyOf(query);
  if (!terms.length && !whole) return [];
  const k1 = 1.2;
  const b = 0.75;
  const results: Ranked[] = [];
  snapshot.prepared.forEach(item => {
    if (opts.kinds && !opts.kinds.includes(item.entry.kind)) return;
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      let weighted = 0;
      item.fields.forEach((field, i) => {
        const tf = field.terms.get(term);
        if (tf) weighted += (field.weight * tf) / (1 - b + (b * field.length) / Math.max(1, snapshot.averages[i] ?? 1));
      });
      if (weighted) { matched++; score += (snapshot.idf.get(term) ?? 0) * ((weighted * (k1 + 1)) / (weighted + k1)); }
    }
    // An entry about more of the request's words beats one about a single word said loudly.
    if (terms.length > 1) score *= 0.5 + (0.5 * matched) / terms.length;
    if (whole && (item.key === whole || item.titleKey === whole)) score += 25;
    else if (whole.length >= 5 && item.key.length >= 5 && (whole.includes(item.key) || item.key.includes(whole))) score += 4;
    // A ready, non-showcase template is what a builder wants; showcases demonstrate every variant at once.
    if ((item.entry.kind === "block" || item.entry.kind === "page") && (item.entry.showcase || item.entry.ready === false || item.entry.unpublished?.length)) score *= 0.5;
    if (score > 0) results.push({ entry: item.entry, score });
  });
  return results.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 10);
}

/** Close names for an unknown one: same prefix or a small edit distance. */
export function suggestions(snapshot: AstryxSnapshot, kind: AstryxKind[], name: string, limit = 5) {
  const wanted = keyOf(name);
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const next = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = next;
      }
    }
    return row[b.length];
  };
  const close = snapshot.entries.filter(entry => kind.includes(entry.kind)).map(entry => ({ entry, d: keyOf(entry.name).startsWith(wanted) || wanted.startsWith(keyOf(entry.name)) ? 0 : distance(wanted, keyOf(entry.name)) }))
    .filter(item => item.d <= Math.max(2, Math.floor(wanted.length / 4))).sort((a, b) => a.d - b.d).slice(0, limit).map(item => item.entry.name);
  return close.length ? close : rankAstryx(snapshot, name, { kinds: kind, limit }).map(item => item.entry.name);
}

// ---- The build kit (the CLI's `astryx build "<idea>"`) -------------------------------------

export type BuildKit = { idea: string; start: AstryxEntry | null; fallback: boolean; alternatives: AstryxEntry[]; blocks: AstryxEntry[]; components: AstryxEntry[]; frame: string[]; foundation: string[] };

/**
 * Start from the page template that matches the idea, fill it with blocks for the parts it lacks,
 * and use components only for what is left: the CLI's build workflow, ranked over the snapshot.
 */
/** Below this, no page template is the page the idea names: start from the app shell and compose blocks (as the CLI does). */
export const PAGE_MATCH = 8;

export function buildKit(snapshot: AstryxSnapshot, idea: string): BuildKit {
  const usable = (entry: AstryxEntry) => entry.ready !== false && !entry.showcase && !entry.unpublished?.length;
  // Pages that demonstrate the system rather than being a product page.
  const notAStart = new Set(["theme-showcase", "blank"]);
  const ranked = rankAstryx(snapshot, idea, { kinds: ["page"], limit: 8 }).filter(item => usable(item.entry) && !notAStart.has(item.entry.name));
  const shell = findEntry(snapshot, "template", /\b(side ?nav|sidebar|side bar|admin|back ?office|console|crm|portal)\b/i.test(idea) ? "shell-side-nav" : "shell-top-nav");
  const matched = ranked.length > 0 && ranked[0].score >= PAGE_MATCH;
  const pages = matched ? ranked.map(item => item.entry) : [...(shell ? [shell] : []), ...ranked.map(item => item.entry).filter(entry => entry !== shell)];
  const start = pages[0] ?? null;
  const covered = new Set([...(start?.components ?? []), ...snapshot.manifest.frame, ...snapshot.manifest.foundation].map(keyOf));
  const blocks: AstryxEntry[] = [];
  const seenFor = new Set<string>();
  const rankedBlocks = rankAstryx(snapshot, idea, { kinds: ["block"], limit: 40 });
  const floor = Math.max(4, (rankedBlocks[0]?.score ?? 0) * 0.35);
  for (const { entry, score } of rankedBlocks) {
    // Sections for the page, not demonstrations of a hook (astryx search still finds those).
    if (!usable(entry) || score < floor || /HookUsage$/.test(entry.name) || /^use[A-Z]/.test(entry.exampleFor ?? "")) continue;
    const owner = keyOf(entry.exampleFor ?? entry.name);
    if (covered.has(owner) || seenFor.has(owner)) continue;
    seenFor.add(owner);
    blocks.push(entry);
    if (blocks.length === 3) break;
  }
  const components = rankAstryx(snapshot, idea, { kinds: ["component"], limit: 20 }).map(item => item.entry).filter(entry => !covered.has(keyOf(entry.name)) && !seenFor.has(keyOf(entry.name))).slice(0, 3);
  return { idea, start, fallback: !matched, alternatives: pages.slice(1, 3), blocks, components, frame: snapshot.manifest.frame, foundation: snapshot.manifest.foundation };
}

// ---- Themes ---------------------------------------------------------------------

export function astryxThemes(snapshot: AstryxSnapshot): AstryxTheme[] {
  return snapshot.entries.filter(entry => entry.kind === "theme").map(entry => {
    try { return JSON.parse(entryText(snapshot, entry.file) ?? "null") as AstryxTheme | null; } catch { return null; }
  }).filter((theme): theme is AstryxTheme => Boolean(theme?.slug && theme.module?.source));
}

const value = (token: ThemeValue | undefined, mode: "light" | "dark" = "light") => (typeof token === "string" ? token : token?.[mode] ?? "");
const family = (stack: string) => stack.split(",")[0]?.replace(/["']/g, "").trim() ?? "";

/** One line per theme, for matching a design direction to its closest base. */
export function themeLine(theme: AstryxTheme) {
  const accent = theme.tokens["--color-accent"];
  const surface = theme.tokens["--color-background-body"];
  const body = family(String(theme.tokens["--font-family-body"] ?? ""));
  const heading = family(String(theme.tokens["--font-family-heading"] ?? ""));
  return `${theme.slug} (${theme.name}${theme.darkOnly ? ", dark only" : ""}): ${theme.description.replace(/\s+/g, " ").slice(0, 160)} Accent ${value(accent)}${typeof accent === "object" ? ` / ${accent.dark} dark` : ""}, page ${value(surface)}${typeof surface === "object" ? ` / ${surface.dark}` : ""}, type ${heading}${body && body !== heading ? ` + ${body}` : ""}, radius ${theme.tokens["--radius-element"] ?? "?"}.`;
}

// ---- Setup ------------------------------------------------------------------------

export type SetupFramework = "vite" | "next";

/** The exact steps to add Astryx to a project in a task sandbox (Node 20: Vite 6 and @vitejs/plugin-react 4). */
export function setupRecipe(snapshot: AstryxSnapshot, framework: SetupFramework, slug: string): string | null {
  const theme = astryxThemes(snapshot).find(item => item.slug === slug);
  if (!theme) return null;
  const v = snapshot.manifest.version;
  const install = [`@astryxdesign/core@${v}`, `${theme.package}@${v}`, `@stylexjs/stylex@${snapshot.manifest.install["@stylexjs/stylex"]}`, `react@${snapshot.manifest.install.react}`, `react-dom@${snapshot.manifest.install["react-dom"]}`];
  const moduleFile = "src/astryx-themes.ts";
  const root = framework === "next"
    ? [
      "src/app/providers.tsx:",
      "```tsx",
      "'use client';",
      "import Link from 'next/link';",
      "import {Theme} from '@astryxdesign/core/theme';",
      "import {LinkProvider} from '@astryxdesign/core/Link';",
      "import {themes, defaultThemeSlug} from '../astryx-themes';",
      "",
      "export function Providers({children}: {children: React.ReactNode}) {",
      "  return <Theme theme={themes[defaultThemeSlug]}><LinkProvider component={Link}>{children}</LinkProvider></Theme>;",
      "}",
      "```",
      "src/app/layout.tsx imports './globals.css' and wraps {children} in <Providers> inside <body>; keep <html lang=\"en\">. Pages that use hooks or event handlers are client components ('use client').",
    ]
    : [
      "src/main.tsx:",
      "```tsx",
      "import {StrictMode} from 'react';",
      "import {createRoot} from 'react-dom/client';",
      "import {Theme} from '@astryxdesign/core/theme';",
      "import {themes, defaultThemeSlug} from './astryx-themes';",
      "import './index.css';",
      "import App from './App';",
      "",
      "createRoot(document.getElementById('root')!).render(",
      "  <StrictMode><Theme theme={themes[defaultThemeSlug]}><App /></Theme></StrictMode>,",
      ");",
      "```",
      "With a router, wrap it in <LinkProvider component={RouterLink}> from '@astryxdesign/core/Link' so Astryx links navigate client-side.",
    ];
  return [
    `Astryx ${v} setup for ${framework === "next" ? "Next.js (App Router)" : "Vite + React 19"} with the ${theme.name} theme. Every @astryxdesign package at exactly ${v} (a theme names the exact Core release it works with).`,
    "",
    "1. Install, pinned:",
    `   npm install --save-exact ${install.join(" ")}`,
    framework === "next"
      ? "   New project: next@16 (Node 20.9 is enough), TypeScript, App Router; don't add Tailwind unless the user asks (Astryx styles everything)."
      : "   New project: this sandbox runs Node 20, so use npm install -D --save-exact vite@6.4.6 @vitejs/plugin-react@4.7.0 typescript (Vite 7+ and plugin-react 5+ need Node 20.19).",
    "   Never install the unscoped package `astryx` or run `npx astryx`: that name belongs to an unrelated npm package.",
    "",
    `2. ${framework === "next" ? "src/app/globals.css" : "src/index.css"}, first lines (cascade layers: reset, then components; the theme's CSS comes in through the module below):`,
    "```css",
    "@import '@astryxdesign/core/reset.css';",
    "@import '@astryxdesign/core/astryx.css';",
    "```",
    "   Put your own CSS after these, inside a later @layer or unlayered, and keep it to page layout the components don't cover. Don't restyle components with CSS: theme tokens and the xstyle/className props do that.",
    "",
    `3. ${moduleFile} (.js in a JavaScript project): the module \`astryx theme add ${slug}\` generates (it imports the built theme, its CSS and its fonts). Write it as is:`,
    "```ts",
    theme.module.source.trimEnd(),
    "```",
    "",
    "4. Wire it once at the root:",
    ...root,
    "",
    "5. The design direction goes into the theme, not into CSS over components. Start from the closest theme (astryx themes), then derive yours:",
    "```ts",
    `import {defineTheme} from '@astryxdesign/core/theme';`,
    `import {themes} from './astryx-themes';`,
    "",
    "export const brandTheme = defineTheme({",
    "  name: 'brand',",
    `  extends: themes['${slug}'],`,
    "  color: {accent: ['#0B5FFF', '#7AA7FF'], neutralStyle: 'cool'},   // [light, dark]: expands accent, surfaces, text and borders together",
    "  typography: {heading: {family: 'Your Display', fallbacks: 'system-ui, sans-serif'}, body: {family: 'Your Text', fallbacks: 'system-ui, sans-serif'}},",
    "  radius: {base: 4, multiplier: 1},   // 0-2: sharper to rounder",
    "  motion: {character: 'crisp'},      // crisp | standard | expressive",
    "});",
    "```",
    `   Pass it to <Theme theme={brandTheme}>. In a Vite single-page app that is complete (the theme's tokens are injected at runtime). Under Next.js server rendering, component overrides would flash on hydration: keep to tokens there, or build the theme with the CLI on a machine with Node 22.13+. Load any font you name (a <link> to the font or @font-face). Check each accent against its text (astryx docs tokens-color).`,
    "",
    "6. Build pages from templates: astryx build \"<what the page is for>\", then astryx_scaffold the template it names. Read astryx component <Name> before using a component's props, and run astryx check before you finish.",
  ].join("\n");
}

// ---- When the agent should build on Astryx ---------------------------------------------------

export type AstryxFit = "project" | "requested" | "recommended" | "available" | "none";

type FitIntent = { ui: boolean; surface: string; needs: string[]; styles: string[]; original: string; latest: string };
type FitFacts = { existing: boolean; framework: string | null; styling: string[]; libraries: string[] };

/** Another component system or styling stack the project uses or the user named: Astryx would fight it. */
const OTHER_SYSTEMS = new Set(["MUI", "Chakra UI", "Mantine", "Headless UI", "Radix UI", "shadcn/ui", "Bootstrap", "Bulma"]);
const REACT_FRAMEWORKS = new Set(["React", "Next.js"]);
const NAMED_OTHER = /\b(tailwind|shadcn|mui|material[- ]ui|chakra|mantine|bootstrap|bulma|daisyui|ant design|antd|vue|nuxt|svelte|sveltekit|angular|solid ?js|astro|htmx|jquery|plain html|vanilla (js|javascript|html|css)|single html file|one html file|no framework|without react|no react)\b/i;
const REFUSED = /\b(no|not|without|don'?t use|do not use|avoid|skip|drop)\s+(?:the\s+)?astryx\b/i;
const MENTIONED = /\bastryx\b/i;
/** App-shaped requests: what Astryx's templates and components are built for. */
const APP_TRAITS = /\b(admin|back[- ]?office|internal tool|crm|erp|saas app|settings|preferences|account page|profile page|sign ?in|sign ?up|log ?in|login|onboarding|wizard|checkout|kanban|inbox|messaging|chat (app|ui|interface)|ai chat|data tables?|crud|form builder|file (explorer|manager|browser)|ide|code editor|incident|console|work items?|ticket|issue tracker|project management|scheduling|calendar app|billing portal|customer portal|developer portal)\b/i;

export function astryxFit(intent: FitIntent, facts: FitFacts): AstryxFit {
  if (!intent.ui) return "none";
  const latest = intent.latest || intent.original;
  if (REFUSED.test(latest) || (REFUSED.test(intent.original) && !MENTIONED.test(latest.replace(REFUSED, "")))) return "none";
  if (facts.libraries.includes("Astryx")) return "project";
  if (MENTIONED.test(`${intent.original}\n${latest}`)) return "requested";
  // Astryx is React 19: an existing project on another framework, component system or styling stack keeps its own.
  if (facts.existing && facts.framework && !REACT_FRAMEWORKS.has(facts.framework)) return "none";
  if (facts.libraries.some(name => OTHER_SYSTEMS.has(name)) || facts.styling.some(name => OTHER_SYSTEMS.has(name))) return "none";
  if (NAMED_OTHER.test(`${intent.original}\n${latest}`)) return "none";
  // Style archetypes (anime and entertainment looks) carry their own blocks and tokens.
  if (intent.styles.length) return "none";
  if (["app", "dashboard", "docs"].includes(intent.surface)) return "recommended";
  // A store's pages carry its brand; Astryx suits its account, cart and checkout parts.
  if (intent.surface === "storefront") return "available";
  // Brand, editorial, portfolio, showcase, media and game surfaces keep their own art direction
  // (a newsletter signup on a landing page is not an app).
  if (intent.surface !== "general") return "none";
  if (APP_TRAITS.test(`${intent.original}\n${latest}`)) return "recommended";
  return intent.needs.includes("forms") || intent.needs.includes("data") ? "available" : "none";
}

/** What the agent is told about Astryx for this run (fixed size; the docs are read on demand). */
export function astryxContext(snapshot: AstryxSnapshot, fit: AstryxFit, mode: "agent" | "chat"): string {
  if (fit === "none") return "";
  const m = snapshot.manifest;
  const c = m.counts;
  const lead = {
    project: "This project already uses Astryx: build with its components, templates and theme tokens, and keep every @astryxdesign package at the same version.",
    requested: "The user asked for Astryx: build the interface on it.",
    recommended: "For this app interface, build on Astryx unless the user wants another stack: accessible components, templates and themes instead of hand-rolled UI. Tell the user in one line that you used it.",
    available: "If this interface is app-like (forms, tables, settings, account or checkout flows), Astryx fits; a brand or marketing page keeps its own design.",
  }[fit];
  const lines = [
    `Astryx design system (Meta's open-source React 19 design system, MIT, v${m.version}): ${c.component ?? 0} components, ${c.page ?? 0} page templates, ${c.block ?? 0} blocks, ${c.theme ?? 0} themes and its docs, through the astryx tool. Never write Astryx from memory: read before you use.`,
    `- ${lead}`,
    "- Workflow: astryx build \"<what the page is for>\" names the template to start from and the blocks and components for what it lacks;"
      + (mode === "agent" ? " astryx_scaffold writes that template into the workspace (keep its frame, gap and padding; replace the content);" : " astryx template shows its source;")
      + " astryx component <Name> before you use a component's props; astryx docs <topic> for tokens, layout, theming and principles.",
    "- Setup: astryx setup gives the exact pinned installs, CSS imports and theme wiring. The design direction becomes a theme (astryx themes: the closest base, then defineTheme with accent, type, radius and motion), never CSS over components; no raw <div>/<span>, hex colors or px where a component or token exists.",
    mode === "agent"
      ? "- Templates are content only: give the page its <main>, one h1 and names for icon-only controls, and check it at 390 px (toolbars and boards overflow first). Before you finish: astryx check, then build and test_preview_visual as usual; audit findings on Astryx's own atomic class names (x1abc…) come from the library."
      : "- Building it needs agent mode.",
    "- The Astryx CLI doesn't run in this sandbox (it needs Node 22.13): commands in the docs written as `astryx <command>` are the astryx tool's. Never run `npx astryx` or install the unscoped `astryx` package (an unrelated npm package).",
  ];
  return lines.join("\n");
}

// ---- Commands the sandbox must not run ------------------------------------------------------------

const RUNNERS = String.raw`(?:npx|pnpx|bunx|pnpm\s+dlx|pnpm\s+exec|yarn\s+dlx|npm\s+exec|npm\s+x)`;
const UNSCOPED_RUN = new RegExp(String.raw`(^|[\s;&|()\x60$])${RUNNERS}(?:\s+(?:-y|--yes|--|--package(?:=|\s+)\S+|-p\s+\S+))*\s+astryx(?:@\S*)?(?=$|[\s;&|)])`, "i");
const UNSCOPED_INSTALL = /(^|[\s;&|()])(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|i|install)|yarn\s+(?:global\s+)?add|bun\s+(?:add|i|install))\b[^;&|\n]*?\s(?:-\S+\s+)*astryx(?:@\S*)?(?=$|[\s;&|)])/i;

/**
 * Why a sandbox command must not run, or null. The unscoped `astryx` npm package is not Astryx
 * (the CLI is @astryxdesign/cli): running or installing it would execute a stranger's code with the
 * project's files.
 */
export function astryxCommandRefusal(command: string): string | null {
  if (!/astryx/i.test(command)) return null;
  if (UNSCOPED_RUN.test(command) || UNSCOPED_INSTALL.test(command)) {
    return "Not run: the unscoped npm package `astryx` is unrelated to the Astryx design system (its CLI is @astryxdesign/cli), so running or installing it would execute someone else's code. The Astryx CLI also needs Node 22.13 and this sandbox runs Node 20: use the astryx tool for its commands (build, component, docs, template, search, themes, setup, check) and astryx_scaffold to write a template.";
  }
  return null;
}
