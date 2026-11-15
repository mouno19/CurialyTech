import type { CompositionPlan, PlanNeed } from "@shared/components";
import { toolLabel } from "@shared/components";
import { componentsFor, registry, type Concept, type Entry, type Product, type Snapshot, type TokenSet } from "./registry";
import { conceptVector, indexFor, search, tokens, type Hit } from "./search";

// From a request to one composition plan across the whole library, in stages:
//  1. intent: the kind of product, the needs the request names, the needs that kind implies,
//     visual hints (dark, light) and which of the user's tools are relevant;
//  2-3. discovery and ranking: a search of the full registry for every need (any category, any batch);
//  4. dependencies: the packages, stylesheets, token sets and components the chosen ones need;
//  5. composition: one component per need (no duplicates, one per variant group, a pattern covering
//     its parts), one design theme the others adapt to, and the layout regions.
// A need nothing in the library covers is reported as such ("build"), never filled with an
// unrelated component; a need whose components belong to a tool the user didn't select is
// reported with that tool ("needs-tool").

/** Score from which a component is used as it is, and from which it is offered to adapt. */
export const MATCH_SCORE = 0.36;
export const ADAPT_SCORE = 0.22;

export type Requirement = { text: string; implied: boolean; concepts: string[] };
export type Intent = { product: Product | null; requirements: Requirement[]; mode: "dark" | "light" | null; relevantTools: string[] };

const clauseSplit = /\s*(?:[,;:\n]|\.\s|\band\b|\bwith\b|\bincluding\b|\binclude[sd]?\b|\bplus\b|\bwhere\b|\bthat\b|\bso\b|\bas well as\b|\balong with\b)\s*/i;
const lead = /^(?:please\s+)?(?:build|create|make|design|develop|generate|give me|i need|i want|we need|set up|code|write)\s+(?:me\s+)?(?:a|an|the|some)?\s*/i;

function detectProduct(text: string, products: Product[]) {
  const lower = ` ${text.toLowerCase()} `;
  let best: Product | null = null;
  let length = 0;
  for (const product of products) {
    for (const phrase of product.match) {
      if (lower.includes(` ${phrase} `) || lower.includes(` ${phrase},`) || lower.includes(` ${phrase}.`)) {
        if (phrase.length > length) { best = product; length = phrase.length; }
      }
    }
  }
  return best;
}

const conceptIds = (text: string, concepts: Concept[]) => [...conceptVector(text, concepts).keys()];

/** Stage 1: what the request asks for (or the needs the agent already worked out, when given). */
export function analyze(request: string, needs: string[] | undefined, snapshot: Snapshot): Intent {
  const { concepts, products } = snapshot;
  const product = detectProduct(request, products);
  const lower = request.toLowerCase();
  const mode = /\b(dark|night|terminal|neon)\b/.test(lower) ? "dark" : /\b(light|bright|paper|white)\b/.test(lower) ? "light" : null;
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  const add = (text: string, implied: boolean) => {
    const clean = text.replace(lead, "").replace(/^(?:a|an|the)\s+/i, "").replace(/[.!?…]+$/, "").trim();
    if (clean.length < 3 || !tokens(clean).length) return;
    const ids = conceptIds(clean, concepts);
    const key = tokens(clean).sort().join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    requirements.push({ text: clean, implied, concepts: ids });
  };
  if (needs?.length) {
    for (const need of needs) add(need, false);
  } else {
    // A fragment about nothing (a name in a list: "compare Claude, GPT, Gemini") belongs to the one before it.
    const clauses: string[] = [];
    // Phrases with "and" in them ("drag and drop", "profit and loss") are one thing, not two.
    const joined = concepts.flatMap(concept => concept.terms).filter(term => term.includes(" and "));
    let protectedRequest = request;
    for (const term of joined) protectedRequest = protectedRequest.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), match => match.replace(/ and /gi, " \u0000 "));
    for (const raw of protectedRequest.split(clauseSplit).map(item => item.trim()).filter(Boolean)) {
      const part = raw.replace(/ \u0000 /g, " and ");
      if (clauses.length && !conceptIds(part, concepts).length && tokens(part).length <= 2) clauses[clauses.length - 1] += `, ${part}`;
      else clauses.push(part);
    }
    clauses.forEach((clause, index) => {
      // The opening clause usually names the product ("a financial analytics dashboard for…"): the
      // product itself isn't one of its parts, but what qualifies it ("financial analytics") is.
      const phrase = index === 0 && product ? product.match.find(item => clause.toLowerCase().includes(item)) : undefined;
      if (phrase) {
        const qualifier = clause.toLowerCase().replace(lead, "").replace(new RegExp(`\\b${phrase}\\b.*$`), "").replace(/\b(modern|premium|simple|clean|new|beautiful|sleek|saas|an?|the)\b/g, " ").trim();
        if (qualifier && conceptIds(qualifier, concepts).length) add(qualifier, false);
        return;
      }
      add(clause, false);
    });
    if (!requirements.length && !product) add(request, false);
  }
  // What the kind of product needs although the request didn't say it.
  const covered = new Set(requirements.flatMap(req => req.concepts));
  for (const implied of product?.implies ?? []) {
    const ids = conceptIds(implied, concepts);
    if (ids.length && ids.every(id => covered.has(id))) continue;
    add(implied, true);
    for (const id of ids) covered.add(id);
  }
  const relevantTools = [...new Set(requirements.flatMap(req => req.concepts).flatMap(id => concepts.find(concept => concept.id === id)?.tools ?? []))];
  return { product, requirements, mode, relevantTools };
}

const SPAN_ORDER = ["navigation", "header", "section", "filters", "kpi", "chart", "table", "timeline", "insight", "form", "content"];
const REGION: Record<string, string> = {
  navigation: "Navigation (side rail)", header: "Top bar and page header", section: "Sections", filters: "Filters and date range", kpi: "KPI row",
  chart: "Charts grid", table: "Tables", timeline: "Timeline", insight: "Insights", form: "Forms and settings", content: "Content",
};

const version = (value: string) => value.replace(/^[^\d]*/, "").split(".").map(part => Number.parseInt(part, 10) || 0);
const newer = (a: string, b: string) => { const [x, y] = [version(a), version(b)]; for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };

/**
 * Stage 4: the closure of what the chosen components need — other components they depend on
 * (recursively, cycles reported), packages (one version each: the newest; a different major
 * version is reported as a conflict), stylesheets, token sets and the hosts they fetch from.
 */
export function resolveDependencies(chosen: Entry[], byId: Map<string, Entry>) {
  const components = new Map<string, Entry>(chosen.map(entry => [entry.id, entry]));
  const added: string[] = [];
  const cycles: string[] = [];
  const visit = (entry: Entry, trail: string[]) => {
    for (const dep of entry.dependencies) {
      if (dep.type !== "component") continue;
      if (trail.includes(dep.id)) { cycles.push([...trail, dep.id].join(" → ")); continue; }
      const next = byId.get(dep.id);
      if (!next) continue;
      if (!components.has(next.id)) { components.set(next.id, next); added.push(next.id); }
      visit(next, [...trail, dep.id]);
    }
  };
  for (const entry of chosen) visit(entry, [entry.id]);
  const packages = new Map<string, { name: string; version: string; conflict?: string }>();
  const stylesheets = new Set<string>();
  const tokenSets = new Set<string>();
  const network = new Set<string>();
  for (const entry of components.values()) {
    for (const dep of entry.dependencies) {
      if (dep.type === "package") {
        const current = packages.get(dep.name);
        if (!current) packages.set(dep.name, { name: dep.name, version: dep.version });
        else if (current.version !== dep.version) {
          const major = (v: string) => version(v)[0];
          const [winner, older] = newer(dep.version, current.version) ? [dep.version, current.version] : [current.version, dep.version];
          const conflict = major(dep.version) !== major(current.version) ? `${winner} and ${older} are different major versions` : current.conflict;
          packages.set(dep.name, { name: dep.name, version: winner, ...(conflict ? { conflict } : {}) });
        }
      } else if (dep.type === "stylesheet") stylesheets.add(dep.id);
      else if (dep.type === "tokens") tokenSets.add(dep.id);
    }
    for (const host of entry.network ?? []) network.add(host);
  }
  return { components: [...components.values()], added, cycles, packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)), stylesheets: [...stylesheets], tokens: [...tokenSets], network: [...network] };
}

/**
 * The design theme everything is adapted to: the one asked for; else the family most chosen
 * components share (in the look the request asks for, when it asks); else, when none of them has
 * that look, the family with that look that the search found most for this request.
 */
function chooseTheme(chosen: Entry[], tokenSets: Map<string, TokenSet>, mode: "dark" | "light" | null, requested?: string, found: Entry[] = []) {
  if (requested && tokenSets.has(requested)) return { set: tokenSets.get(requested)!, reason: "requested" };
  const counts = new Map<string, number>();
  for (const entry of chosen) if (entry.style?.tokens) counts.set(entry.style.tokens, (counts.get(entry.style.tokens) ?? 0) + (entry.layout?.span === "full" || entry.kind === "pattern" ? 2 : 1));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => tokenSets.get(id)).filter((set): set is TokenSet => Boolean(set));
  const nearby = () => {
    const counts = new Map<string, number>();
    for (const entry of found) if (entry.style?.tokens && tokenSets.get(entry.style.tokens)?.mode === mode) counts.set(entry.style.tokens, (counts.get(entry.style.tokens) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? tokenSets.get(top) : undefined;
  };
  const fitting = mode ? ranked.find(set => set.mode === mode) ?? nearby() ?? [...tokenSets.values()].find(set => set.mode === mode) : ranked[0];
  const set = fitting ?? ranked[0] ?? [...tokenSets.values()][0];
  return { set, reason: mode && set?.mode === mode ? `the request asks for a ${mode} look; most chosen components that fit it are from this family` : "most of the chosen components are from this family" };
}

export type ComposeInput = {
  request: string;
  /** Needs the agent identified (optional: otherwise they are read from the request). */
  needs?: string[];
  /** The tools the user selected for the task (empty or absent: not limited). */
  tools?: string[];
  framework?: "react" | "html" | "any";
  theme?: string;
  /** The task's account: its own saved candidates are searched too. */
  owner?: string | null;
  candidates?: Entry[];
};

export type Composition = { plan: CompositionPlan; chosen: Entry[]; hits: Map<string, Hit[]> };

export function compose(input: ComposeInput): Composition {
  const started = Date.now();
  const snapshot = registry();
  const entries = componentsFor(input.owner ?? null, input.candidates ?? []);
  const index = indexFor(snapshot, entries);
  const intent = analyze(input.request, input.needs, snapshot);
  const selected = (input.tools ?? []).filter(Boolean);
  const limited = selected.length > 0;
  const frameworks = input.framework && input.framework !== "any" ? [input.framework] : undefined;
  const chosen = new Map<string, Entry>();
  const covers = new Map<string, string[]>();
  const hits = new Map<string, Hit[]>();
  const needs: PlanNeed[] = [];
  let considered = 0;
  /** A good match in a framework other than the one asked for (only when one was asked for). */
  const portable = (text: string) => (frameworks
    ? search(index, text, {}, 6).find(hit => hit.score >= MATCH_SCORE && !hit.entry.frameworks.some(item => (frameworks as string[]).includes(item)) && (!limited || hit.entry.compatible_tools.some(tool => selected.includes(tool))))
    : undefined);
  for (const requirement of intent.requirements) {
    // Design consistency: the look the request asks for, and the family already chosen, rank a little higher.
    const families = new Map<string, number>();
    for (const entry of chosen.values()) if (entry.style?.tokens) families.set(entry.style.tokens, (families.get(entry.style.tokens) ?? 0) + 1);
    const dominant = [...families.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const all = search(index, requirement.text, { frameworks }, 12)
      .map(hit => ({ ...hit, score: Math.round((hit.score + (intent.mode && hit.entry.style?.mode ? (hit.entry.style.mode === intent.mode ? 0.04 : -0.04) : 0) + (dominant && hit.entry.style?.tokens === dominant ? 0.03 : 0)) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);
    considered += all.length;
    hits.set(requirement.text, all);
    const allowed = limited ? all.filter(hit => hit.entry.compatible_tools.some(tool => selected.includes(tool))) : all;
    // One per variant group (a component can serve several needs: a searchable table covers "table" and "search").
    // A closest match to adapt must at least be about the same thing as the need.
    const pick = allowed.find(hit => hit.score >= ADAPT_SCORE && (hit.score >= MATCH_SCORE || hit.concepts.length > 0 || !requirement.concepts.length)
      && !(hit.entry.variant_of && chosen.has(hit.entry.variant_of)) && ![...chosen.values()].some(entry => entry.variant_of === hit.entry.id));
    const best = all[0];
    const alternatives = allowed.filter(hit => hit !== pick && hit.score >= ADAPT_SCORE).slice(0, 2).map(hit => ({ id: hit.entry.id, name: hit.entry.name, score: hit.score }));
    let port: Hit | undefined;
    const why = (hit: Hit) => [hit.concepts.length ? `about ${hit.concepts.join(", ")}` : "", hit.matched.length ? `matches ${hit.matched.slice(0, 5).join(", ")}` : ""].filter(Boolean).join("; ");
    if (pick && pick.score >= MATCH_SCORE) {
      needs.push({ need: requirement.text, implied: requirement.implied || undefined, status: "matched", component: { id: pick.entry.id, name: pick.entry.name, score: pick.score, why: why(pick) }, alternatives });
    } else if (limited && best && best.score >= MATCH_SCORE && !best.entry.compatible_tools.some(tool => selected.includes(tool))) {
      const tool = best.entry.compatible_tools[0];
      needs.push({ need: requirement.text, implied: requirement.implied || undefined, status: "needs-tool", tool, component: { id: best.entry.id, name: best.entry.name, score: best.score, why: why(best) }, note: `${best.entry.name} would fit, but it belongs to ${best.entry.compatible_tools.map(toolLabel).join(" / ")}, which isn't selected` });
      continue;
    } else if (frameworks && (port = portable(requirement.text)) && (!pick || port.score > pick.score + 0.1)) {
      // Not (or only weakly) in the framework asked for, but the library has it in another: port it rather than start over.
      needs.push({ need: requirement.text, implied: requirement.implied || undefined, status: "adapt", component: { id: port.entry.id, name: port.entry.name, score: port.score, why: why(port) }, note: `exists as ${port.entry.frameworks.join("/")}, not ${frameworks.join("/")}: port it (add_components copies it as it is)` });
      if (!chosen.has(port.entry.id)) chosen.set(port.entry.id, port.entry);
      covers.set(port.entry.id, [...(covers.get(port.entry.id) ?? []), requirement.text]);
      continue;
    } else if (pick) {
      needs.push({ need: requirement.text, implied: requirement.implied || undefined, status: "adapt", component: { id: pick.entry.id, name: pick.entry.name, score: pick.score, why: why(pick) }, alternatives, note: "closest match: adapt it, or build this part" });
    } else {
      const toolsFor = requirement.concepts.flatMap(id => snapshot.concepts.find(concept => concept.id === id)?.tools ?? []);
      const missingTool = limited && toolsFor.length && !toolsFor.some(tool => selected.includes(tool)) ? toolsFor[0] : undefined;
      needs.push(missingTool
        ? { need: requirement.text, implied: requirement.implied || undefined, status: "needs-tool", tool: missingTool, note: `this is ${toolLabel(missingTool)} work, which isn't selected` }
        : { need: requirement.text, implied: requirement.implied || undefined, status: "build", note: "no component in the library covers this: build it in the plan's design tokens (save_component keeps it for later)" });
      continue;
    }
    const entry = pick.entry;
    if (!chosen.has(entry.id)) chosen.set(entry.id, entry);
    covers.set(entry.id, [...(covers.get(entry.id) ?? []), requirement.text]);
  }
  // A chosen pattern covers the parts it contains.
  for (const entry of [...chosen.values()]) {
    for (const part of entry.composes ?? []) {
      if (chosen.has(part) && part !== entry.id) {
        covers.set(entry.id, [...(covers.get(entry.id) ?? []), ...(covers.get(part) ?? [])]);
        chosen.delete(part);
        covers.delete(part);
        for (const need of needs) if (need.component?.id === part) need.note = `covered by ${entry.name} (it contains it)`;
      }
    }
  }
  const resolved = resolveDependencies([...chosen.values()], snapshot.byId);
  const theme = chooseTheme(resolved.components, snapshot.tokens, intent.mode, input.theme, [...hits.values()].flatMap(list => list.slice(0, 5).map(hit => hit.entry)));
  const ordered = resolved.components.sort((a, b) => SPAN_ORDER.indexOf(a.layout?.role ?? a.role) - SPAN_ORDER.indexOf(b.layout?.role ?? b.role));
  const regions = new Map<string, string[]>();
  for (const entry of ordered) {
    const region = REGION[entry.layout?.role ?? entry.role] ?? REGION.content;
    regions.set(region, [...(regions.get(region) ?? []), entry.id]);
  }
  const plan: CompositionPlan = {
    request: input.request,
    product: intent.product?.id ?? "interface",
    tools: { selected, limited, relevant: intent.relevantTools },
    needs,
    components: ordered.map(entry => ({
      id: entry.id, name: entry.name, category: entry.category, batch: entry.batch, role: entry.layout?.role ?? entry.role, span: entry.layout?.span ?? "half",
      frameworks: entry.frameworks, family: entry.style?.tokens ?? "-", covers: covers.get(entry.id) ?? (resolved.added.includes(entry.id) ? ["dependency"] : []), status: entry.status,
    })),
    categories: [...new Set(ordered.map(entry => entry.category))],
    batches: [...new Set(ordered.map(entry => entry.batch))],
    layout: [...regions.entries()].map(([region, components]) => ({ region, components })),
    theme: { id: theme.set?.id ?? "-", name: theme.set?.name ?? "-", mode: theme.set?.mode ?? "-", reason: theme.reason, adapted: ordered.filter(entry => entry.style?.tokens && entry.style.tokens !== theme.set?.id).map(entry => entry.id) },
    dependencies: { packages: resolved.packages, stylesheets: resolved.stylesheets, components: resolved.added, network: resolved.network },
    stats: { searched: entries.length, considered, ms: Date.now() - started },
  };
  if (resolved.cycles.length) plan.dependencies.components.push(...resolved.cycles.map(cycle => `cycle: ${cycle}`));
  return { plan, chosen: ordered, hits };
}

/** The plan as the agent reads it: compact, no implementation source. */
export function planText(plan: CompositionPlan) {
  const lines: string[] = [];
  lines.push(`Composition plan for: ${plan.request.slice(0, 300)}`);
  lines.push(`Product: ${plan.product} · searched ${plan.stats.searched} components · ${plan.components.length} chosen from ${plan.categories.length} categories and ${plan.batches.length} batches (${plan.batches.join(", ") || "none"})`);
  lines.push(`Tools: ${plan.tools.limited ? plan.tools.selected.map(toolLabel).join(", ") : "not limited by the user"}${plan.tools.relevant.length ? ` · relevant here: ${plan.tools.relevant.map(toolLabel).join(", ")}` : ""}`);
  lines.push("", "Needs:");
  for (const need of plan.needs) {
    const mark = { matched: "✓", adapt: "~", build: "+", "needs-tool": "!" }[need.status];
    const component = need.component ? ` → ${need.component.id} (${need.component.name}, score ${need.component.score}${need.component.why ? `; ${need.component.why}` : ""})` : "";
    lines.push(`${mark} ${need.need}${need.implied ? " (implied)" : ""}${component}${need.tool ? ` [needs ${toolLabel(need.tool)}]` : ""}${need.note ? ` — ${need.note}` : ""}${need.alternatives?.length ? ` · alternatives: ${need.alternatives.map(alt => alt.id).join(", ")}` : ""}`);
  }
  if (plan.components.length) {
    lines.push("", "Layout:");
    for (const region of plan.layout) lines.push(`- ${region.region}: ${region.components.join(", ")}`);
    lines.push("", `Theme: ${plan.theme.id} (${plan.theme.name}, ${plan.theme.mode}) — ${plan.theme.reason}.${plan.theme.adapted.length ? ` Adapted to it: ${plan.theme.adapted.join(", ")}.` : ""}`);
    const deps = plan.dependencies;
    lines.push(`Packages: ${deps.packages.map(pkg => `${pkg.name}@${pkg.version}${pkg.conflict ? ` (conflict: ${pkg.conflict})` : ""}`).join(", ") || "none"}${deps.stylesheets.length ? ` · stylesheets: ${deps.stylesheets.join(", ")}` : ""}${deps.components.length ? ` · added as dependencies: ${deps.components.join(", ")}` : ""}${deps.network.length ? ` · fetches data from: ${deps.network.join(", ")}` : ""}`);
  }
  const blocked = plan.needs.filter(need => need.status === "needs-tool");
  const build = plan.needs.filter(need => need.status === "build");
  lines.push("");
  const missingTools = [...new Set(blocked.map(need => toolLabel(need.tool!)))];
  if (blocked.length) lines.push(`Ask the user before going on: ${missingTools.join(" and ")} ${missingTools.length > 1 ? "aren't" : "isn't"} selected, and ${blocked.map(need => `"${need.need}"`).join(", ")} need${blocked.length === 1 ? "s" : ""} ${missingTools.length > 1 ? "them" : "it"}. Explain what is missing and ask them to enable it; don't use those components meanwhile.`);
  if (plan.components.length) lines.push(`Next: add_components with ${plan.components.map(component => component.id).join(", ")} (theme ${plan.theme.id}) copies them into the workspace adapted to one theme. Build what is marked + yourself in the same tokens.`);
  if (build.length) lines.push(`Not in the library (build these; don't say a component exists for them): ${build.map(need => need.need).join("; ")}.`);
  return lines.join("\n");
}
