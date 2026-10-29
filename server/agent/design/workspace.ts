import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { workspaceManifest } from "../artifacts";
import { listWorkspaceTree, readWorkspaceFile } from "../sandbox";
import type { WorkspaceFacts } from "./types";

// What the workspace already has that a design must respect: the framework, the styling approach,
// a token system and a written direction. Reads are bounded and confined to the workspace (under
// the cloud sandbox the local copy has sources and config but no node_modules, which is enough).

const UI_EXT = /\.(html?|css|scss|sass|less|jsx|tsx|vue|svelte|astro)$/i;
const SOURCE_EXT = /\.(html?|css|scss|sass|less|jsx?|tsx?|mjs|vue|svelte|astro|py|go|rs|rb|php|java|kt|swift)$/i;
const SKIP_DIR = /(^|\/)(attachments|build|out|coverage|\.[^/]+)(\/|$)/;

const FRAMEWORKS: [dep: string, name: string][] = [
  ["next", "Next.js"], ["astro", "Astro"], ["nuxt", "Nuxt"], ["@sveltejs/kit", "SvelteKit"], ["svelte", "Svelte"], ["vue", "Vue"],
  ["solid-js", "Solid"], ["@angular/core", "Angular"], ["preact", "Preact"], ["react", "React"], ["lit", "Lit"],
];
const STYLING: [dep: string, name: string][] = [
  ["tailwindcss", "Tailwind"], ["sass", "Sass"], ["styled-components", "styled-components"], ["@emotion/react", "Emotion"],
  ["@vanilla-extract/css", "vanilla-extract"], ["unocss", "UnoCSS"], ["bootstrap", "Bootstrap"], ["bulma", "Bulma"],
];
const LIBRARIES: [dep: string, name: string][] = [
  ["three", "three.js"], ["@react-three/fiber", "React Three Fiber"], ["gsap", "GSAP"], ["framer-motion", "Framer Motion"], ["motion", "Motion"],
  ["lottie-web", "Lottie"], ["chart.js", "Chart.js"], ["recharts", "Recharts"], ["d3", "D3"], ["echarts", "ECharts"], ["@radix-ui/react-dialog", "Radix UI"],
  ["@mui/material", "MUI"], ["@chakra-ui/react", "Chakra UI"], ["@mantine/core", "Mantine"], ["@headlessui/react", "Headless UI"],
  ["lucide-react", "Lucide icons"], ["@heroicons/react", "Heroicons"],
];

const MAX_STYLESHEETS = 8;
const MAX_PACKAGES = 3;

function readText(root: string, file: string) {
  try {
    const result = readWorkspaceFile(root, file);
    return result.exists ? result.content : null;
  } catch {
    return null;
  }
}

export function workspaceFacts(root: string): WorkspaceFacts {
  const facts: WorkspaceFacts = { hasUi: false, existing: false, framework: null, styling: [], libraries: [], tokens: 0, designDoc: null };
  let tree: ReturnType<typeof listWorkspaceTree>;
  try { tree = listWorkspaceTree(root, ".", 4, 1500); } catch { return facts; }
  const files = tree.filter(entry => entry.type === "file" && !SKIP_DIR.test(entry.path)).map(entry => entry.path);
  facts.hasUi = files.some(file => UI_EXT.test(file));
  facts.existing = files.filter(file => SOURCE_EXT.test(file)).length >= 3;
  facts.designDoc = files.find(file => /^(docs\/)?design\.md$/i.test(file)) ?? null;

  const deps = new Set<string>();
  for (const file of files.filter(file => path.basename(file) === "package.json").sort((a, b) => a.split("/").length - b.split("/").length).slice(0, MAX_PACKAGES)) {
    try {
      const pkg = JSON.parse(readText(root, file) ?? "{}");
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) deps.add(name);
    } catch { /* not JSON */ }
  }
  facts.framework = FRAMEWORKS.find(([dep]) => deps.has(dep))?.[1] ?? (files.some(file => /(^|\/)index\.html?$/i.test(file)) ? "static HTML" : null);
  facts.styling = STYLING.filter(([dep]) => deps.has(dep)).map(([, name]) => name);
  if (!facts.styling.includes("Tailwind") && files.some(file => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(file))) facts.styling.push("Tailwind");
  if (files.some(file => /\.module\.(css|scss)$/.test(file))) facts.styling.push("CSS modules");
  facts.libraries = LIBRARIES.filter(([dep]) => deps.has(dep)).map(([, name]) => name);
  if (files.some(file => /(^|\/)components\.json$/.test(file))) facts.libraries.push("shadcn/ui");

  // Custom properties already declared: a token system the design should extend.
  for (const file of files.filter(file => /\.(css|scss)$/i.test(file)).slice(0, MAX_STYLESHEETS)) {
    const css = readText(root, file);
    if (css) facts.tokens += (css.match(/(^|[\s{;])--[a-z0-9-]+\s*:/gi) ?? []).length;
  }
  return facts;
}

// ---- What a visual test looked at -------------------------------------------

const UI_SOURCE = /\.(html?|css|scss|sass|less|jsx|tsx|vue|svelte|astro)$/i;
/** Tests, stories, build output, test and coverage reports and dot-directories are not the interface (at any depth). */
const NOT_UI = /(^|\/)(node_modules|dist|build|out|target|coverage|_site|playwright-report|blob-report|test-results|htmlcov|storybook-static|\.[^/]+)\/|\.(test|spec|stories)\.[a-z]+$/i;
export const isUiSource = (file: string) => UI_SOURCE.test(file) && !NOT_UI.test(file);

const MAX_PRINT_FILES = 2000;
const MAX_PRINT_BYTES = 2 * 1024 * 1024;
/** Bytes read and hashed per fingerprint; past it (or for a file over 2 MB) size and mtime stand in. */
const PRINT_BUDGET_BYTES = 32 * 1024 * 1024;

/** Hashes computed earlier in a run, by path: reused while size and mtime are unchanged. */
export type PrintCache = Map<string, { size: number; mtimeMs: number; hash: string }>;

/**
 * Content hashes of the workspace's interface sources. Compared by content, so a rebuild that
 * rewrites identical generated CSS, or a touched file, is not a change. With a cache, only files
 * whose size or mtime changed are read again.
 */
export function uiFingerprint(root: string, cache?: PrintCache) {
  const print = new Map<string, string>();
  let budget = PRINT_BUDGET_BYTES;
  for (const [file, info] of workspaceManifest(root)) {
    if (print.size >= MAX_PRINT_FILES) break;
    if (!isUiSource(file)) continue;
    const cached = cache?.get(file);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) { print.set(file, cached.hash); continue; }
    let hash = `size:${info.size}:${info.mtimeMs}`;
    if (info.size <= MAX_PRINT_BYTES && info.size <= budget) {
      try { hash = createHash("sha1").update(fs.readFileSync(path.join(root, file))).digest("hex"); budget -= info.size; } catch { continue; /* gone meanwhile */ }
    }
    cache?.set(file, { size: info.size, mtimeMs: info.mtimeMs, hash });
    print.set(file, hash);
  }
  return print;
}

/** Interface files added, changed or removed between two fingerprints. */
export function uiChanges(before: Map<string, string>, after: Map<string, string>) {
  const changed = [...after].filter(([file, hash]) => before.get(file) !== hash).map(([file]) => file);
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed.sort();
}
