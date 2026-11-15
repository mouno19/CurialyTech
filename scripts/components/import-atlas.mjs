// Imports the staged Component Atlas (component-library/atlas/*.html) into the component registry:
// one folder per component under component-library/components/<id>/ with its metadata
// (component.json), its implementation (react.jsx, or component.html for markup blocks) and a
// standalone preview page. Removes what only the authoring tool needed (its bootstrap, SDK scripts
// and editor class names), fixes a syntax error in one source, and writes the design token sets.
// Re-running replaces what it generated; components added by hand (other folders) are untouched.
//   node scripts/components/import-atlas.mjs [--only graph-0]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { animeCollections, BLOCKS, FAMILIES, graphId, LEXICON, ROLES, TOKEN_SETS } from "./families.mjs";
import { closure, declarations, references, scopeCss } from "./bundle.mjs";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = path.resolve(HERE, "../../component-library");
const ATLAS = path.join(LIBRARY, "atlas");
const OUT = path.join(LIBRARY, "components");
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const GENERATOR = "atlas-import";

/** Exact versions the source pages load (for the React modules' package dependencies). */
const PACKAGES = {
  react: "18.3.1", "react-dom": "18.3.1", "chart.js": "4.4.8", echarts: "5.5.1", d3: "7.9.0", "d3-sankey": "0.12.3", leaflet: "1.9.4", three: "0.160.1", lucide: "0.577.0",
};
/** Bare imports → ES modules, for the preview pages only. */
const IMPORT_MAP = {
  react: "https://esm.sh/react@18.3.1",
  "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
  "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1",
  "chart.js/auto": "https://esm.sh/chart.js@4.4.8/auto",
  "chart.js": "https://esm.sh/chart.js@4.4.8",
  echarts: "https://esm.sh/echarts@5.5.1",
  d3: "https://esm.sh/d3@7.9.0",
  "d3-sankey": "https://esm.sh/d3-sankey@0.12.3?deps=d3-array@3.2.4,d3-shape@3.2.0",
  leaflet: "https://esm.sh/leaflet@1.9.4",
  three: "https://esm.sh/three@0.160.1",
};
const CSS_IMPORTS = { "leaflet/dist/leaflet.css": "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" };

// ---- Source pages ----

/** The page without the authoring tool's bootstrap, SDK scripts and editor-only class names. */
export function clean(html) {
  return html
    .replace(/<script>window\["__codeletBootstrap__"\][\s\S]*?<\/script>/g, "")
    .replace(/<script[^>]*\bsrc="\/_sdk\/[^"]*"[^>]*>\s*<\/script>/g, "")
    .replace(/ ?\bcanva-[a-z0-9-]+\b/g, "")
    .replace(/ class=""/g, "");
}

function pieces(html) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(code => code.trim());
  const fonts = [...html.matchAll(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/g)].map(match => match[1].replace(/&amp;/g, "&"));
  return { styles, scripts, fonts };
}

function evaluate(file, request) {
  const output = execFileSync(process.execPath, [path.join(HERE, "evaluate.cjs"), file, JSON.stringify(request)], { encoding: "utf8", env: {}, cwd: path.dirname(file), timeout: 120_000, maxBuffer: 128 << 20 });
  return JSON.parse(output);
}

const applyFixes = (scripts, fixes = []) => scripts.map((code, index) => fixes.filter(fix => fix.script === index).reduce((text, fix) => {
  if (!text.includes(fix.find)) throw new Error(`fix for script ${index} no longer applies: ${fix.why}`);
  return text.split(fix.find).join(fix.replace);
}, code));

// ---- Metadata ----

const words = value => (typeof value === "string" ? value : "");
const unique = list => [...new Set(list.filter(Boolean))];
const componentName = name => (name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next) => (next ? next.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "") || "Component").replace(/^./, first => first.toUpperCase());

function lexiconTags(text) {
  return unique(LEXICON.flatMap(([pattern, tags]) => (pattern.test(text) ? tags : [])));
}

function capabilities(source, data) {
  const caps = [];
  if (/onClick|onMouse|onPointer|addEventListener|\.on\(['"](click|mouse|pointer)|tooltip|hover/i.test(source)) caps.push("interactive");
  if (/tooltip|title=|bindTooltip|<title>/i.test(source)) caps.push("tooltips");
  if (/responsive:\s*true|viewBox|width:\s*['"]?100%|ResizeObserver|preserveAspectRatio/.test(source)) caps.push("responsive");
  if (/onKeyDown|keydown|tabindex|tabIndex/.test(source)) caps.push("keyboard");
  if (/aria-label|ariaLabel|role=/.test(source)) caps.push("accessible");
  if (/animation|requestAnimationFrame|transition|animate/i.test(source)) caps.push("animated");
  const datasets = data?.datasets?.length ?? data?.legend?.length ?? (Array.isArray(data?.data?.[0]) ? data.data[0].length - 1 : 0);
  if (datasets > 1) caps.push("multiple-series");
  if (/fetch\(['"]https?:/.test(source)) caps.push("remote-data");
  return unique(caps);
}

/** Colours in a module mapped to the roles of its token set (what theme adaptation swaps). */
function colorRoles(source, tokenSet, extra = {}) {
  const roles = {};
  const byHex = new Map(Object.entries(tokenSet.colors).map(([role, hex]) => [hex.toLowerCase(), role]));
  for (const [hex, role] of Object.entries(extra)) if (hex) byHex.set(hex.toLowerCase(), role);
  for (const match of source.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = match[0].toLowerCase();
    if (byHex.has(hex)) roles[hex] = byHex.get(hex);
  }
  return roles;
}

const packagesIn = source => unique([...source.matchAll(/^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm)].map(match => match[1]))
  .filter(spec => !spec.endsWith(".css")).map(spec => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]));

// ---- Files ----

/** Render results of the previous import, kept for components whose files did not change. */
const previous = new Map();

/** Folders written by this run: once it has finished, generated folders not among them are stale and removed. */
const written = new Set();

function write(id, files) {
  const dir = path.join(OUT, id);
  written.add(id);
  const meta = JSON.parse(files["component.json"]);
  const hash = createHash("sha256").update(Object.entries(files).filter(([name]) => name !== "component.json").sort().map(([name, content]) => `${name}\n${content}`).join("\n")).digest("hex").slice(0, 16);
  const before = previous.get(id);
  meta.quality = { ...meta.quality, hash };
  if (before?.hash === hash && before.rendered !== undefined && before.rendered !== null) {
    meta.quality = { ...meta.quality, rendered: before.rendered, checked_at: before.checked_at, notes: [...(meta.quality.notes ?? []), ...(before.notes ?? []).filter(note => note.startsWith("render:"))] };
    if (before.rendered === false && meta.status === "active") meta.status = "needs-review";
  }
  files = { ...files, "component.json": `${JSON.stringify(meta, null, 2)}\n` };
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

/** A page that renders the React module alone (ES modules from a CDN; for previews and render checks). */
function reactPreview({ id, name, source, fonts, background }) {
  const links = [];
  const stripped = previewSource(source).replace(/^\s*import\s+['"]([^'"]+\.css)['"];?\s*$/gm, (_, css) => { if (CSS_IMPORTS[css]) links.push(CSS_IMPORTS[css]); return ""; });
  const compiled = esbuild.transformSync(stripped, { loader: "jsx", jsx: "automatic", format: "esm", target: "es2020" }).code;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} · ${id}</title>
${[...fonts, ...links].map(href => `<link rel="stylesheet" href="${href}">`).join("\n")}
<style>html,body{margin:0;background:${background};min-height:100%}#root{padding:24px;max-width:1100px;margin:0 auto}</style>
<script type="importmap">${JSON.stringify({ imports: IMPORT_MAP })}</script>
</head><body><div id="root" data-component="${id}"></div>
<script type="module">
${compiled.replace(/<\/script/gi, "<\\/script")}
import { createRoot as __createRoot } from "react-dom/client";
import { createElement as __h } from "react";
__createRoot(document.getElementById("root")).render(__h(__entry));
</script></body></html>`;
}

/** Component names a page's generator made from a title with punctuation ("Force-DirectedGraph"), made valid. */
function validIdentifiers(source) {
  let out = source;
  for (const match of source.matchAll(/\b(?:function|const|class)\s+([A-Za-z_$][\w$]*(?:-[\w$]+)+)/g)) out = out.split(match[1]).join(match[1].replace(/-/g, ""));
  return out;
}

/** The module's default export, so a preview (or an app) can import it the same way every time. */
function withDefaultExport(source) {
  if (/export\s+default\b/.test(source)) return source;
  const named = /export\s+(?:function|const|class)\s+([A-Z]\w*)/.exec(source);
  if (!named) throw new Error("no exported component");
  return `${source.trimEnd()}\n\nexport default ${named[1]};\n`;
}

/** Preview pages import the module's default export through a fixed name. */
function previewSource(source) {
  return source.replace(/export\s+default\s+function\s+(\w+)/, "const __entry = function $1").replace(/export\s+default\s+(\w+)\s*;?/, "const __entry = $1;").replace(/\bexport\s+(?=(const|function|class)\b)/g, "");
}

// ---- Families with definition arrays ----

function reactModule(strategy, ask, family, item, ctx) {
  const data = item.data;
  const id = ctx.id;
  const name = data.name ?? data.title ?? id;
  const Comp = componentName(name);
  const header = `// ${name} · ${id}\n// From the ${family.collection} (Curialy component library). Sample data is fictional; pass your own.\n`;
  if (strategy === "generated") {
    if (!item.react) throw new Error(item.reactError ?? "the page's generator produced nothing");
    const code = validIdentifiers(item.react);
    if (ask.sample) {
      const sample = ctx.samples?.[data[ask.sample.key]];
      const named = /export\s+function\s+([A-Z]\w*)/.exec(code)?.[1];
      if (sample === undefined || !named) throw new Error(`no sample data (${ask.sample.from}[${data[ask.sample.key]}])`);
      return `${header}${code.trimEnd()}

/** The page's own sample data, the default when no ${ask.sample.prop} is passed. */
export const sampleData = ${JSON.stringify(sample, null, 2)};

export default function ${named}WithData(props) {
  return <${named} ${ask.sample.prop}={sampleData} {...props} />;
}
`;
    }
    return header + withDefaultExport(code);
  }
  if (strategy === "renderer") {
    const helpers = closure(ctx.decls, [ask.renderer]);
    const scope = `cx-${family.tokens}`;
    const css = ask.css ? scopeCss(ctx.styles, scope).css.replace(/`/g, "\\`").replace(/\$\{/g, "\\${") : "";
    return `${header}import React from "react";

// The page's own renderer and the helpers it uses (it returns the chart's markup).
${helpers}

export const config = ${JSON.stringify(data, null, 2)};
${css ? `\n/** The family's styles, scoped to .${scope} so they stay inside this component. */\nconst styles = \`${css}\`;\n` : ""}
export default function ${Comp}({ config: definition = config, className = "", style }) {
  return (
    <div className={\`${scope} ${"${className}"}\`.trim()} style={style}>
      ${css ? "<style>{styles}</style>\n      " : ""}<div dangerouslySetInnerHTML={{ __html: ${ask.renderer}(definition) }} />
    </div>
  );
}
`;
  }
  if (strategy === "element") {
    const scope = `cx-${family.tokens}`;
    const css = ask.css ? scopeCss(ctx.styles, scope).css.replace(/`/g, "\\`").replace(/\$\{/g, "\\${") : "";
    const styled = inner => (css
      ? `React.createElement("div", { className: \`${scope} \${className}\`.trim(), style }, React.createElement("style", null, styles), ${inner})`
      : `React.createElement("div", { className, style }, ${inner})`);
    const stylesBlock = css ? `\n/** The family's styles, scoped to .${scope} so they stay inside this component. */\nconst styles = \`${css}\`;\n` : "";
    if (ask.entry === "FinancialChart") {
      const helpers = closure(ctx.decls, ["FinancialChart"]);
      const { data: points, config = {}, ...rest } = data;
      return `${header}import React from "react";

// The page's own React renderer and the helpers it uses.
${helpers}

export const component = ${JSON.stringify({ id: rest.id, type: rest.type, unit: rest.unit, ...config }, null, 2)};
export const sampleData = ${JSON.stringify(points)};
${stylesBlock}
export default function ${Comp}({ points = sampleData, onHover, className = "", style }) {
  return ${styled("React.createElement(FinancialChart, { component, points, onHover })")};
}
`;
    }
    const entry = /\[function (\w+)\]/.exec(String(data.component ?? ""))?.[1];
    if (!entry) throw new Error("no component function");
    const helpers = closure(ctx.decls, [entry]);
    return `${header}import React from "react";

// The page's own React component and the helpers and data it uses.
${helpers}
${stylesBlock}
export default function ${Comp === entry ? `${Comp}Card` : Comp}({ className = "", style }) {
  return ${styled(`React.createElement(${entry})`)};
}
`;
  }
  throw new Error(`unknown strategy ${strategy}`);
}

function importFamily(family) {
  const file = path.join(ATLAS, family.file);
  const html = clean(fs.readFileSync(file, "utf8"));
  const { styles, scripts, fonts } = pieces(html);
  const fixed = applyFixes(scripts, family.fixes);
  const decls = new Map();
  for (const code of fixed) for (const [name, decl] of declarations(code)) decls.set(name, decl);
  const sampleSources = [...new Set(family.arrays.map(ask => ask.sample?.from).filter(Boolean))];
  const evaluated = evaluate(file, { arrays: family.arrays.map(ask => ({ array: ask.array, generator: ask.generator, renderer: ask.renderer })), fixes: family.fixes, sources: sampleSources });
  const samples = Object.assign({}, ...sampleSources.map(name => JSON.parse(evaluated[`source:${name}`] ?? "{}")));
  const tokenSet = TOKEN_SETS[family.tokens];
  const results = [];
  for (const ask of family.arrays) {
    const found = evaluated.families[ask.array];
    if (!found || found.missing) throw new Error(`${family.file}: no ${ask.array}`);
    for (const item of found.items) {
      const base = graphId(item.data);
      if (!base) throw new Error(`${family.file}: ${ask.array}[${item.index}] has no id`);
      const id = `${base}${ask.variantSuffix ?? ""}`;
      if (ONLY && !id.startsWith(ONLY)) continue;
      const data = item.data;
      const name = String(data.name ?? data.title ?? id);
      const type = words(data.type) || words(data.kind) || words(data.category);
      const purpose = words(data.use) || words(data.purpose) || words(data.usecase) || words(data.desc) || words(data.description) || words(data.subtitle);
      const style = words(data.style) || words(data.philosophy);
      const notes = [];
      let source = null;
      let status = "active";
      try {
        source = reactModule(ask.strategy, ask, family, item, { id, decls, styles, samples });
        esbuild.transformSync(source.replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gm, ""), { loader: "jsx", jsx: "automatic", format: "esm" });
      } catch (error) {
        status = "needs-review";
        notes.push(`React module: ${(error.errors?.[0] ? `${error.errors[0].text} (line ${error.errors[0].location?.line})` : String(error.message ?? error).split("\n")[0]).slice(0, 200)}`);
      }
      const text = `${name} ${type} ${purpose} ${style} ${ask.batch}`;
      const packages = source ? unique(packagesIn(source)) : ask.packages;
      const extraRoles = {};
      if (data.accent) extraRoles[data.accent] = "accent";
      if (data.secondary) extraRoles[data.secondary] = "series2";
      if (data.color) extraRoles[data.color] = "series1";
      for (const [index, hex] of (Array.isArray(data.colors) ? data.colors : []).entries()) if (typeof hex === "string") extraRoles[hex] = `series${Math.min(6, index + 1)}`;
      if (typeof data.grid === "string") extraRoles[data.grid] = "border";
      if (typeof data.text === "string") extraRoles[data.text] = "muted";
      const meta = {
        id,
        name,
        description: unique([type && purpose ? `${type}: ${purpose}` : purpose || type, style && `Style: ${style}.`]).join(" ").replace(/\s+/g, " ").trim(),
        category: ask.category,
        batch: ask.batch,
        collection: family.collection,
        kind: "component",
        role: "chart",
        tags: unique([...lexiconTags(text), ...ask.batch.split("-").filter(word => !["charts", "and"].includes(word)), tokenSet.mode === "dark" ? "dark-theme" : "light-theme"]),
        capabilities: source ? capabilities(source, data) : [],
        dependencies: [
          ...packages.map(pkg => ({ type: "package", name: pkg, version: PACKAGES[pkg] ?? "*" })),
          { type: "tokens", id: family.tokens },
        ],
        compatible_tools: ["data-analytics", "dashboard-builder", "frontend-development"],
        frameworks: source ? ["react"] : [],
        implementations: source ? [{ framework: "react", file: "react.jsx", origin: ask.strategy === "generated" ? "page-generator" : ask.strategy === "renderer" ? "page-renderer" : "page-component" }] : [],
        layout: { role: "chart", span: ask.batch === "geospatial-charts" || /gantt|timeline|sankey|network|map/i.test(text) ? "wide" : "half" },
        style: { tokens: family.tokens, mode: tokenSet.mode, colors: source ? colorRoles(source, tokenSet, extraRoles) : {} },
        ...(ask.variantSuffix ? { variant_of: base } : {}),
        source: { file: `atlas/${family.file}`, ref: `${ask.array}[${item.index}]` },
        status,
        quality: { compiled: status === "active", rendered: null, notes },
        generated_by: GENERATOR,
        version: 1,
      };
      // Hosts the component loads from when it runs (data, map tiles, textures; not links it only shows).
      const hosts = unique([...(source ?? "").matchAll(/['"`]https:\/\/([a-z0-9.-]+)\/(?!copyright)/gi)].map(match => match[1].toLowerCase()).filter(host => !/^(fonts\.|esm\.sh|cdn\.jsdelivr)/.test(host)));
      if (hosts.length) meta.network = hosts;
      if (hosts.includes("tile.openstreetmap.org")) meta.quality.notes.push("map tiles come from tile.openstreetmap.org: they need a page with a proper referrer (previews show them blocked), and OpenStreetMap's tile policy rules out heavy or commercial use — set your own tile provider for production");
      const files = { "component.json": `${JSON.stringify(meta, null, 2)}\n` };
      if (source) {
        files["react.jsx"] = source;
        try { files["preview.html"] = reactPreview({ id, name, source, fonts, background: tokenSet.colors.background }); }
        catch (error) { meta.quality.notes.push(`preview: ${error.errors?.[0]?.text ?? String(error.message).split("\n")[0]}`); }
      }
      files["component.json"] = `${JSON.stringify(meta, null, 2)}\n`;
      write(id, files);
      results.push(meta);
    }
  }
  return { results, errors: evaluated.errors };
}

// ---- The analytics library (markup blocks) ----

/** The element that starts at `start`, through its matching closing tag. */
function element(html, start) {
  const tag = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start))[1].toLowerCase();
  // Void elements have no closing tag: the element is the tag itself.
  if (/^(input|img|br|hr|meta|link|source|area|col|embed|track|wbr)$/.test(tag)) return html.slice(start, html.indexOf(">", start) + 1);
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
  pattern.lastIndex = start;
  let depth = 0;
  for (let match; (match = pattern.exec(html));) {
    if (match[2] === "/") continue;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, pattern.lastIndex);
  }
  throw new Error(`unclosed <${tag}> at ${start}`);
}

/** Where `marker` starts a tag whose class list begins with that exact class (".panel", not ".panel-head"). */
function markerAt(html, marker, at) {
  const next = html[at + marker.length];
  return !/class="[^"]*$/.test(marker) || next === '"' || next === " ";
}

function nth(html, marker, index) {
  if (typeof index === "string") {
    // The innermost element starting with `marker` that holds a heading with this text.
    const heading = new RegExp(`<h[1-4][^>]*>\\s*${index.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<`).exec(html);
    if (!heading) throw new Error(`no heading "${index}"`);
    for (let at = html.lastIndexOf(marker, heading.index); at >= 0; at = html.lastIndexOf(marker, at - 1)) {
      if (markerAt(html, marker, at) && at + element(html, at).length > heading.index) return at;
    }
    throw new Error(`no ${marker} around "${index}"`);
  }
  let at = -1;
  for (let count = 0; count <= index;) {
    at = html.indexOf(marker, at + 1);
    if (at < 0) throw new Error(`no ${marker} #${index}`);
    if (markerAt(html, marker, at)) count++;
  }
  return at;
}

/** A token set by id: the atlas families' (TOKEN_SETS), or one written to tokens/ (the anime archetypes). */
function tokenSetOf(id) {
  if (TOKEN_SETS[id]) return TOKEN_SETS[id];
  return JSON.parse(fs.readFileSync(path.join(LIBRARY, "tokens", `${id}.json`), "utf8"));
}

/**
 * An archetype template's colours as the library keeps them: written in full (#abc → #aabbcc, in style
 * rules and style attributes, so theme adaptation finds them), and the text-safe shades its token set
 * names in place of the colours they replace (with any alpha suffix kept).
 */
function safeColors(html, tokenSet) {
  const full = text => text.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/gi, (_, r, g, b) => `#${r}${r}${g}${g}${b}${b}`);
  let out = html
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) => `${open}${css.replace(/\{([^{}]*)\}/g, (__, rule) => `{${full(rule)}}`)}${close}`)
    .replace(/\sstyle="([^"]*)"/g, (_, value) => ` style="${full(value)}"`);
  for (const [from, to] of Object.entries(tokenSet.replaced ?? {})) out = out.replace(new RegExp(`${from}(?=(?:[0-9a-f]{2})?\\b)`, "gi"), to);
  return out;
}

/** Elements a piece of script looks up: ids (getElementById, a $("id") helper) and selectors. */
const lookups = text => unique([...text.matchAll(/(?:getElementById|\$)\(\s*['"]([^'"]+)['"]/g)].map(match => `#${match[1]}`)
  .concat([...text.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])));

function importBlocks(BLOCKS) {
  const file = path.join(BLOCKS.dir ?? ATLAS, BLOCKS.file);
  const tokenSet = tokenSetOf(BLOCKS.tokens);
  const source = clean(fs.readFileSync(file, "utf8"));
  const html = BLOCKS.archetype ? safeColors(source, tokenSet) : source;
  const { styles, scripts, fonts } = pieces(html);
  const body = html.slice(html.indexOf("<body"));
  const scope = `cx-${BLOCKS.tokens}`;
  const scoped = scopeCss(styles, scope).css;
  // One stylesheet for the family, loaded once however many of its blocks a page uses.
  const stylesDir = path.join(LIBRARY, "styles");
  fs.mkdirSync(stylesDir, { recursive: true });
  fs.writeFileSync(path.join(stylesDir, `${BLOCKS.tokens}.css`), `/* ${BLOCKS.collection}: the family's styles, scoped to .${scope} (put the blocks inside an element with that class). */\n${scoped}\n`);
  // Every top-level statement of the page's scripts, with what it touches.
  const { parse } = require("@babel/parser");
  const statements = [];
  const decls = new Map();
  for (const [index, code] of scripts.entries()) {
    const ast = parse(code, { sourceType: "script" });
    for (const node of ast.program.body) {
      const text = code.slice(node.start, node.end);
      // What a statement touches: ids it looks up (getElementById, querySelector, a $("id") helper), and
      // ids a call hands to a helper as plain strings (makeChecks("genre-list", …)).
      const calls = node.type === "ExpressionStatement" && node.expression.type === "CallExpression" ? [...text.matchAll(/["'`]([a-z][\w-]*)["'`]/gi)].map(match => `#${match[1]}`) : [];
      const touches = unique([...lookups(text), ...calls]);
      statements.push({ node, text, touches, script: index, setup: /^(lucide\.createIcons|Chart\.defaults)/.test(text) });
    }
    // An archetype template's declarations one by one, so a block takes only the names it uses.
    for (const [name, decl] of declarations(code, { split: !!BLOCKS.archetype })) decls.set(name, Object.assign(decl, { script: index }));
  }
  const pageIds = new Map([...body.matchAll(/\sid="([^"]+)"/g)].map(match => [match[1], match.index]));
  // Dialogs of the page (a title's details): what a block's script opens there comes along with it.
  const dialogs = [...body.matchAll(/<dialog\b|<[a-z][\w-]*\s[^>]*(?:role="dialog"|aria-modal="true")/g)].map(match => {
    try { return [match.index, match.index + element(body, match.index).length]; } catch { return [match.index, match.index]; }
  });
  const inDialog = id => dialogs.some(([start, end]) => pageIds.get(id) >= start && pageIds.get(id) < end);
  const pageClasses = new Set([...body.matchAll(/\sclass="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
  const pageAttrs = new Set([...body.matchAll(/\s(data-[a-z-]+)=/g)].map(match => match[1]));
  const results = [];
  for (const block of BLOCKS.items) {
    if (ONLY && !block.id.startsWith(ONLY)) continue;
    const notes = [];
    let markup = element(body, nth(body, block.find[0], block.find[1]));
    // A view the page shows on demand (a title detail) is registered open: with the class that shows it,
    // or without the one that hides it.
    if (block.addClass) markup = markup.replace(/^(<[a-z][\w-]*[^>]*?\bclass=")([^"]*)"/i, (_, start, classes) => `${start}${classes} ${block.addClass}"`);
    if (block.removeClass) markup = markup.replace(/^(<[a-z][\w-]*[^>]*?\bclass=")([^"]*)"/i, (_, start, classes) => `${start}${classes.split(/\s+/).filter(name => name !== block.removeClass).join(" ")}"`).replace(/^(<[^>]*?) class=""/, "$1");
    const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const classes = new Set([...markup.matchAll(/\bclass="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
    const attrs = new Set([...markup.matchAll(/\s(data-[a-z-]+)=/g)].map(match => match[1]));
    // A script that sits inside the block's own markup comes with it: never add it a second time.
    const selected = statements.filter(statement => !markup.includes(statement.text) && statement.touches.some(selector => {
      const first = selector.split(/\s+/)[0];
      if (first.startsWith("#")) return ids.has(first.slice(1).replace(/-$/, "")) || [...ids].some(id => first.endsWith("-") && id.startsWith(first.slice(1)));
      if (first.startsWith(".")) return classes.has(first.slice(1));
      if (first.startsWith("[")) return attrs.has(first.slice(1, -1).split("=")[0]);
      return false;
    }));
    // Calls of functions the block's statements declare (renderSources();), and the declarations they read.
    const declared = new Set(selected.flatMap(statement => (statement.node.type === "FunctionDeclaration" ? [statement.node.id.name] : statement.node.type === "VariableDeclaration" ? statement.node.declarations.map(d => d.id.name) : [])));
    const calls = statements.filter(statement => statement.node.type === "ExpressionStatement" && statement.node.expression.type === "CallExpression" && declared.has(statement.node.expression.callee?.name));
    // Statements that reach the block only through a variable a chosen statement declared
    // (const trend = $("trending-grid"); titles.forEach(… trend.append(…))), when neither they nor the
    // page's functions they call work on anything of the page outside the block but a dialog (which comes
    // along as a supporting element: a title's details; the page's other cards and grids don't).
    const variables = new Set(selected.filter(statement => statement.node.type === "VariableDeclaration").flatMap(statement => statement.node.declarations.map(d => d.id.name).filter(Boolean)));
    const outside = selector => {
      const first = selector.split(/\s+/)[0];
      if (first.startsWith("#")) return pageIds.has(first.slice(1)) && !ids.has(first.slice(1)) && !inDialog(first.slice(1));
      if (first.startsWith(".")) return pageClasses.has(first.slice(1)) && !classes.has(first.slice(1));
      if (first.startsWith("[")) { const attr = first.slice(1, -1).split("=")[0]; return pageAttrs.has(attr) && !attrs.has(attr); }
      return false;
    };
    const inSelected = decl => selected.some(statement => statement.script === decl.script && decl.start >= statement.node.start && decl.start < statement.node.end);
    const elsewhere = (node, touches, seen = new Set()) => touches.some(outside) || [...references(node)].some(name => {
      if (seen.has(name) || !decls.has(name)) return false;
      seen.add(name);
      const decl = decls.get(name);
      return !inSelected(decl) && elsewhere(decl.node, lookups(decl.text), seen);
    });
    const uses = statements.filter(statement => statement.node.type === "ExpressionStatement" && !selected.includes(statement) && !markup.includes(statement.text) && [...references(statement.node)].some(name => variables.has(name)) && !elsewhere(statement.node, statement.touches));
    const chosen = new Set([...selected, ...calls, ...uses]);
    const refs = [...new Set([...chosen].flatMap(statement => [...references(statement.node)]))];
    let needed = "";
    try {
      // Declarations that read the page are fine only when their elements are in this block (then they were chosen).
      // A block runs in a page with its markup (and the elements its script uses), so declarations that look elements up at load are fine.
      needed = closure(decls, refs, { skip: declared, allowPage: true });
    } catch (error) {
      notes.push(`script: ${error.message}`);
    }
    const usesCharts = /new Chart\(/.test([...chosen].map(statement => statement.text).join(""));
    const ordered = statements.filter(statement => chosen.has(statement)).map(statement => statement.text);
    const script = [needed, ...ordered].filter(Boolean).join("\n");
    const usesIcons = /data-lucide=/.test(markup) || /\blucide\./.test(script);
    const setup = statements.filter(statement => statement.setup && (usesCharts || !/^Chart/.test(statement.text)) && (usesIcons || !/^lucide/.test(statement.text))).map(statement => statement.text);
    // Elements the block's script uses that sit elsewhere on the page (a detail dialog, a toast): they come along.
    const supporting = [];
    for (const id of new Set([...script.matchAll(/(?:getElementById|\$)\(\s*['"]([^'"]+)['"]|querySelector\(\s*['"]#([\w-]+)['"]/g)].map(match => match[1] ?? match[2]))) {
      if (ids.has(id)) continue;
      const at = body.search(new RegExp(`<[a-z][\\w-]*[^>]*\\sid="${id}"`));
      if (at < 0) continue;
      let extra = "";
      try { extra = element(body, at); } catch { continue; }
      if (extra.length <= 25_000 && !extra.includes(markup) && !supporting.some(item => item.includes(extra))) supporting.push(extra);
    }
    // An element inside another one that comes along is already there (no duplicate ids).
    for (let index = supporting.length - 1; index >= 0; index--) if (supporting.some((other, at) => at !== index && other.includes(supporting[index]))) supporting.splice(index, 1);
    const title = /<h3[^>]*>([^<]+)</.exec(markup)?.[1]?.trim();
    const packages = unique([usesCharts && "chart.js", usesIcons && "lucide"]);
    const snippet = `<!-- ${block.name} · ${block.id}: from the ${BLOCKS.collection} (Curialy component library). Sample data is fictional.
     Needs the stylesheet styles/${BLOCKS.tokens}.css, and an ancestor with class="${scope}". -->
${packages.includes("chart.js") ? `<script src="https://cdn.jsdelivr.net/npm/chart.js@${PACKAGES["chart.js"]}/dist/chart.umd.min.js"></script>\n` : ""}${packages.includes("lucide") ? `<script src="https://cdn.jsdelivr.net/npm/lucide@${PACKAGES.lucide}/dist/umd/lucide.min.js"></script>\n` : ""}<div class="${scope}">
${markup}${supporting.length ? `\n<!-- Used by this block's script (elsewhere on the page it came from): -->\n${supporting.join("\n")}` : ""}
</div>
<script>
${[...setup, script].filter(Boolean).join("\n")}
</script>
`;
    const preview = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${block.name} · ${block.id}</title>
${fonts.map(href => `<link rel="stylesheet" href="${href}">`).join("\n")}
<style>html,body{margin:0;background:${tokenSet.colors.background}}.preview-root{padding:24px;max-width:1180px;margin:0 auto}</style>
<style>${scoped}</style>
</head><body><div class="preview-root" data-component="${block.id}">
${snippet}
</div>${block.previewRun ? `\n<script>/* Preview only: show it open. */ ${block.previewRun}</script>` : ""}</body></html>`;
    const meta = {
      id: block.id,
      name: block.name,
      description: block.description + (title && !block.name.toLowerCase().includes(title.toLowerCase()) ? ` (In the source: "${title}".)` : ""),
      category: block.category,
      batch: block.batch,
      collection: BLOCKS.collection,
      kind: block.composes ? "pattern" : "component",
      role: block.role,
      tags: unique([...block.tags, ...lexiconTags(`${block.name} ${block.description}`), tokenSet.mode === "dark" ? "dark-theme" : "light-theme"]),
      capabilities: unique([...block.capabilities, ...capabilities(markup + script, null)]),
      dependencies: [...packages.map(pkg => ({ type: "package", name: pkg, version: PACKAGES[pkg] })), { type: "stylesheet", id: BLOCKS.tokens }, { type: "tokens", id: BLOCKS.tokens }],
      compatible_tools: block.tools,
      frameworks: ["html"],
      implementations: [{ framework: "html", file: "component.html", origin: "page-block" }],
      layout: { role: block.role, span: block.role === "navigation" ? "rail" : ["header", "table", "timeline", "kpi", "section"].includes(block.role) ? "full" : "half" },
      style: { tokens: BLOCKS.tokens, mode: tokenSet.mode, colors: colorRoles(markup + script, tokenSet, Object.fromEntries(Object.entries(tokenSet.aliases ?? {}).map(([hex, role]) => [hex, role]))) },
      source: { file: `${path.basename(BLOCKS.dir ?? ATLAS)}/${BLOCKS.file}`, ref: `${block.find[0].replace(/^</, "")} #${block.find[1]}` },
      ...(BLOCKS.archetype ? { archetype: BLOCKS.archetype } : {}),
      ...(block.previewWidth ? { preview: { width: block.previewWidth } } : {}),
      ...(block.composes ? { composes: block.composes } : {}),
      status: notes.length ? "needs-review" : "active",
      quality: { compiled: !notes.length, rendered: null, notes },
      generated_by: GENERATOR,
      version: 1,
    };
    write(block.id, { "component.json": `${JSON.stringify(meta, null, 2)}\n`, "component.html": snippet, "preview.html": preview });
    results.push({ ...meta, _title: title });
  }
  return results;
}

// ---- Run ----

fs.mkdirSync(OUT, { recursive: true });
// Only folders this importer made are replaced (a hand-registered component is never touched).
for (const name of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
  const file = path.join(OUT, name, "component.json");
  if (!fs.existsSync(file)) continue;
  const meta = JSON.parse(fs.readFileSync(file, "utf8"));
  if (meta.generated_by !== GENERATOR) continue;
  previous.set(name, meta.quality ?? {});
}
const tokensDir = path.join(LIBRARY, "tokens");
fs.mkdirSync(tokensDir, { recursive: true });
for (const [id, set] of Object.entries(TOKEN_SETS)) {
  for (const role of ROLES) if (!set.colors[role]) throw new Error(`token set ${id} has no ${role}`);
  fs.writeFileSync(path.join(tokensDir, `${id}.json`), `${JSON.stringify({ id, ...set }, null, 2)}\n`);
}
const summary = [];
for (const family of FAMILIES) {
  const { results, errors } = importFamily(family);
  summary.push(`${family.file}: ${results.length} components (${results.filter(meta => meta.status !== "active").length} need review)${errors.length ? `; page script notes: ${errors.join("; ")}` : ""}`);
  for (const meta of results.filter(meta => meta.status !== "active")) summary.push(`  ${meta.id}: ${meta.quality.notes.join("; ")}`);
}
const blocks = importBlocks(BLOCKS);
summary.push(`${BLOCKS.file}: ${blocks.length} components`);
// The anime archetypes' blocks (from anime-templates/archetypes.json, written by export-archetypes.mts).
const ANIME = path.join(LIBRARY, "anime-templates");
for (const collection of animeCollections(JSON.parse(fs.readFileSync(path.join(ANIME, "archetypes.json"), "utf8")), ANIME)) {
  const made = importBlocks(collection);
  summary.push(`${collection.file}: ${made.length} components`);
  for (const block of made) summary.push(`  ${block.id}: "${block._title ?? "?"}" ${block.status}`);
}
for (const block of blocks) summary.push(`  ${block.id}: "${block._title ?? "?"}" ${block.dependencies.filter(dep => dep.type === "package").map(dep => dep.name).join("+") || "markup only"}`);
// Only after everything was written: generated components that no longer exist in the sources go
// (a run that fails halfway leaves the library as it was, with its render results).
if (!ONLY) for (const name of previous.keys()) if (!written.has(name)) { fs.rmSync(path.join(OUT, name), { recursive: true, force: true }); summary.push(`removed ${name} (no longer in the sources)`); }
console.log(summary.join("\n"));
