import { ruleText } from "./knowledge";
import { allowedLooks, analyzeRequest } from "./intent";
import { selectEntries } from "./retrieve";
import type { BriefRole, DesignBrief, DesignEntry, DesignIntent, Surface, WorkspaceFacts } from "./types";
import { workspaceFacts } from "./workspace";

// The per-run design brief: a system block appended after the static prompt (so that prompt stays
// cacheable), rendered once per run and identical on every turn. Only UI work gets one.

/** Characters of retrieved guidance (on top of the core entries): about 1,300 tokens. */
export const KNOWLEDGE_BUDGET = 5200;
/** Requests for expressive motion or 3D carry more that can go wrong, so they get a little more. */
const budgetFor = (intent: DesignIntent) => KNOWLEDGE_BUDGET + (intent.needs.includes("immersive") ? 900 : 0) + (intent.motion === "expressive" ? 600 : 0);

const SURFACE_LABEL: Record<Surface, string> = {
  landing: "product landing page", storefront: "storefront", dashboard: "data dashboard", editorial: "long-form editorial page", showcase: "product showcase",
  app: "app interface", portfolio: "portfolio site", docs: "documentation site", game: "browser game", general: "web interface",
};

export function buildBrief(input: { root: string; original: string; latest: string; imageAttached: boolean; facts?: WorkspaceFacts; visualTest?: boolean }): DesignBrief | null {
  const facts = input.facts ?? workspaceFacts(input.root);
  const intent = analyzeRequest({ original: input.original, latest: input.latest, imageAttached: input.imageAttached, facts });
  if (!intent.ui) return null;
  const { core, chosen } = selectEntries(intent, budgetFor(intent));
  return { intent, facts, entries: [...core, ...chosen], visualTest: input.visualTest ?? true };
}

function projectLine(facts: WorkspaceFacts) {
  if (!facts.existing) return "a new project";
  const stack = [facts.framework, ...facts.styling, ...facts.libraries.slice(0, 4)].filter(Boolean).join(", ");
  const tokens = facts.tokens ? `, ${facts.tokens} CSS custom properties already declared` : "";
  return `an existing project${stack ? ` (${stack}${tokens})` : tokens}`;
}

const section = (entry: DesignEntry) => `### ${entry.title}\n${entry.rules.map(rule => `- ${ruleText(rule)}`).join("\n")}`;

function workflow(role: BriefRole, intent: DesignIntent, facts: WorkspaceFacts, visualTest: boolean) {
  const record = facts.designDoc
    ? `The project's direction is in ${facts.designDoc}: read it first, keep to it, and update it when the user changes the direction.`
    : facts.existing
      ? "Follow the project's existing design system (tokens, components, fonts); state the direction in your plan rather than adding a DESIGN.md file unless the user asks for one."
      : "Write the direction to DESIGN.md (about 25 lines: concept, named colors with roles and contrast, type roles and scale, spacing, radius and elevation, motion, what you avoid) before any UI code, then define it as CSS custom properties. If you clone or find an existing project instead, follow its design system and add no DESIGN.md unless asked.";
  switch (role) {
    case "architect":
      return [
        "1. Fill submit_plan's design field: the concept, palette with roles, type, layout and motion, and the generic choices to avoid. Base it on the subject and on what the user said.",
        `2. Make the first step "Design direction and tokens"${facts.existing ? " (extending the existing system)" : ""}, with acceptance criteria the Reviewer can check: contrast, phone layout at 390 px, focus styles, reduced motion.`,
        visualTest
          ? "3. Plan the visual check: the Engineer builds and runs test_preview_visual, and fixes the audit's findings marked \"fix\"."
          : "3. There is no visual test in this environment: plan checks the Engineer can run on the source (contrast of the token pairs, a 390 px layout, focus styles).",
      ];
    case "reviewer":
      return [
        visualTest
          ? "1. Judge the build against the plan's design direction as well as its function: run test_preview_visual and read both screenshots and the design audit."
          : "1. Judge the build against the plan's design direction as well as its function, from the source (there is no visual test in this environment).",
        "2. Audit findings marked \"fix\" (or the same problems found in the source) are major issues; a generic template choice that contradicts the direction is a minor issue. Visual quality is in scope (only code style is not).",
      ];
    default:
      return [
        `1. Direction first. ${record}`,
        visualTest
          ? "2. Build, then run test_preview_visual: it returns desktop and phone screenshots and a design audit. Fix every finding marked \"fix\", weigh the \"improve\" ones, and give the reason for any deliberate exception in your summary."
          : "2. Build it. There is no visual test in this environment, so check the quality floor in the source yourself: contrast of every token pair, the layout at 390 px, focus styles, labels, reduced motion.",
        `3. Critique the result against the direction${intent.reference ? " and the reference image" : ""}: fix the weakest section and remove one accessory before you finish.`,
      ];
  }
}

const LOOK_LABEL: Record<string, string> = {
  violet: "purple or violet tones", "gradient-text": "gradient text", glass: "glass effects", emoji: "emoji", eyebrow: "all-caps labels",
  "default-font": "a standard system font", bounce: "bouncy motion", marquee: "a marquee or ticker",
};

/** The brief as a system block for one role. Byte-stable: same brief and role, same text. */
export function renderBrief(brief: DesignBrief, role: BriefRole = "solo") {
  const { intent, facts } = brief;
  const looks = allowedLooks(intent).map(look => LOOK_LABEL[look] ?? look);
  const lines = [
    "Design brief for this task (Curialy design intelligence). Use it while you plan, build and check the interface.",
    `Detected: ${SURFACE_LABEL[intent.surface]}, ${intent.register} register, ${intent.motion} motion, ${projectLine(facts)}.`,
  ];
  if (intent.cues.length) lines.push(`The user's direction: ${intent.cues.map(cue => `"${cue}"`).join(", ")}. It overrides the defaults below wherever they differ${looks.length ? `; they asked for ${looks.join(", ")}, so do that deliberately and keep the quality floor` : ""}.`);
  if (intent.avoid.length) lines.push(`The user asked to avoid: ${intent.avoid.map(cue => `"${cue}"`).join(", ")}.`);
  if (intent.reference) lines.push("An image is attached: treat it as the reference to match before adding anything of your own.");
  lines.push("", "## How to work", ...workflow(role, intent, facts, brief.visualTest));
  // The Reviewer checks against the floor, the tells and the recipe; it doesn't need the build guidance.
  const entries = role === "reviewer" ? brief.entries.filter(entry => entry.core || entry.discipline === "surface") : brief.entries;
  lines.push("", "## Guidance", ...entries.map(section));
  return lines.join("\n");
}

/** Brief for a run: null when the request is not interface work. */
export function designBriefFor(root: string, original: string, latest: string, imageAttached: boolean, visualTest = true) {
  try {
    return buildBrief({ root, original, latest, imageAttached, visualTest });
  } catch {
    // The brief is guidance: a workspace that can't be read leaves the run without one, never failed.
    return null;
  }
}
