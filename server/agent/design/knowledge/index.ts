import type { DesignEntry, Discipline, Rule } from "../types";
import { COMPONENTS } from "./components";
import { FOUNDATIONS } from "./foundations";
import { MOTION } from "./motion";
import { SURFACES } from "./surfaces";

/**
 * The design knowledge base, in the order entries are rendered. To add knowledge, add an entry to
 * the file of its discipline (or a new file listed here); `knowledgeProblems` (run by the tests)
 * keeps ids unique and every entry sourced and short enough to retrieve.
 */
export const KNOWLEDGE: DesignEntry[] = [...FOUNDATIONS, ...COMPONENTS, ...MOTION, ...SURFACES];

export const ruleText = (rule: Rule) => (typeof rule === "string" ? rule : rule.text);

export const DISCIPLINE_ORDER: Discipline[] = ["process", "surface", "typography", "color", "layout", "imagery", "copy", "components", "motion", "immersive", "accessibility", "performance"];

/** Longest rule and entry the brief can carry without crowding out the rest. */
export const MAX_RULE_CHARS = 420;
export const MAX_ENTRY_CHARS = 1600;

export function knowledgeProblems(entries: DesignEntry[] = KNOWLEDGE) {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) problems.push(`${entry.id}: id must be kebab-case`);
    if (ids.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    if (!DISCIPLINE_ORDER.includes(entry.discipline)) problems.push(`${entry.id}: unknown discipline ${entry.discipline}`);
    if (!entry.rules.length) problems.push(`${entry.id}: no rules`);
    if (!entry.sources.length) problems.push(`${entry.id}: no sources`);
    if (entry.discipline === "surface" && !entry.surfaces?.length) problems.push(`${entry.id}: a recipe names its surface`);
    if (entry.optional && !entry.signals?.length) problems.push(`${entry.id}: an optional entry needs signals`);
    for (const source of entry.sources) if (source.startsWith("corpus:") && !/^corpus:[a-z0-9._-]+-\d{6}$/.test(source)) problems.push(`${entry.id}: bad corpus slug ${source}`);
    let total = 0;
    for (const rule of entry.rules) {
      const text = ruleText(rule);
      total += text.length;
      if (text.length > MAX_RULE_CHARS) problems.push(`${entry.id}: rule over ${MAX_RULE_CHARS} characters`);
      if (typeof rule !== "string" && !rule.unless.length) problems.push(`${entry.id}: conditional rule without words`);
    }
    if (total > MAX_ENTRY_CHARS) problems.push(`${entry.id}: entry over ${MAX_ENTRY_CHARS} characters`);
    for (const signal of entry.signals ?? []) if (signal !== signal.toLowerCase()) problems.push(`${entry.id}: signal "${signal}" must be lowercase`);
  }
  for (const entry of entries) for (const id of entry.related ?? []) if (!ids.has(id)) problems.push(`${entry.id}: related entry ${id} does not exist`);
  return problems;
}
