// What the importer knows about the staged Component Atlas (component-library/atlas): per source
// file, where its components are defined, how a standalone React module is made from each, which
// category and batch it belongs to, and the design tokens of its visual family. Adding a file is
// adding an entry here; the registry itself needs no change (it reads component.json files).

/** Roles every token set fills, so a component from one family can take another family's look. */
export const ROLES = ["background", "surface", "surface2", "border", "text", "muted", "accent", "positive", "negative", "warning", "series1", "series2", "series3", "series4", "series5", "series6"];

const dark = { mode: "dark" };
export const TOKEN_SETS = {
  "atlas-essentials": {
    name: "Essentials (light)", mode: "light", source: "01_essential_charts_001_020.html",
    colors: { background: "#f6f8fc", surface: "#ffffff", surface2: "#f8faff", border: "#e8ebf0", text: "#172033", muted: "#657084", accent: "#635bdb", positive: "#148b85", negative: "#e65b3c", warning: "#f1ab50", series1: "#635bdb", series2: "#148b85", series3: "#f1ab50", series4: "#e65b3c", series5: "#272d28", series6: "#d7e1ff" },
    fonts: { sans: "Inter, system-ui, sans-serif", mono: "\"DM Mono\", ui-monospace, monospace" }, radius: { card: "20px", control: "7px" }, spacing: "24px",
  },
  "atlas-terminal": {
    name: "Financial terminal (dark)", ...dark, source: "02_financial_charts_021_030.html",
    colors: { background: "#090e16", surface: "#111b29", surface2: "#152131", border: "#273444", text: "#e8f0f4", muted: "#8a9bab", accent: "#69cbf5", positive: "#60e6b2", negative: "#ff7782", warning: "#f7c878", series1: "#69cbf5", series2: "#60e6b2", series3: "#f7c878", series4: "#a99afa", series5: "#ff7782", series6: "#8a9bab" },
    fonts: { sans: "\"IBM Plex Sans\", system-ui, sans-serif", mono: "\"IBM Plex Mono\", ui-monospace, monospace" }, radius: { card: "14px", control: "8px" }, spacing: "20px",
  },
  "atlas-circular": {
    name: "Circular (dark)", ...dark, source: "03_circular_radial_charts_031_040.html",
    colors: { background: "#090c12", surface: "#111722", surface2: "#161d29", border: "#27303d", text: "#f0f3f5", muted: "#91a0af", accent: "#a8f0d2", positive: "#a8f0d2", negative: "#e7b886", warning: "#e7b886", series1: "#a8f0d2", series2: "#6ca6c4", series3: "#a788d8", series4: "#e7b886", series5: "#778795", series6: "#9fb0be" },
    fonts: { sans: "Manrope, system-ui, sans-serif", mono: "\"DM Mono\", ui-monospace, monospace" }, radius: { card: "18px", control: "10px" }, spacing: "24px",
  },
  "atlas-network": {
    name: "Network (dark)", ...dark, source: "04_network_hierarchy_charts_041_050.html",
    colors: { background: "#080e1b", surface: "#101a2c", surface2: "#131f33", border: "#26344b", text: "#edf5ff", muted: "#90a2ba", accent: "#5ce2e6", positive: "#bcf07a", negative: "#f18fba", warning: "#ffbf75", series1: "#5ce2e6", series2: "#aa91ff", series3: "#bcf07a", series4: "#ffbf75", series5: "#f18fba", series6: "#79adff" },
    fonts: { sans: "\"Space Grotesk\", system-ui, sans-serif", mono: "\"JetBrains Mono\", ui-monospace, monospace" }, radius: { card: "16px", control: "8px" }, spacing: "22px",
  },
  "atlas-geo": {
    name: "Geospatial (dark)", ...dark, source: "05_geospatial_charts_051_060.html",
    colors: { background: "#080e18", surface: "#101a28", surface2: "#142132", border: "#26384a", text: "#e8f3f7", muted: "#8da4b5", accent: "#6ce7e7", positive: "#83e8bc", negative: "#ff859e", warning: "#ffbd76", series1: "#6ce7e7", series2: "#6d91ff", series3: "#ab8bff", series4: "#ffbd76", series5: "#83e8bc", series6: "#ff859e" },
    fonts: { sans: "\"DM Sans\", system-ui, sans-serif", mono: "\"DM Mono\", ui-monospace, monospace" }, radius: { card: "16px", control: "8px" }, spacing: "22px",
  },
  "atlas-scientific": {
    name: "Scientific (dark)", ...dark, source: "06_scientific_charts_061_070.html",
    colors: { background: "#090e15", surface: "#101923", surface2: "#141f2b", border: "#263440", text: "#eaf2f5", muted: "#8da0af", accent: "#6ae0df", positive: "#6ae0df", negative: "#e782aa", warning: "#ffb674", series1: "#6ae0df", series2: "#5c95e8", series3: "#ffb674", series4: "#e782aa", series5: "#90a9b8", series6: "#263b48" },
    fonts: { sans: "\"IBM Plex Sans\", system-ui, sans-serif", mono: "\"IBM Plex Mono\", ui-monospace, monospace" }, radius: { card: "12px", control: "6px" }, spacing: "20px",
  },
  "atlas-temporal": {
    name: "Temporal (dark)", ...dark, source: "07_temporal_timeline_charts_071_080.html",
    colors: { background: "#090e1b", surface: "#111a2b", surface2: "#172238", border: "#26334b", text: "#edf4ff", muted: "#91a0b8", accent: "#65d9e9", positive: "#69d9b3", negative: "#ed8ca8", warning: "#f4be72", series1: "#65d9e9", series2: "#aa93f5", series3: "#69d9b3", series4: "#f4be72", series5: "#ed8ca8", series6: "#91a0b8" },
    fonts: { sans: "\"DM Sans\", system-ui, sans-serif", mono: "\"IBM Plex Mono\", ui-monospace, monospace" }, radius: { card: "16px", control: "8px" }, spacing: "22px",
  },
  "atlas-experimental": {
    name: "Experimental (dark)", ...dark, source: "08_experimental_charts_081_090.html",
    colors: { background: "#070b15", surface: "#101726", surface2: "#141d30", border: "#253047", text: "#eaf0fa", muted: "#98a6bc", accent: "#5ee4df", positive: "#5ee4df", negative: "#ff8aa8", warning: "#ffc46b", series1: "#5ee4df", series2: "#487dff", series3: "#b18cff", series4: "#ffc46b", series5: "#ff8aa8", series6: "#98a6bc" },
    fonts: { sans: "\"Space Grotesk\", system-ui, sans-serif", mono: "ui-monospace, monospace" }, radius: { card: "18px", control: "10px" }, spacing: "24px",
  },
  "atlas-specialized": {
    name: "Specialized (dark)", ...dark, source: "09_advanced_specialized_charts_091_100.html",
    colors: { background: "#090d13", surface: "#101720", surface2: "#151e29", border: "#273341", text: "#e9f0f2", muted: "#8b9ba7", accent: "#9df0cb", positive: "#9df0cb", negative: "#f49d91", warning: "#e8c47d", series1: "#9df0cb", series2: "#79b8f6", series3: "#b8a4f4", series4: "#e8c47d", series5: "#f49d91", series6: "#81939f" },
    fonts: { sans: "\"DM Sans\", system-ui, sans-serif", mono: "\"IBM Plex Mono\", ui-monospace, monospace" }, radius: { card: "14px", control: "8px" }, spacing: "20px",
  },
  "atlas-paper": {
    name: "Analytics paper (light)", mode: "light", source: "10_analytics_dashboard_components.html",
    colors: { background: "#f6f5f1", surface: "#fffefa", surface2: "#f1f0ea", border: "#e8e8e1", text: "#202522", muted: "#747b76", accent: "#f2735d", positive: "#246d57", negative: "#f2735d", warning: "#f3ca78", series1: "#f2735d", series2: "#246d57", series3: "#a5dbc6", series4: "#f3ca78", series5: "#212c29", series6: "#838d85" },
    fonts: { sans: "\"DM Sans\", system-ui, sans-serif", display: "\"Plus Jakarta Sans\", system-ui, sans-serif", mono: "\"DM Mono\", ui-monospace, monospace" }, radius: { card: "18px", control: "10px" }, spacing: "16px",
  },
};

const CHART_TOOLS = ["data-analytics", "dashboard-builder", "frontend-development"];
const UI_TOOLS = ["web-design", "ui-ux-design", "dashboard-builder", "frontend-development"];
const DATA_UI_TOOLS = ["data-analytics", "dashboard-builder", "web-design", "frontend-development"];

/**
 * Source files with definition arrays. strategy: how the React module is made —
 *  generated: the page's own React export (its "copy code" generator), used as it is;
 *  renderer: the page's own renderer (HTML/SVG string) with exactly the declarations it needs, in a React wrapper;
 *  element: the page's own React.createElement component, lifted out with what it needs.
 */
export const FAMILIES = [
  {
    file: "01_essential_charts_001_020.html", tokens: "atlas-essentials", collection: "Essential Data Visualization",
    fixes: [{ script: 2, find: "text(W-R,yy-5,v+'%',v>=100?c[0]:c[1],10,'end'))}", replace: "text(W-R,yy-5,v+'%',v>=100?c[0]:c[1],10,'end'))})", why: "the bullet branch of the finance renderer was missing a closing parenthesis, so the whole script failed to run" }],
    arrays: [
      { array: "specs", strategy: "generated", generator: "reactSource", batch: "essential-charts", category: "data-visualization", packages: ["react", "chart.js"] },
      { array: "advanced", strategy: "generated", generator: "advancedReactSource", batch: "statistical-charts", category: "data-visualization", packages: ["react"] },
      { array: "finance", strategy: "generated", generator: "financeReactSource", batch: "financial-charts", category: "data-visualization", packages: ["react"], variantSuffix: "-alt" },
    ],
  },
  { file: "02_financial_charts_021_030.html", tokens: "atlas-terminal", collection: "Financial Visualization", arrays: [{ array: "components", strategy: "element", entry: "FinancialChart", css: true, batch: "financial-charts", category: "data-visualization", packages: ["react"] }] },
  { file: "03_circular_radial_charts_031_040.html", tokens: "atlas-circular", collection: "Circular Atlas", arrays: [{ array: "defs", strategy: "generated", generator: "reactCode", batch: "circular-radial-charts", category: "data-visualization", packages: ["react", "echarts"] }] },
  // The generated components take their data as a prop: the page's own sample (datasets[key]) becomes the default.
  { file: "04_network_hierarchy_charts_041_050.html", tokens: "atlas-network", collection: "Network Atlas", arrays: [{ array: "graphs", strategy: "generated", generator: "reactSource", sample: { from: "datasets", key: "key", prop: "data" }, batch: "network-hierarchy-charts", category: "data-visualization", packages: ["react", "d3", "d3-sankey"] }] },
  { file: "05_geospatial_charts_051_060.html", tokens: "atlas-geo", collection: "Geospatial Visualization", arrays: [{ array: "components", strategy: "generated", generator: "reactCode", batch: "geospatial-charts", category: "data-visualization", packages: ["react", "leaflet", "three"] }] },
  { file: "06_scientific_charts_061_070.html", tokens: "atlas-scientific", collection: "Scientific Graph Atlas", arrays: [{ array: "graphs", strategy: "element", css: true, batch: "scientific-charts", category: "data-visualization", packages: ["react"] }] },
  { file: "07_temporal_timeline_charts_071_080.html", tokens: "atlas-temporal", collection: "Temporal Graph Library", arrays: [{ array: "graphs", strategy: "renderer", renderer: "preview", css: true, batch: "temporal-timeline-charts", category: "data-visualization", packages: ["react"] }] },
  { file: "08_experimental_charts_081_090.html", tokens: "atlas-experimental", collection: "Future Forms", arrays: [{ array: "graphs", strategy: "renderer", renderer: "preview", batch: "experimental-charts", category: "data-visualization", packages: ["react"] }] },
  { file: "09_advanced_specialized_charts_091_100.html", tokens: "atlas-specialized", collection: "Visualization Atlas", arrays: [{ array: "components", strategy: "renderer", renderer: "renderChart", batch: "advanced-specialized-charts", category: "data-visualization", packages: ["react"] }] },
];

/** The id a definition carries ("GRAPH-001", "071", n: 81) as a registry id ("graph-001"). */
export function graphId(data) {
  const raw = data.id ?? data.n;
  const digits = String(raw).match(/(\d{1,3})\s*$/)?.[1];
  return digits ? `graph-${digits.padStart(3, "0")}` : null;
}

/** Tags and capabilities a chart's name, type and purpose imply (searchable vocabulary, not restrictions). */
export const LEXICON = [
  [/candle|ohlc/i, ["finance", "trading", "price-action", "ohlc", "market", "stock", "time-series", "crypto"]],
  [/volume/i, ["trading", "volume", "market"]],
  [/portfolio|allocation/i, ["finance", "portfolio", "allocation", "composition"]],
  [/stock|market|index|benchmark/i, ["finance", "market", "stock", "comparison", "time-series"]],
  [/revenue|sales|income|mrr|arr/i, ["revenue", "finance", "growth", "business"]],
  [/profit|loss|p&l|cash|margin|budget|spend|expense|treasury/i, ["finance", "accounting", "budget"]],
  [/waterfall|bridge/i, ["waterfall", "finance", "change-analysis"]],
  [/bar|column/i, ["bar-chart", "comparison", "ranking", "categorical"]],
  [/stack/i, ["stacked", "composition"]],
  [/line|trend|momentum|performance over|growth/i, ["line-chart", "trend", "time-series"]],
  [/area|stream|liquid|fluid/i, ["area-chart", "trend", "time-series", "volume"]],
  [/pie|donut|doughnut|share|composition|proportion/i, ["pie-chart", "composition", "share", "proportion"]],
  [/radial|polar|rose|circular|ring|sunburst/i, ["radial", "circular"]],
  [/gauge|meter|progress|goal|target|bullet|kpi|attainment/i, ["kpi", "target", "progress", "performance"]],
  [/scatter|bubble|correlation/i, ["scatter", "correlation", "statistics", "distribution"]],
  [/histogram|distribution|box|violin|density|percentile|quantile|ridge/i, ["distribution", "statistics", "latency", "variance"]],
  [/heat|matrix|grid|calendar/i, ["heatmap", "matrix", "density"]],
  [/radar|spider/i, ["radar", "multivariate", "comparison", "profile"]],
  [/parallel/i, ["parallel-coordinates", "multivariate"]],
  [/contour|surface|3d|field|spectro/i, ["scientific", "field", "3d"]],
  [/sankey|flow|alluvial/i, ["flow", "sankey", "conversion"]],
  [/funnel|journey|conversion|cohort|retention/i, ["conversion", "funnel", "retention", "user-analytics"]],
  [/tree|hierarch|treemap|icicle|dendro|org/i, ["hierarchy", "tree", "structure"]],
  [/network|force|graph|node|chord|arc|relationship|dependency/i, ["network", "relationships", "graph"]],
  [/map|geo|choropleth|globe|world|country|city|route|location/i, ["geospatial", "map", "location"]],
  [/gantt|timeline|roadmap|schedule|milestone|calendar|planning/i, ["timeline", "schedule", "planning", "project-management"]],
  [/event|log|incident|activity|uptime|status/i, ["events", "monitoring", "operations"]],
  [/forecast|projection|prediction|outlook/i, ["forecast", "prediction"]],
  [/compar|versus|vs\.?|benchmark|budget vs/i, ["comparison"]],
  [/rank|leaderboard|top /i, ["ranking"]],
  [/user|audience|visitor|session|device|channel|acquisition/i, ["user-analytics", "audience"]],
  [/\bapi\b|\brequests?\b|latency|throughput|\btokens?\b|\bendpoints?\b/i, ["api-monitoring", "usage"]],
  [/sparkline|mini/i, ["sparkline", "compact"]],
  [/word|text|sentiment/i, ["text-analytics"]],
];

/**
 * The analytics library (file 10): dashboard building blocks cut out of one page. find: where the
 * block's element starts — its nth occurrence, or the one around a heading with that text; the
 * block's chart code and handlers come with it.
 */
export const BLOCKS = {
  file: "10_analytics_dashboard_components.html", tokens: "atlas-paper", collection: "Analytics Component Library",
  packages: ["chart.js", "lucide"],
  items: [
    { id: "nav-sidebar", find: ['<aside class="sidebar', 0], name: "Sidebar navigation", category: "navigation", batch: "app-navigation", role: "navigation", tools: UI_TOOLS, tags: ["sidebar", "navigation", "menu", "app-shell", "sections"], description: "A fixed left sidebar with brand, grouped section links with icons and active state, and a footer block.", capabilities: ["keyboard", "active-state", "icons"] },
    { id: "nav-topbar", find: ['<header class="topbar', 0], name: "Top bar with breadcrumb", category: "navigation", batch: "app-navigation", role: "header", tools: UI_TOOLS, tags: ["topbar", "top-navigation", "breadcrumb", "header", "actions"], description: "A top application bar with breadcrumb trail and right-side actions.", capabilities: ["responsive"] },
    { id: "layout-page-intro", find: ['<section id="overview"', 0], name: "Page intro with highlight pills", category: "layout", batch: "page-sections", role: "header", tools: UI_TOOLS, tags: ["hero", "intro", "page-header", "headline", "pills"], description: "An editorial page intro: eyebrow, large headline, supporting copy and a row of highlight pills.", capabilities: ["responsive"] },
    { id: "dashboard-performance-snapshot", find: ['<div class="canvas"', 0], composes: ["kpi-metric-cards", "chart-revenue-momentum", "kpi-goal-ring"], name: "Performance snapshot (KPI cards, revenue chart, target ring, period switch)", category: "dashboard", batch: "dashboard-sections", role: "section", tools: DATA_UI_TOOLS, tags: ["dashboard", "overview", "kpi", "revenue", "period-switch", "date-range", "filters", "section"], description: "A complete overview section: a 7/30/90-day period switch that updates four KPI cards and a revenue chart comparing current and previous periods, plus a quarterly target ring.", capabilities: ["interactive", "period-filter", "growth-indicators"] },
    { id: "kpi-metric-cards", find: ['<div class="grid four', 0], name: "KPI metric cards", category: "analytics", batch: "kpi-cards", role: "kpi", tools: DATA_UI_TOOLS, tags: ["kpi", "metrics", "stat-cards", "big-numbers", "growth-indicator", "revenue", "conversion", "period-switch"], description: "Four big-number KPI cards with deltas and trend direction, switchable between periods (7/30/90 days).", capabilities: ["interactive", "period-filter", "growth-indicators"] },
    { id: "chart-revenue-momentum", find: ['<div class="panel', "Revenue momentum"], name: "Revenue momentum (current vs previous)", category: "data-visualization", batch: "dashboard-charts", role: "chart", tools: CHART_TOOLS, tags: ["revenue", "line-chart", "area-chart", "comparison", "time-series", "trend"], description: "A line/area chart comparing the current period's revenue with the previous period, in a dashboard panel.", capabilities: ["interactive", "tooltips", "multiple-series", "responsive"] },
    { id: "kpi-goal-ring", find: ['<div class="panel', "Quarterly target"], name: "Quarterly target ring", category: "analytics", batch: "kpi-cards", role: "kpi", tools: DATA_UI_TOOLS, tags: ["goal", "target", "progress-ring", "kpi", "quota"], description: "A progress ring showing attainment of a quarterly target with supporting figures.", capabilities: ["accessible"] },
    { id: "chart-acquisition-mix", find: ['<div class="panel', "Acquisition mix"], name: "Acquisition mix over time", category: "data-visualization", batch: "dashboard-charts", role: "chart", tools: CHART_TOOLS, tags: ["acquisition", "channels", "stacked", "bar-chart", "marketing", "user-analytics"], description: "Stacked bars showing how acquisition channels contribute over time.", capabilities: ["tooltips", "multiple-series", "responsive"] },
    { id: "chart-device-donut", find: ['<div class="panel', "Audience by device"], name: "Audience by device (donut)", category: "data-visualization", batch: "dashboard-charts", role: "chart", tools: CHART_TOOLS, tags: ["donut", "pie-chart", "devices", "audience", "share", "user-analytics"], description: "A donut chart of sessions by device type with a legend.", capabilities: ["tooltips", "responsive"] },
    { id: "chart-category-ranking", find: ['<div class="panel', "Category ranking"], name: "Category ranking (horizontal bars)", category: "data-visualization", batch: "dashboard-charts", role: "chart", tools: CHART_TOOLS, tags: ["ranking", "bar-chart", "categories", "products", "comparison"], description: "Horizontal bars ranking product categories by revenue index.", capabilities: ["tooltips", "responsive"] },
    { id: "chart-activity-heatmap", find: ['<div class="panel', "Activity density"], name: "Activity density heatmap", category: "data-visualization", batch: "dashboard-charts", role: "chart", tools: CHART_TOOLS, tags: ["heatmap", "activity", "weekly", "density", "calendar"], description: "A compact weekday × hour heatmap for recurring activity.", capabilities: ["compact"] },
    ...[
      ["chart-bar-side-by-side", "Side-by-side comparison bars", ["grouped", "comparison", "bar-chart"]],
      ["chart-bar-diverging", "Change in direction (diverging bars)", ["diverging", "change", "positive-negative", "bar-chart"]],
      ["chart-bar-range", "Daily order range (floating bars)", ["range", "min-max", "bar-chart", "orders"]],
      ["chart-bar-spotlight", "Monthly milestones (spotlight bars, dark)", ["highlight", "milestones", "bar-chart", "dark"]],
      ["chart-bar-gradient", "Conversion lift (gradient bars)", ["conversion", "lift", "bar-chart"]],
      ["chart-bar-bullet", "Goals vs. actuals (bullet bars)", ["target", "goals", "actuals", "bullet", "bar-chart", "kpi"]],
      ["chart-bar-percent", "Channel composition (100% stacked)", ["percent", "stacked", "composition", "channels", "bar-chart"]],
      ["chart-bar-waterfall", "Revenue bridge (waterfall, dark)", ["waterfall", "bridge", "revenue", "finance", "bar-chart"]],
    ].map(([id, name, tags], index) => ({ id, find: ['<article class="panel', index], name, category: "data-visualization", batch: "bar-chart-variants", role: "chart", tools: CHART_TOOLS, tags, description: `${name}: one of eight bar chart treatments for comparing magnitude in a dashboard card.`, capabilities: ["tooltips", "responsive"] })),
    { id: "card-report-insights", find: ['<div class="canvas"', 2], name: "Report hero with insight cards", category: "analytics", batch: "insights", role: "insight", tools: DATA_UI_TOOLS, tags: ["insights", "report", "summary", "narrative", "cards"], description: "A report headline with three insight cards that pair a finding with its evidence.", capabilities: ["responsive"] },
    { id: "timeline-milestones", find: ['<div class="canvas"', 3], name: "Milestone timeline", category: "layout", batch: "insights", role: "timeline", tools: DATA_UI_TOOLS, tags: ["timeline", "milestones", "events", "history", "roadmap"], description: "A vertical timeline of the quarter's milestones with dates and notes.", capabilities: ["responsive"] },
    { id: "card-status-tiles", find: ['<div class="grid three', 1], name: "Status tiles", category: "analytics", batch: "kpi-cards", role: "kpi", tools: DATA_UI_TOOLS, tags: ["status", "health", "sync", "uptime", "latency", "operations", "monitoring"], description: "Three compact status tiles with icons (connected sources, sync success, average latency).", capabilities: ["icons"] },
    { id: "table-source-directory", find: ['<div class="canvas"', 4], name: "Searchable, sortable data table", category: "data-management", batch: "tables", role: "table", tools: DATA_UI_TOOLS, tags: ["data-table", "table", "search", "sorting", "filter", "status-badges", "empty-state", "logs", "directory"], description: "A data table with a search box, sortable columns, status badges and an empty state.", capabilities: ["search", "sorting", "empty-state", "keyboard", "responsive"] },
    { id: "chart-conversion-funnel", find: ['<div class="panel', "Conversion funnel"], name: "Conversion funnel", category: "data-visualization", batch: "journey-analytics", role: "chart", tools: CHART_TOOLS, tags: ["funnel", "conversion", "journey", "drop-off", "checkout"], description: "A conversion funnel showing the share of visitors reaching each step.", capabilities: ["responsive"] },
    { id: "chart-retention-cohorts", find: ['<div class="panel', "Retention cohorts"], name: "Retention cohort grid", category: "data-visualization", batch: "journey-analytics", role: "chart", tools: CHART_TOOLS, tags: ["retention", "cohorts", "heatmap", "matrix", "user-analytics"], description: "A monthly retention cohort grid with shaded cells.", capabilities: ["responsive"] },
    { id: "chart-cohort-variations", find: ['<div id="cohort-variations', 0], name: "Retention cohort variations (10 treatments)", category: "data-visualization", batch: "journey-analytics", role: "chart", tools: CHART_TOOLS, tags: ["retention", "cohorts", "variations", "small-multiples"], description: "Ten ways to read the same cohort data: matrices, lanes, arcs and strips.", capabilities: ["responsive"] },
    { id: "chart-revenue-forecast", composes: ["chart-forecast-variations"], find: ['<div class="panel', "Revenue outlook"], name: "Revenue outlook (forecast)", category: "data-visualization", batch: "planning", role: "chart", tools: CHART_TOOLS, tags: ["forecast", "revenue", "projection", "line-chart", "confidence"], description: "Historical monthly revenue with a projected range.", capabilities: ["tooltips", "responsive"] },
    { id: "chart-forecast-variations", find: ['<div id="forecast-variations', 0], name: "Revenue forecast variations (13 treatments)", category: "data-visualization", batch: "planning", role: "chart", tools: CHART_TOOLS, tags: ["forecast", "revenue", "projection", "variations", "small-multiples"], description: "Thirteen ways to show one April–September revenue forecast (exact values, momentum or the outlook), with projected months labeled.", capabilities: ["responsive"] },
    { id: "kpi-goal-pacing", find: ['<div class="panel', "Goal pacing"], name: "Goal pacing bars", category: "analytics", batch: "planning", role: "kpi", tools: DATA_UI_TOOLS, tags: ["goals", "pacing", "progress", "targets", "team"], description: "Progress bars pacing current results against team targets.", capabilities: ["accessible"] },
    { id: "card-priority-notes", find: ['<div class="grid three', 2], name: "Priority notes", category: "analytics", batch: "planning", role: "insight", tools: DATA_UI_TOOLS, tags: ["notes", "recommendations", "actions", "priorities", "cards"], description: "Three cards pairing evidence with a recommended next action.", capabilities: ["responsive"] },
    ...[
      ["table-chart-in-cell-bars", "Table with in-cell bars", ["in-cell-bars", "ranking", "channels"]],
      ["table-chart-dark-comparison", "Dark comparison table", ["comparison", "dark", "products", "revenue"]],
      ["table-chart-sparklines", "Table with sparklines", ["sparkline", "trend", "orders", "weekly"]],
      ["table-chart-heatmap", "Heatmap matrix table", ["heatmap", "matrix", "support", "volume"]],
    ].map(([id, name, tags], index) => ({ id, find: ['<article class="table-chart-card', index], name, category: "data-management", batch: "table-charts", role: "table", tools: DATA_UI_TOOLS, tags: ["table", "data-table", ...tags], description: `${name}: a table that makes comparisons visible without leaving the rows.`, capabilities: ["responsive"] })),
  ],
};
