// The component library's shared vocabulary: the tools a user can select for a task, and the
// shape of a registered component (component-library/components/<id>/component.json) and of the
// composition plan the agent gets for a request. Categories, batches and tags are open strings:
// searchable metadata, never a fixed list.

export const TOOLS = [
  { id: "web-design", label: "Web Design", detail: "Pages, sections, navigation and layout" },
  { id: "data-analytics", label: "Data Analytics", detail: "Charts, statistics and data tables" },
  { id: "dashboard-builder", label: "Dashboard Builder", detail: "KPI cards, dashboard sections and grids" },
  { id: "ui-ux-design", label: "UI/UX Design", detail: "Interaction patterns, states and design systems" },
  { id: "frontend-development", label: "Frontend Development", detail: "React and HTML implementation" },
  { id: "backend-development", label: "Backend Development", detail: "APIs, data models and services" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];
export const TOOL_IDS = TOOLS.map(tool => tool.id) as [ToolId, ...ToolId[]];
export const toolLabel = (id: string) => TOOLS.find(tool => tool.id === id)?.label ?? id;
/** Tools a task may carry (the composer's multi-select). Empty: not limited. */
export const MAX_TASK_TOOLS = TOOLS.length;

export type ComponentStatus = "active" | "needs-review" | "candidate" | "deprecated";
export type Framework = "react" | "html" | "vue" | "svelte";
export type LayoutRole = "navigation" | "header" | "section" | "filters" | "kpi" | "chart" | "table" | "insight" | "timeline" | "form" | "content";

export type ComponentDependency =
  | { type: "package"; name: string; version: string }
  | { type: "component"; id: string; reason?: string }
  | { type: "tokens"; id: string }
  | { type: "stylesheet"; id: string };

export type ComponentMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  batch: string;
  collection?: string;
  kind: "component" | "pattern";
  role: LayoutRole;
  tags: string[];
  capabilities: string[];
  dependencies: ComponentDependency[];
  compatible_tools: string[];
  frameworks: Framework[];
  implementations: { framework: Framework; file: string; origin?: string }[];
  layout?: { role: LayoutRole; span?: "rail" | "full" | "wide" | "half" | "third" };
  /** Design family: its token set, and the colours of this component mapped to token roles. */
  style?: { tokens: string; mode?: "light" | "dark"; colors?: Record<string, string> };
  /** Another component this one is a variant of (one per variant group is picked). */
  variant_of?: string;
  /** The style archetype a block comes from: a plan mixes archetypes rather than taking one whole. */
  archetype?: string;
  /** Components this pattern already contains (picking it covers them). */
  composes?: string[];
  /** Hosts the component fetches data from at run time. */
  network?: string[];
  source?: { file: string; ref?: string };
  status: ComponentStatus;
  quality?: { compiled?: boolean; rendered?: boolean | null; checked_at?: string; notes?: string[]; hash?: string };
  version?: number;
  generated_by?: string;
};

/** One thing the request needs, and what the library offers for it. */
export type PlanNeed = {
  need: string;
  /** Inferred from the kind of product (not written in the request). */
  implied?: boolean;
  status: "matched" | "adapt" | "build" | "needs-tool";
  component?: { id: string; name: string; score: number; why: string };
  alternatives?: { id: string; name: string; score: number }[];
  /** needs-tool: the tool that provides it, which the user didn't select. */
  tool?: string;
  note?: string;
};

export type CompositionPlan = {
  request: string;
  product: string;
  tools: { selected: string[]; limited: boolean; relevant: string[] };
  needs: PlanNeed[];
  components: { id: string; name: string; category: string; batch: string; role: LayoutRole; span: string; frameworks: Framework[]; family: string; covers: string[]; status: ComponentStatus; archetype?: string }[];
  categories: string[];
  batches: string[];
  layout: { region: string; components: string[] }[];
  theme: { id: string; name: string; mode: string; reason: string; adapted: string[] };
  dependencies: { packages: { name: string; version: string; conflict?: string }[]; stylesheets: string[]; components: string[]; network: string[] };
  stats: { searched: number; considered: number; ms: number };
};
