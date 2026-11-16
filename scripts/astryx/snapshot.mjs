#!/usr/bin/env node
// Writes design-systems/astryx/: the pinned, vetted snapshot of Astryx (github.com/meta/astryx, MIT)
// that the agent's astryx tools read. Nothing from Astryx runs on the Curialy server; this script runs
// its CLI once, offline, in a jail, and keeps only text and data.
//
//   node scripts/astryx/snapshot.mjs [--version 0.7.16] [--stage /srv/astryx-stage] [--reuse]
//
// 1. Stage: the packages at exact versions, installed with --ignore-scripts into <stage>/<version>/project,
//    then `npm audit signatures` must verify every registry signature (provenance where published).
// 2. Ask: scripts/astryx/jail.sh runs snapshot-driver.mjs and theme-module-driver.mjs there (no network,
//    a transient user, the project read-only); their stdout is all that comes back.
// 3. Write: components, hooks, docs, templates, themes and an index, after checking every answer.
//    --reuse skips 1-2 when <stage>/<version>/*.jsonl exist (to re-run the conversion only).
//
// Review the diff of design-systems/astryx before committing a new version.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = path.join(REPO, "design-systems/astryx");

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const VERSION = arg("version", "0.7.16");
const STAGE = path.join(arg("stage", "/srv/astryx-stage"), VERSION);
const PROJECT = path.join(STAGE, "project");
const REUSE = process.argv.includes("--reuse");
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) throw new Error(`--version must be an exact release, got ${VERSION}`);

const THEMES = ["neutral", "butter", "chocolate", "gothic", "matcha", "stone", "y2k"];
/** Exact versions a project installs with this snapshot (React is a peer: >= 19). */
const PINNED = {
  "@astryxdesign/core": VERSION,
  ...Object.fromEntries(THEMES.map(slug => [`@astryxdesign/theme-${slug}`, VERSION])),
  "@stylexjs/stylex": "0.19.2",
  react: "19.3.1",
  "react-dom": "19.3.1",
};

const log = (...parts) => console.error("[astryx-snapshot]", ...parts);

// ---- 1. Stage ---------------------------------------------------------------

function stage() {
  fs.mkdirSync(PROJECT, { recursive: true });
  const pkg = { name: "astryx-snapshot-stage", private: true, type: "module", dependencies: { ...PINNED, "@astryxdesign/cli": VERSION } };
  fs.writeFileSync(path.join(PROJECT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  log("installing (no install scripts) into", PROJECT);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: PROJECT, stdio: "inherit" });
}

function verify() {
  const audit = spawnSync("npm", ["audit", "signatures"], { cwd: PROJECT, encoding: "utf8" });
  const text = `${audit.stdout}\n${audit.stderr}`;
  const installed = Number(/audited (\d+) packages?/.exec(text)?.[1] ?? 0);
  const signed = Number(/(\d+) packages? ha(?:ve|s) verified registry signatures?/.exec(text)?.[1] ?? 0);
  const attested = Number(/(\d+) packages? ha(?:ve|s) verified attestations?/.exec(text)?.[1] ?? 0);
  if (audit.status !== 0 || !installed || signed !== installed || /invalid|missing/i.test(text)) {
    throw new Error(`npm audit signatures did not verify every package:\n${text}`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(PROJECT, "package-lock.json"), "utf8"));
  const withScripts = Object.entries(lock.packages).filter(([key, info]) => key && info.hasInstallScript).map(([key]) => key.replace(/^node_modules\//, ""));
  const unexpected = withScripts.filter(name => !["@astryxdesign/cli", "@astryxdesign/core"].includes(name));
  if (unexpected.length) throw new Error(`Packages with install scripts nobody reviewed: ${unexpected.join(", ")}`);
  const integrity = Object.fromEntries(Object.keys(PINNED).filter(name => name.startsWith("@astryxdesign/")).map(name => [name, lock.packages[`node_modules/${name}`]?.integrity]));
  for (const [name, value] of Object.entries(integrity)) if (!value?.startsWith("sha512-")) throw new Error(`No integrity for ${name}`);
  return { packages: installed, signatures: signed, attestations: attested, installScripts: withScripts, integrity };
}

// ---- 2. Ask the CLI in the jail -------------------------------------------------

function jail(driver, file, extra = []) {
  log("running", driver, "in the jail");
  const result = spawnSync(path.join(HERE, "jail.sh"), [PROJECT, `/srv/stage/driver/${driver}`, ...extra], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${driver} failed (${result.status}): ${result.stderr.slice(0, 2000)}`);
  fs.writeFileSync(path.join(STAGE, file), result.stdout);
}

function records(file) {
  const map = new Map();
  for (const line of fs.readFileSync(path.join(STAGE, file), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    map.set(record.key, record);
  }
  return map;
}

// ---- 3. Write ----------------------------------------------------------------------

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
/**
 * The CLI prints follow-up commands for the project it ran in (`npx astryx …`). Agents here call the
 * astryx tool with the same command instead (the CLI needs Node 22.13, the task sandboxes run 20),
 * and an unscoped `npx astryx` would fetch an unrelated npm package: every runner form is rewritten.
 */
const RUNNER = /(?:\bnpx(?:\s+(?:-y|--yes))?|\bpnpm\s+exec|\bpnpm\s+dlx|\byarn\s+dlx|\bbunx|\bnpm\s+exec(?:\s+--)?|\bnpm\s+run\s+astryx\s+--)\s+(?:@astryxdesign\/cli(?:@[\w.-]+)?|astryx)\b/g;
const clean = text => text.replace(ANSI, "").replace(RUNNER, "astryx").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd() + "\n";

function need(map, key, { json = false } = {}) {
  const record = map.get(key);
  if (!record) throw new Error(`missing answer: ${key}`);
  if (record.code !== 0 || record.out == null) throw new Error(`${key} failed (${record.code}): ${record.err}`);
  if (!json) return record.out;
  const parsed = JSON.parse(record.out);
  if (parsed.error) throw new Error(`${key}: ${parsed.error}`);
  return parsed.data;
}

const safeName = name => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)) throw new Error(`unsafe name ${JSON.stringify(name)}`);
  return name;
};
const routeFile = route => {
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(route)) throw new Error(`unsafe docs route ${JSON.stringify(route)}`);
  return route.replace(/\//g, "__");
};

function write(relative, content) {
  const file = path.join(OUT, relative);
  if (!file.startsWith(`${OUT}${path.sep}`)) throw new Error(`outside the snapshot: ${relative}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return relative;
}

const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text ?? "");
const firstSentences = (text, max = 320) => clip(String(text ?? "").replace(/\s+/g, " ").trim(), max);

/** Package specifiers a template's source imports. */
function imports(source) {
  const found = new Set();
  // Statements only (import ... from 'x', import 'x', export ... from 'x'): prose in JSX can say "from 'Next'".
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"\n]+)['"]/gm)) {
    if (/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w./-]*)?$/.test(match[1]) || match[1].startsWith(".")) found.add(match[1]);
  }
  return [...found];
}
const packageOf = specifier => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);

/** The theme's own tokens: the first declaration of each in its stylesheet, light and dark apart. */
function themeTokens(css) {
  const wanted = ["--color-accent", "--color-on-accent", "--color-background-body", "--color-background-surface", "--color-text-primary", "--color-text-secondary", "--color-border",
    "--font-family-body", "--font-family-heading", "--font-family-code", "--radius-element", "--radius-container", "--radius-page"];
  const tokens = {};
  for (const name of wanted) {
    const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
    if (!match) continue;
    const value = match[1].trim();
    const pair = /^light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/.exec(value);
    tokens[name] = pair ? { light: pair[1], dark: pair[2] } : value;
  }
  const schemes = [...css.matchAll(/color-scheme\s*:\s*([^;]+);/g)].map(match => match[1].trim());
  return { tokens, schemes: [...new Set(schemes)] };
}

function convert(verification) {
  const main = records("driver-out.jsonl");
  const themeRuns = records("theme-out.jsonl");
  if (!main.has("done")) throw new Error("the driver did not finish");
  const cliVersion = need(main, "version").trim();
  if (cliVersion !== VERSION) throw new Error(`CLI answered as ${cliVersion}, expected ${VERSION}`);

  // Everything generated is replaced; README.md (written by hand) stays.
  for (const generated of ["components", "hooks", "docs", "templates", "themes", "fixtures", "index.json", "snapshot.json", "LICENSE"]) fs.rmSync(path.join(OUT, generated), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // The CLI's own search index: keywords and guidance for every candidate it ranks.
  const searchIndex = JSON.parse(need(main, "search-index"));
  const keywordsOf = new Map();
  for (const candidate of searchIndex.candidates ?? []) {
    const key = `${candidate.domain}:${candidate.name}`;
    // `prose` holds a template's own keywords ("preferences", "kpi tiles"); `keywords` its category words.
    const words = [...(candidate.keywords ?? []), ...(candidate.prose ?? [])].map(word => String(word).toLowerCase().trim()).filter(Boolean);
    keywordsOf.set(key, [...new Set([...(keywordsOf.get(key) ?? []), ...words])].slice(0, 40));
  }
  const keywords = (domain, name) => keywordsOf.get(`${domain}:${name}`) ?? [];

  const index = [];
  const problems = [];

  // Components: dense docs per component, the structured answer for search metadata.
  const families = need(main, "list:components", { json: true }).components;
  for (const [group, members] of Object.entries(families)) {
    for (const member of members) {
      const name = safeName(member.name);
      const detail = need(main, `component:${name}`, { json: true });
      const file = write(`components/${name}.md`, clean(need(main, `component-dense:${name}`)));
      index.push({
        kind: "component", name, group, category: detail.category ?? null, title: detail.displayName ?? name,
        description: firstSentences(member.description ?? detail.usage?.description), keywords: [...new Set([...(detail.keywords ?? []), ...keywords("component", name)].map(word => String(word).toLowerCase()))].slice(0, 40),
        import: member.import ?? detail.import ?? null, props: (detail.props ?? []).map(prop => prop.name).filter(Boolean).slice(0, 60), file,
      });
    }
  }

  // Hooks.
  const hookGroups = need(main, "list:hooks", { json: true }).components;
  for (const [group, members] of Object.entries(hookGroups)) {
    for (const member of members) {
      const name = safeName(member.name);
      const file = write(`hooks/${name}.md`, clean(need(main, `hook-dense:${name}`)));
      index.push({ kind: "hook", name, group, category: group, title: name, description: firstSentences(member.description), keywords: keywords("hook", name), import: member.import ?? null, file });
    }
  }

  // Docs: every node the driver walked; the dense text is kept only where it is materially shorter.
  for (const [key, record] of main) {
    if (!key.startsWith("doc:")) continue;
    const route = key.slice(4);
    const node = need(main, key, { json: true });
    const full = clean(need(main, `doc-full:${route}`));
    const dense = clean(need(main, `doc-dense:${route}`));
    const file = write(`docs/${routeFile(route)}.md`, full);
    const denseFile = dense.length < full.length * 0.85 ? write(`docs/${routeFile(route)}.dense.md`, dense) : null;
    const children = (node.slots ?? []).flatMap(slot => (slot.children ?? []).map(child => child.route)).filter(child => typeof child === "string");
    const sections = [...full.matchAll(/^## (.+)$/gm)].map(match => match[1].trim()).slice(0, 60);
    index.push({ kind: "doc", name: route, title: node.title ?? route, description: firstSentences(node.summary), keywords: keywords("doc", route), category: node.kind ?? null, children, sections, file, ...(denseFile ? { dense: denseFile } : {}) });
    void record;
  }

  // Templates: the source a copy writes, the packages it imports, and the skeleton of each page.
  const lock = JSON.parse(fs.readFileSync(path.join(PROJECT, "package-lock.json"), "utf8"));
  const cliPackage = JSON.parse(fs.readFileSync(path.join(PROJECT, "node_modules/@astryxdesign/cli/package.json"), "utf8"));
  const templateRanges = Object.fromEntries(Object.entries(cliPackage.devDependencies ?? {}).filter(([name]) => !name.startsWith("@astryxdesign/") && !name.startsWith("@types/") && name !== "@stylexjs/stylex"));
  const published = new Set(Object.keys(PINNED));
  for (const item of need(main, "list:templates", { json: true })) {
    const id = safeName(item.id);
    const shown = need(main, `template:${id}`, { json: true });
    if (typeof shown.source !== "string" || !shown.source.trim()) { problems.push(`template ${id}: no source`); continue; }
    const folder = item.type === "page" ? "pages" : "blocks";
    const file = write(`templates/${folder}/${id}.tsx`, shown.source.endsWith("\n") ? shown.source : `${shown.source}\n`);
    const skeleton = item.type === "page" ? write(`templates/${folder}/${id}.skeleton.txt`, clean(need(main, `skeleton:${id}`))) : null;
    const packages = [...new Set(imports(shown.source).filter(spec => !spec.startsWith(".") && !spec.startsWith("/")).map(packageOf))].sort();
    const external = packages.filter(name => !published.has(name) && !name.startsWith("@astryxdesign/"));
    const unpublished = packages.filter(name => name.startsWith("@astryxdesign/") && !published.has(name));
    const unknown = external.filter(name => !templateRanges[name]);
    // Templates that call stylex.create() themselves need a StyleX compiler in the project.
    const stylex = /from\s+['"]@stylexjs\/stylex['"]/.test(shown.source) && /stylex\.(create|keyframes|defineVars|createTheme)\s*\(/.test(shown.source);
    index.push({
      kind: item.type === "page" ? "page" : "block", name: id, title: item.name ?? id, description: firstSentences(item.description ?? shown.description), category: item.category ?? null,
      keywords: keywords("template", id), components: shown.components ?? item.componentsUsed ?? [], exampleFor: item.exampleFor ?? null, showcase: Boolean(item.isShowcase), ready: item.isReady !== false,
      packages: external, ...(stylex ? { stylex: true } : {}), ...(unpublished.length ? { unpublished } : {}), ...(unknown.length ? { unpinned: unknown } : {}), demoMedia: shown.demoMediaReplaced ?? 0, file, ...(skeleton ? { skeleton } : {}),
    });
  }

  // Themes: descriptions from the CLI, tokens and fonts from each package's built stylesheet, and the
  // module `astryx theme add` generates for it (the recipe writes the same imports).
  const themeList = need(main, "list:themes", { json: true });
  const themes = [];
  for (const slug of THEMES) {
    const listed = themeList.find(theme => theme.slug === slug);
    if (!listed) throw new Error(`theme ${slug} is not listed`);
    const dir = path.join(PROJECT, "node_modules", `@astryxdesign/theme-${slug}`);
    const css = fs.readFileSync(path.join(dir, "dist/theme.css"), "utf8");
    const fontsCss = fs.existsSync(path.join(dir, "fonts.css")) ? fs.readFileSync(path.join(dir, "fonts.css"), "utf8") : "";
    const fonts = [...fontsCss.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map(match => match[1]);
    const added = themeRuns.get(`theme-add:${slug}`);
    if (!added || added.code !== 0) throw new Error(`theme add ${slug} failed: ${added?.err}`);
    const generated = Object.entries(added.files ?? {}).filter(([file]) => /astryx-themes\.(ts|js)$/.test(file));
    if (generated.length !== 1) throw new Error(`theme add ${slug} wrote ${Object.keys(added.files ?? {}).join(", ") || "nothing"}`);
    const { tokens, schemes } = themeTokens(css);
    // A theme with both modes declares `color-scheme: light dark` at the root and pairs every colour
    // with light-dark(); a single-mode theme (gothic) gives plain values: dark when its page is dark.
    const page = tokens["--color-background-body"];
    const singleMode = !/:root\s*\{\s*color-scheme:\s*light dark/.test(css) && typeof page === "string";
    const luminance = hex => { const m = /^#([0-9a-f]{6})/i.exec(String(hex)); if (!m) return 1; const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const darkOnly = singleMode && luminance(page) < 0.25;
    const facts = {
      slug, name: listed.displayName, description: listed.description, package: `@astryxdesign/theme-${slug}`, version: VERSION, tokens, schemes,
      modes: singleMode ? [darkOnly ? "dark" : "light"] : ["light", "dark"], darkOnly, fonts,
      module: { file: generated[0][0], source: generated[0][1] }, otherFiles: Object.keys(added.files).filter(file => file !== generated[0][0]),
    };
    write(`themes/${slug}.json`, `${JSON.stringify(facts, null, 2)}\n`);
    themes.push(facts);
    index.push({ kind: "theme", name: slug, title: listed.displayName, description: firstSentences(listed.description), keywords: keywords("theme", slug), category: facts.darkOnly ? "dark" : "light and dark", file: `themes/${slug}.json` });
  }

  // The official build kits for the test ideas: what the ranking is measured against.
  const kits = [];
  for (const [key] of main) {
    if (!key.startsWith("build:")) continue;
    const kit = need(main, key, { json: true });
    kits.push({ idea: key.slice(6), start: kit.start?.name ?? null, alternatives: (kit.start?.alternatives ?? []).map(item => item.name), pages: (kit.pages ?? []).map(item => item.name), blocks: (kit.blocks ?? []).map(item => item.name), components: (kit.domain ?? []).map(item => item.name), frame: kit.frame ?? [], foundation: kit.foundation ?? [] });
  }
  write("fixtures/build-kits.json", `${JSON.stringify(kits, null, 2)}\n`);
  const frame = kits.find(kit => kit.frame.length)?.frame ?? [];
  const foundation = kits.find(kit => kit.foundation.length)?.foundation ?? [];

  // The licence travels with the copies.
  // (@astryxdesign/core declares MIT but ships no LICENSE file; the CLI's is the repository's.)
  const licence = fs.readFileSync(path.join(PROJECT, "node_modules/@astryxdesign/cli/LICENSE"), "utf8");
  if (!/^MIT License/.test(licence) || !/Meta Platforms/.test(licence)) throw new Error("unexpected licence text");
  write("LICENSE", licence);

  const counts = index.reduce((acc, entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {});
  const indexText = `${JSON.stringify({ version: VERSION, entries: index })}\n`;
  write("index.json", indexText);
  // Core's public entries (its package.json exports): what an import may name.
  const coreExports = Object.keys(JSON.parse(fs.readFileSync(path.join(PROJECT, "node_modules/@astryxdesign/core/package.json"), "utf8")).exports ?? {})
    .map(key => key.replace(/^\.\/?/, "")).filter(key => key && !/\.(mjs|json)$/.test(key) && !key.includes("*"));
  const manifest = {
    name: "astryx", source: "https://github.com/meta/astryx", license: "MIT", version: VERSION, cli: cliVersion, generatedAt: new Date().toISOString(),
    exports: coreExports,
    install: PINNED, peers: { react: ">=19.0.0", "react-dom": ">=19.0.0" }, templatePackages: templateRanges, frame, foundation, counts,
    verification: { ...verification, lockfileNode: process.version }, indexSha256: createHash("sha256").update(indexText).digest("hex"), problems,
    lockfile: { packages: Object.keys(lock.packages).length - 1 },
  };
  write("snapshot.json", `${JSON.stringify(manifest, null, 2)}\n`);
  log("wrote", OUT, JSON.stringify(counts), problems.length ? `problems: ${problems.join("; ")}` : "no problems");
}

// ---- Run ------------------------------------------------------------------------

const reusable = REUSE && fs.existsSync(path.join(STAGE, "driver-out.jsonl")) && fs.existsSync(path.join(STAGE, "theme-out.jsonl"));
if (!reusable) {
  if (!fs.existsSync(path.join(PROJECT, "package-lock.json"))) stage();
}
const verification = verify();
log(`verified ${verification.signatures}/${verification.packages} registry signatures, ${verification.attestations} attestations`);
if (!reusable) {
  jail("snapshot-driver.mjs", "driver-out.jsonl");
  jail("theme-module-driver.mjs", "theme-out.jsonl");
}
convert(verification);
