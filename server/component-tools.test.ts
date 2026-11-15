import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventBody } from "@shared/agent";

// The agent's component tools on the real library and a workspace of their own: a plan, the
// chosen components copied in one theme (with their stylesheet and tokens), what the user's tools
// rule out, a component the agent saved (seen by its own account only), and the fixed-size block
// the agent is told about the library.

const state = vi.hoisted(() => ({ owner: "owner-a", rows: [] as { owner_id: string; id: string; meta: unknown; framework: string; source: string }[] }));
vi.mock("./agent/store", () => ({ taskOwner: async () => state.owner }));
vi.mock("./db/pg", () => ({
  query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT id, meta, framework, source FROM curialy.component_candidates")) return { rows: state.rows.filter(row => row.owner_id === params[0]), rowCount: 0 };
    if (sql.includes("INSERT INTO curialy.component_candidates")) {
      const [owner_id, id, meta, framework, source] = params as string[];
      state.rows = [...state.rows.filter(row => !(row.owner_id === owner_id && row.id === id)), { owner_id, id, meta: JSON.parse(meta), framework, source }];
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  },
}));

const { COMPONENT_SCHEMAS, componentsContext, runComponentTool } = await import("./agent/component-tools");
const { registry } = await import("./components/registry");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-components-ws-"));
afterAll(() => fs.rmSync(workspace, { recursive: true, force: true }));

let events: AgentEventBody[] = [];
let session = 0;
const ctx = (selectedTools: string[] = []) => ({ sessionId: `00000000-0000-4000-8000-0000000000${String(++session).padStart(2, "0")}`, root: workspace, callId: "call-1", signal: new AbortController().signal, emit: (event: AgentEventBody) => { events.push(event); }, onFileChange: () => undefined, selectedTools }) as never;
const tool = (name: keyof typeof COMPONENT_SCHEMAS, input: Record<string, unknown>, tools: string[] = []) => runComponentTool(name, COMPONENT_SCHEMAS[name].parse(input), ctx(tools));

beforeEach(() => {
  events = [];
  state.owner = "owner-a";
});

describe("find_components", () => {
  it("plans across categories with the needs the agent gives, and names the next step", async () => {
    const result = await tool("find_components", { request: "SaaS dashboard for an API platform", needs: ["sidebar navigation", "revenue over time", "API logs table with search", "latency distribution"] });
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/✓ sidebar navigation → nav-sidebar/);
    expect(result.content).toMatch(/✓ API logs table with search → table-source-directory/);
    expect(result.content).toMatch(/Next: add_components with /);
    // The four needs given, plus what a dashboard implies (marked as implied).
    expect(result.summary).toMatch(/components · \d+\/\d+ needs matched/);
    expect(result.content).toMatch(/\(implied\)/);
  });
});

describe("add_components", () => {
  it("copies the components into the workspace in one theme, with their stylesheet and the tokens", async () => {
    const result = await tool("add_components", { ids: ["graph-021", "table-source-directory"], theme: "atlas-paper" });
    expect(result.ok).toBe(true);
    const lib = path.join(workspace, "src/components/library");
    const files = fs.readdirSync(lib, { recursive: true }).map(String).sort();
    expect(files).toEqual(expect.arrayContaining(["CandlestickChart.jsx", "table-source-directory.html", "styles/atlas-paper.css", "tokens.css", "tokens.js"]));
    const candle = fs.readFileSync(path.join(lib, "CandlestickChart.jsx"), "utf8");
    // Adapted from the dark terminal family to the paper theme's colours.
    expect(candle.toLowerCase()).toContain(registry().tokens.get("atlas-paper")!.colors.positive.toLowerCase());
    expect(candle.toLowerCase()).not.toContain(registry().tokens.get("atlas-terminal")!.colors.positive.toLowerCase());
    expect(result.content).toMatch(/import CandlestickChart from "\.\/CandlestickChart\.jsx"/);
    expect(result.content).toMatch(/Install: npm install .*chart\.js@4\.4\.8|Install: npm install react@18\.3\.1/);
    expect(events.filter(event => event.type === "file_change").length).toBe(files.filter(file => !file.endsWith("styles")).length);
    // The source itself is not in what the model reads.
    expect(result.content.length).toBeLessThan(2000);
  });

  it("never replaces a file of the user's", async () => {
    const own = path.join(workspace, "mine/tokens.css");
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, ":root { --brand: red; }");
    const result = await tool("add_components", { ids: ["nav-sidebar"], dir: "mine" });
    expect(result.content).toMatch(/Skipped: mine\/tokens\.css \(a file of yours is there: not replaced\)/);
    expect(fs.readFileSync(own, "utf8")).toBe(":root { --brand: red; }");
  });

  it("refuses components of a tool the user didn't select, and unknown ids", async () => {
    const blocked = await tool("add_components", { ids: ["graph-021"] }, ["web-design"]);
    expect(blocked).toMatchObject({ ok: false, summary: "Tool not selected" });
    expect(blocked.content).toMatch(/Ask them to enable it/);
    expect(await tool("add_components", { ids: ["graph-999"] })).toMatchObject({ ok: false, summary: "Unknown component" });
  });
});

describe("load_component", () => {
  it("reads one component (adapted when a theme is given)", async () => {
    const plain = await tool("load_component", { id: "graph-041" });
    expect(plain.content).toMatch(/^Treemap · graph-041 · react/);
    expect(plain.content).toContain("export default function TreemapWithData");
    const themed = await tool("load_component", { id: "graph-041", theme: "atlas-paper" });
    expect(themed.content).toMatch(/\d+ colours adapted to atlas-paper/);
    expect(await tool("load_component", { id: "graph-041", theme: "nope" })).toMatchObject({ ok: false, summary: "Unknown theme" });
  });
});

describe("save_component", () => {
  it("keeps a component as a candidate its own account finds later, and no other account sees", async () => {
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src/OrderBook.jsx"), "export default function OrderBook({ bids = [], asks = [] }) { return <table>{bids.length + asks.length}</table>; }\n");
    const saved = await tool("save_component", { path: "src/OrderBook.jsx", name: "Order book", description: "Live bids and asks with depth bars for a trading terminal.", category: "data-management", role: "table", tags: ["order book", "bids", "asks"] });
    expect(saved).toMatchObject({ ok: true, summary: "Saved custom-order-book" });
    expect(state.rows).toHaveLength(1);
    const found = await tool("find_components", { request: "trading terminal", needs: ["order book"] });
    expect(found.content).toMatch(/✓ order book → custom-order-book/);
    state.owner = "owner-b";
    const other = await tool("find_components", { request: "trading terminal", needs: ["order book"] });
    expect(other.content).not.toContain("custom-order-book");
  });
});

describe("what the agent is told", () => {
  it("is the same size whatever the library holds, and says which tools the user selected", () => {
    const text = componentsContext(["web-design", "data-analytics"], "agent");
    expect(text).toMatch(/Component library: \d+ reusable components/);
    expect(text).toContain("Tools the user selected for this task: Web Design, Data Analytics.");
    expect(text).toContain("ask the user to enable that tool");
    // No component is listed: it is searched on demand.
    expect(text).not.toMatch(/graph-0\d\d|nav-sidebar|Candlestick/);
    expect(text.length).toBeLessThan(2500);
    expect(componentsContext([], "chat")).toMatch(/not limited \(the user selected none\)/);
  });

  it("is only for interface, dashboard or chart work", async () => {
    const { wantsComponents } = await import("./agent/component-tools");
    for (const text of ["Build a SaaS analytics dashboard", "Add a revenue chart to the report page", "Create a landing page", "Make the sidebar collapsible"]) expect(wantsComponents(text), text).toBe(true);
    for (const text of ["Write a cron job that rotates the logs", "Fix the failing pytest in utils.py", "Summarize this PDF"]) expect(wantsComponents(text), text).toBe(false);
  });
});
