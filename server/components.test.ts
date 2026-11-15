import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compose, planText, resolveDependencies } from "./components/compose";
import { implementation, implementationReads, registry } from "./components/registry";
import { adaptSource, tokensCss } from "./components/adapt";
import { indexFor, search } from "./components/search";

// The component library as imported (component-library/): the staged atlas registered as one
// ecosystem, searched and composed across every category and batch, and the instruction's test
// scenarios (A single-category, B multi-category, C complex multi-batch, D unavailable, F only
// what is relevant). Registration, validation and scale are in components-registry.test.ts.

const library = registry();
const ids = new Set(library.components.map(entry => entry.id));
const chosen = (request: string, tools: string[] = []) => compose({ request, tools });

describe("the imported library", () => {
  it("registers every graph 001–100 (and the second finance set as variants), and the analytics blocks", () => {
    for (let n = 1; n <= 100; n++) expect(ids.has(`graph-${String(n).padStart(3, "0")}`), `graph-${n}`).toBe(true);
    for (let n = 21; n <= 30; n++) expect(library.byId.get(`graph-0${n}-alt`)?.variant_of).toBe(`graph-0${n}`);
    expect(library.components.filter(entry => entry.collection === "Analytics Component Library").length).toBeGreaterThan(25);
    expect(library.problems).toEqual([]);
    // Categories and batches are metadata, never a fixed list.
    expect(new Set(library.components.map(entry => entry.category)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(library.components.map(entry => entry.batch)).size).toBeGreaterThanOrEqual(15);
  });

  it("keeps nothing of the authoring tool (its name, SDK scripts or editor classes) in what it registered", () => {
    const root = path.resolve("component-library");
    for (const dir of ["components", "styles", "tokens"]) {
      for (const file of fs.readdirSync(path.join(root, dir), { recursive: true }) as string[]) {
        const full = path.join(root, dir, file);
        if (!fs.statSync(full).isFile()) continue;
        const text = fs.readFileSync(full, "utf8");
        expect(/\bcanva\b|canva-[a-z]|\/_sdk\/|__codeletBootstrap__/i.test(text), full).toBe(false);
      }
    }
  });

  it("has a real implementation for every component, and every React module compiles", async () => {
    const esbuild = await import("esbuild");
    for (const entry of library.components) {
      expect(entry.implementations.length, entry.id).toBeGreaterThan(0);
      for (const impl of entry.implementations) {
        const source = fs.readFileSync(path.join(entry.dir, impl.file), "utf8");
        expect(source.length, entry.id).toBeGreaterThan(200);
        if (impl.framework === "react") {
          expect(source, entry.id).toMatch(/export\s+default\b/);
          expect(() => esbuild.transformSync(source.replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gm, ""), { loader: "jsx", jsx: "automatic", format: "esm" }), entry.id).not.toThrow();
        }
      }
    }
  });
});

describe("hybrid retrieval", () => {
  const index = indexFor(library);
  it("finds by meaning, not only by words: spending → finance, API logs → tables, latency → distributions", () => {
    expect(search(index, "track spending", {}, 3)[0].entry.category).toBe("data-visualization");
    expect(search(index, "track spending", {}, 3)[0].concepts).toContain("finance");
    expect(search(index, "API logs", {}, 3)[0].entry.role).toBe("table");
    expect(search(index, "analyze latency", {}, 3)[0].concepts).toContain("distribution");
    // Spelling variants find the same thing.
    expect(search(index, "candles", {}, 3).map(hit => hit.entry.name)).toContain("Candlestick Chart");
  });

  it("filters by metadata: frameworks, categories and tools", () => {
    expect(search(index, "revenue", { frameworks: ["html"] }, 10).every(hit => hit.entry.frameworks.includes("html"))).toBe(true);
    expect(search(index, "revenue", { categories: ["analytics"] }, 10).every(hit => hit.entry.category === "analytics")).toBe(true);
    expect(search(index, "sidebar", { tools: ["data-analytics"] }, 10).map(hit => hit.entry.id)).not.toContain("nav-sidebar");
  });

  it("searches metadata only: no implementation file is read", () => {
    const before = implementationReads();
    for (const query of ["sidebar", "candlestick", "retention cohorts", "network graph", "choropleth map"]) search(index, query);
    chosen("Create a cryptocurrency trading terminal with portfolio analytics, real-time market charts, order book, trading history, and account settings.");
    expect(implementationReads()).toBe(before);
  });
});

describe("the test scenarios", () => {
  it("A: a landing page uses web design components (and says what the library lacks), never charts", () => {
    const { plan } = chosen("Create a modern landing page.");
    expect(plan.product).toBe("landing-page");
    expect(plan.components.every(component => ["navigation", "layout"].includes(component.category))).toBe(true);
    expect(plan.components.map(component => component.id)).toContain("nav-topbar");
    expect(plan.needs.filter(need => need.status === "build").map(need => need.need)).toEqual(expect.arrayContaining(["call to action"]));
  });

  it("B: a financial analytics dashboard combines navigation, KPI cards, financial charts and a data table", () => {
    const { plan } = chosen("Create a financial analytics dashboard with a modern interface.");
    const categories = new Set(plan.components.map(component => component.category));
    for (const category of ["navigation", "analytics", "data-visualization", "data-management"]) expect(categories.has(category), category).toBe(true);
    expect(plan.components.find(component => component.category === "data-visualization")!.batch).toBe("financial-charts");
    expect(plan.layout.map(region => region.region)).toEqual(["Navigation (side rail)", "Top bar and page header", "KPI row", "Charts grid", "Tables"]);
  });

  it("C: a crypto trading terminal draws on several batches, picks one dark theme, and builds what doesn't exist", () => {
    const { plan } = chosen("Create a cryptocurrency trading terminal with portfolio analytics, real-time market charts, order book, trading history, and account settings.");
    expect(plan.product).toBe("trading-terminal");
    expect(plan.batches.length).toBeGreaterThanOrEqual(3);
    expect(plan.categories.length).toBeGreaterThanOrEqual(3);
    const need = (text: string) => plan.needs.find(item => item.need === text)!;
    expect(need("real-time market charts").component!.id).toMatch(/^graph-02\d/);
    expect(need("portfolio analytics").component!.name).toMatch(/Portfolio/);
    expect(plan.components.find(component => component.id === need("trading history").component!.id)!.role).toBe("table");
    // No order book or settings form in the library: said so, nothing irrelevant put in their place.
    expect(need("order book").status).toBe("build");
    expect(need("account settings").status).toBe("build");
    expect(plan.theme).toMatchObject({ id: "atlas-terminal", mode: "dark" });
    expect(plan.theme.adapted.length).toBeGreaterThan(0);
  });

  it("D: an unavailable capability is reported as missing, not faked", () => {
    const { plan } = chosen("Add a kanban board with drag and drop task cards.");
    expect(plan.needs.length).toBeGreaterThan(0);
    expect(plan.needs.every(need => need.status === "build")).toBe(true);
    expect(plan.components).toEqual([]);
    expect(planText(plan)).toContain("Not in the library (build these; don't say a component exists for them)");
  });

  it("F: a simple web design task retrieves only the few relevant components", () => {
    const { plan } = chosen("Create a page header with a top navigation bar.");
    expect(plan.stats.searched).toBe(library.components.length);
    expect(plan.components.length).toBeLessThanOrEqual(3);
    expect(plan.components.every(component => component.category !== "data-visualization")).toBe(true);
  });

  it("the instruction's example: an AI API dashboard mixes web, navigation, KPI, charts and tables across batches", () => {
    const { plan } = chosen("Build a modern SaaS analytics dashboard for an AI API platform. Include revenue tracking, API request monitoring, user analytics, model usage comparison, and an interactive sidebar.", ["web-design", "data-analytics"]);
    expect(plan.tools).toMatchObject({ limited: true, selected: ["web-design", "data-analytics"] });
    expect(plan.batches.length).toBeGreaterThanOrEqual(4);
    expect(plan.needs.filter(need => !need.implied).every(need => need.status === "matched")).toBe(true);
    expect(plan.components.map(component => component.id)).toEqual(expect.arrayContaining(["nav-sidebar", "nav-topbar"]));
    expect(new Set(plan.components.map(component => component.id)).size).toBe(plan.components.length);
  });
});

describe("the user's tools", () => {
  it("are respected: a need whose components belong to an unselected tool is flagged, not used", () => {
    const { plan } = chosen("Create a premium AI model analytics dashboard where users can compare Claude, GPT, Gemini, and other models, monitor API usage, track spending, and analyze latency.", ["web-design"]);
    const blocked = plan.needs.filter(need => need.status === "needs-tool");
    expect(blocked.length).toBeGreaterThanOrEqual(2);
    expect(new Set(blocked.map(need => need.tool))).toEqual(new Set(["data-analytics"]));
    // Nothing chosen belongs only to tools the user didn't select.
    for (const component of plan.components) expect(library.byId.get(component.id)!.compatible_tools).toContain("web-design");
    expect(planText(plan)).toMatch(/Ask the user before going on: Data Analytics isn't selected/);
    // The same request with both tools uses the charts.
    const both = chosen("Create a premium AI model analytics dashboard where users can compare Claude, GPT, Gemini, and other models, monitor API usage, track spending, and analyze latency.", ["web-design", "data-analytics"]);
    expect(both.plan.needs.some(need => need.status === "needs-tool")).toBe(false);
    expect(both.plan.components.some(component => component.category === "data-visualization")).toBe(true);
  });

  it("not selecting any tool means not limited", () => {
    expect(chosen("Create a financial analytics dashboard.").plan.tools).toMatchObject({ limited: false });
  });
});

describe("dependencies and design consistency", () => {
  it("a pattern covers the parts it contains, and dependencies resolve to one version each", () => {
    const { plan } = compose({ request: "dashboard", needs: ["performance overview with period switch", "kpi metric cards", "revenue momentum chart"] });
    const ids = plan.components.map(component => component.id);
    expect(ids).toContain("dashboard-performance-snapshot");
    expect(ids).not.toContain("kpi-metric-cards");
    expect(plan.dependencies.stylesheets).toEqual(["atlas-paper"]);
    const names = plan.dependencies.packages.map(pkg => pkg.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("chart.js");
  });

  it("resolveDependencies: component dependencies are added, cycles reported, version conflicts flagged", () => {
    const base = library.components[0];
    const make = (id: string, deps: { type: "component"; id: string }[] | { type: "package"; name: string; version: string }[]) => ({ ...base, id, dependencies: deps as never });
    const a = make("x-a", [{ type: "component", id: "x-b" }]);
    const b = make("x-b", [{ type: "component", id: "x-a" }, { type: "package", name: "d3", version: "7.9.0" }] as never);
    const c = make("x-c", [{ type: "package", name: "d3", version: "6.2.0" }]);
    const byId = new Map([a, b, c].map(entry => [entry.id, entry]));
    const resolved = resolveDependencies([a, c], byId);
    expect(resolved.added).toEqual(["x-b"]);
    expect(resolved.cycles).toEqual(["x-a → x-b → x-a"]);
    expect(resolved.packages.find(pkg => pkg.name === "d3")).toEqual({ name: "d3", version: "7.9.0", conflict: "7.9.0 and 6.2.0 are different major versions" });
  });

  it("a component takes another family's theme by colour role, and the theme is written as CSS variables", () => {
    const entry = library.byId.get("graph-021")!;
    const impl = implementation(entry, "react")!;
    const paper = library.tokens.get("atlas-paper")!;
    const adapted = adaptSource(impl.source, entry, paper);
    expect(adapted.swapped).toBeGreaterThan(0);
    const terminal = library.tokens.get("atlas-terminal")!;
    expect(adapted.source.toLowerCase()).not.toContain(terminal.colors.positive.toLowerCase());
    expect(adapted.source.toLowerCase()).toContain(paper.colors.positive.toLowerCase());
    expect(adaptSource(impl.source, entry, terminal).swapped).toBe(0);
    expect(tokensCss(paper)).toMatch(/--cx-background: #f6f5f1;[\s\S]*--cx-series-1: #f2735d;/);
  });
});
