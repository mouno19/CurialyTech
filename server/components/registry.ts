import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ComponentMeta } from "@shared/components";

// The unified component registry: every component of every batch and category is a folder
// component-library/components/<id>/ with a component.json (metadata) and its implementation
// files. Registering a component is adding a folder (see component-library/README.md); the
// registry finds it on its next look (folders are re-read when the directory changes, at most
// every few seconds), with no code or orchestration change. Metadata is held in memory;
// implementation files are read only when a component is used (and kept in a small cache).
// Components an account's agent saved are candidates: only that account's tasks see them.

export const LIBRARY_DIR = process.env.COMPONENT_LIBRARY_DIR || path.resolve(process.cwd(), "component-library");
const RECHECK_MS = 5_000;

const dependency = z.discriminatedUnion("type", [
  z.object({ type: z.literal("package"), name: z.string().min(1), version: z.string().min(1) }),
  z.object({ type: z.literal("component"), id: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal("tokens"), id: z.string().min(1) }),
  z.object({ type: z.literal("stylesheet"), id: z.string().min(1) }),
]);
const role = z.enum(["navigation", "header", "section", "filters", "kpi", "chart", "table", "insight", "timeline", "form", "content"]);
const framework = z.enum(["react", "html", "vue", "svelte"]);

export const componentSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, "lowercase letters, digits and dashes"),
  name: z.string().min(2).max(160),
  description: z.string().min(10).max(2000),
  category: z.string().min(2).max(60),
  batch: z.string().min(2).max(60),
  collection: z.string().max(120).optional(),
  kind: z.enum(["component", "pattern"]).default("component"),
  role: role.default("content"),
  tags: z.array(z.string().min(1).max(60)).max(80).default([]),
  capabilities: z.array(z.string().min(1).max(60)).max(40).default([]),
  dependencies: z.array(dependency).max(40).default([]),
  compatible_tools: z.array(z.string().min(1).max(60)).min(1).max(12),
  frameworks: z.array(framework).default([]),
  implementations: z.array(z.object({ framework, file: z.string().regex(/^[\w.-]+$/, "a file in the component's folder"), origin: z.string().optional() })).default([]),
  layout: z.object({ role, span: z.enum(["rail", "full", "wide", "half", "third"]).optional() }).optional(),
  style: z.object({ tokens: z.string(), mode: z.enum(["light", "dark"]).optional(), colors: z.record(z.string(), z.string()).optional() }).optional(),
  variant_of: z.string().optional(),
  /** The style archetype a block comes from (the design mixes several; see server/agent/design/synthesis.ts). */
  archetype: z.string().optional(),
  /** The width its preview is checked at (a phone-only block). */
  preview: z.object({ width: z.number().int().min(280).max(2560) }).optional(),
  composes: z.array(z.string()).optional(),
  network: z.array(z.string()).optional(),
  source: z.object({ file: z.string(), ref: z.string().optional() }).optional(),
  status: z.enum(["active", "needs-review", "candidate", "deprecated"]).default("active"),
  quality: z.object({ compiled: z.boolean().optional(), rendered: z.boolean().nullable().optional(), checked_at: z.string().optional(), notes: z.array(z.string()).optional(), hash: z.string().optional() }).optional(),
  version: z.number().int().positive().optional(),
  generated_by: z.string().optional(),
});

export type TokenSet = {
  id: string; name: string; mode: "light" | "dark"; source?: string;
  colors: Record<string, string>; fonts: Record<string, string>; radius?: Record<string, string>; spacing?: string;
  /** A family's own colours with no role of their own, mapped to the role they adapt as. */
  aliases?: Record<string, string>;
  /** Colours of the source the library copy replaced with a text-safe shade (source → shade). */
  replaced?: Record<string, string>;
};

export type Concept = { id: string; tools: string[]; role: string; terms: string[] };
export type Product = { id: string; match: string[]; implies: string[]; /** Tags whose components suit this kind of product a little better. */ prefer?: string[] };

/** A registered component: its metadata, where it lives, and whose it is (null: the library's). inline: a saved candidate's files. */
export type Entry = ComponentMeta & { dir: string; owner: string | null; inline?: Record<string, string> };

export type Snapshot = {
  components: Entry[];
  byId: Map<string, Entry>;
  tokens: Map<string, TokenSet>;
  concepts: Concept[];
  products: Product[];
  /** Folders that could not be registered, and why (shown to the operator, never fatal). */
  problems: string[];
  signature: string;
  loadedAt: number;
};

let snapshot: Snapshot | null = null;
let checkedAt = 0;

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Changes when a component folder or file is added, removed or edited. */
function signatureOf(dir: string) {
  const parts: string[] = [];
  for (const sub of ["components", "tokens"]) {
    const root = path.join(dir, sub);
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root).sort()) {
      const file = sub === "components" ? path.join(root, name, "component.json") : path.join(root, name);
      try { parts.push(`${sub}/${name}:${fs.statSync(file).mtimeMs}`); } catch { parts.push(`${sub}/${name}:-`); }
    }
  }
  try { parts.push(`vocabulary:${fs.statSync(path.join(dir, "vocabulary.json")).mtimeMs}`); } catch { /* none */ }
  return parts.join("|");
}

function load(dir: string, signature: string): Snapshot {
  const problems: string[] = [];
  const components: Entry[] = [];
  const byId = new Map<string, Entry>();
  const root = path.join(dir, "components");
  for (const name of fs.existsSync(root) ? fs.readdirSync(root).sort() : []) {
    const folder = path.join(root, name);
    const file = path.join(folder, "component.json");
    if (!fs.existsSync(file)) continue;
    let parsed: z.infer<typeof componentSchema>;
    try {
      const result = componentSchema.safeParse(readJson(file));
      if (!result.success) { problems.push(`${name}: ${result.error.issues.slice(0, 3).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`); continue; }
      parsed = result.data;
    } catch (error) {
      problems.push(`${name}: component.json is not valid JSON (${error instanceof Error ? error.message.slice(0, 80) : "?"})`);
      continue;
    }
    if (parsed.id !== name) { problems.push(`${name}: its id is "${parsed.id}" (the folder must be named after the id)`); continue; }
    if (byId.has(parsed.id)) { problems.push(`${name}: duplicate id`); continue; }
    const missing = parsed.implementations.filter(impl => !fs.existsSync(path.join(folder, impl.file)));
    if (missing.length) problems.push(`${name}: missing ${missing.map(impl => impl.file).join(", ")}`);
    const entry: Entry = { ...(parsed as ComponentMeta), implementations: parsed.implementations.filter(impl => !missing.includes(impl)), dir: folder, owner: null };
    components.push(entry);
    byId.set(entry.id, entry);
  }
  const tokens = new Map<string, TokenSet>();
  const tokenRoot = path.join(dir, "tokens");
  for (const name of fs.existsSync(tokenRoot) ? fs.readdirSync(tokenRoot).filter(file => file.endsWith(".json")) : []) {
    try { const set = readJson(path.join(tokenRoot, name)) as TokenSet; tokens.set(set.id, set); } catch { problems.push(`tokens/${name}: not valid JSON`); }
  }
  let concepts: Concept[] = [];
  let products: Product[] = [];
  try { ({ concepts = [], products = [] } = readJson(path.join(dir, "vocabulary.json"))); } catch { problems.push("vocabulary.json: missing or not valid JSON (search falls back to keywords)"); }
  for (const entry of components) {
    for (const dep of entry.dependencies) {
      if (dep.type === "component" && !byId.has(dep.id)) problems.push(`${entry.id}: depends on unknown component ${dep.id}`);
      if (dep.type === "tokens" && !tokens.has(dep.id)) problems.push(`${entry.id}: unknown token set ${dep.id}`);
    }
  }
  return { components, byId, tokens, concepts, products, problems, signature, loadedAt: Date.now() };
}

/** The registry as it is on disk now (re-read when it changed; checked at most every few seconds). */
export function registry(dir = LIBRARY_DIR): Snapshot {
  const now = Date.now();
  if (snapshot && dir === LIBRARY_DIR && now - checkedAt < RECHECK_MS) return snapshot;
  checkedAt = now;
  const signature = signatureOf(dir);
  if (snapshot && snapshot.signature === signature && dir === LIBRARY_DIR) return snapshot;
  const next = load(dir, signature);
  if (dir === LIBRARY_DIR) {
    snapshot = next;
    implementationCache.clear();
  }
  return next;
}

/** Tests: forget what was loaded. */
export function resetRegistry() {
  snapshot = null;
  checkedAt = 0;
  implementationCache.clear();
}

/** The library plus an account's own candidates (those are visible to that account only). */
export function componentsFor(owner: string | null, candidates: Entry[] = []): Entry[] {
  const base = registry().components;
  const own = candidates.filter(entry => entry.owner === owner && !registry().byId.has(entry.id));
  return own.length ? [...base, ...own] : base;
}

// ---- Implementations (read on demand) ----

const implementationCache = new Map<string, string>();
const MAX_CACHED = 64;

/** A component's implementation for a framework (the first available one when not given). */
export function implementation(entry: Entry, framework?: string): { framework: string; file: string; source: string } | null {
  const impl = entry.implementations.find(item => !framework || item.framework === framework) ?? null;
  if (!impl) return null;
  if (entry.inline) {
    const source = entry.inline[impl.file];
    return source === undefined ? null : { framework: impl.framework, file: impl.file, source };
  }
  const file = path.join(entry.dir, impl.file);
  const key = `${file}:${entry.quality?.hash ?? ""}`;
  let source = implementationCache.get(key);
  if (source === undefined) {
    source = fs.readFileSync(file, "utf8");
    implementationCache.set(key, source);
    if (implementationCache.size > MAX_CACHED) implementationCache.delete(implementationCache.keys().next().value!);
  }
  return { framework: impl.framework, file: impl.file, source };
}

/** Implementation reads so far (tests check that search never loads sources). */
export const implementationReads = () => implementationCache.size;

/** A family stylesheet (component-library/styles/<id>.css). */
export function stylesheet(id: string, dir = LIBRARY_DIR): string | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const file = path.join(dir, "styles", `${id}.css`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
