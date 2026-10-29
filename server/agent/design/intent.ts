import type { DesignIntent, Need, Register, Surface, WorkspaceFacts } from "./types";

// Reads a request (and the workspace it lands in) for what kind of interface it asks for. Pure and
// deterministic: the same request always gets the same brief, which keeps the prompt cacheable.
// Negation counts: "no purple gradients" is something to avoid, not a request for one.

type Weighted = [phrase: string, weight: number][];

const SURFACE_PHRASES: Record<Exclude<Surface, "general">, Weighted> = {
  landing: [["landing", 3], ["homepage", 2], ["home page", 2], ["marketing site", 3], ["marketing page", 3], ["saas", 3], ["startup", 2], ["waitlist", 3], ["launch page", 3], ["pricing", 1], ["testimonial", 1], ["call to action", 1], ["signup", 1], ["sign-up", 1], ["hero", 1]],
  // "store" alone is usually the verb ("stores signups in the database"), so only noun phrases count.
  storefront: [["storefront", 3], ["online store", 3], ["web store", 3], ["webshop", 3], ["e-shop", 3], ["store for", 2], ["shop", 2], ["e-commerce", 3], ["ecommerce", 3], ["boutique", 2], ["catalog", 2], ["catalogue", 2], ["product grid", 1], ["quick view", 1], ["add to cart", 2], ["cart", 1], ["checkout", 2], ["collection", 1]],
  dashboard: [["dashboard", 4], ["analytics", 3], ["admin panel", 3], ["back office", 3], ["crm", 3], ["kpi", 2], ["metrics", 2], ["monitoring", 2], ["chart", 1], ["table", 1], ["report", 1], ["sample data", 1]],
  editorial: [["article", 3], ["long-form", 3], ["longform", 3], ["long read", 3], ["blog post", 3], ["essay", 3], ["magazine", 3], ["editorial", 2], ["scrollytelling", 3], ["pull quote", 1], ["history of", 1], ["chapter", 1], ["timeline", 1], ["story", 1]],
  showcase: [["showcase", 4], ["product page", 2], ["product launch", 3], ["configurator", 3], ["product tour", 3], ["color picker", 1], ["colour picker", 1], ["specs", 1], ["feature highlights", 1]],
  app: [["mobile-first", 3], ["mobile first", 3], ["app interface", 3], ["web app", 3], ["mobile app", 3], ["single page app", 3], ["single-page app", 3], ["pwa", 3], ["tracker", 3], ["todo", 3], ["to-do", 3], ["planner", 2], ["habit", 2], ["streak", 1], ["sheet", 1], ["tab bar", 2], ["onboarding", 1]],
  portfolio: [["portfolio", 4], ["personal site", 3], ["personal website", 3], ["resume", 2], ["case studies", 2]],
  docs: [["documentation", 4], ["docs site", 4], ["api reference", 3], ["knowledge base", 3], ["developer docs", 4]],
  game: [["game", 4], ["playable", 3], ["arcade", 3], ["platformer", 3], ["puzzle", 1]],
};

const REGISTER_OF: Record<Surface, Register> = {
  landing: "brand", storefront: "brand", showcase: "brand", portfolio: "brand",
  editorial: "editorial", dashboard: "product", app: "product", docs: "product", game: "playful", general: "product",
};

/** Unmistakably interface work: these hold even when backend words appear too. */
const STRONG_UI_WORDS = [
  "ui", "ux", "user interface", "app interface", "frontend", "front-end", "front end", "web app", "webapp", "website", "web site", "web page", "webpage",
  "landing page", "landing", "dashboard", "storefront", "portfolio", "css", "tailwind", "react", "vue", "svelte", "next.js", "nextjs", "astro",
  "web design", "ui design", "design system", "redesign", "restyle", "styling", "navbar", "nav bar", "sidebar", "modal", "mockup", "wireframe", "figma",
  "dark mode", "light mode", "responsive", "mobile view", "hero section", "component library", "docs site", "documentation site", "documentation website",
];
/** Interface words on their own (a "page", a "button"), unless backend work is named too. */
const UI_WORDS = [...STRONG_UI_WORDS, "page", "site", "component", "html", "vite", "layout", "screen", "theme", "footer", "button", "hero", "animation", "animated"];
/** Things people build with an interface but rarely call one ("a recipe app"): UI evidence in a new workspace, unless backend words appear. */
const WEAK_UI_WORDS = ["app", "interface", "form", "blog", "widget", "board", "calculator", "timer", "clock", "quiz", "chat", "game", "gallery", "editor", "player"];
/** "Build a page that ...", "make a todo app with ...": an interface is the thing being built. */
const BUILDS_UI = /\b(?:build|make|create|design|code|develop|prototype|redesign)\b((?:\s+[\w'-]+){0,4}?)\s+(?:page|site|website|web app|app|interface|ui|dashboard|form|component|screen|frontend|front-end|storefront|portfolio|landing page|widget|layout)s?\b/g;
/** Visual words: in a project that already has a UI, these make a short follow-up design work too. */
const VISUAL_WORDS = ["color", "colour", "font", "spacing", "padding", "margin", "bigger", "smaller", "align", "look", "looks", "premium", "modern", "cleaner", "prettier", "ugly", "style", "icon", "image", "logo", "background", "contrast", "mobile", "phone", "tablet", "desktop", "animate", "motion", "card", "grid", "section"];
/** Work that has nothing to do with an interface. */
const BACKEND_WORDS = [
  "api", "rest api", "graphql", "api endpoint", "endpoint", "database", "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis", "sql", "migration",
  "cron", "cli", "command-line", "backend", "back-end", "server", "express", "fastapi", "django", "flask", "scraper", "scrape", "crawler", "webhook",
  "queue", "worker", "bot", "unit test", "benchmark", "dockerfile", "docker", "kubernetes", "terraform", "pipeline", "etl", "pandas", "csv", "json", "lambda", "microservice",
];

const MOTION_WORDS = ["animated", "animation", "animate", "motion", "kinetic", "scroll-driven", "scroll driven", "scroll animation", "scrollytelling", "parallax", "transitions", "micro-interaction", "microinteraction", "gsap", "framer motion", "lottie", "cinematic", "animate in", "animates in"];
const NEED_WORDS: Record<Exclude<Need, "motion">, string[]> = {
  scroll: ["scroll-driven", "scroll driven", "scrollytelling", "parallax", "sticky scroll", "sticky section", "sticky visual", "chapters", "long-form", "longform", "long read"],
  immersive: ["3d", "three.js", "threejs", "three js", "webgl", "webgpu", "shader", "canvas", "particles", "r3f", "react-three", "babylon", "spline", "generative art", "voxel"],
  data: ["dashboard", "chart", "charts", "graph", "analytics", "metrics", "kpi", "data table", "datatable", "data viz", "data visualization", "data visualisation", "sample data", "report", "statistics", "sortable", "breakdown", "over time"],
  forms: ["form", "signup", "sign up", "sign-up", "newsletter", "subscribe", "login", "log in", "register", "checkout", "contact", "booking", "waitlist", "input", "add-", "sheet", "survey"],
  commerce: ["storefront", "online store", "shop", "cart", "checkout", "e-commerce", "ecommerce", "product grid", "price", "buy"],
};

const STYLE_WORDS = [
  "minimal", "minimalist", "brutalist", "brutalism", "playful", "luxury", "luxurious", "premium", "high-end", "elegant", "corporate", "retro", "vintage",
  "futuristic", "neon", "glassmorphism", "glass", "frosted", "neumorphism", "skeuomorphic", "flat design", "bold", "dark", "light mode", "light theme", "pastel", "monochrome",
  "colorful", "colourful", "vibrant", "warm", "earthy", "organic", "scandinavian", "nordic", "japanese", "swiss", "bauhaus", "art deco", "y2k", "cyberpunk",
  "vaporwave", "synthwave", "hand-drawn", "editorial", "serif", "sans-serif", "monospace", "rounded", "gradient", "gradients", "purple", "violet",
  "indigo", "emoji", "bento", "marquee", "parallax", "bouncy", "whimsical", "cartoon", "kids", "industrial", "newspaper", "swiss style",
];
/** A style word followed by one of these is not about looks ("minimal dependencies", "a bold claim"). */
const NOT_A_LOOK = /^\s*(?:dependenc\w*|deps?\b|code\b|setup\b|config\w*|api\b|footprint\b|changes?\b|effort\b|overhead\b|latency\b|requirements?\b|steps?\b|claims?\b|moves?\b|ideas?\b|plan\b|budget\b|server\b|backend\b|logic\b)/;
/** "glass" is a look only as glassmorphism, frosted or liquid glass, or a glass effect/card/panel. */
const GLASS = /(?:^|[^a-z])(?:frosted|liquid)?\s?glass(?:morphism|y)?(?=\s*(?:effect|morphism|card|cards|panel|panels|ui|look|style|header|nav|navbar|background|layer|surface|button|overlay)s?\b)|glassmorphism|frosted glass|liquid glass/;
const COLOR_WORDS = ["red", "orange", "yellow", "green", "teal", "cyan", "blue", "navy", "pink", "magenta", "gold", "beige", "cream", "black", "white", "grey", "gray", "brown", "olive", "mint", "coral"];
const FONT_NAMES = [
  "Inter", "Roboto", "Helvetica", "Futura", "Garamond", "EB Garamond", "Playfair Display", "Montserrat", "Poppins", "Lato", "Open Sans", "Source Serif",
  "IBM Plex", "Space Grotesk", "DM Sans", "DM Serif", "Manrope", "Satoshi", "Geist", "Fraunces", "Cormorant", "Lora", "Merriweather", "Work Sans", "Nunito",
  "Raleway", "Oswald", "Bebas Neue", "JetBrains Mono", "Fira Code", "Archivo", "Syne", "Clash Display", "General Sans", "Instrument Serif", "Newsreader",
];
const MOCKUP_WORDS = ["mockup", "mock-up", "figma", "wireframe", "screenshot", "this design", "the design attached", "attached design"];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRegex = (phrase: string) => {
  const tail = /[a-z0-9]$/.test(phrase) ? "(?![a-z0-9])" : "";
  // Plurals and simple suffixes: "charts", "tracker's", "animations".
  const suffix = /[a-z]$/.test(phrase) ? "(?:s|es|'s)?" : "";
  return new RegExp(`(?:^|[^a-z0-9-])(${escape(phrase)}${suffix})${tail}`, "g");
};
/** Phrase at a word start (so "store" misses "restore" and "form" misses "long-form"); a trailing hyphen matches as written. */
export function mentions(text: string, phrase: string) {
  return phraseRegex(phrase).test(text);
}
const any = (text: string, words: string[]) => words.some(word => mentions(text, word));

// ---- Negation ----------------------------------------------------------------

/** Words that start a "don't" ("no", "avoid", "without", "instead of"); their scope runs to the end of the clause. */
const NEGATION = /(?:^|[^a-z])(no|not|without|avoid|avoiding|don'?t|do not|never|drop|remove|ditch|stop|less|skip|nothing like|instead of|rather than|get rid of|lose the|kill the)(?![a-z])/g;
/** A clause ends at a sentence mark, a turn ("but", "instead"), or a comma followed by a new instruction ("..., use flat colors"). */
const SCOPE_END = /[.;!?\n]|(?:^|[^a-z])(?:but|however|instead|rather|except)(?![a-z])|,\s*(?:use|make|add|go|keep|want|with|do|try|give|set|prefer|i'd|i would)(?![a-z])/;

function negatedRanges(text: string) {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(NEGATION)) {
    const start = (match.index ?? 0) + match[0].length;
    const rest = text.slice(start);
    const end = rest.search(SCOPE_END);
    ranges.push([start, end < 0 ? text.length : start + end]);
  }
  return ranges;
}

/** Where the phrase occurs, asked for (outside a negation) and avoided (inside one). */
function occurrences(text: string, phrase: string) {
  const ranges = negatedRanges(text);
  let asked = false;
  let avoided = false;
  for (const match of text.matchAll(phraseRegex(phrase))) {
    const at = (match.index ?? 0) + match[0].indexOf(match[1]);
    if (ranges.some(([start, end]) => at >= start && at < end)) avoided = true;
    else asked = true;
  }
  return { asked, avoided };
}

/** The user asked for one of these words: the newest message decides, else the first prompt. */
export function askedFor(intent: Pick<DesignIntent, "original" | "latest">, words: string[]) {
  for (const text of intent.latest === intent.original ? [intent.latest] : [intent.latest, intent.original]) {
    const found = words.map(word => occurrences(text, word));
    if (found.some(hit => hit.avoided)) return false;
    if (found.some(hit => hit.asked)) return true;
  }
  return false;
}

// ---- Surface and direction --------------------------------------------------

function surfaceOf(text: string): Surface {
  let best: Surface = "general";
  let bestScore = 0;
  for (const [surface, phrases] of Object.entries(SURFACE_PHRASES) as [Exclude<Surface, "general">, Weighted][]) {
    const score = phrases.reduce((sum, [phrase, weight]) => sum + (mentions(text, phrase) ? weight : 0), 0);
    if (score > bestScore) { best = surface; bestScore = score; }
  }
  return bestScore >= 2 ? best : "general";
}

/**
 * The style direction the user stated, in their words: asked for (hex colors, style words, fonts
 * named as fonts, references, a mockup) and asked to avoid ("no purple gradients").
 */
export function directionCues(source: string, imageAttached: boolean) {
  const text = source.toLowerCase();
  const cues: string[] = [];
  const avoid: string[] = [];
  const add = (list: string[], cue: string) => { if (!list.includes(cue) && list.length < 12) list.push(cue); };
  const ranges = negatedRanges(text);
  const negated = (at: number) => ranges.some(([start, end]) => at >= start && at < end);
  // Hex colors, not issue or PR numbers ("issue #123").
  for (const match of source.matchAll(/(?<![\w&])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 12), match.index);
    if (/(issue|pr|pull request|ticket|bug|item|no\.?|number)\s*$/.test(before) || (/^\d+$/.test(match[1]) && !/colou?r|#\w+\s*(?:accent|background|bg|text)/.test(text))) continue;
    add(negated(match.index ?? 0) ? avoid : cues, `#${match[1].toLowerCase()}`);
  }
  for (const word of STYLE_WORDS) {
    if (word === "glass") continue;
    for (const match of text.matchAll(phraseRegex(word))) {
      const at = (match.index ?? 0) + match[0].indexOf(match[1]);
      if (NOT_A_LOOK.test(text.slice(at + match[1].length))) continue;
      add(negated(at) ? avoid : cues, word);
    }
  }
  const glass = text.match(GLASS);
  if (glass && !cues.includes("glassmorphism")) add(negated(glass.index ?? 0) ? avoid : cues, "glass");
  // A color word is direction only next to a design noun ("blue accent", "in green", "make it black").
  for (const word of COLOR_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b(?:[\\s,/-]+[a-z]+){0,2}?[\\s,/-]+(?:themes?|palettes?|colou?rs?|accents?|backgrounds?|bg|schemes?|tones?|headers?|buttons?|text|brand|gradients?|primary|mode)\\b|\\b(?:in|use|make it|make (?:the|it) [a-z]+)\\s+${word}\\b(?=\\s*(?:$|[.,;!?)]|and\\b|with\\b|accents?\\b|tones?\\b))`, "g");
    for (const match of text.matchAll(pattern)) add(negated(match.index ?? 0) ? avoid : cues, word);
  }
  // Font names only where a font is meant ("set in Satoshi", "Inter for headings", "font: Lora").
  for (const font of FONT_NAMES) {
    const name = escape(font);
    const context = new RegExp(`\\b(?:fonts?|typefaces?|typography|set in|headings? in|body in|type in|using)\\s*(?:like|:|of|called|named|=)?\\s*["']?${name}\\b|\\b${name}\\b\\s*(?:font|typeface|for (?:the )?(?:headings?|body|text|display|titles?))`, "i");
    const match = source.match(context);
    if (match) add(negated((match.index ?? 0)) ? avoid : cues, `font: ${font}`);
  }
  for (const match of source.matchAll(/\b(?:like|inspired by|in the style of|similar to|feel of)\s+([A-Z][\w.&-]+(?:\s[A-Z][\w.&-]+)?)/g)) {
    add(negated(match.index ?? 0) ? avoid : cues, `like ${match[1].replace(/[.,;:!?-]+$/, "")}`);
  }
  if (imageAttached || any(text, MOCKUP_WORDS)) add(cues, "follow the reference design");
  return { cues, avoid };
}

/**
 * Design intent of a request. `original` is the task's first prompt; `latest` is the newest user
 * message (the same text on a first run), so a short follow-up keeps the task's character.
 */
export function analyzeRequest(input: { original: string; latest: string; imageAttached: boolean; facts: WorkspaceFacts }): DesignIntent {
  const original = input.original.toLowerCase();
  const latest = input.latest.toLowerCase();
  const text = original === latest ? latest : `${original}\n${latest}`;
  // With backend work named ("an API endpoint for analytics metrics"), only unmistakable
  // interface words count; otherwise any UI word, a surface or (in a new workspace) a weak one.
  const buildsUi = (request: string) => Array.from(request.matchAll(BUILDS_UI)).some(match => !any(match[1], BACKEND_WORDS));
  const isUi = (request: string) => (any(request, BACKEND_WORDS)
    ? any(request, STRONG_UI_WORDS) || buildsUi(request)
    : any(request, UI_WORDS) || surfaceOf(request) !== "general" || (!input.facts.existing && any(request, WEAK_UI_WORDS)));
  const uiLatest = isUi(latest);
  const backendLatest = any(latest, BACKEND_WORDS) && !uiLatest;
  const ui = uiLatest
    || (isUi(original) && !backendLatest)
    || (input.facts.hasUi && !backendLatest && (any(latest, VISUAL_WORDS) || (input.imageAttached && latest.length < 400)));
  const surface = surfaceOf(text);
  const { cues, avoid } = directionCues(input.original === input.latest ? input.original : `${input.original}\n${input.latest}`, input.imageAttached);
  const intent = { original, latest };
  let register = REGISTER_OF[surface];
  if (askedFor(intent, ["playful", "whimsical", "cartoon", "kids", "fun"]) && surface !== "dashboard") register = "playful";
  const needs: Need[] = [];
  const motion = askedFor(intent, MOTION_WORDS) ? "expressive" : "subtle";
  if (motion === "expressive") needs.push("motion");
  for (const [need, words] of Object.entries(NEED_WORDS) as [Exclude<Need, "motion">, string[]][]) if (askedFor(intent, words)) needs.push(need);
  if (surface === "editorial" && !needs.includes("scroll")) needs.push("scroll");
  if (surface === "dashboard" && !needs.includes("data")) needs.push("data");
  if (surface === "storefront" && !needs.includes("commerce")) needs.push("commerce");
  if (surface === "game" && !needs.includes("immersive")) needs.push("immersive");
  return { ui, surface, register, motion, needs, cues, avoid, text, original, latest, reference: input.imageAttached };
}

/** Looks the user asked for, so neither the brief nor the audit discourages them (a negated mention doesn't count). */
export function allowedLooks(intent: DesignIntent) {
  const allowed = new Set<string>();
  const has = (words: string[]) => askedFor(intent, words);
  if (has(["purple", "violet", "indigo", "neon", "aurora", "synthwave", "vaporwave", "cyberpunk"])) allowed.add("violet");
  if (has(["gradient text", "gradient headline", "gradient heading", "gradient title", "gradient-filled text"])) allowed.add("gradient-text");
  if (has(["glassmorphism", "frosted glass", "liquid glass", "glass effect", "glass card", "glass cards", "glass panel", "glass panels", "glass ui", "translucent"])) allowed.add("glass");
  if (has(["emoji", "emojis"])) allowed.add("emoji");
  if (has(["uppercase", "all caps", "all-caps", "brutalist"])) allowed.add("eyebrow");
  if (has(["inter font", "roboto", "arial", "helvetica", "system font", "system-ui", "set in inter", "use inter"])) allowed.add("default-font");
  if (has(["bounce", "bouncy", "elastic", "playful", "cartoon"])) allowed.add("bounce");
  if (has(["marquee", "ticker"])) allowed.add("marquee");
  return [...allowed].sort();
}
