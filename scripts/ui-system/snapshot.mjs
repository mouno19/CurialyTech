#!/usr/bin/env node
// Writes design-systems/curialy-ui/: Curialy UI, the agent's design system. It is a white-labelled
// build of an MIT-licensed open-source React 19 design system (the upstream project and its
// packages are named in design-systems/curialy-ui/README.md and UPSTREAM.json, which the site
// never serves). Nothing from upstream runs on the Curialy server: this script runs its CLI once,
// offline, in a jail, and keeps text, data and repacked packages.
//
//   node scripts/ui-system/snapshot.mjs [--version 0.7.16] [--stage /srv/astryx-stage] [--reuse]
//
// 1. Stage: the upstream packages at exact versions, installed with --ignore-scripts into
//    <stage>/<version>/project; `npm audit signatures` must verify every registry signature.
// 2. Ask: jail.sh runs snapshot-driver.mjs and theme-module-driver.mjs there (no network, a transient
//    user, the project read-only); their stdout is all that comes back.
// 3. White-label: the upstream name, scope, URLs and file names are rewritten everywhere, with one
//    consistent mapping, so code, styles and translation keys keep matching:
//      @<upstream>/core → @curialy/ui · @<upstream>/theme-<slug> → @curialy/ui-theme-<slug>
//      <name>.css → styles.css · <name>-themes → ui-themes · identifiers, classes, data attributes,
//      layers and keys → cui · the name in prose → Curialy UI.
//    Meta's MIT copyright notices stay: the licence requires them in copies.
// 4. Write: components, hooks, docs, templates, themes, an index, and packages/*.tgz (the repacked
//    core and themes, served by the app at /ui-kit/). Fails if the name survives anywhere served.
//    --reuse skips 1-2 when <stage>/<version>/*.jsonl exist.
//
// Review the diff of design-systems/curialy-ui before committing a new version.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = path.join(REPO, "design-systems/curialy-ui");
const require = createRequire(path.join(REPO, "package.json"));

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const VERSION = arg("version", "0.7.16");
const STAGE = path.join(arg("stage", "/srv/astryx-stage"), VERSION);
const PROJECT = path.join(STAGE, "project");
const REUSE = process.argv.includes("--reuse");
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) throw new Error(`--version must be an exact release, got ${VERSION}`);

/** The upstream npm scope (internal: never written into anything the site serves). */
const UPSTREAM = "@astryxdesign";
const THEMES = ["neutral", "butter", "chocolate", "gothic", "matcha", "stone", "y2k"];
/** Exact upstream versions staged and repacked (React is a peer: >= 19). */
const PINNED = {
  [`${UPSTREAM}/core`]: VERSION,
  ...Object.fromEntries(THEMES.map(slug => [`${UPSTREAM}/theme-${slug}`, VERSION])),
  "@stylexjs/stylex": "0.19.2",
  react: "19.3.1",
  "react-dom": "19.3.1",
};
/** What projects install from the npm registry (everything else comes from /ui-kit/). */
const REGISTRY = { "@stylexjs/stylex": PINNED["@stylexjs/stylex"], react: PINNED.react, "react-dom": PINNED["react-dom"] };
/** Docs about wiring AI tools and third-party integrations to upstream: nothing for this agent, and they point at upstream services. */
const EXCLUDE_DOCS = new Set(["working-with-ai", "use-integrations"]);

const log = (...parts) => console.error("[ui-snapshot]", ...parts);

// ---- 1. Stage ---------------------------------------------------------------

function stage() {
  fs.mkdirSync(PROJECT, { recursive: true });
  const pkg = { name: "ui-snapshot-stage", private: true, type: "module", dependencies: { ...PINNED, [`${UPSTREAM}/cli`]: VERSION } };
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
  const unexpected = withScripts.filter(name => ![`${UPSTREAM}/cli`, `${UPSTREAM}/core`].includes(name));
  if (unexpected.length) throw new Error(`Packages with install scripts nobody reviewed: ${unexpected.join(", ")}`);
  const integrity = Object.fromEntries(Object.keys(PINNED).filter(name => name.startsWith(`${UPSTREAM}/`)).map(name => [name, lock.packages[`node_modules/${name}`]?.integrity]));
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

// ---- 3. White-label ------------------------------------------------------------------

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
/** CLI runners (`npx <name> …`, `pnpm exec <name> …`): the agent calls the design_system tool instead. */
const RUNNER = /(?:\bnpx(?:\s+(?:-y|--yes))?|\bpnpm\s+exec|\bpnpm\s+dlx|\byarn\s+dlx|\bbunx|\bnpm\s+exec(?:\s+--)?|\bnpm\s+run\s+astryx\s+--)\s+(?:@astryxdesign\/cli(?:@[\w.-]+)?|astryx)\b/g;
const CLI_COMMANDS = "build|search|component|hook|docs|template|theme|swizzle|init|upgrade|doctor|discover|gap-report|integration|experimental|blog|manifest|help";
/** A markdown link to upstream (repository, docs site, translations): its text stays, the link goes. */
const UPSTREAM_LINK = /\[([^\]\n]+)\]\((?:https?:\/\/)?[^)\s]*(?:astryx|atmeta)[^)\s]*\)/gi;
const UPSTREAM_URL = /(?:https?:\/\/|git\+https?:\/\/)?[\w.-]*(?:astryx|atmeta)[\w.-]*\.(?:com|org|io|dev|net)(?:[/?#][^\s)"'`<>\]]*)?|(?:https?:\/\/|git\+https?:\/\/)(?:www\.)?(?:github\.com|crowdin\.com|npmjs\.com)\/[^\s)"'`<>\]]*astryx[^\s)"'`<>\]]*/gi;

/**
 * The one mapping from upstream names to Curialy UI. `prose`: docs text, where the CLI's commands
 * become the agent's design_system tool. Code keeps every identifier consistent (Cui…, cui-…).
 */
function whiteLabel(text, { prose = false } = {}) {
  let out = text;
  // CLI command lines first, while they still read `npx <name> …` / `<name> docs …`.
  if (prose) out = out.replace(RUNNER, "astryx").replace(new RegExp(`(^|[\\s\`'"(\\[])astryx (?=(?:${CLI_COMMANDS})\\b)`, "gm"), "$1design_system ");
  out = out.replace(UPSTREAM_LINK, "$1").replace(UPSTREAM_URL, "")
    .replace(/@astryxdesign\/core\b/g, "@curialy/ui")
    .replace(/@astryxdesign\/theme-/g, "@curialy/ui-theme-")
    .replace(/@astryxdesign\//g, "@curialy/ui-")
    .replace(/\bastryx\.css\b/g, "styles.css")
    .replace(/\bastryx-themes\b/g, "ui-themes");
  return out
    .replace(/ASTRYX/g, "CUI")
    .replace(/(?<=[A-Za-z0-9_$])Astryx|Astryx(?=[A-Za-z0-9_$])/g, "Cui")
    .replace(/\bAstryx\b/g, "Curialy UI")
    .replace(/astryx/gi, "cui");
}
const LEAK = /astryx|atmeta/i;
/**
 * Docs install the packages from the npm registry; here they come from the site (a registry package
 * of that name would not be ours), so an install line names the tool that gives the exact command.
 */
const INSTALL_LINE = /^(\s*)(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|install)|yarn\s+add|bun\s+add)\b[^\n]*@curialy\/ui[^\n]*$/gm;
const clean = text => whiteLabel(text.replace(ANSI, "").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, ""), { prose: true })
  .replace(INSTALL_LINE, "$1# design_system setup gives the exact install command (the packages come from the site, not the npm registry)")
  .replace(/`(?:npm\s+(?:i|install|add)|pnpm\s+(?:add|install)|yarn\s+add|bun\s+add)\s+[^`\n]*@curialy\/ui[^`\n]*`/g, "`design_system setup` (the exact install command, from the site)")
  .replace(/^package: @curialy\/ui-cli$/gm, "package: @curialy/ui")
  .trimEnd() + "\n";

// ---- 4. Write ----------------------------------------------------------------------

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

const written = [];
function write(relative, content) {
  const file = path.join(OUT, relative);
  if (!file.startsWith(`${OUT}${path.sep}`)) throw new Error(`outside the snapshot: ${relative}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  written.push(relative);
  return relative;
}

const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text ?? "");
const firstSentences = (text, max = 320) => clip(whiteLabel(String(text ?? "").replace(/\s+/g, " ").trim(), { prose: true }), max);
const words = list => [...new Set((list ?? []).map(word => whiteLabel(String(word).toLowerCase(), { prose: true })).filter(Boolean))];

/** Package specifiers a template's source imports (statements only: prose in JSX can say "from 'Next'"). */
function imports(source) {
  const found = new Set();
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

// ---- Repacked packages ----

const TEXT_FILE = /\.(m?js|cjs|ts|tsx|mts|cts|css|json|txt)$/;
/** Upstream docs, changelogs, install scripts and CLI-only doc modules stay out of the repacked packages. */
const DROP = /(^|\/)(README\.md|CHANGELOG\.md|scripts\/.*|docs\.mjs|groups\.doc\.mjs|[^/]*\.doc\.(m?js|d\.m?ts))$|\.map$/;
/** Markdown in the packages is developer notes, except third-party licence files, which must travel with the code. */
const keepMarkdown = relative => /licen[cs]e/i.test(path.basename(relative));

function repack(upstreamName, newName, licence, esbuild) {
  const from = path.join(PROJECT, "node_modules", upstreamName);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ui-repack-"));
  const root = path.join(work, "package");
  let files = 0;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(from, full).split(path.sep).join("/");
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || DROP.test(relative) || relative === "package.json" || relative === "LICENSE" || (relative.endsWith(".md") && !keepMarkdown(relative))) continue;
      const target = path.join(root, whiteLabel(relative));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (TEXT_FILE.test(relative)) {
        let text = fs.readFileSync(full, "utf8").replace(/^\s*\/\/# sourceMappingURL=.*$/gm, "").replace(/\/\*# sourceMappingURL=[^*]*\*\//g, "");
        text = whiteLabel(text);
        const loader = /\.(m?js|cjs)$/.test(relative) ? "js" : /\.tsx$/.test(relative) ? "tsx" : /\.(m|c)?ts$/.test(relative) && !/\.d\.(m|c)?ts$/.test(relative) ? "ts" : null;
        if (loader) {
          // Parse only (nothing runs): a rewrite that broke the syntax stops the snapshot.
          try { esbuild.transformSync(text, { loader, logLevel: "silent" }); } catch (error) { throw new Error(`${newName}/${relative}: the rewrite broke the syntax: ${String(error.message).slice(0, 300)}`); }
        }
        fs.writeFileSync(target, text);
      } else {
        fs.copyFileSync(full, target);
      }
      files++;
    }
  };
  walk(from);
  const upstream = JSON.parse(fs.readFileSync(path.join(from, "package.json"), "utf8"));
  const exports = JSON.parse(whiteLabel(JSON.stringify(upstream.exports ?? {})));
  for (const key of Object.keys(exports)) if (/doc\.mjs$|^\.\/docs\.mjs$/.test(key)) delete exports[key];
  const pkg = {
    name: newName, version: upstream.version, description: newName === "@curialy/ui" ? "Curialy UI: accessible React components, page layouts, themes and design tokens." : `Curialy UI theme: ${whiteLabel(upstream.description ?? "")}`,
    license: "MIT", type: upstream.type, main: upstream.main, module: upstream.module, types: upstream.types,
    sideEffects: upstream.sideEffects, exports,
    dependencies: upstream.dependencies,
    // The core is never named as a peer: npm would fetch a package of that name from the registry,
    // which is not ours. Themes resolve it from the project, which installs both together.
    peerDependencies: Object.fromEntries(Object.entries(upstream.peerDependencies ?? {}).filter(([name]) => !name.startsWith(`${UPSTREAM}/`))),
  };
  for (const key of Object.keys(pkg)) if (pkg[key] === undefined) delete pkg[key];
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "LICENSE"), licence);
  // Nothing in the package may still carry the upstream name, in a path or in a text file.
  const leaks = [];
  const scan = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (LEAK.test(entry.name)) leaks.push(path.relative(root, full));
      if (entry.isDirectory()) scan(full);
      else if (LEAK.test(fs.readFileSync(full, "latin1"))) leaks.push(path.relative(root, full));
    }
  };
  scan(root);
  if (leaks.length) throw new Error(`${newName}: the upstream name is still in ${leaks.slice(0, 8).join(", ")}${leaks.length > 8 ? ` and ${leaks.length - 8} more` : ""}`);
  const fileName = `${newName.replace(/^@/, "").replace("/", "-")}-${upstream.version}.tgz`;
  const target = path.join(OUT, "packages", fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync("tar", ["--sort=name", "--mtime=2026-01-01 00:00:00", "--owner=0", "--group=0", "--numeric-owner", "-czf", target, "-C", work, "package"]);
  fs.rmSync(work, { recursive: true, force: true });
  const bytes = fs.readFileSync(target);
  written.push(`packages/${fileName}`);
  return { file: fileName, version: upstream.version, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, bytes: bytes.length, files };
}

function convert(verification) {
  const main = records("driver-out.jsonl");
  const themeRuns = records("theme-out.jsonl");
  if (!main.has("done")) throw new Error("the driver did not finish");
  const cliVersion = need(main, "version").trim();
  if (cliVersion !== VERSION) throw new Error(`CLI answered as ${cliVersion}, expected ${VERSION}`);

  // Everything generated is replaced; README.md (written by hand) stays.
  for (const generated of ["components", "hooks", "docs", "templates", "themes", "fixtures", "packages", "index.json", "snapshot.json", "UPSTREAM.json", "LICENSE"]) fs.rmSync(path.join(OUT, generated), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // The CLI's own search index: keywords and guidance for every candidate it ranks.
  const searchIndex = JSON.parse(need(main, "search-index"));
  const keywordsOf = new Map();
  for (const candidate of searchIndex.candidates ?? []) {
    const key = `${candidate.domain}:${candidate.name}`;
    // `prose` holds a template's own keywords ("preferences", "kpi tiles"); `keywords` its category words.
    keywordsOf.set(key, words([...(keywordsOf.get(key) ?? []), ...(candidate.keywords ?? []), ...(candidate.prose ?? [])]).slice(0, 40));
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
        description: firstSentences(member.description ?? detail.usage?.description), keywords: words([...(detail.keywords ?? []), ...keywords("component", name)]).slice(0, 40),
        import: whiteLabel(member.import ?? detail.import ?? "") || null, props: (detail.props ?? []).map(prop => prop.name).filter(Boolean).slice(0, 60), file,
      });
    }
  }

  // Hooks.
  const hookGroups = need(main, "list:hooks", { json: true }).components;
  for (const [group, members] of Object.entries(hookGroups)) {
    for (const member of members) {
      const name = safeName(member.name);
      const file = write(`hooks/${name}.md`, clean(need(main, `hook-dense:${name}`)));
      index.push({ kind: "hook", name, group, category: group, title: name, description: firstSentences(member.description), keywords: keywords("hook", name), import: member.import ? whiteLabel(member.import) : null, file });
    }
  }

  // Docs: every node the driver walked, minus the AI-tooling and integration pages; the dense text is
  // kept only where it is materially shorter.
  const excluded = route => EXCLUDE_DOCS.has(route) || EXCLUDE_DOCS.has(route.split("/")[0]);
  for (const [key] of main) {
    if (!key.startsWith("doc:")) continue;
    const route = key.slice(4);
    if (excluded(route)) continue;
    const node = need(main, key, { json: true });
    const full = clean(need(main, `doc-full:${route}`));
    const dense = clean(need(main, `doc-dense:${route}`));
    const file = write(`docs/${routeFile(route)}.md`, full);
    const denseFile = dense.length < full.length * 0.85 ? write(`docs/${routeFile(route)}.dense.md`, dense) : null;
    const children = (node.slots ?? []).flatMap(slot => (slot.children ?? []).map(child => child.route)).filter(child => typeof child === "string" && !excluded(child));
    const sections = [...full.matchAll(/^## (.+)$/gm)].map(match => match[1].trim()).slice(0, 60);
    index.push({ kind: "doc", name: route, title: whiteLabel(node.title ?? route, { prose: true }), description: firstSentences(node.summary), keywords: keywords("doc", route), category: node.kind ?? null, children, sections, file, ...(denseFile ? { dense: denseFile } : {}) });
  }

  // Templates: the source a copy writes, the packages it imports, and the skeleton of each page.
  const cliPackage = JSON.parse(fs.readFileSync(path.join(PROJECT, `node_modules/${UPSTREAM}/cli/package.json`), "utf8"));
  const templateRanges = Object.fromEntries(Object.entries(cliPackage.devDependencies ?? {}).filter(([name]) => !name.startsWith(`${UPSTREAM}/`) && !name.startsWith("@types/") && name !== "@stylexjs/stylex"));
  const ours = new Set(["@curialy/ui", ...THEMES.map(slug => `@curialy/ui-theme-${slug}`), ...Object.keys(REGISTRY)]);
  for (const item of need(main, "list:templates", { json: true })) {
    const id = safeName(item.id);
    const shown = need(main, `template:${id}`, { json: true });
    if (typeof shown.source !== "string" || !shown.source.trim()) { problems.push(`template ${id}: no source`); continue; }
    const source = whiteLabel(shown.source);
    const folder = item.type === "page" ? "pages" : "blocks";
    const file = write(`templates/${folder}/${id}.tsx`, source.endsWith("\n") ? source : `${source}\n`);
    const skeleton = item.type === "page" ? write(`templates/${folder}/${id}.skeleton.txt`, clean(need(main, `skeleton:${id}`))) : null;
    const packages = [...new Set(imports(source).filter(spec => !spec.startsWith(".") && !spec.startsWith("/")).map(packageOf))].sort();
    const external = packages.filter(name => !ours.has(name) && !name.startsWith("@curialy/"));
    const unpublished = packages.filter(name => name.startsWith("@curialy/") && !ours.has(name));
    const unknown = external.filter(name => !templateRanges[name]);
    // Templates that call stylex.create() themselves need a StyleX compiler in the project.
    const stylex = /from\s+['"]@stylexjs\/stylex['"]/.test(source) && /stylex\.(create|keyframes|defineVars|createTheme)\s*\(/.test(source);
    index.push({
      kind: item.type === "page" ? "page" : "block", name: id, title: whiteLabel(item.name ?? id, { prose: true }), description: firstSentences(item.description ?? shown.description), category: item.category ? whiteLabel(item.category, { prose: true }) : null,
      keywords: keywords("template", id), components: shown.components ?? item.componentsUsed ?? [], exampleFor: item.exampleFor ?? null, showcase: Boolean(item.isShowcase), ready: item.isReady !== false,
      packages: external, ...(stylex ? { stylex: true } : {}), ...(unpublished.length ? { unpublished } : {}), ...(unknown.length ? { unpinned: unknown } : {}), demoMedia: shown.demoMediaReplaced ?? 0, file, ...(skeleton ? { skeleton } : {}),
    });
  }

  // Themes: descriptions from the CLI, tokens and fonts from each package's built stylesheet, and the
  // module `theme add` generates for it (the recipe writes the same imports).
  const themeList = need(main, "list:themes", { json: true });
  for (const slug of THEMES) {
    const listed = themeList.find(theme => theme.slug === slug);
    if (!listed) throw new Error(`theme ${slug} is not listed`);
    const dir = path.join(PROJECT, "node_modules", `${UPSTREAM}/theme-${slug}`);
    const css = fs.readFileSync(path.join(dir, "dist/theme.css"), "utf8");
    const fontsCss = fs.existsSync(path.join(dir, "fonts.css")) ? fs.readFileSync(path.join(dir, "fonts.css"), "utf8") : "";
    const fonts = [...fontsCss.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map(match => match[1]);
    const added = themeRuns.get(`theme-add:${slug}`);
    if (!added || added.code !== 0) throw new Error(`theme add ${slug} failed: ${added?.err}`);
    const generated = Object.entries(added.files ?? {}).filter(([file]) => /-themes\.(ts|js)$/.test(file));
    if (generated.length !== 1) throw new Error(`theme add ${slug} wrote ${Object.keys(added.files ?? {}).join(", ") || "nothing"}`);
    const { tokens, schemes } = themeTokens(css);
    // A theme with both modes declares `color-scheme: light dark` at the root and pairs every colour
    // with light-dark(); a single-mode theme gives plain values: dark when its page is dark.
    const page = tokens["--color-background-body"];
    const singleMode = !/:root\s*\{\s*color-scheme:\s*light dark/.test(css) && typeof page === "string";
    const luminance = hex => { const m = /^#([0-9a-f]{6})/i.exec(String(hex)); if (!m) return 1; const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const darkOnly = singleMode && luminance(page) < 0.25;
    const facts = {
      slug, name: listed.displayName, description: whiteLabel(listed.description ?? "", { prose: true }), package: `@curialy/ui-theme-${slug}`, version: VERSION, tokens, schemes,
      modes: singleMode ? [darkOnly ? "dark" : "light"] : ["light", "dark"], darkOnly, fonts,
      module: { file: whiteLabel(generated[0][0]).replace(/\.js$/, ".ts"), source: whiteLabel(generated[0][1]) },
    };
    write(`themes/${slug}.json`, `${JSON.stringify(facts, null, 2)}\n`);
    index.push({ kind: "theme", name: slug, title: listed.displayName, description: firstSentences(listed.description), keywords: keywords("theme", slug), category: darkOnly ? "dark" : "light and dark", file: `themes/${slug}.json` });
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

  // The licence travels with every copy (@<upstream>/core declares MIT but ships no LICENSE file; the CLI's is the repository's).
  const licence = fs.readFileSync(path.join(PROJECT, `node_modules/${UPSTREAM}/cli/LICENSE`), "utf8");
  if (!/^MIT License/.test(licence) || !/Meta Platforms/.test(licence) || LEAK.test(licence)) throw new Error("unexpected licence text");
  write("LICENSE", licence);

  // The repacked packages projects install (from /ui-kit/ on the site, never from the registry).
  const esbuild = require("esbuild");
  const packages = { "@curialy/ui": repack(`${UPSTREAM}/core`, "@curialy/ui", licence, esbuild) };
  for (const slug of THEMES) packages[`@curialy/ui-theme-${slug}`] = repack(`${UPSTREAM}/theme-${slug}`, `@curialy/ui-theme-${slug}`, licence, esbuild);

  const counts = index.reduce((acc, entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {});
  const indexText = `${JSON.stringify({ version: VERSION, entries: index })}\n`;
  write("index.json", indexText);
  const coreExports = Object.keys(JSON.parse(execFileSync("tar", ["-xzOf", path.join(OUT, "packages", packages["@curialy/ui"].file), "package/package.json"], { encoding: "utf8" })).exports ?? {})
    .map(key => key.replace(/^\.\/?/, "")).filter(key => key && !/\.(mjs|json)$/.test(key) && !key.includes("*"));
  const manifest = {
    name: "curialy-ui", license: "MIT", version: VERSION, generatedAt: new Date().toISOString(),
    packages, registry: REGISTRY, peers: { react: ">=19.0.0", "react-dom": ">=19.0.0" }, templatePackages: templateRanges, exports: coreExports, frame, foundation, counts,
    verification: { packages: verification.packages, signatures: verification.signatures, attestations: verification.attestations }, indexSha256: createHash("sha256").update(indexText).digest("hex"), problems,
  };
  write("snapshot.json", `${JSON.stringify(manifest, null, 2)}\n`);
  // Provenance, for maintainers only (the server never reads or serves this file).
  fs.writeFileSync(path.join(OUT, "UPSTREAM.json"), `${JSON.stringify({ project: "https://github.com/meta/astryx", cli: cliVersion, packages: PINNED, verification }, null, 2)}\n`);

  // Nothing the site serves or the agent reads may still carry the upstream name.
  const leaks = written.filter(relative => !relative.endsWith(".tgz") && LEAK.test(fs.readFileSync(path.join(OUT, relative), "utf8")));
  if (leaks.length) throw new Error(`the upstream name is still in ${leaks.slice(0, 10).join(", ")}${leaks.length > 10 ? ` and ${leaks.length - 10} more` : ""}`);
  log("wrote", OUT, JSON.stringify(counts), Object.values(packages).map(item => `${item.file} ${Math.round(item.bytes / 1024)} KB`).join(", "), problems.length ? `problems: ${problems.join("; ")}` : "no problems");
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
