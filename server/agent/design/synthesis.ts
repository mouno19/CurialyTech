import { ARCHETYPES, ENTERTAINMENT_WORDS, type Archetype, type GrantedLook } from "./knowledge/archetypes";
import { contrast } from "./audit";
import { MOTION_FAMILIES, MOTION_PIECES, MOTION_TIMING, type MotionPiece, type MotionSlot } from "./knowledge/motion";
import type { MotionLevel, Need, Surface } from "./types";

// Style synthesis: when a request is anime or entertainment work, or its subject fits one of the
// style archetypes (a luxury brand, a developer terminal, a cozy cafe), the design is a mixture:
// one archetype gives the base (tokens, type, layout language) and two or three others lend blocks
// and details, all on one token set. Never a single template reproduced. Deterministic: the same
// request gets the same synthesis (the brief stays byte-stable and cacheable).

export type ArchetypeKey = Archetype["id"];
export type Synthesis = {
  primary: Archetype;
  partners: Archetype[];
  /** Blocks to take from each archetype (2-4 in all from the partners, a few from the base). */
  blocks: { archetype: Archetype; block: Archetype["blocks"][number] }[];
  /** Why this mixture: the home domain, or the subject the base fits. */
  reason: string;
  entertainment: boolean;
  /** Looks the chosen archetypes are built on (deliberate here, so not warned against). */
  grants: GrantedLook[];
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A phrase at a word start (the same rule as the intent analysis), outside a "no …" clause. */
function said(text: string, phrase: string) {
  const pattern = new RegExp(`(?:^|[^a-z0-9-])${escape(phrase)}(?:s|es|'s)?(?![a-z0-9])`, "g");
  for (const match of text.matchAll(pattern)) {
    // Up to where the phrase starts (the separator before it belongs to the clause: "no 3d").
    const at = (match.index ?? 0) + match[0].indexOf(phrase);
    const before = text.slice(Math.max(0, at - 24), at);
    if (!/(?:^|[^a-z])(?:no|not|without|avoid|never|instead of|rather than)\s+(?:[a-z-]+\s+){0,2}$/.test(before)) return true;
  }
  return false;
}

/** Partners that complement each base (contrast in one dimension, kinship in another). */
const PARTNERS: Record<string, string[]> = {
  "anime-cozy-slice-of-life": ["anime-pastel-sakura-stream", "anime-editorial-frame-magazine", "anime-streaming-nebula-cosmic", "anime-community-anime-live"],
  "anime-luxury-kuro-cinema": ["anime-editorial-frame-magazine", "anime-streaming-nebula-cosmic", "anime-traditional-kitsune-flix", "anime-archive-anime-vault", "anime-celestial-senpai-plus"],
  "anime-retro-arcade-synthwave": ["anime-action-shonen-hub", "anime-terminal-otaku-os", "anime-catalog-anime-grid", "anime-cyberpop-hyperanime"],
  "anime-editorial-frame-magazine": ["anime-luxury-kuro-cinema", "anime-traditional-kitsune-flix", "anime-catalog-anime-grid", "anime-minimal-swiss-editorial", "anime-archive-anime-vault"],
  "anime-action-shonen-hub": ["anime-retro-arcade-synthwave", "anime-terminal-otaku-os", "anime-cozy-slice-of-life", "anime-cyberpop-hyperanime", "anime-community-anime-live"],
  "anime-streaming-nebula-cosmic": ["anime-catalog-anime-grid", "anime-luxury-kuro-cinema", "anime-retro-arcade-synthwave", "anime-celestial-senpai-plus", "anime-community-anime-live"],
  "anime-catalog-anime-grid": ["anime-streaming-nebula-cosmic", "anime-terminal-otaku-os", "anime-editorial-frame-magazine", "anime-minimal-swiss-editorial", "anime-archive-anime-vault"],
  "anime-terminal-otaku-os": ["anime-catalog-anime-grid", "anime-retro-arcade-synthwave", "anime-streaming-nebula-cosmic", "anime-community-anime-live"],
  "anime-pastel-sakura-stream": ["anime-cozy-slice-of-life", "anime-traditional-kitsune-flix", "anime-editorial-frame-magazine", "anime-community-anime-live"],
  "anime-traditional-kitsune-flix": ["anime-editorial-frame-magazine", "anime-pastel-sakura-stream", "anime-luxury-kuro-cinema", "anime-archive-anime-vault", "anime-minimal-swiss-editorial"],
  "anime-celestial-senpai-plus": ["anime-luxury-kuro-cinema", "anime-archive-anime-vault", "anime-streaming-nebula-cosmic", "anime-cyberpop-hyperanime"],
  "anime-community-anime-live": ["anime-streaming-nebula-cosmic", "anime-action-shonen-hub", "anime-cyberpop-hyperanime", "anime-terminal-otaku-os"],
  "anime-minimal-swiss-editorial": ["anime-editorial-frame-magazine", "anime-catalog-anime-grid", "anime-traditional-kitsune-flix", "anime-archive-anime-vault"],
  "anime-archive-anime-vault": ["anime-luxury-kuro-cinema", "anime-editorial-frame-magazine", "anime-catalog-anime-grid", "anime-minimal-swiss-editorial"],
  "anime-cyberpop-hyperanime": ["anime-retro-arcade-synthwave", "anime-action-shonen-hub", "anime-community-anime-live", "anime-celestial-senpai-plus"],
};

/** Bases for entertainment requests that name no style (picked by the request's own text, so they vary across requests). */
const DEFAULT_BASES = [
  "anime-streaming-nebula-cosmic", "anime-luxury-kuro-cinema", "anime-pastel-sakura-stream", "anime-action-shonen-hub", "anime-cozy-slice-of-life", "anime-catalog-anime-grid",
  "anime-celestial-senpai-plus", "anime-community-anime-live", "anime-minimal-swiss-editorial", "anime-cyberpop-hyperanime",
];

/** Request words that ask for a particular block (whichever archetype has it). */
const BLOCK_WORDS: [RegExp, RegExp][] = [
  [/\b(filters?|filtering|faceted|browse by|refine)\b/, /filter/i],
  [/\b(episodes?|episode guide|track ?list|chapters)\b/, /episode|detail/i],
  [/\b(continue watching|resume|progress|history)\b/, /continue/i],
  [/\b(streaks?|achievements?|gamif\w*|points|xp|leaderboard)\b/, /player hub/i],
  [/\b(reviews?|critics?|ratings?|scores?)\b/, /critics|rated/i],
  [/\b(shelf|shelves|carousel|row of|trending)\b/, /shelf|trending/i],
  [/\b(membership|plans?|pricing|subscribe|subscriptions?|tiers?|vip|perks)\b/, /membership|pricing/i],
  [/\b(characters?|cast|heroes|champions?)\b/, /champion/i],
  [/\b(search|command|terminal|cli|prompt)\b/, /prompt|slash search|status bar/i],
  [/\b(collections?|curated|playlists?)\b/, /collection/i],
  [/\b(mood|feeling|vibe)\b/, /mood/i],
  [/\b(mobile|phone|bottom nav|tab bar)\b/, /mobile dock/i],
  [/\b(ticker|breaking|live updates|live scores)\b/, /ticker/i],
  [/\b(masthead|issue|magazine)\b/, /masthead|cover/i],
  [/\b(watch[ -]?party|watch together|livestreams?|live streams?|live now)\b/, /watch-party/i],
  [/\b(chat|live chat|messages|activity)\b/, /chat/i],
  [/\b(discussions?|forums?|threads?|posts|fan theories)\b/, /discussion/i],
  [/\b(schedule|calendar|premieres?|upcoming|line-?up)\b/, /schedule|premiere/i],
  [/\b(genre grid|genre buttons|genre index|grid of genres)\b/, /genre grid/i],
  [/\b(archives?|archival|catalogu?es?|metadata|provenance|dossiers?)\b/, /archive|dossier/i],
  [/\b(rank|ranks|ranked|rankings?|top 10|top ten)\b/, /rank|trending/i],
  [/\b(accounts?|profiles?|my list|watchlists?|saved)\b/, /account|my list|watchlist/i],
  [/\b(manifesto|philosophy|our story)\b/, /manifesto|philosophy/i],
  [/\b(new releases?|latest releases|just added)\b/, /releases|recent/i],
];

/** A matched phrase (two words or more) names the subject clearly ("video platform", "tea house"). */
function strongMatch(archetype: Archetype, text: string) {
  return [...archetype.signals, ...archetype.fits].some(word => word.includes(" ") && said(text, word));
}

function score(archetype: Archetype, text: string) {
  // Each word counts once (a signal that is also a fit is not double evidence): a phrase or a fit 3, a style word 2.
  const weights = new Map<string, number>();
  for (const word of archetype.signals) if (said(text, word)) weights.set(word, Math.max(weights.get(word) ?? 0, word.includes(" ") ? 3 : 2));
  for (const fit of archetype.fits) if (said(text, fit)) weights.set(fit, 3);
  let points = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  for (const font of [archetype.fonts.display, archetype.fonts.extra].filter(Boolean) as string[]) if (text.includes(font.toLowerCase())) points += 2;
  if (text.includes(archetype.name.toLowerCase())) points += 6;
  return points;
}

function stableIndex(text: string, size: number) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % size;
}

/**
 * The synthesis for a request, or null when neither its domain nor its subject calls for the
 * archetypes (a generic landing page or a dashboard keeps the regular brief). `avoid` holds what
 * the user refused ("no neon"): an archetype built on it is not chosen.
 */
export function synthesize(input: { text: string; ui: boolean; avoid?: string[] }): Synthesis | null {
  if (!input.ui) return null;
  const text = input.text.toLowerCase();
  const refused = (archetype: Archetype) => (input.avoid ?? []).some(word => archetype.signals.includes(word) || archetype.style.toLowerCase().includes(word));
  const entertainment = ENTERTAINMENT_WORDS.some(word => said(text, word));
  // Equal points: a phrase that names the subject beats a single word.
  const ranked = ARCHETYPES.filter(archetype => !refused(archetype))
    .map((archetype, order) => ({ archetype, points: score(archetype, text), strong: strongMatch(archetype, text), order }))
    .sort((a, b) => b.points - a.points || Number(b.strong) - Number(a.strong) || a.order - b.order);
  const best = ranked[0];
  // Outside entertainment, only a clear fit of subject or style brings the archetypes in: two
  // signals, or one phrase that names the subject.
  if (!entertainment && (!best || (best.points < 4 && !best.strong))) return null;
  if (!best) return null;
  const pool = ranked.map(item => item.archetype);
  const primary = best.points > 0 ? best.archetype : pool.find(archetype => archetype.id === DEFAULT_BASES.filter(id => pool.some(item => item.id === id))[stableIndex(text, DEFAULT_BASES.length) % DEFAULT_BASES.length]) ?? pool[0];
  // Partners: others the request also points to; then the owners of the blocks it asks for (up to
  // three partners); then the base's complements (always at least one partner).
  const partners: Archetype[] = [];
  for (const item of ranked) if (item.archetype !== primary && item.points >= 3 && partners.length < 2) partners.push(item.archetype);
  const complements = (PARTNERS[primary.id] ?? []).map(id => pool.find(archetype => archetype.id === id)).filter((archetype): archetype is Archetype => !!archetype);
  // Blocks: what the request asks for, from the mixture if it has it (the base first while it has room
  // beside its hero), else from the base's complements, else from any archetype; otherwise each
  // partner's signature block.
  const blocks: Synthesis["blocks"] = [];
  const take = (archetype: Archetype, block: Archetype["blocks"][number]) => { if (!blocks.some(item => item.block.id === block.id)) blocks.push({ archetype, block }); };
  const room = Math.max(2, Math.ceil(primary.blocks.length / 2)) - 1;
  for (const [ask, name] of BLOCK_WORDS) {
    if (!ask.test(text)) continue;
    const mixture = blocks.filter(item => item.archetype === primary).length < room ? [primary, ...partners] : [...partners, primary];
    const owners = [...mixture, ...(partners.length < 3 ? [...complements, ...pool].filter(archetype => archetype !== primary && !partners.includes(archetype)) : [])];
    const owner = owners.find(archetype => archetype.blocks.some(item => name.test(item.name)));
    if (!owner) continue;
    if (owner !== primary && !partners.includes(owner)) partners.push(owner);
    take(owner, owner.blocks.find(item => name.test(item.name))!);
  }
  for (const complement of complements) if (partners.length < 2 && !partners.includes(complement)) partners.push(complement);
  if (!partners.length) partners.push(pool.find(archetype => archetype !== primary)!);
  // A partner's signature block, not its hero (the base gives the hero) and not its chrome.
  for (const partner of partners) if (!blocks.some(item => item.archetype === partner)) take(partner, partner.blocks.find(block => !/header|topbar|nav|sidebar|footer|dock|masthead|ticker|status bar|intro|hero|cover|featured/i.test(block.name)) ?? partner.blocks[0]);
  const hero = primary.blocks.find(block => /hero|cover|featured/i.test(block.name));
  if (hero) take(primary, hero);
  const fit = primary.fits.find(item => said(text, item));
  // The base's looks, and only what each borrowed block brings (a partner's whole look isn't licensed by one block of it).
  const chosen = blocks.slice(0, 6);
  const grants = [...new Set([...primary.grants, ...chosen.flatMap(item => item.block.looks ?? [])])].sort() as GrantedLook[];
  return {
    primary, partners, blocks: chosen, entertainment, grants,
    reason: entertainment ? "anime or entertainment work: the archetypes' home ground" : `the subject fits ${primary.name} (${fit ?? primary.style.toLowerCase()})`,
  };
}

const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items.join(""));
const textColor = (archetype: Archetype, role: "muted" | "accent" | "accent2") => archetype.textSafe?.[role] ?? archetype.tokens[role];
const rgb = (hex: string) => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** The accent fill: the template's own, or its text-safe shade where a label on the template's is under 4.5:1 too. */
export const accentFill = (archetype: Archetype) =>
  (archetype.textSafe?.accent && contrast(rgb(archetype.tokens.onAccent), rgb(archetype.tokens.accent)) < 4.5 ? archetype.textSafe.accent : archetype.tokens.accent);

/** The synthesis as the brief's section: base, partners, one token set, type, blocks and the rules. */
export function renderSynthesis(synthesis: Synthesis) {
  const { primary, partners, blocks } = synthesis;
  const t = primary.tokens;
  const fonts = [primary.fonts.display, primary.fonts.text, primary.fonts.extra].filter(Boolean).join(", ");
  const safe = primary.textSafe ? ` For text, use ${Object.entries(primary.textSafe).map(([role, hex]) => `${hex} instead of the ${role} ${t[role as keyof typeof t]} (under 4.5:1)`).join("; ")}.` : "";
  return [
    `## Style synthesis (${synthesis.reason})`,
    `Mix archetypes; never reproduce one template. Base: **${primary.name}** (${primary.style}) — ${primary.concept} Partners: ${list(partners.map(partner => `**${partner.name}** (${partner.style})`))}.`,
    `- One token set for everything, from the base: --bg ${t.bg}, --surface ${t.surface}, --surface-2 ${t.surface2}, --line ${t.line}, --text ${t.text}, --muted ${textColor(primary, "muted")}, --accent ${accentFill(primary)}, --accent-2 ${t.accent2}, --on-accent ${t.onAccent}; radius: ${primary.radius}.${safe} Borrowed blocks take these tokens and this radius, never their own palette.`,
    `- Type: ${primary.fonts.use} Load only ${fonts}${partners.some(partner => partner.fonts.display !== primary.fonts.display) ? `; a partner's face (${[...new Set(partners.map(partner => partner.fonts.display))].filter(face => face !== primary.fonts.display).join(", ")}) at most for one small detail` : ""}.`,
    `- Blocks to combine: ${blocks.map(item => `${item.block.name} from ${item.archetype.name} (${item.block.how}; component ${item.block.id})`).join("; ")}. Rebuild each in the base's language; add what the subject needs and leave out what it doesn't.`,
    `- Layout and motion from the base: ${primary.layout} ${primary.motion}`,
    `- Keep from the partners only their idea, not their skin: ${partners.map(partner => `${partner.name}: ${partner.concept.split(":")[0].toLowerCase()}`).join("; ")}.`,
    `- Avoid: ${primary.avoid}`,
    synthesis.entertainment
      ? "- Content: real, plausible titles, episode counts, ratings and dates for the subject; mark sample data as such in apps."
      : `- This is not an anime site: keep the style language and replace the anime content with the subject's own (episodes become the subject's items, ratings its real measures).`,
    `- Not a template: no more than ${Math.max(2, Math.ceil(primary.blocks.length / 2))} blocks from any one archetype, a layout of your own, copy written for this subject.`,
    `- With the component library: add_components with these block ids and theme ${primary.id} re-skins them to this one token set (find_components finds more).`,
  ].join("\n");
}

/** Every archetype in one line (for docs and the agent's general knowledge). */
export const archetypeSummary = () => ARCHETYPES.map(archetype => `${archetype.name}: ${archetype.style}; ${archetype.fonts.display} + ${archetype.fonts.text}; fits ${archetype.fits.slice(0, 4).join(", ")}`);

// ---- Motion mixture ----
// When a request asks for motion (by name, or by asking for an animated or interactive site), a few
// pieces of the motion library by job: what it names, else defaults that suit the kind of site,
// varied by the request. One continuously running piece at most; studies made for show only by
// name; all on the design's tokens and the shared timing (--cx-ease, --cx-duration-*).

export type MotionMixture = {
  picks: { slot: MotionSlot; piece: MotionPiece; named: boolean }[];
  /** The token set the pieces go on: the style synthesis's base, else the first pick's family. */
  theme: string;
  grants: GrantedLook[];
  reason: string;
};

const MOTION_ASK = ["animated", "animation", "animations", "animate", "motion", "interactive", "micro-interaction", "micro-interactions", "microinteraction", "kinetic", "scroll effects", "scroll animations", "transitions", "delightful", "playful interactions", "immersive", "wow"];
const SLOT_LIMIT: Partial<Record<MotionSlot, number>> = { scroll: 2, data: 3 };
const SLOT_ORDER: MotionSlot[] = ["hero", "type", "scroll", "surface", "control", "navigation", "feedback", "data", "ambient"];
/** Defaults by kind of site, a few options per slot (the request's text picks one). */
const MOTION_DEFAULTS: Partial<Record<Surface, Partial<Record<MotionSlot, string[]>>>> = {
  landing: { type: ["motion-type-split-reveal", "motion-type-rotating-3d"], scroll: ["motion-scroll-reveal", "motion-scroll-staggered-grid", "motion-scroll-sticky-story"], surface: ["motion-card-tilt", "motion-card-spotlight", "motion-card-border-glow"], control: ["motion-button-magnetic", "motion-button-border-trace", "motion-button-ripple"], navigation: ["motion-nav-scroll-aware"] },
  showcase: { hero: ["motion-3d-product-showcase", "motion-3d-sphere"], scroll: ["motion-scroll-pin-zoom", "motion-scroll-sticky-story", "motion-scroll-horizontal-story"], surface: ["motion-card-tilt", "motion-card-parallax"], control: ["motion-button-magnetic", "motion-button-3d-press"] },
  portfolio: { type: ["motion-type-split-reveal", "motion-type-variable-weight"], scroll: ["motion-scroll-text-mask", "motion-scroll-pin-zoom", "motion-scroll-horizontal-story"], surface: ["motion-card-image-reveal", "motion-card-spotlight", "motion-card-tilt"], control: ["motion-button-border-trace", "motion-button-magnetic"], navigation: ["motion-nav-fullscreen-overlay", "motion-nav-morphing-hamburger"] },
  editorial: { type: ["motion-type-split-reveal"], scroll: ["motion-scroll-progress", "motion-scroll-sticky-story", "motion-scroll-text-mask"], navigation: ["motion-nav-vertical-timeline", "motion-nav-scroll-aware"] },
  storefront: { scroll: ["motion-scroll-staggered-grid", "motion-scroll-reveal"], surface: ["motion-card-image-reveal", "motion-card-flip", "motion-card-tilt"], control: ["motion-button-ripple", "motion-button-particle-burst", "motion-button-3d-press"], feedback: ["motion-loader-skeleton"] },
  dashboard: { data: ["motion-chart-momentum-line", "motion-chart-radial-indicators"], feedback: ["motion-loader-skeleton", "motion-loader-progress-ring"], navigation: ["motion-nav-liquid-indicator"], control: ["motion-button-morphing-toggle"] },
  app: { feedback: ["motion-loader-skeleton", "motion-loader-ai-thinking", "motion-loader-multi-stage"], navigation: ["motion-nav-liquid-indicator", "motion-nav-floating-dock"], control: ["motion-button-morphing-toggle", "motion-button-ripple"], surface: ["motion-card-expandable", "motion-card-stacked"] },
  docs: { scroll: ["motion-scroll-progress"], navigation: ["motion-nav-vertical-timeline"] },
  media: { hero: ["motion-bg-starfield", "motion-bg-particle-field", "motion-bg-waveform"], type: ["motion-type-kinetic-headline", "motion-type-split-reveal"], scroll: ["motion-scroll-staggered-grid", "motion-scroll-horizontal-story"], surface: ["motion-3d-card-carousel", "motion-card-tilt"], control: ["motion-button-magnetic", "motion-button-3d-press"], feedback: ["motion-loader-skeleton"] },
  game: { hero: ["motion-canvas-particle-burst", "motion-bg-starfield"], type: ["motion-type-glitch", "motion-type-text-scramble"], control: ["motion-button-3d-press", "motion-button-particle-burst"], feedback: ["motion-loader-segments", "motion-loader-orbit"] },
  general: { scroll: ["motion-scroll-reveal", "motion-scroll-staggered-grid"], surface: ["motion-card-tilt", "motion-card-spotlight"], control: ["motion-button-magnetic", "motion-button-ripple"] },
};
/** A hero moment by default only for expressive requests on these kinds of site (none built on a look that needs asking for). */
const HERO_DEFAULTS = ["motion-bg-particle-field", "motion-bg-waveform", "motion-3d-sphere", "motion-bg-geometric-grid", "motion-bg-starfield"];
/** Style words a "no …" rules out wherever they appear in a piece ("no 3d" rules out the 3D tilt card). */
const REFUSABLE = ["3d", "parallax", "particle", "glass", "neon", "glitch", "canvas", "gradient", "blob", "aurora", "starfield", "matrix", "cursor", "magnetic", "tilt", "typewriter", "confetti", "orbit", "liquid", "carousel"];

/** Mentioned, but only inside a "no …" clause. */
const refusedIn = (text: string, phrase: string) => text.includes(phrase) && !said(text, phrase);

export function motionMixture(input: { text: string; ui: boolean; surface: Surface; motion: MotionLevel; needs: Need[]; avoid?: string[]; synthesis?: Synthesis | null }): MotionMixture | null {
  if (!input.ui) return null;
  const text = input.text.toLowerCase();
  // Asked to keep it still: no mixture at all.
  if (["animation", "animations", "motion", "animated"].some(word => refusedIn(text, word)) || /\b(static|no motion|without motion|reduced motion only)\b/.test(text)) return null;
  const refusedWords = REFUSABLE.filter(word => refusedIn(text, word));
  const refused = (piece: MotionPiece) => piece.signals.some(signal => refusedIn(text, signal))
    || refusedWords.some(word => [piece.name, piece.family, ...piece.signals].some(value => value.toLowerCase().includes(word)))
    || (input.avoid ?? []).some(word => piece.signals.includes(word) || piece.name.toLowerCase().includes(word));
  // What the request names, longest phrase first; a phrase inside a longer one already matched ("scroll progress ring") is that one's.
  const claimed: [number, number][] = [];
  const spans = (signal: string) => [...text.matchAll(new RegExp(`(?:^|[^a-z0-9-])(${escape(signal)})(?:s|es)?(?![a-z0-9])`, "g"))].map(match => [match.index! + match[0].indexOf(match[1]), match.index! + match[0].indexOf(match[1]) + signal.length] as [number, number]);
  const named = MOTION_PIECES.filter(piece => !refused(piece) && piece.signals.some(signal => said(text, signal)))
    .map(piece => ({ piece, signals: piece.signals.filter(signal => said(text, signal)).sort((a, b) => b.length - a.length) }))
    .sort((a, b) => b.signals[0].length - a.signals[0].length || MOTION_PIECES.indexOf(a.piece) - MOTION_PIECES.indexOf(b.piece))
    .filter(({ signals }) => {
      const own = signals.flatMap(spans).filter(([start, end]) => !claimed.some(([from, to]) => start < to && end > from));
      if (!own.length) return false;
      claimed.push(...own);
      return true;
    });
  const asked = input.motion === "expressive" || MOTION_ASK.some(word => said(text, word));
  if (!named.length && !asked) return null;
  const picks: MotionMixture["picks"] = [];
  // What the user names may take two of a slot (two backgrounds for two sections); a default never adds a second loop.
  const room = (slot: MotionSlot, isNamed: boolean) => picks.filter(pick => pick.slot === slot).length < (SLOT_LIMIT[slot] ?? 1) + (isNamed ? 1 : 0);
  const add = (piece: MotionPiece, isNamed: boolean) => {
    if (picks.some(pick => pick.piece.id === piece.id) || !room(piece.slot, isNamed) || (!isNamed && piece.cost === "loop" && picks.some(pick => pick.piece.cost === "loop"))) return;
    picks.push({ slot: piece.slot, piece, named: isNamed });
  };
  for (const { piece } of named) add(piece, true);
  // A request that asks for motion in general gets the defaults that suit its kind of site, one per open slot.
  if (asked) {
    const defaults = MOTION_DEFAULTS[input.surface] ?? MOTION_DEFAULTS.general!;
    const pool = (ids: string[]) => ids.map(id => MOTION_PIECES.find(piece => piece.id === id)!).filter(piece => piece && !refused(piece));
    for (const slot of SLOT_ORDER) {
      const options = pool(defaults[slot] ?? []);
      if (options.length && !picks.some(pick => pick.slot === slot)) add(options[stableIndex(`${text}:${slot}`, options.length)], false);
    }
    // A continuously running hero only when nothing was named, or the request talks about its hero or background.
    const heroWanted = !named.length || ["hero", "background", "backdrop"].some(word => said(text, word));
    if (heroWanted && !picks.some(pick => pick.slot === "hero") && input.motion === "expressive" && (input.needs.includes("immersive") || ["landing", "showcase", "media", "general"].includes(input.surface))) {
      const heroes = pool(HERO_DEFAULTS);
      if (heroes.length) add(heroes[stableIndex(`${text}:hero`, heroes.length)], false);
    }
  }
  if (!picks.length) return null;
  picks.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const chosen = picks.slice(0, 7);
  const first = MOTION_FAMILIES.find(family => family.id === chosen[0].piece.family)!;
  return {
    picks: chosen,
    theme: input.synthesis?.primary.id ?? first.tokens,
    // Only what the user named makes its look deliberate (a default never lifts a warning).
    grants: [...new Set(chosen.filter(pick => pick.named).flatMap(pick => pick.piece.looks ?? []))].sort() as GrantedLook[],
    reason: named.length ? "the request names these" : "the request asks for motion",
  };
}

/** The mixture as the brief's section: the pieces by job, the shared timing, the budget and the rules. */
export function renderMotionMixture(mixture: MotionMixture) {
  const loops = mixture.picks.filter(pick => pick.piece.cost === "loop");
  return [
    `## Motion mixture (${mixture.reason})`,
    "Mix pieces of the motion library by job; never reproduce a suite or the scroll mock. Rebuild each in the design's own language.",
    `- Pieces: ${mixture.picks.map(pick => `${pick.slot}: ${pick.piece.name} (${pick.piece.how}; component ${pick.piece.id}${pick.piece.react ? `, React: ${pick.piece.id}-react` : ""})`).join("; ")}.`,
    `- Timing from the tokens for every piece: --cx-ease ${MOTION_TIMING.ease}, --cx-duration-fast ${MOTION_TIMING.fast}, --cx-duration-base ${MOTION_TIMING.base}, --cx-duration-reveal ${MOTION_TIMING.reveal}, --cx-stagger ${MOTION_TIMING.stagger}; colours by role from the design's tokens, never a suite's own palette or font.`,
    loops.length > 1
      ? `- Budget: ${loops.map(pick => pick.piece.name).join(" and ")} run continuously: never on screen together (separate sections), each paused off-screen and when the tab is hidden, each with a pause control. Everything else runs on events, scroll or CSS.`
      : loops.length
        ? `- Budget: ${loops[0].piece.name} is the one continuously running piece; it pauses off-screen and when the tab is hidden, and gets a pause control. Everything else runs on events, scroll or CSS.`
        : "- Budget: nothing runs continuously; everything runs on events, scroll or CSS.",
    "- Reduced motion (prefers-reduced-motion: reduce): every piece has an end state: reveals show their content, loops stop on a still frame, pointer effects stay put, pinned and horizontal sections stack.",
    `- With the component library: add_components with ${mixture.picks.map(pick => pick.piece.id).join(", ")} and theme ${mixture.theme} re-skins them to one token set (find_components finds other pieces).`,
  ].join("\n");
}
