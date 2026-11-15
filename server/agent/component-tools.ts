import type Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import { z } from "zod";
import { toolLabel, type ComponentMeta } from "@shared/components";
import { compose, planText } from "../components/compose";
import { componentsFor, implementation, registry, stylesheet, type Entry, type TokenSet } from "../components/registry";
import { adaptSource, tokensCss, tokensModule } from "../components/adapt";
import { query } from "../db/pg";
import { taskOwner } from "./store";
import { readWorkspaceFile, writeWorkspaceFile } from "./sandbox";
import type { ToolContext, ToolOutcome } from "./tools";

// The agent's way into the component library. find_components plans (metadata only, whatever the
// library's size); add_components copies the chosen components into the workspace adapted to one
// theme, so their source never has to pass through the model; load_component reads one when the
// agent needs to see it; save_component keeps something the agent built as a candidate for this
// account's later tasks. The tools the user selected for the task limit what is used.

export const COMPONENT_SCHEMAS = {
  find_components: z.object({
    request: z.string().trim().min(3).max(4000),
    needs: z.array(z.string().trim().min(2).max(200)).max(24).optional(),
    framework: z.enum(["react", "html", "any"]).default("any"),
    theme: z.string().trim().max(60).optional(),
  }),
  load_component: z.object({ id: z.string().trim().min(2).max(80), framework: z.enum(["react", "html"]).optional(), theme: z.string().trim().max(60).optional() }),
  add_components: z.object({
    ids: z.array(z.string().trim().min(2).max(80)).min(1).max(24),
    theme: z.string().trim().max(60).optional(),
    dir: z.string().trim().min(1).max(200).default("src/components/library"),
  }),
  save_component: z.object({
    path: z.string().trim().min(1).max(300),
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(600),
    category: z.string().trim().min(2).max(60),
    role: z.enum(["navigation", "header", "section", "filters", "kpi", "chart", "table", "insight", "timeline", "form", "content"]).default("content"),
    tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  }),
};

export type ComponentToolName = keyof typeof COMPONENT_SCHEMAS;
export const COMPONENT_TOOL_NAMES = Object.keys(COMPONENT_SCHEMAS) as ComponentToolName[];
/** In chat mode (no workspace) the agent can plan and read, not copy or save. */
export const COMPONENT_READ_TOOLS: ComponentToolName[] = ["find_components", "load_component"];

export const COMPONENT_TOOLS: (Anthropic.Tool & { name: ComponentToolName })[] = [
  {
    name: "find_components",
    description: "Search the Curialy component library — every category and batch: charts and data visualization (finance, statistics, network, geospatial, scientific, timelines…), dashboard and analytics blocks (KPI cards, insight cards, sections), navigation, tables and more — for what an interface needs, and get one composition plan: for each need the best component or that none exists, the layout regions, one design theme for all of them, and the packages and stylesheets they need. Call it before writing UI code for a dashboard, chart, website or app screen. request: the user's request. needs: the parts you identified (each a short phrase, e.g. \"revenue over time\", \"API logs table\"); optional but sharper.",
    input_schema: {
      type: "object",
      properties: {
        request: { type: "string" },
        needs: { type: "array", items: { type: "string" }, description: "The parts the interface needs, one short phrase each" },
        framework: { type: "string", enum: ["react", "html", "any"], description: "Default any" },
        theme: { type: "string", description: "A token set id to use for everything (default: the plan's choice)" },
      },
      required: ["request"],
    },
  },
  {
    name: "add_components",
    description: "Copy library components into the workspace, adapted to one design theme: React components as .jsx files, HTML blocks as .html snippets, the stylesheets they need, and tokens.css / tokens.js with the theme as CSS variables (--cx-*) for the parts you build. Returns each file's path, its export, props and the packages to install. The source isn't shown to you; read a file when you need to.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Component ids from find_components" },
        theme: { type: "string", description: "Token set id (default: the one most of these components share)" },
        dir: { type: "string", description: "Workspace folder, default src/components/library" },
      },
      required: ["ids"],
    },
  },
  {
    name: "load_component",
    description: "Read one library component's source (adapted to a theme when given) and how to use it. Prefer add_components to put components into the workspace; use this to inspect one before adapting it.",
    input_schema: { type: "object", properties: { id: { type: "string" }, framework: { type: "string", enum: ["react", "html"] }, theme: { type: "string" } }, required: ["id"] },
  },
  {
    name: "save_component",
    description: "Save a reusable component you built (a .jsx, .tsx or .html file in the workspace) to this account's component library as a candidate, so later tasks find it with find_components. Only for reusable parts (a chart, card, table, section), not whole pages or app-specific code.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" }, name: { type: "string" }, description: { type: "string" }, category: { type: "string", description: "e.g. data-visualization, navigation, data-management, layout" },
        role: { type: "string", enum: ["navigation", "header", "section", "filters", "kpi", "chart", "table", "insight", "timeline", "form", "content"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["path", "name", "description", "category", "tags"],
    },
  },
];

/** The request is interface, dashboard or chart work (the kind the library is for). */
export function wantsComponents(text: string) {
  return /\b(dashboards?|charts?|graphs?|visuali[sz]\w*|plots?|analytics|kpis?|metrics|tables?|sidebar|navbar|nav bar|landing page|website|web ?page|web app|ui|ux|interface|components?|screens?|widgets?|heat ?maps?|maps?|terminal|admin panel|report page)\b/i.test(text);
}

/**
 * What the agent is told about the library (a fixed-size block: it doesn't grow with the library,
 * which is searched on demand and never listed in the prompt).
 */
export function componentsContext(tools: string[], mode: "agent" | "chat") {
  const snapshot = registry();
  if (!snapshot.components.length) return "";
  const categories = [...new Set(snapshot.components.map(entry => entry.category))].sort();
  const selected = tools.length ? tools.map(toolLabel).join(", ") : "not limited (the user selected none)";
  return [
    `Component library: ${snapshot.components.length} reusable components in ${categories.length} categories (${categories.join(", ")}), from many batches. It grows over time: never assume what it holds, search it.`,
    "- Before writing UI code for a dashboard, chart, website or app screen, call find_components with the user's request and the needs you identify (one short phrase each). It searches the whole library and returns one plan: the best component for each need across every category and batch, one design theme, the layout regions and the dependencies.",
    mode === "agent"
      ? "- Then add_components with the plan's ids copies them into the workspace adapted to that theme (their source stays out of the conversation). Build the parts the plan marks \"build\" yourself with the theme's tokens.css variables, so everything looks like one product."
      : "- In chat mode you can explain and show components (load_component); building them into a project needs agent mode.",
    "- Use only components find_components returned, and never say the library has a component for a need it marked \"build\". Quality over quantity: leave out components the request doesn't need.",
    `- Tools the user selected for this task: ${selected}.${tools.length ? " When the plan says a need belongs to a tool that isn't selected, explain what is missing and ask the user to enable that tool rather than using it." : ""}`,
    ...(mode === "agent" ? ["- A reusable part you had to build (a chart, card, table, section) can be kept for later tasks with save_component."] : []),
  ].join("\n");
}

// ---- Candidates (an account's own saved components) ----

const candidateCache = new Map<string, { at: number; entries: Entry[] }>();

type CandidateRow = { id: string; meta: ComponentMeta; framework: string; source: string };

export async function candidatesFor(owner: string | null): Promise<Entry[]> {
  if (!owner) return [];
  const cached = candidateCache.get(owner);
  if (cached && Date.now() - cached.at < 30_000) return cached.entries;
  const { rows } = await query<CandidateRow>("SELECT id, meta, framework, source FROM curialy.component_candidates WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 200", [owner]);
  const entries = rows.map(row => ({ ...row.meta, id: row.id, status: "candidate" as const, dir: "", owner, inline: { [row.meta.implementations[0]?.file ?? "component"]: row.source } } as Entry));
  candidateCache.set(owner, { at: Date.now(), entries });
  return entries;
}

// ---- Helpers ----

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const pascal = (text: string) => text.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ? next.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "").replace(/^./, first => first.toUpperCase()) || "Component";

function themeFor(entries: Entry[], requested: string | undefined, tokens: Map<string, TokenSet>): TokenSet | null {
  if (requested) return tokens.get(requested) ?? null;
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.style?.tokens) counts.set(entry.style.tokens, (counts.get(entry.style.tokens) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? tokens.get(top) ?? null : null;
}

/** "export default function X({ a = 1, b })" → "X({ a, b })". */
function signature(source: string) {
  const match = /export\s+default\s+function\s+(\w+)\s*\(([^)]*)\)/.exec(source);
  if (!match) return /export\s+default\s+(\w+)/.exec(source)?.[1] ?? "default export";
  const props = [...match[2].matchAll(/([A-Za-z_$][\w$]*)\s*(?==|,|}|$)/g)].map(item => item[1]).filter(name => !["props"].includes(name));
  return `${match[1]}(${props.length ? `{ ${[...new Set(props)].join(", ")} }` : ""})`;
}

const packageLine = (entries: Entry[]) => {
  const versions = new Map<string, string>();
  for (const entry of entries) for (const dep of entry.dependencies) if (dep.type === "package" && dep.name !== "lucide") versions.set(dep.name, dep.version);
  return [...versions.entries()].map(([name, version]) => `${name}@${version}`);
};

async function context(ctx: Pick<ToolContext, "sessionId">) {
  const owner = await taskOwner(ctx.sessionId).catch(() => null);
  const candidates = await candidatesFor(owner).catch(() => []);
  const entries = componentsFor(owner, candidates);
  return { owner, entries, byId: new Map(entries.map(entry => [entry.id, entry])), snapshot: registry() };
}

function unknown(ids: string[], byId: Map<string, Entry>) {
  return ids.filter(id => !byId.has(id));
}

// ---- The tools ----

export async function runComponentTool(name: ComponentToolName, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const { owner, entries, byId, snapshot } = await context(ctx);
  if (!snapshot.components.length) return { ok: false, content: "The component library is empty on this server.", summary: "No library" };
  const selectedTools = ctx.selectedTools ?? [];

  if (name === "find_components") {
    const input = rawInput as z.infer<typeof COMPONENT_SCHEMAS.find_components>;
    const { plan } = compose({ request: input.request, needs: input.needs, tools: selectedTools, framework: input.framework, theme: input.theme, owner, candidates: entries.filter(entry => entry.owner) });
    const matched = plan.needs.filter(need => need.status === "matched").length;
    return { ok: true, content: planText(plan), summary: `${plan.components.length} components · ${matched}/${plan.needs.length} needs matched · ${plan.categories.length} categories` };
  }

  if (name === "load_component") {
    const input = rawInput as z.infer<typeof COMPONENT_SCHEMAS.load_component>;
    const entry = byId.get(input.id);
    if (!entry) return { ok: false, content: `No component "${input.id}". Use find_components to see what exists.`, summary: "Unknown component" };
    if (selectedTools.length && !entry.compatible_tools.some(tool => selectedTools.includes(tool))) {
      return { ok: false, content: `${entry.name} belongs to ${entry.compatible_tools.map(toolLabel).join(" / ")}, which the user didn't select for this task. Ask them to enable it before using this component.`, summary: "Tool not selected" };
    }
    const impl = implementation(entry, input.framework);
    if (!impl) return { ok: false, content: `${entry.name} has no ${input.framework ?? ""} implementation (it has: ${entry.frameworks.join(", ") || "none"}).`, summary: "No implementation" };
    const theme = input.theme ? snapshot.tokens.get(input.theme) ?? null : null;
    if (input.theme && !theme) return { ok: false, content: `No token set "${input.theme}". Token sets: ${[...snapshot.tokens.keys()].join(", ")}.`, summary: "Unknown theme" };
    const adapted = adaptSource(impl.source, entry, theme);
    const styles = entry.dependencies.filter(dep => dep.type === "stylesheet").map(dep => dep.id);
    const clipped = adapted.source.length > 60_000 ? `${adapted.source.slice(0, 60_000)}\n… (cut at 60,000 characters: add_components writes the whole file)` : adapted.source;
    return {
      ok: true,
      summary: `${entry.id} (${impl.framework}, ${adapted.source.length} chars)`,
      content: [`${entry.name} · ${entry.id} · ${impl.framework} · ${entry.category}/${entry.batch} · status ${entry.status}`, entry.description,
        `Packages: ${packageLine([entry]).join(", ") || "none"}${styles.length ? ` · stylesheet: ${styles.join(", ")} (add_components writes it)` : ""}${adapted.swapped ? ` · ${adapted.swapped} colours adapted to ${theme!.id}` : ""}`,
        "", clipped].join("\n"),
    };
  }

  if (name === "add_components") {
    const input = rawInput as z.infer<typeof COMPONENT_SCHEMAS.add_components>;
    const missing = unknown(input.ids, byId);
    if (missing.length) return { ok: false, content: `No component ${missing.map(id => `"${id}"`).join(", ")}. Use find_components to see what exists.`, summary: "Unknown component" };
    const chosen = [...new Set(input.ids)].map(id => byId.get(id)!);
    const blocked = selectedTools.length ? chosen.filter(entry => !entry.compatible_tools.some(tool => selectedTools.includes(tool))) : [];
    if (blocked.length) return { ok: false, content: `${blocked.map(entry => `${entry.name} (${entry.compatible_tools.map(toolLabel).join(" / ")})`).join(", ")}: the user didn't select ${blocked.length > 1 ? "those tools" : "that tool"} for this task. Ask them to enable it, or leave ${blocked.length > 1 ? "these" : "this"} out.`, summary: "Tool not selected" };
    const theme = themeFor(chosen, input.theme, snapshot.tokens);
    if (input.theme && !theme) return { ok: false, content: `No token set "${input.theme}". Token sets: ${[...snapshot.tokens.keys()].join(", ")}.`, summary: "Unknown theme" };
    const dir = input.dir.replace(/\/+$/, "");
    const written: string[] = [];
    const skipped: string[] = [];
    const lines: string[] = [];
    const put = (relative: string, content: string) => {
      const before = readWorkspaceFile(ctx.root, relative);
      if (before.exists && before.content !== content && !/Curialy component library/.test(before.content.slice(0, 400))) {
        skipped.push(`${relative} (a file of yours is there: not replaced)`);
        return false;
      }
      const previous = before.exists ? before.content : "";
      writeWorkspaceFile(ctx.root, relative, content);
      let added = 0;
      let removed = 0;
      for (const change of diffLines(previous, content)) { if (change.added) added += change.count ?? 0; if (change.removed) removed += change.count ?? 0; }
      const cap = 256 * 1024;
      ctx.emit({ type: "file_change", callId: ctx.callId, path: relative, kind: before.exists ? "modify" : "create", before: previous.slice(0, cap), after: content.slice(0, cap), bytesBefore: Buffer.byteLength(previous), bytesAfter: Buffer.byteLength(content), added, removed, truncated: previous.length > cap || content.length > cap });
      ctx.onFileChange(relative);
      written.push(relative);
      return true;
    };
    const used = new Set<string>();
    for (const entry of chosen) {
      const impl = implementation(entry, entry.frameworks.includes("react") ? "react" : undefined);
      if (!impl) { skipped.push(`${entry.id} (no implementation)`); continue; }
      const adapted = adaptSource(impl.source, entry, theme);
      let base = impl.framework === "react" ? pascal(entry.name) : entry.id;
      while (used.has(base)) base = `${base}2`;
      used.add(base);
      const file = `${dir}/${base}.${impl.framework === "react" ? "jsx" : "html"}`;
      if (!put(file, adapted.source)) continue;
      lines.push(impl.framework === "react"
        ? `- ${file}: import ${base} from "./${base}.jsx" → <${signature(adapted.source).replace(/\(.*$/, "")} /> — ${signature(adapted.source)}${adapted.swapped ? ` · ${adapted.swapped} colours adapted` : ""}`
        : `- ${file}: an HTML block (markup + script) to place inside an element with class="cx-${entry.style?.tokens ?? ""}"${adapted.swapped ? ` · ${adapted.swapped} colours adapted` : ""}`);
    }
    for (const id of [...new Set(chosen.flatMap(entry => entry.dependencies.filter(dep => dep.type === "stylesheet").map(dep => dep.id)))]) {
      const css = stylesheet(id);
      if (!css) { skipped.push(`stylesheet ${id} (missing)`); continue; }
      const family = snapshot.tokens.get(id);
      const adapted = family ? adaptSource(css, { style: { tokens: id, colors: { ...family.aliases, ...Object.fromEntries(Object.entries(family.colors).map(([role, hex]) => [hex, role])) } } }, theme) : { source: css, swapped: 0 };
      if (put(`${dir}/styles/${id}.css`, adapted.source)) lines.push(`- ${dir}/styles/${id}.css: styles the ${id} blocks (load it once; they sit inside class="cx-${id}")`);
    }
    if (theme) {
      put(`${dir}/tokens.css`, tokensCss(theme));
      put(`${dir}/tokens.js`, tokensModule(theme));
      lines.push(`- ${dir}/tokens.css and tokens.js: the ${theme.name} theme as --cx-* variables and a series palette: style everything you build with them.`);
    }
    const packages = packageLine(chosen);
    const content = [
      `Added ${chosen.length} component${chosen.length === 1 ? "" : "s"}${theme ? ` in the ${theme.id} theme (${theme.mode})` : ""}:`,
      ...lines,
      packages.length ? `Install: npm install ${packages.join(" ")}` : "No packages to install.",
      chosen.some(entry => entry.network?.length) ? `Some fetch data at run time from: ${[...new Set(chosen.flatMap(entry => entry.network ?? []))].join(", ")}.` : "",
      skipped.length ? `Skipped: ${skipped.join("; ")}.` : "",
      "Sample data in them is fictional: replace it with the user's data or clearly labeled placeholders.",
    ].filter(Boolean).join("\n");
    return { ok: written.length > 0, content, summary: `${written.length} files in ${dir}` };
  }

  // save_component
  const input = rawInput as z.infer<typeof COMPONENT_SCHEMAS.save_component>;
  if (!owner) return { ok: false, content: "This task has no account to save it to.", summary: "No account" };
  const file = readWorkspaceFile(ctx.root, input.path);
  if (!file.exists) return { ok: false, content: `File not found: ${file.relative}.`, summary: "Not found" };
  const framework = /\.(jsx|tsx)$/.test(file.relative) ? "react" : /\.html?$/.test(file.relative) ? "html" : null;
  if (!framework) return { ok: false, content: "Save a .jsx, .tsx or .html file.", summary: "Not a component file" };
  if (file.content.length > 200_000) return { ok: false, content: "That file is over 200,000 characters: save a smaller, reusable part.", summary: "Too large" };
  const id = `custom-${slug(input.name)}`;
  if (snapshot.byId.has(id)) return { ok: false, content: `The library already has "${id}": choose another name.`, summary: "Name taken" };
  const implFile = framework === "react" ? "react.jsx" : "component.html";
  const meta: ComponentMeta = {
    id, name: input.name, description: input.description, category: slug(input.category), batch: "saved", collection: "Saved by your tasks", kind: "component", role: input.role,
    tags: [...new Set(input.tags.map(slug).filter(Boolean))], capabilities: [], dependencies: [], compatible_tools: input.role === "chart" ? ["data-analytics", "dashboard-builder", "frontend-development"] : ["web-design", "ui-ux-design", "dashboard-builder", "frontend-development"],
    frameworks: [framework], implementations: [{ framework, file: implFile, origin: "saved" }], layout: { role: input.role, span: "half" }, status: "candidate", quality: { rendered: null, notes: [`saved from task ${ctx.sessionId.slice(0, 8)}: not reviewed`] }, version: 1,
  };
  await query(
    `INSERT INTO curialy.component_candidates (owner_id, id, meta, framework, source, task_id) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner_id, id) DO UPDATE SET meta = EXCLUDED.meta, framework = EXCLUDED.framework, source = EXCLUDED.source, task_id = EXCLUDED.task_id, updated_at = now()`,
    [owner, id, JSON.stringify(meta), framework, file.content, ctx.sessionId],
  );
  candidateCache.delete(owner);
  return { ok: true, content: `Saved ${file.relative} as ${id}: your later tasks find it with find_components (a candidate: only your account sees it).`, summary: `Saved ${id}` };
}
