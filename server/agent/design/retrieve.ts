import { askedFor, mentions } from "./intent";
import { DISCIPLINE_ORDER, KNOWLEDGE, ruleText } from "./knowledge";
import type { DesignEntry, DesignIntent, Discipline, Rule } from "./types";

// Picks the knowledge a request needs instead of sending the whole base: the core entries always,
// the recipe for the detected surface, then the best-scoring entries until the budget is spent.

/** How much a discipline matters to any interface before the request says more. */
const BASE: Record<Discipline, number> = {
  process: 0, surface: 0, typography: 4, color: 4, layout: 3, components: 2, copy: 2, imagery: 2, motion: 2, accessibility: 1, performance: 1, immersive: 2,
};

/** A rule survives unless the request asked for exactly what it warns against (a refusal like "no glass" keeps it). */
export const keepRule = (rule: Rule, intent: Pick<DesignIntent, "original" | "latest">) => typeof rule === "string" || !askedFor(intent, rule.unless);

/** The entry as the request will see it: its rules filtered by what the user asked for. */
export function applicable(entry: DesignEntry, intent: Pick<DesignIntent, "original" | "latest">): DesignEntry | null {
  const rules = entry.rules.filter(rule => keepRule(rule, intent));
  return rules.length ? { ...entry, rules } : null;
}

export function entryChars(entry: DesignEntry) {
  return entry.title.length + 6 + entry.rules.reduce((sum, rule) => sum + ruleText(rule).length + 3, 0);
}

export type Scored = { entry: DesignEntry; score: number; hits: string[] };

export function scoreEntries(intent: DesignIntent, entries: DesignEntry[] = KNOWLEDGE): Scored[] {
  const scored: Scored[] = [];
  // What the recipe for this surface depends on comes first after the recipe itself.
  const related = new Set(entries.filter(entry => entry.surfaces?.includes(intent.surface)).flatMap(entry => entry.related ?? []));
  for (const entry of entries) {
    if (entry.core) continue;
    if (entry.surfaces && !entry.surfaces.includes(intent.surface)) continue;
    if (entry.needs && !entry.needs.some(need => intent.needs.includes(need))) continue;
    const hits = (entry.signals ?? []).filter(signal => mentions(intent.text, signal));
    if (entry.optional && !hits.length) continue;
    const score = BASE[entry.discipline] + (entry.surfaces ? 20 : 0) + (related.has(entry.id) ? 6 : 0) + (entry.needs ? 4 : 0) + Math.min(hits.length, 3) * 2;
    scored.push({ entry, score, hits });
  }
  // Stable: equal scores keep the knowledge base's order.
  return scored.map((item, index) => ({ item, index })).sort((a, b) => b.item.score - a.item.score || a.index - b.index).map(({ item }) => item);
}

/**
 * Core entries plus the best of the rest within `budget` characters of rule text. The result is
 * ordered by discipline so the brief reads the same way every time.
 */
export function selectEntries(intent: DesignIntent, budget: number, entries: DesignEntry[] = KNOWLEDGE) {
  const core = entries.filter(entry => entry.core).map(entry => applicable(entry, intent)).filter((entry): entry is DesignEntry => entry !== null);
  const chosen: DesignEntry[] = [];
  let left = budget;
  for (const { entry } of scoreEntries(intent, entries)) {
    const fitted = applicable(entry, intent);
    if (!fitted) continue;
    const size = entryChars(fitted);
    if (size > left) continue;
    chosen.push(fitted);
    left -= size;
  }
  const order = (entry: DesignEntry) => DISCIPLINE_ORDER.indexOf(entry.discipline) * 1000 + entries.findIndex(item => item.id === entry.id);
  return { core, chosen: chosen.sort((a, b) => order(a) - order(b)) };
}
