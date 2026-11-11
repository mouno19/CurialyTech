export type SkillCategory = "research" | "engineering" | "reasoning" | "analysis" | "communication" | "documents";
export type SkillAvailability = "available" | "needs_configuration" | "disabled";

export type CurialySkill = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category: SkillCategory;
  version: string;
  icon: string;
  accent: "violet" | "mint";
  enabled: boolean;
  availability: SkillAvailability;
  instructions: string;
  requiredTools: string[];
  outputFormat: string;
  examplePrompts: string[];
};

export const SKILLS: CurialySkill[] = [
  {
    id: "web-research",
    name: "Web Research",
    shortName: "Research",
    description: "Find information and verify sources.",
    category: "research",
    version: "1.0.0",
    icon: "search",
    accent: "violet",
    enabled: true,
    availability: "needs_configuration",
    instructions: "Research current information only when a grounded search provider is available; preserve source metadata and uncertainty.",
    requiredTools: ["google-search-grounding"],
    outputFormat: "Structured summary with source metadata",
    examplePrompts: ["Compare the latest approaches to...", "Find trustworthy sources about..."]
  },
  {
    id: "coding",
    name: "Coding",
    shortName: "Code",
    description: "Write, explain, and debug code.",
    category: "engineering",
    version: "1.0.0",
    icon: "code",
    accent: "mint",
    enabled: true,
    availability: "available",
    instructions: "Generate and review code without executing arbitrary model-authored commands.",
    requiredTools: ["artifact-writer"],
    outputFormat: "Markdown explanation and fenced code",
    examplePrompts: ["Debug this TypeScript error", "Sketch a safe API boundary"]
  },
  {
    id: "deep-thinking",
    name: "Deep Thinking",
    shortName: "Think",
    description: "Work through complex problems.",
    category: "reasoning",
    version: "1.0.0",
    icon: "brain",
    accent: "violet",
    enabled: true,
    availability: "available",
    instructions: "Produce concise plans, identify constraints, and validate the result without exposing private chain-of-thought.",
    requiredTools: ["planner"],
    outputFormat: "Plan, key conclusions, and next steps",
    examplePrompts: ["Help me plan this launch", "Break down this complex decision"]
  },
  {
    id: "data-analysis",
    name: "Data Analysis",
    shortName: "Data",
    description: "Analyze data and identify patterns.",
    category: "analysis",
    version: "1.1.0",
    icon: "chart",
    accent: "mint",
    enabled: true,
    availability: "available",
    instructions: "Summarize CSV, TSV, JSON and Excel tables with column types, missing values and numeric summaries. The summary does not need a library installed in the sandbox.",
    requiredTools: ["analyze_data"],
    outputFormat: "Summary statistics, findings, and limitations",
    examplePrompts: ["Find patterns in this CSV", "Summarize these metrics"]
  },
  {
    id: "writing",
    name: "Writing",
    shortName: "Write",
    description: "Create and improve content.",
    category: "communication",
    version: "1.0.0",
    icon: "pen",
    accent: "violet",
    enabled: true,
    availability: "available",
    instructions: "Draft, rewrite, proofread, and structure content according to the user's requested audience and tone.",
    requiredTools: ["artifact-writer"],
    outputFormat: "Structured prose or document outline",
    examplePrompts: ["Draft a concise project update", "Improve this announcement"]
  },
  {
    id: "document-analysis",
    name: "Document Analysis",
    shortName: "Docs",
    description: "Extract insights from uploaded files.",
    category: "documents",
    version: "1.1.0",
    icon: "file",
    accent: "mint",
    enabled: true,
    availability: "available",
    instructions: "Read PDF, Word (.docx) and PowerPoint (.pptx) text when a file is attached and again with read_document. Say when a file has no text layer or the reading was cut short.",
    requiredTools: ["read_document"],
    outputFormat: "Key facts, outline, and source references",
    examplePrompts: ["Summarize this document", "Extract dates and owners"]
  }
];

export function selectSkills(input: string, think: boolean, webSearch: boolean): string[] {
  const value = input.toLowerCase();
  const selected = new Set<string>();
  if (webSearch || /research|source|latest|compare|market|competitor|current/.test(value)) selected.add("web-research");
  if (/code|coding|typescript|javascript|bug|debug|website|app|api|function/.test(value)) selected.add("coding");
  if (think || /plan|strategy|decision|complex|architecture|roadmap/.test(value)) selected.add("deep-thinking");
  if (/csv|json|spreadsheet|data|metric|trend|analysis|pattern/.test(value)) selected.add("data-analysis");
  if (/write|draft|edit|rewrite|email|article|proposal|content/.test(value)) selected.add("writing");
  if (/pdf|document|file|upload|contract|report/.test(value)) selected.add("document-analysis");
  if (selected.size === 0) selected.add("deep-thinking");
  return Array.from(selected);
}

export function getSkill(id: string) {
  return SKILLS.find(skill => skill.id === id);
}

/**
 * A procedure the account writes once (how tests run, how a pull request is described, which folders
 * stay untouched). Attached to a task by id, including a repository that has no note yet.
 * name and body lengths match the database checks on curialy.user_skills.
 */
export const SAVED_SKILL_LIMITS = { maxPerAccount: 30, maxPerTask: 8, name: 80, body: 2000 } as const;

export type SavedSkill = { id: string; name: string; body: string; updatedAt: string };
