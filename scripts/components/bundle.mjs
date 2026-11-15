// Helpers for turning a staged component page into standalone modules: the top-level declarations
// a renderer needs (by reference, transitively), and the page's CSS scoped under one class so a
// component's styles never leak into the app it is placed in.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const postcss = require("postcss");

/** Browser and library globals a declaration may use freely (never bundled). */
const GLOBALS = new Set([
  "React", "ReactDOM", "Math", "JSON", "Number", "String", "Array", "Object", "Date", "Boolean", "Symbol", "Map", "Set", "WeakMap", "Promise",
  "parseInt", "parseFloat", "isNaN", "isFinite", "Infinity", "NaN", "undefined", "console", "encodeURIComponent", "decodeURIComponent", "Error", "RegExp",
  "Intl", "BigInt", "globalThis", "window", "document", "Chart", "echarts", "d3", "L", "THREE", "lucide", "setTimeout", "clearTimeout", "requestAnimationFrame",
]);
/** Declarations that touch the page itself: a module built from them would not stand alone. */
const PAGE_BOUND = /\b(document\.|getElementById|querySelector|d3\.select\(\s*["'`]#|createRoot|ReactDOM\.render|addEventListener\()/;

/** Identifiers a node refers to (not property names, object keys or its own parameters' names). */
export function references(node, out = new Set()) {
  const visit = (current, parent, key) => {
    if (!current || typeof current.type !== "string") return;
    if (current.type === "Identifier") {
      const isProperty = (parent?.type === "MemberExpression" || parent?.type === "OptionalMemberExpression") && key === "property" && !parent.computed;
      const isKey = (parent?.type === "ObjectProperty" || parent?.type === "ObjectMethod") && key === "key" && !parent.computed;
      if (!isProperty && !isKey) out.add(current.name);
      return;
    }
    if (current.type === "JSXIdentifier") {
      if (parent?.type === "JSXOpeningElement" && /^[A-Z]/.test(current.name)) out.add(current.name);
      return;
    }
    for (const [childKey, child] of Object.entries(current)) {
      if (childKey === "loc" || childKey === "start" || childKey === "end" || childKey === "leadingComments" || childKey === "trailingComments") continue;
      if (Array.isArray(child)) for (const item of child) visit(item, current, childKey);
      else if (child && typeof child.type === "string") visit(child, current, childKey);
    }
  };
  visit(node, null, null);
  return out;
}

/** Top-level declarations of a script: name → { node, text, refs, pageBound }. */
export function declarations(code) {
  const ast = parse(code, { sourceType: "script", plugins: ["jsx"], errorRecovery: false });
  const byName = new Map();
  for (const node of ast.program.body) {
    const names = node.type === "FunctionDeclaration" || node.type === "ClassDeclaration" ? [node.id.name]
      : node.type === "VariableDeclaration" ? node.declarations.flatMap(d => (d.id.type === "Identifier" ? [d.id.name] : [])) : [];
    if (!names.length) continue;
    const text = code.slice(node.start, node.end);
    // One entry per statement, shared by every name it declares (so it is emitted once). Only what
    // runs at load can read a page that isn't there: a function touches the page when it is called.
    const deferred = node.type === "FunctionDeclaration" || (node.type === "VariableDeclaration" && node.declarations.every(d => d.init && /^(ArrowFunctionExpression|FunctionExpression)$/.test(d.init.type)));
    const entry = { node, text, start: node.start, refs: references(node), pageBound: !deferred && PAGE_BOUND.test(text) };
    for (const name of names) byName.set(name, entry);
  }
  return byName;
}

/**
 * The declarations `entries` need, in source order. Throws when one of them touches the page
 * (a DOM lookup at load time): such a renderer can't be lifted out on its own.
 */
export function closure(byName, entries, { allowPage = false, skip = new Set() } = {}) {
  const wanted = new Set();
  const queue = [...entries];
  while (queue.length) {
    const name = queue.shift();
    // A page's own declaration wins over a library global of the same name (its L() helper is not Leaflet).
    if (wanted.has(name) || skip.has(name) || !byName.has(name)) continue;
    const declaration = byName.get(name);
    if (declaration.pageBound && !allowPage) throw new Error(`${name} reads the page (${declaration.text.match(PAGE_BOUND)[0]}…)`);
    wanted.add(name);
    for (const ref of declaration.refs) if (!wanted.has(ref)) queue.push(ref);
  }
  const statements = [...new Set([...wanted].map(name => byName.get(name)))].sort((a, b) => a.start - b.start);
  return statements.map(statement => statement.text).join("\n");
}

/**
 * The page's CSS with every rule under `.scope`: :root, html and body become the scope itself;
 * @font-face and @keyframes stay as they are; @import (web fonts) is returned separately.
 */
export function scopeCss(css, scope) {
  const root = postcss.parse(css);
  const imports = [];
  root.walkAtRules("import", rule => { imports.push(rule.params); rule.remove(); });
  root.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.flatMap(selector => {
      const trimmed = selector.trim();
      if (/^(:root|html|body)$/i.test(trimmed)) return [`.${scope}`];
      const replaced = trimmed.replace(/^(:root|html|body)\b\s*/i, "");
      if (replaced !== trimmed) return [`.${scope} ${replaced}`];
      // "*" and "*::before" reach the scope element too.
      if (trimmed.startsWith("*")) return [`.${scope} ${trimmed}`, `.${scope}${trimmed.slice(1)}`];
      return [`.${scope} ${trimmed}`];
    });
  });
  return { css: root.toString(), imports };
}
