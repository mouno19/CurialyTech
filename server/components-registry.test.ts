import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// The registry on a library of its own: a component is registered by adding its folder (no code
// change, no restart), invalid folders are reported instead of breaking the rest, and with
// thousands of components a simple request still retrieves only the few it needs, quickly.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-components-"));
process.env.COMPONENT_LIBRARY_DIR = dir;
fs.cpSync(path.resolve("component-library/vocabulary.json"), path.join(dir, "vocabulary.json"));
fs.mkdirSync(path.join(dir, "tokens"), { recursive: true });
fs.cpSync(path.resolve("component-library/tokens/atlas-paper.json"), path.join(dir, "tokens/atlas-paper.json"));

const { registry, resetRegistry } = await import("./components/registry");
const { compose } = await import("./components/compose");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function register(id: string, meta: Record<string, unknown> = {}, source = "export default function Component() { return null; }\n// a component of the test library, long enough to look like one".repeat(2)) {
  const folder = path.join(dir, "components", id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "react.jsx"), source);
  fs.writeFileSync(path.join(folder, "component.json"), JSON.stringify({
    id, name: `Component ${id}`, description: `A test component called ${id}.`, category: "data-visualization", batch: "test-batch", role: "chart",
    tags: [], compatible_tools: ["data-analytics"], frameworks: ["react"], implementations: [{ framework: "react", file: "react.jsx" }],
    style: { tokens: "atlas-paper" }, status: "active", ...meta,
  }));
}

beforeEach(() => {
  fs.rmSync(path.join(dir, "components"), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "components"), { recursive: true });
  resetRegistry();
});

describe("registration", () => {
  it("E: a new component becomes discoverable by adding its folder, with no other change", () => {
    register("chart-latency-histogram", { name: "Latency histogram", description: "Distribution of API response times with p50, p95 and p99 markers.", tags: ["latency", "histogram", "percentiles"] });
    expect(compose({ request: "x", needs: ["order book depth"] }).plan.needs[0].status).toBe("build");
    register("table-order-book", { name: "Order book", description: "Live bids and asks with depth bars, for trading terminals.", category: "data-management", batch: "trading", role: "table", tags: ["order-book", "bids", "asks", "trading"] });
    resetRegistry(); // the registry notices on its own within seconds; tests don't wait
    expect(registry().components.map(entry => entry.id).sort()).toEqual(["chart-latency-histogram", "table-order-book"]);
    const { plan } = compose({ request: "trading terminal", needs: ["order book depth", "API latency distribution"] });
    expect(plan.needs.filter(need => !need.implied).map(need => [need.status, need.component?.id])).toEqual([["matched", "table-order-book"], ["matched", "chart-latency-histogram"]]);
  });

  it("reports invalid folders and keeps the valid ones", () => {
    register("good-one");
    register("bad-schema", { compatible_tools: [] });
    register("wrong-folder", { id: "another-id" });
    fs.mkdirSync(path.join(dir, "components", "not-json"));
    fs.writeFileSync(path.join(dir, "components", "not-json", "component.json"), "{ nope");
    register("missing-file", { implementations: [{ framework: "react", file: "gone.jsx" }] });
    register("unknown-dep", { dependencies: [{ type: "component", id: "nowhere" }] });
    const snapshot = registry();
    expect(snapshot.components.map(entry => entry.id).sort()).toEqual(["good-one", "missing-file", "unknown-dep"]);
    expect(snapshot.problems.join("\n")).toMatch(/bad-schema: compatible_tools/);
    expect(snapshot.problems.join("\n")).toMatch(/wrong-folder: its id is "another-id"/);
    expect(snapshot.problems.join("\n")).toMatch(/not-json: component.json is not valid JSON/);
    expect(snapshot.problems.join("\n")).toMatch(/missing-file: missing gone.jsx/);
    expect(snapshot.problems.join("\n")).toMatch(/unknown-dep: depends on unknown component nowhere/);
    // A component whose file is gone is registered without that implementation.
    expect(snapshot.byId.get("missing-file")!.implementations).toEqual([]);
  });
});

describe("scale", () => {
  it("F: with 2,000 components a simple request retrieves only what it needs, in milliseconds", () => {
    const families = ["finance", "trading", "geo", "network", "science", "timeline", "retention", "kpi"];
    for (let n = 0; n < 2000; n++) {
      const family = families[n % families.length];
      register(`bulk-${family}-${n}`, { name: `${family} chart ${n}`, description: `A ${family} visualization number ${n} for dashboards.`, tags: [family, `variant-${n % 13}`], batch: `${family}-charts` });
    }
    register("nav-topbar-test", { name: "Top bar", description: "A top navigation bar with breadcrumb and actions.", category: "navigation", batch: "app-navigation", role: "header", tags: ["topbar", "top-navigation", "breadcrumb"], compatible_tools: ["web-design"] });
    resetRegistry();
    const started = Date.now();
    expect(registry().components.length).toBe(2001);
    const loaded = Date.now() - started;
    const first = compose({ request: "Create a top navigation bar." });
    const again = compose({ request: "Add a breadcrumb to the top bar." });
    expect(first.plan.components.map(component => component.id)).toEqual(["nav-topbar-test"]);
    expect(again.plan.components.map(component => component.id)).toEqual(["nav-topbar-test"]);
    expect(first.plan.stats.searched).toBe(2001);
    expect(loaded).toBeLessThan(5000);
    expect(again.plan.stats.ms).toBeLessThan(500);
  });
});
