import { ARCHETYPES, ENTERTAINMENT_WORDS, type Archetype, type GrantedLook } from "./knowledge/archetypes";
import { contrast } from "./audit";

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
    const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index);
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
