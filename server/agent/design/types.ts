// Curialy design intelligence: shared types for the knowledge base, request analysis, the per-run
// design brief and the in-browser design audit. See docs/design-intelligence.md.

export type Discipline =
  | "process"
  | "typography"
  | "color"
  | "layout"
  | "imagery"
  | "copy"
  | "motion"
  | "immersive"
  | "components"
  | "accessibility"
  | "performance"
  | "surface";

/** What kind of interface is being built; decides which recipe and examples apply. */
export type Surface = "landing" | "storefront" | "dashboard" | "editorial" | "showcase" | "app" | "portfolio" | "docs" | "game" | "general";

/** Visual register: how expressive the design should be. */
export type Register = "brand" | "product" | "editorial" | "playful";

/** How much motion the request calls for. */
export type MotionLevel = "subtle" | "expressive";

/** Request traits some entries need before they are worth their tokens. */
export type Need = "motion" | "immersive" | "data" | "forms" | "commerce" | "scroll";

/** A guideline line; `unless` names request words that mean the user asked for exactly this (then it is dropped). */
export type Rule = string | { text: string; unless: string[] };

export type DesignEntry = {
  /** Stable kebab-case id (cited in tests, docs and audits). */
  id: string;
  title: string;
  discipline: Discipline;
  /** Product types the entry is written for; omitted means any interface. */
  surfaces?: Surface[];
  /** Request words (lowercase; matched at word starts) that make the entry more relevant. */
  signals?: string[];
  /** Included only when the request mentions one of its signals. */
  optional?: boolean;
  /** Included only when the request has one of these traits. */
  needs?: Need[];
  /** Part of every UI brief (the direction process and the quality floor). */
  core?: boolean;
  /** Recipes only: the entries this kind of interface depends on most (ranked first after the recipe). */
  related?: string[];
  /** Imperative, specific guidance; numbers rather than adjectives. */
  rules: Rule[];
  /**
   * Where the guidance comes from: "corpus:<slug>" for an entry of the reference prompt corpus
   * (yihui-dev/awesome-opus5-5-videos), otherwise a short name of the standard or guide.
   */
  sources: string[];
};

/** Facts about the workspace that change the brief (an existing design system is extended, not replaced). */
export type WorkspaceFacts = {
  /** Any web UI source exists (HTML, CSS, JSX/TSX, Vue, Svelte, Astro). */
  hasUi: boolean;
  /** The project existed before this request (sources beyond what the agent creates from scratch). */
  existing: boolean;
  framework: string | null;
  styling: string[];
  libraries: string[];
  /** Custom properties declared in the project's stylesheets (a token system to extend). */
  tokens: number;
  /** Path of a design direction document, when one exists (DESIGN.md). */
  designDoc: string | null;
};

export type DesignIntent = {
  /** The request is (or continues) front-end work. */
  ui: boolean;
  surface: Surface;
  register: Register;
  motion: MotionLevel;
  needs: Need[];
  /** Style direction the user gave, quoted back in the brief (it overrides the defaults). */
  cues: string[];
  /** Looks the user asked to avoid ("no purple gradients"). */
  avoid: string[];
  /** Lowercased request text used for matching rules and signals (first prompt, then the newest message). */
  text: string;
  /** The first prompt and the newest message, lowercased: the newest one decides what was asked or refused. */
  original: string;
  latest: string;
  /** An image is attached (a mockup or reference to follow). */
  reference: boolean;
};

export type BriefRole = "solo" | "architect" | "engineer" | "reviewer";

export type DesignBrief = {
  intent: DesignIntent;
  facts: WorkspaceFacts;
  entries: DesignEntry[];
  /** test_preview_visual is offered in this run (it needs the cloud browser). */
  visualTest: boolean;
};

// ---- Audit ----------------------------------------------------------------

export type RGBA = [number, number, number, number];

export type TextSample = {
  /** Short selector-like description of the element. */
  el: string;
  tag: string;
  chars: number;
  size: number;
  weight: number;
  /** line-height in px (0 when "normal"). */
  line: number;
  /** letter-spacing in em. */
  tracking: number;
  upper: boolean;
  family: string;
  /** Text color, its alpha multiplied by the opacity of the element and its ancestors. */
  color: RGBA;
  /**
   * What is painted behind the text: one color, or one per gradient stop (the scorer takes the
   * worst). null when an image, video or canvas is behind it (not measurable from styles).
   */
  bg: [number, number, number][] | null;
  /** Not measured where it was painted (outside the viewport, or partly transparent): only clear failures count. */
  estimated: boolean;
  /** Characters per line, for paragraphs of two or more lines. */
  cpl: number | null;
  heading: boolean;
  /** Rendered height of the element in px. */
  height: number;
};

export type PageFacts = {
  viewport: { width: number; height: number };
  scrollWidth: number;
  scrollHeight: number;
  lang: string;
  title: string;
  viewportMeta: string | null;
  headings: number[];
  landmarks: { main: number; header: number; nav: number; footer: number };
  /**
   * px: how far the page scrolls sideways. clipped: overflow the viewport cuts off instead
   * (overflow-x: hidden or clip on html or body), so nothing scrolls but content may be lost.
   */
  overflow: { px: number; clipped: number; offenders: { el: string; right: number }[] };
  text: TextSample[];
  /** Text present in the layout but invisible (opacity 0 or visibility hidden) after scrolling through. */
  hidden: { count: number; chars: number; samples: string[] };
  controls: { total: number; unnamed: string[]; small: { el: string; w: number; h: number }[]; under44: number; checked: number };
  focus: { checked: number; missing: string[] };
  images: { total: number; noAlt: string[]; broken: string[]; unsized: number };
  fields: { total: number; unlabeled: string[]; smallFont: number };
  fonts: { families: { name: string; chars: number }[]; loaded: string[] };
  styles: {
    gradients: number;
    /** Gradients whose stops sit in the indigo/violet/purple range (the stock generated palette). */
    violetGradients: number;
    gradientText: number;
    backdrop: number;
    shadows: number;
    /** The most repeated box-shadow and how many elements wear it. */
    sameShadow: number;
    radii: number;
    transitionAll: number;
    /** Keyframes that animate layout properties (width, height, top, left, margins, padding). */
    layoutKeyframes: string[];
    /** A prefers-reduced-motion rule exists; null when some stylesheets could not be read (the preview's origin is opaque). */
    reducedMotionRule: boolean | null;
    /** Tracked-out all-caps labels placed right above headings ("eyebrows"). */
    eyebrows: number;
    /** Emoji used as icons (alone in small elements, or leading headings, buttons and list items). */
    emoji: number;
    /** Headings with one word set apart in a different color or italic. */
    accentWords: number;
  };
  animations: { running: number; infinite: number; longestMs: number };
  copy: { lorem: boolean; buzzwords: string[]; placeholders: string[] };
  perf: { lcpMs: number | null; lcpEl: string | null; cls: number; nodes: number };
  /** Something in the collector failed; the rest of the facts are still valid. */
  errors: string[];
};

export type FindingLevel = "fix" | "improve" | "note";

export type Finding = {
  id: string;
  level: FindingLevel;
  viewport: "desktop" | "phone" | "both";
  message: string;
};

export type DesignAudit = {
  findings: Finding[];
  /** One-line facts (fonts, sizes, palette) that help the model judge the design. */
  stats: string[];
  /** Which passes produced facts. */
  measured: { desktop: boolean; phone: boolean };
  /** Checks that could not run (each pass's own errors, and the visual test's). */
  problems: string[];
};
