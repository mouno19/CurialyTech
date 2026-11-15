import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MOTION, MOTION_FAMILIES, MOTION_KIT, MOTION_PIECES, MOTION_TIMING } from "./agent/design/knowledge/motion";
import { knowledgeProblems } from "./agent/design/knowledge";
import { motionMixture, renderMotionMixture } from "./agent/design/synthesis";
import { allowedLooks, analyzeRequest } from "./agent/design/intent";
import { buildBrief, renderBrief } from "./agent/design/brief";
import type { WorkspaceFacts } from "./agent/design/types";
import { registry } from "./components/registry";
import { compose } from "./components/compose";
import { tokensCss } from "./components/adapt";
import { AGENT_SYSTEM } from "./agent/runner";

// The motion library in Curialy's design intelligence: the ten staged motion suites (100 pieces) and
// the scroll motion mock, registered piece by piece; a request that asks for motion gets a few
// pieces by job (what it names, else defaults for its kind of site), on the design's tokens and the
// shared timing, never a whole suite, one continuous animation unless the user names more, and an
// end state for reduced motion.

const SUITES = path.resolve("component-library/motion-components");
const MOCK = path.resolve("component-library/motion-mocks/scroll-transition-showcase");
const facts: WorkspaceFacts = { hasUi: false, existing: false, framework: null, styling: [], libraries: [], tokens: 0, designDoc: null };
const intent = (text: string) => analyzeRequest({ original: text, latest: text, imageAttached: false, facts });
const brief = (text: string) => buildBrief({ root: "/tmp", original: text, latest: text, imageAttached: false, facts });
const picks = (text: string) => intent(text).motionPicks;
const piece = (id: string) => MOTION_PIECES.find(item => item.id === id)!;

describe("the motion library", () => {
  it("is the ten staged suites of ten pieces each, plus the scroll mock's kit", () => {
    expect(MOTION_FAMILIES).toHaveLength(10);
    expect(MOTION_PIECES).toHaveLength(100);
    expect(new Set(MOTION_PIECES.map(item => item.id)).size).toBe(100);
    const files = fs.readdirSync(SUITES).filter(name => name.endsWith(".html")).sort();
    expect(MOTION_FAMILIES.map(family => family.file).sort()).toEqual(files);
    const readme = fs.readFileSync(path.join(SUITES, "README.md"), "utf8");
    for (const family of MOTION_FAMILIES) {
      expect(readme, family.file).toContain(family.file);
      expect(MOTION_PIECES.filter(item => item.family === family.id), family.id).toHaveLength(10);
    }
    for (const item of MOTION_PIECES) for (const signal of item.signals) expect(signal, item.id).toBe(signal.toLowerCase());
    // The scroll patterns have the mock's React versions.
    expect(MOTION_PIECES.filter(item => item.react).map(item => item.family)).toEqual(Array(10).fill("motion-scroll"));
    expect(MOTION_KIT.id).toBe("motion-react-scroll-kit");
  });

  it("shares one timing, the mock's ease, with every motion token set and every theme's tokens.css", () => {
    expect(fs.readFileSync(path.join(MOCK, "src", "index.css"), "utf8")).toContain(`--ease: ${MOTION_TIMING.ease}`);
    const library = registry();
    const motionSets = [...library.tokens.values()].filter(set => set.id.startsWith("motion-"));
    expect(motionSets).toHaveLength(11);
    for (const set of motionSets) expect(set.motion, set.id).toEqual(MOTION_TIMING);
    // A theme without motion tokens (the anime and atlas families) still gets them.
    const css = tokensCss(library.tokens.get("atlas-paper")!);
    expect(css).toContain(`--cx-ease: ${MOTION_TIMING.ease};`);
    expect(css).toContain("--cx-duration-reveal: 800ms;");
  });

  it("is valid design knowledge, with the mixture rules", () => {
    expect(knowledgeProblems()).toEqual([]);
    const rules = MOTION.find(entry => entry.id === "motion-mixture")!;
    expect(rules.needs).toEqual(["motion"]);
    expect(JSON.stringify(rules.rules)).toMatch(/at most one hero moment/);
  });
});

describe("the motion mixture", () => {
  it("takes what the request names, by its longest phrase, and fills the other jobs for the kind of site", () => {
    const chosen = picks("Build a landing page with a magnetic button, 3D card tilt, a text scramble headline and a scroll progress ring");
    expect(chosen).toEqual(expect.arrayContaining(["motion-button-magnetic", "motion-card-tilt", "motion-type-text-scramble", "motion-scroll-progress"]));
    // "progress ring" is part of "scroll progress ring": not the loader.
    expect(chosen).not.toContain("motion-loader-progress-ring");
    // A general request gets a mixture across several suites, never one suite.
    const general = picks("Create an animated landing page for our AI startup");
    expect(new Set(general.map(id => piece(id).family)).size).toBeGreaterThanOrEqual(4);
    expect(picks("Create an animated landing page for our AI startup")).toEqual(general);
    // It varies with the request.
    const sets = new Set(["Create an animated landing page for our AI startup", "Build an animated landing page for a design agency", "Make an animated landing page for a coffee brand", "Animated landing page for a fintech app"].map(text => picks(text).join(" ")));
    expect(sets.size).toBeGreaterThanOrEqual(3);
  });

  it("picks for the subject: dashboards get charts and skeletons, docs get progress and a scrollspy", () => {
    expect(picks("Make a dashboard with animated charts and skeleton loading states")).toEqual(expect.arrayContaining(["motion-loader-skeleton"]));
    expect(picks("Make a dashboard with animated charts and skeleton loading states").some(id => piece(id).slot === "data")).toBe(true);
    expect(picks("Create a docs site with a scroll progress bar and a table of contents")).toEqual(["motion-scroll-progress", "motion-nav-vertical-timeline"]);
    expect(picks("Build a chat app with an AI thinking indicator")).toEqual(["motion-loader-ai-thinking"]);
  });

  it("keeps the budget: one continuous animation from defaults, two only when the user names them", () => {
    for (const text of ["Create an animated landing page for our AI startup", "Build an anime streaming website with animated hero and trending shelves", "Build a landing page with an animated hero background"]) {
      expect(picks(text).filter(id => piece(id).cost === "loop").length, text).toBeLessThanOrEqual(1);
    }
    const two = brief("Build a website with an aurora background and a starfield")!;
    expect(two.intent.motionPicks).toEqual(expect.arrayContaining(["motion-bg-aurora", "motion-bg-starfield"]));
    expect(renderBrief(two)).toMatch(/never on screen together/);
  });

  it("honours refusals, and leaves requests without motion alone", () => {
    expect(picks("A static landing page, no animations")).toEqual([]);
    expect(picks("Build a landing page with parallax but no 3d").some(id => /3d/i.test(`${id} ${piece(id).name}`))).toBe(false);
    expect(picks("Build a landing page with parallax but no 3d")).toContain("motion-scroll-parallax");
    expect(picks("Build a landing page with animations but no particles and no glass").some(id => /particle|glass/.test(id))).toBe(false);
    expect(picks("Create a SaaS landing page for an invoicing tool")).toEqual([]);
    expect(picks("Build an analytics dashboard for API usage")).toEqual([]);
    expect(motionMixture({ text: "an animated landing page", ui: false, surface: "landing", motion: "expressive", needs: ["motion"] })).toBeNull();
  });

  it("uses studies made for show only when named, and makes a look deliberate only when the user named its piece", () => {
    for (const text of ["Create an animated landing page for our AI startup", "Build an animated portfolio for a photographer", "Build an e-commerce store for sneakers with micro-interactions"]) {
      expect(picks(text).filter(id => piece(id).showcase), text).toEqual([]);
    }
    expect(picks("Build a game landing page with glitch text and particles")).toEqual(expect.arrayContaining(["motion-type-glitch", "motion-canvas-particle-burst"]));
    const glass = intent("Landing page with a kinetic text scramble headline, glass buttons and a scroll progress ring");
    expect(glass.motionPicks).toContain("motion-button-glass");
    expect(allowedLooks(glass)).toContain("glass");
    // Defaults never lift a warning.
    for (const text of ["Create an animated landing page for our AI startup", "Build a landing page with an animated hero background"]) expect(intent(text).granted, text).toEqual([]);
  });

  it("goes on the style synthesis's tokens when there is one", () => {
    const anime = brief("Build an anime streaming website with animated hero and trending shelves")!;
    expect(anime.motionMixture!.theme).toBe(anime.synthesis!.primary.id);
    expect(brief("Create an animated landing page for our AI startup")!.motionMixture!.theme).toMatch(/^motion-/);
  });
});

describe("the design brief", () => {
  it("carries the motion mixture: pieces by job, the shared timing, the budget and reduced motion", () => {
    const made = brief("Build a landing page with a magnetic button, 3D card tilt, a text scramble headline and a scroll progress ring")!;
    const text = renderBrief(made);
    expect(text).toMatch(/## Motion mixture \(the request names these\)/);
    expect(text).toContain("never reproduce a suite or the scroll mock");
    expect(text).toContain(`--cx-ease ${MOTION_TIMING.ease}`);
    expect(text).toMatch(/component motion-scroll-progress, React: motion-scroll-progress-react/);
    expect(text).toContain("Reduced motion (prefers-reduced-motion: reduce): every piece has an end state");
    expect(text).toMatch(/add_components with motion-type-text-scramble, .*motion-button-magnetic/);
    expect(renderBrief(made)).toBe(text);
    expect(renderBrief(made, "reviewer")).toMatch(/ships a whole motion suite or the scroll mock, runs two continuous animations at once, or has no reduced-motion end state is a major issue/);
    expect(renderMotionMixture(made.motionMixture!)).toContain("Budget: nothing runs continuously");
    expect(renderBrief(brief("Create a SaaS landing page for an invoicing tool")!)).not.toContain("## Motion mixture");
  });

  it("the agent's prompt carries the rule", () => {
    expect(AGENT_SYSTEM).toContain("never a whole motion suite or mock");
  });
});

describe("the component library", () => {
  const library = registry();
  const html = (id: string) => fs.readFileSync(path.join(library.byId.get(id)!.dir, "component.html"), "utf8");

  it("has every piece, its React version and the kit, all rendered", () => {
    for (const item of MOTION_PIECES) {
      const entry = library.byId.get(item.id);
      expect(entry, item.id).toBeDefined();
      expect(entry!.batch).toBe(item.family);
      expect(entry!.quality?.rendered, item.id).toBe(true);
      if (item.react) {
        const variant = library.byId.get(`${item.id}-react`)!;
        expect(variant.variant_of).toBe(item.id);
        expect(variant.frameworks).toEqual(["react"]);
        expect(variant.quality?.rendered, variant.id).toBe(true);
      }
    }
    const kit = library.byId.get(MOTION_KIT.id)!;
    expect(fs.readFileSync(path.join(kit.dir, "react.jsx"), "utf8")).toContain("export { useInView, useElementProgress, Reveal };");
    expect(library.problems).toEqual([]);
  });

  it("keeps each piece to itself: its own scope, its own branch of a shared canvas, no Tailwind CDN", () => {
    for (const item of MOTION_PIECES) {
      const source = html(item.id);
      expect(source, item.id).toMatch(/<script>\n\(\(\) => \{\n[\s\S]*\n\}\)\(\);\n<\/script>/);
      expect(source, item.id).not.toContain("cdn.tailwindcss.com");
      // The authoring tool's ids go, except those the piece's script selects by.
      for (const [, value] of source.matchAll(/\sdata-template-id="([^"]+)"/g)) expect(source.slice(source.lastIndexOf("<script>")), `${item.id} ${value}`).toContain(value);
    }
    // The backgrounds shared one draw(): each keeps its own effect.
    expect(html("motion-bg-starfield")).toContain('let effect="stars";');
    expect(html("motion-bg-starfield")).not.toContain("effect===");
    // The charts were drawn by one render(): each draws its own.
    expect(html("motion-chart-funnel")).toMatch(/funnelChart\(\);\n\}\)\(\);/);
    expect(html("motion-chart-funnel")).not.toContain("function lineChart");
    // The suites' Tailwind utilities are in their stylesheets, without cascade layers.
    const css = fs.readFileSync(path.resolve("component-library/styles/motion-canvas.css"), "utf8");
    expect(css).toMatch(/\.cx-motion-canvas \.text-xs \{/);
    expect(css).not.toMatch(/@layer\b/);
  });

  it("finds the pieces a request names", () => {
    const { plan } = compose({ request: "Build a landing page with a magnetic button, 3D card tilt, a text scramble headline and skeleton loading" });
    const ids = plan.components.map(component => component.id);
    expect(ids).toEqual(expect.arrayContaining(["motion-button-magnetic", "motion-card-tilt", "motion-type-text-scramble", "motion-loader-skeleton"]));
  });
});
