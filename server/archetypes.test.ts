import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "./agent/design/knowledge/archetypes";
import { knowledgeProblems } from "./agent/design/knowledge";
import { synthesize } from "./agent/design/synthesis";
import { allowedLooks, analyzeRequest } from "./agent/design/intent";
import { buildBrief, renderBrief } from "./agent/design/brief";
import type { WorkspaceFacts } from "./agent/design/types";
import { registry } from "./components/registry";
import { compose, planText } from "./components/compose";
import { AGENT_SYSTEM } from "./agent/runner";

// The anime style archetypes in Curialy's design intelligence: their tokens are the templates' own
// (with text-safe shades where a template's colour fails contrast), a request gets a mixture of
// archetypes on one token set (never one template), their looks are deliberate where chosen, the
// subjects they suit outside anime pick them too, and their blocks are in the component library.

const TEMPLATES = path.resolve("component-library/anime-templates");
const facts: WorkspaceFacts = { hasUi: false, existing: false, framework: null, styling: [], libraries: [], tokens: 0, designDoc: null };
const brief = (text: string) => buildBrief({ root: "/tmp", original: text, latest: text, imageAttached: false, facts });
const intent = (text: string) => analyzeRequest({ original: text, latest: text, imageAttached: false, facts });
const pick = (text: string) => synthesize({ text, ui: true });

function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("the archetypes", () => {
  it("are the ten staged templates, with their own tokens and fonts", () => {
    expect(ARCHETYPES).toHaveLength(10);
    const readme = fs.readFileSync(path.join(TEMPLATES, "README.md"), "utf8");
    for (const archetype of ARCHETYPES) {
      expect(readme, archetype.id).toContain(`\`${archetype.id}\``);
      const html = fs.readFileSync(path.join(TEMPLATES, archetype.file), "utf8");
      const root = /:root\s*{([^}]*)}/.exec(html)![1].toLowerCase();
      for (const role of ["bg", "text", "muted", "accent"] as const) expect(root, `${archetype.id} ${role}`).toContain(archetype.tokens[role].toLowerCase());
      for (const font of [archetype.fonts.display, archetype.fonts.text, archetype.fonts.extra].filter(Boolean) as string[]) expect(html, `${archetype.id} ${font}`).toContain(font.replace(/ /g, "+"));
    }
  });

  it("keep text readable: text, text-safe muted and accent shades reach 4.5:1 on the background and the raised surface", () => {
    for (const archetype of ARCHETYPES) {
      const { bg, surface, text, onAccent, accent } = archetype.tokens;
      for (const ground of [bg, surface]) {
        expect(contrast(text, ground), `${archetype.id} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(archetype.textSafe?.muted ?? archetype.tokens.muted, ground), `${archetype.id} muted`).toBeGreaterThanOrEqual(4.5);
        if (archetype.textSafe?.accent) expect(contrast(archetype.textSafe.accent, ground), `${archetype.id} accent text`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(onAccent, accent), `${archetype.id} label on accent`).toBeGreaterThanOrEqual(4.5);
    }
    // The templates' own muted colours that fail are the ones given a text-safe shade.
    expect(ARCHETYPES.filter(archetype => contrast(archetype.tokens.muted, archetype.tokens.bg) < 4.5).map(archetype => archetype.name).sort())
      .toEqual(ARCHETYPES.filter(archetype => archetype.textSafe?.muted).map(archetype => archetype.name).sort());
  });

  it("are valid design knowledge (the media recipe included)", () => {
    expect(knowledgeProblems()).toEqual([]);
  });
});

describe("synthesis", () => {
  it("mixes a base with partners for anime work, never one archetype alone, and deterministically", () => {
    const request = "Build an anime streaming website with trending shelves, a filterable catalog and an episode guide.";
    const one = pick(request)!;
    expect(one.entertainment).toBe(true);
    expect(one.partners.length).toBeGreaterThanOrEqual(1);
    expect(new Set(one.blocks.map(item => item.archetype.id)).size).toBeGreaterThanOrEqual(2);
    for (const archetype of [one.primary, ...one.partners]) expect(one.blocks.filter(item => item.archetype === archetype).length).toBeLessThanOrEqual(Math.max(2, Math.ceil(archetype.blocks.length / 2)));
    // What the request names comes from whichever archetype has it.
    expect(one.blocks.map(item => item.block.id)).toEqual(expect.arrayContaining(["anime-kuro-detail"]));
    expect(pick(request)).toEqual(one);
    // Requests that name no style still vary their base.
    const bases = new Set(["anime fan site for a mecha series", "manga reader website", "anime news portal", "a website for our anime club", "k-drama streaming site", "webtoon site"].map(text => pick(`Build an ${text}`)!.primary.id));
    expect(bases.size).toBeGreaterThanOrEqual(3);
  });

  it("brings the archetypes to other subjects that suit them, and leaves the rest alone", () => {
    const base = (text: string) => pick(text)?.primary.name ?? null;
    expect(base("Create a luxury fashion brand website with a lookbook")).toBe("Kuro Cinema");
    expect(base("Build a developer portal for our CLI with a terminal look")).toBe("Otaku OS");
    expect(base("Make a website for a cozy cafe and reading club")).toBe("Slice of Life");
    expect(base("A website for a florist that does weddings")).toBe("Sakura Stream");
    expect(base("Website for a tea house and its museum of crafts")).toBe("Kitsune Flix");
    expect(base("Landing page for a boxing gym and fitness club")).toBe("Shonen Hub");
    expect(base("Build a job board with listings and filters")).toBe("Anime Grid");
    expect(base("A literary magazine site with issues and reviews")).toBe("Frame Anime");
    expect(base("Website for a web3 hackathon with retro pixel style")).toBe("Anime Arcade");
    expect(base("A video platform with shelves of recommended videos")).toBe("Nebula Anime");
    expect(base("Build a SaaS landing page for an invoicing tool")).toBeNull();
    expect(base("Create an analytics dashboard for API usage")).toBeNull();
    // A refused look rules its archetypes out.
    const calm = synthesize({ text: "build a manga reading site, no neon", ui: true, avoid: ["neon"] })!;
    expect([calm.primary, ...calm.partners].map(archetype => archetype.name)).not.toEqual(expect.arrayContaining(["Anime Arcade"]));
    expect([calm.primary, ...calm.partners].map(archetype => archetype.name)).not.toContain("Nebula Anime");
  });
});

describe("the design brief", () => {
  it("carries the mixture, one token set and the never-a-template rule", () => {
    const made = brief("Build an anime streaming website with trending shelves, a filterable catalog and an episode guide.")!;
    expect(made.intent.surface).toBe("media");
    const text = renderBrief(made);
    expect(text).toContain("Detected: anime, streaming or entertainment site");
    expect(text).toMatch(/## Style synthesis \(anime or entertainment work/);
    expect(text).toContain("Mix archetypes; never reproduce one template.");
    expect(text).toMatch(/--bg #[0-9a-f]{6}, --surface #[0-9a-f]{6}/);
    expect(text).toContain("Borrowed blocks take these tokens and this radius, never their own palette.");
    expect(text).toContain("### Recipe: anime, streaming or entertainment site");
    expect(renderBrief(made)).toBe(text);
    // The reviewer is told what to check, not the whole build guidance.
    expect(renderBrief(made, "reviewer")).toMatch(/reproduces one template, or mixes palettes and radii across sections, is a major issue/);
  });

  it("drops the generic warnings for the looks the chosen archetypes are built on, and keeps the others", () => {
    const nebula = brief("Build an anime streaming site in the style of Nebula Anime with glowing shelves")!;
    expect(nebula.synthesis!.primary.name).toBe("Nebula Anime");
    const text = renderBrief(nebula);
    expect(text).not.toContain("Purple, indigo or violet gradients");
    expect(text).not.toContain("Glass panels for content");
    expect(text).toContain("Emoji as icons");
    expect(allowedLooks(nebula.intent)).toEqual(expect.arrayContaining(["glass", "violet"]));
    // Without archetypes the warnings stand.
    const plain = renderBrief(brief("Build a SaaS landing page for an invoicing tool")!);
    expect(plain).toContain("Purple, indigo or violet gradients");
    expect(plain).not.toContain("## Style synthesis");
    expect(intent("Build a SaaS landing page for an invoicing tool").styles).toEqual([]);
  });

  it("the agent's prompt carries the rule", () => {
    expect(AGENT_SYSTEM).toContain("Never reproduce a single template or mockup as it is.");
  });
});

describe("the component library", () => {
  const library = registry();
  it("has every archetype's blocks and token set", () => {
    for (const archetype of ARCHETYPES) {
      expect(library.tokens.get(archetype.id)?.colors.background, archetype.id).toBe(archetype.tokens.bg);
      for (const block of archetype.blocks) expect(library.byId.get(block.id)?.archetype, block.id).toBe(archetype.id);
    }
    expect(library.problems).toEqual([]);
  });

  it("plans an anime site from several archetypes on one theme, and says so when a plan leans on one", () => {
    const { plan } = compose({ request: "Build an anime streaming website with trending shelves, a filterable catalog, an episode guide and continue watching." });
    const archetypes = new Set(plan.components.map(component => component.archetype).filter(Boolean));
    expect(archetypes.size).toBeGreaterThanOrEqual(3);
    expect(ARCHETYPES.map(archetype => archetype.id)).toContain(plan.theme.id);
    expect(planText(plan)).toMatch(/Style blocks from \d archetypes .* put them on one token set/);
    const single = compose({ request: "x", needs: ["membership perks", "luxury premiere grid"] }).plan;
    if (new Set(single.components.map(component => component.archetype).filter(Boolean)).size === 1) expect(planText(single)).toMatch(/^Mix: these style blocks all come from one archetype/m);
  });
});
