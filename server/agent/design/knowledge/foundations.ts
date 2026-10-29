import type { DesignEntry } from "../types";

// Direction process, type, color, layout, imagery and copy. Rules are written as instructions to
// the agent, with the numbers that make them checkable. Sources: see docs/design-intelligence.md.

/**
 * Words that mean the user asked for a look on purpose (the matching warning is then dropped; a
 * refusal such as "no glass" keeps it). Kept narrow: a beige gradient is not a purple one, and
 * "pricing cards" is not a request for the card kit.
 */
const ASKED_VIOLET = ["purple", "violet", "indigo", "neon", "glow", "aurora", "synthwave", "vaporwave", "cyberpunk", "gradient text", "gradient headline", "gradient heading"];
const ASKED_GLASS = ["glassmorphism", "frosted glass", "liquid glass", "glass effect", "glass card", "glass cards", "glass panel", "glass panels", "translucent"];
const ASKED_CARDS = ["bento", "card grid", "card-based"];
const ASKED_PLAYFUL_MOTION = ["marquee", "ticker", "bounce", "bouncy", "elastic", "typewriter", "typing effect"];

export const FOUNDATIONS: DesignEntry[] = [
  {
    id: "direction-first",
    title: "Direction before code",
    discipline: "process",
    core: true,
    rules: [
      "Ground the design in the subject: who it is for, the one job of this screen, and the materials, vocabulary and imagery of its world (furniture: wood, light, rooms; logistics: routes, timestamps, statuses).",
      "Before any UI code, fix the direction in writing: a one-line concept; 4-6 named colors with roles (surface, raised surface, text, muted text, accent, status) and their contrast; type roles (display, text, mono if needed) with a size scale; a spacing scale; radius and elevation rules; the motion stance; and what leads each section.",
      "Name 3 generic choices you are deliberately not making, and compare the plan with what you would produce for any similar prompt; revise the parts that would be the same.",
      "Implement the direction as CSS custom properties first (color, type, space, radius, shadow, duration, easing). Components use the tokens, never literal colors or one-off sizes.",
      "Spend boldness in one place per view (a headline, an image, a live demo) and keep everything around it quiet. Before finishing, remove one accessory.",
    ],
    sources: ["anthropic-frontend-design-skill", "corpus:everestchris6-399895", "corpus:stokebuilder-356793", "corpus:archiveexplorer-560622", "corpus:daniel-haida-636937"],
  },
  {
    id: "user-direction",
    title: "The user's direction comes first",
    discipline: "process",
    core: true,
    rules: [
      "Anything the user specified (style words, colors, fonts, a reference site, an attached mockup) overrides every default in this brief. Carry their words into the direction.",
      "With an attached mockup or screenshot, match its layout, proportions, colors and type first; add only what it lacks (states, responsiveness, accessibility).",
      "In an existing project, extend its design system (tokens, components, spacing, fonts) instead of restyling it; change the visual language only when asked.",
    ],
    sources: ["corpus:bthreeagency-827092", "corpus:l3d1c-632524", "corpus:proanaliteg-458642"],
  },
  {
    id: "generic-tells",
    title: "Generic tells to avoid (unless asked for)",
    discipline: "process",
    core: true,
    rules: [
      "Reflex type: one default sans (Inter, Roboto, Arial, system-ui) with a flat scale, or the newer reflex set (Space Grotesk, Geist, Plus Jakarta Sans, oversized italic-serif heroes).",
      { text: "Purple, indigo or violet gradients, gradient-filled headline text, neon on near-black, colored glows and blurred blobs behind the hero.", unless: ASKED_VIOLET },
      { text: "Glass panels for content (backdrop-filter on cards and sections); keep translucency for a floating bar or menu at most.", unless: ASKED_GLASS },
      { text: "Everything in identical rounded cards with one radius and the same soft shadow, cards inside cards, colored left stripes on cards.", unless: ASKED_CARDS },
      "The template skeleton regardless of subject: centered hero with two buttons, logo strip, stat strip, 3-up icon features, FAQ; a tracked ALL-CAPS eyebrow over every heading; one accented word in each headline; 01/02/03 on things that are not steps; an arrow on every link.",
      "Motion tropes: fade-and-slide-up on every section, hover lift on every card, transition: all.",
      { text: "Gimmick motion: bounce or elastic easing, marquee logo rows, pulsing dots, fake typing.", unless: ASKED_PLAYFUL_MOTION },
      "Emoji as icons, \"illustrations\" assembled from primitive shapes, sparkle icons on AI features, decorative grid or stripe backgrounds.",
    ],
    sources: ["anthropic-frontend-design-skill", "impeccable-catalogue", "corpus:raphaelaubryy-687877", "corpus:daniel-haida-636937"],
  },
  {
    id: "quality-floor",
    title: "Quality floor (every page)",
    discipline: "accessibility",
    core: true,
    rules: [
      "Text contrast at least 4.5:1 (3:1 for text 24 px and up, or 18.66 px bold and up); borders of inputs, icons and focus rings at least 3:1 against what is next to them.",
      "A visible :focus-visible style on every control (a 2 px or thicker outline with offset); never outline: none without a replacement.",
      "Pointer targets at least 24×24 px everywhere and 44×44 px on touch layouts and for primary controls.",
      "No sideways scrolling at 320-390 px; a meta viewport without maximum-scale or user-scalable=no; <html lang>; one h1 with no skipped heading levels; header, main and footer landmarks.",
      "Every image has alt (alt=\"\" when decorative); every control and field has a visible label or an accessible name. A placeholder is not a label.",
      "Content is visible at rest: never hide text until a script reveals it. Under prefers-reduced-motion: reduce, remove movement (translate, scale, parallax, auto-scroll) and keep short opacity fades.",
      "Specific, plausible content: no lorem ipsum, \"John Doe\" or \"Acme\", and no invented facts presented as real (customer counts, logos); label sample data as sample where it could be mistaken for fact.",
    ],
    sources: ["WCAG 2.2 (1.4.3, 1.4.11, 2.4.7, 2.5.8, 1.4.10, 1.1.1, 2.3.3)", "WAI-ARIA APG", "WebAIM Million 2026"],
  },
  {
    id: "type-choice",
    title: "Choosing type",
    discipline: "typography",
    rules: [
      "Pick faces from the subject: a display face with character for brand and editorial pages; a well-tuned neutral sans is right for dense product UI. Use one family, or two that clearly differ (display + text, or text + mono).",
      "Keep font loading light: at most 2 families and 4 weights, WOFF2, font-display: swap, preconnect to the font origin, and a fallback stack close in metrics.",
      "Without web fonts, choose a deliberate system stack (ui-serif, Georgia for reading; system-ui for interfaces) instead of falling back to Arial.",
    ],
    sources: ["anthropic-frontend-design-skill", "web.dev font best practices"],
  },
  {
    id: "type-scale",
    title: "Type scale and hierarchy",
    discipline: "typography",
    rules: [
      "Use a token scale of 6-9 steps. Body 16-18 px; ratio about 1.2 on phones rising to 1.25-1.333 on wide screens; at least one jump of 1.5× or more so hierarchy is unmistakable.",
      "Fluid sizes with clamp(min rem, rem + vw, max rem), max at most 2.5× min; never vw alone (it ignores zoom).",
      "Size headlines to the job: a hero h1 of 32-44 px on phones; 48-80 px on desktop brand pages, 28-40 px in product UI. A headline that pushes the first content below the fold of a 1280×800 screen is too big.",
      "Real weight contrast for expressive pages (for example 300 against 700), not 400 against 500.",
    ],
    sources: ["Material 3 type scale", "Utopia fluid type", "WCAG 2.2 1.4.4", "anthropic-frontend-design-skill"],
  },
  {
    id: "type-readability",
    title: "Readable text",
    discipline: "typography",
    rules: [
      "Measure 45-75 characters (max-width about 60-70ch on the text itself); leading 1.5-1.7 for body, 1.05-1.25 for headings, 1.25-1.4 for UI labels.",
      "Tracking 0 for body; -0.01 to -0.03em for large display; +0.04 to +0.1em only for short all-caps labels.",
      "text-wrap: balance on headings and pretty on paragraphs; curly quotes, a real ellipsis and a non-breaking space between number and unit.",
      "tabular-nums for numbers that are compared; start-aligned body text; center only short headings.",
      "Floors: running text 16 px, secondary text 14 px (12-13 px only for dense data such as table cells), nothing functional under 12 px, form inputs 16 px on phones (smaller ones make iOS zoom).",
    ],
    sources: ["WCAG 2.2 1.4.8, 1.4.12", "USWDS typography", "Butterick's Practical Typography", "Vercel Web Interface Guidelines"],
  },
  {
    id: "color-system",
    title: "Color system",
    discipline: "color",
    rules: [
      "Derive the palette from the subject or brand: neutrals tinted slightly toward the main hue, one dominant color and one sharp accent, status colors kept separate. A dominant color with a sharp accent beats an evenly spread rainbow.",
      "Declare primitives (tonal ramps), then semantic tokens (--surface, --surface-raised, --text, --text-muted, --border, --accent, --on-accent, --focus, --danger); components use the semantic tokens.",
      "Build ramps in OKLCH (fixed lightness per step); derive hover and pressed states with color-mix() or relative color syntax instead of new hex values.",
      "The accent marks the primary action and the current state; it is not decoration spread everywhere.",
    ],
    sources: ["Radix Colors scale", "W3C Design Tokens 2025.10", "Linear theme system", "anthropic-frontend-design-skill"],
  },
  {
    id: "color-contrast",
    title: "Contrast in practice",
    discipline: "color",
    rules: [
      "Check every text and background pair. White on mid violet or indigo fails for normal-size labels (on #6366f1 it is 4.47:1).",
      "Muted grey text on white: #6b7280 (4.8:1) is about the lightest that passes; #9ca3af is 2.5:1 and fails.",
      "On colored surfaces, tint text toward the surface's hue and darken it instead of using grey.",
      "Never rely on color alone: underline links in running text, and pair status colors with an icon or a word.",
    ],
    sources: ["WCAG 2.2 1.4.3, 1.4.1", "WebAIM Million 2026"],
  },
  {
    id: "dark-theme",
    title: "Dark themes",
    discipline: "color",
    signals: ["dark", "night", "theme", "black", "noir"],
    optional: true,
    rules: [
      "Design dark as its own theme, not an inversion: lighter surfaces show elevation (instead of heavier shadows), large fills get lower chroma, and contrast is re-checked.",
      "Set color-scheme (and light-dark() or [data-theme] token sets) so native controls and scrollbars match; never override a user's chosen scheme.",
      "Avoid pure #000 with pure #fff body text on large areas; a near-black surface with off-white text is easier to read.",
    ],
    sources: ["Apple HIG dark mode", "Material 3 dark theme", "Vercel Web Interface Guidelines"],
  },
  {
    id: "spacing-scale",
    title: "Spacing and rhythm",
    discipline: "layout",
    rules: [
      "Use a 4 px base with an 8 px rhythm (4, 8, 12, 16, 24, 32, 48, 64, 96) as tokens; off-scale values are rare and deliberate.",
      "Space encodes grouping: 4-8 px inside components, 12-24 px between related items, 48-96 px between sections. The space above a heading is larger than the space below it.",
      "Vary rhythm between levels; one gap value everywhere flattens the hierarchy.",
    ],
    sources: ["IBM Carbon spacing", "Atlassian spacing", "Gestalt proximity"],
  },
  {
    id: "composition",
    title: "Composition",
    discipline: "layout",
    rules: [
      "CSS Grid for two-dimensional layout (minmax, auto-fit, named areas), flexbox for one dimension, gap instead of child margins, logical properties.",
      "One focal point per viewport; use scale contrast, asymmetry and a visible grid on purpose, and let the real content decide the structure.",
      "Choose containers by hierarchy: spacing, type and dividers before cards; cards only for discrete, actionable objects, never cards inside cards.",
      "A small radius scale tied to element size (for example 4/8/16 px) with concentric radii (inner = outer minus padding), and one elevation language: defined edges or soft layered shadows, not both on everything.",
    ],
    sources: ["anthropic-frontend-design-skill", "Vercel Web Interface Guidelines", "MDN CSS Grid"],
  },
  {
    id: "responsive",
    title: "Responsive layout",
    discipline: "layout",
    rules: [
      "Design at 390 px and at 1280-1440 px, and check 320 px: no sideways scroll, no clipped text, targets intact.",
      "Page gutters of at least 16 px on phones and 24-48 px on larger screens; content width around 1120-1280 px on marketing pages.",
      "Container queries for components that appear at different widths; media queries for page-level changes; breakpoints where the content breaks.",
      "Full-height mobile sections use svh or dvh, not 100vh; respect env(safe-area-inset-*).",
    ],
    sources: ["WCAG 2.2 1.4.10", "MDN container queries", "Material window size classes"],
  },
  {
    id: "imagery",
    title: "Images and illustration",
    discipline: "imagery",
    rules: [
      "Real images beat decoration. Without real photos, use honest placeholders: tonal blocks at the final aspect ratio with a caption, or one purposeful SVG illustration drawn with care. Never broken links, and never random stock photos that don't match the subject.",
      "Every img and video gets width/height or aspect-ratio and object-fit; alt text describes what it shows (alt=\"\" when decorative).",
      "Images from external URLs need a background color behind them so a failed load leaves no hole.",
    ],
    sources: ["web.dev image performance", "anthropic-frontend-design-skill", "corpus:ik-builds-585923"],
  },
  {
    id: "copy",
    title: "Copy",
    discipline: "copy",
    rules: [
      "Say what the product literally does, with specific nouns and verbs; one idea per section; headlines of about 10 words at most.",
      "No filler words (unlock, elevate, supercharge, seamless, effortless, revolutionize, next-gen, cutting-edge, world-class) and no aphorism cadence (\"Not a tool. A platform.\").",
      "Button labels name the action and stay consistent through the flow (\"Start free trial\" leads to \"Trial started\"); avoid \"Get started\" and \"Learn more\" everywhere.",
      "Errors say what happened and how to fix it; empty states offer the next action.",
    ],
    sources: ["anthropic-frontend-design-skill", "Vercel Web Interface Guidelines", "GOV.UK content design"],
  },
];
