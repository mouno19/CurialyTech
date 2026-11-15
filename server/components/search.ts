import type { Concept, Entry, Snapshot } from "./registry";

// Hybrid component search over the whole registry: keyword relevance (BM25 over name, tags,
// description and metadata), concept similarity (the vocabulary maps "spending", "API logs" or
// "order book" to what components are about, so a query finds components that never use its
// words), and character-trigram similarity (spelling variants: "candles" ~ "candlestick"). There
// is no neural embedding model in it: the platform's model bridge serves no embeddings route, so
// the "semantic" part is the concept vocabulary (component-library/vocabulary.json). Only metadata
// is searched: no implementation file is read.

const STOP = new Set(("a an the and or of for with to in on at by from as is are be it its this that these those my our your their we you i me us " +
  "build create make design develop generate want need needs should must can could would please also include includes including plus where which " +
  "who what when how all any some other each every one two three new modern premium beautiful clean simple nice good great best fully just like using use " +
  "into onto via per across within show shows display displays add adds let lets allow allows give gives provide provides etc page app application platform " +
  "interface ui ux site product tool system").split(" "));

export function stem(word: string) {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  return word;
}

const normalize = (text: string) => ` ${text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9%$]+/g, " ").replace(/\s+/g, " ").trim()} `;
export const tokens = (text: string) => normalize(text).trim().split(" ").filter(word => word && !STOP.has(word)).map(stem);

/** How strongly a text is about each concept (term matches, as phrases). */
export function conceptVector(text: string, concepts: Concept[]): Map<string, number> {
  const haystack = ` ${normalize(text).trim().split(" ").map(stem).join(" ")} `;
  const vector = new Map<string, number>();
  for (const concept of concepts) {
    let weight = 0;
    for (const term of concept.terms) {
      const phrase = ` ${normalize(term).trim().split(" ").map(stem).join(" ")} `;
      // A phrase ("order book", "trading history") says more than one of its words.
      if (phrase.trim() && haystack.includes(phrase)) weight += phrase.trim().includes(" ") ? 3 : 1;
    }
    if (weight) vector.set(concept.id, weight);
  }
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, value] of a) { na += value * value; const other = b.get(key); if (other) dot += value * other; }
  for (const value of b.values()) nb += value * value;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function trigrams(text: string) {
  const grams = new Map<string, number>();
  for (const word of normalize(text).trim().split(" ")) {
    if (word.length < 3 || STOP.has(word)) continue;
    const padded = `_${word}_`;
    for (let index = 0; index < padded.length - 2; index++) {
      const gram = padded.slice(index, index + 3);
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
  }
  return grams;
}

const FIELDS = { name: 3, tags: 2, meta: 1.5, text: 1 } as const;

type Doc = { entry: Entry; tf: Map<string, number>; length: number; concepts: Map<string, number>; grams: Map<string, number> };
type Index = { key: string; docs: Doc[]; df: Map<string, number>; avgLength: number; concepts: Concept[] };

let cached: Index | null = null;

function docOf(entry: Entry, concepts: Concept[]): Doc {
  const tf = new Map<string, number>();
  let length = 0;
  const add = (text: string, weight: number) => {
    for (const token of tokens(text)) { tf.set(token, (tf.get(token) ?? 0) + weight); length += weight; }
  };
  add(entry.name, FIELDS.name);
  add(entry.tags.join(" "), FIELDS.tags);
  add(`${entry.category} ${entry.batch} ${entry.collection ?? ""} ${entry.role}`, FIELDS.meta);
  add(`${entry.description} ${entry.capabilities.join(" ")}`, FIELDS.text);
  const about = `${entry.name} ${entry.tags.join(" ")} ${entry.category} ${entry.batch} ${entry.description}`;
  return { entry, tf, length, concepts: conceptVector(about, concepts), grams: trigrams(`${entry.name} ${entry.tags.join(" ")}`) };
}

/** The search index of a registry snapshot (and an account's candidates), built once per change. */
export function indexFor(snapshot: Snapshot, entries: Entry[] = snapshot.components): Index {
  const key = `${snapshot.signature}#${entries.length}#${entries.filter(entry => entry.owner).map(entry => entry.id).join(",")}`;
  if (cached?.key === key) return cached;
  const docs = entries.map(entry => docOf(entry, snapshot.concepts));
  const df = new Map<string, number>();
  for (const doc of docs) for (const token of doc.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const index = { key, docs, df, avgLength: docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length), concepts: snapshot.concepts };
  cached = index;
  return index;
}

export type SearchFilters = {
  /** Include components whose status is one of these (default: active and needs-review). */
  status?: string[];
  categories?: string[];
  frameworks?: string[];
  /** Components compatible with at least one of these tools (absent or empty: any). */
  tools?: string[];
  exclude?: Set<string>;
};

export type Hit = { entry: Entry; score: number; keyword: number; concept: number; spelling: number; matched: string[]; concepts: string[] };

/**
 * Ranked components for a query. score is 0..1: keyword relevance (normalized to the best hit),
 * concept similarity and spelling similarity, weighed, then adjusted for quality (a component
 * that did not render ranks lower) and for the layout role the query implies.
 */
export function search(index: Index, query: string, filters: SearchFilters = {}, limit = 8): Hit[] {
  const qTokens = [...new Set(tokens(query))];
  const qConcepts = conceptVector(query, index.concepts);
  const qGrams = trigrams(query);
  const statuses = new Set(filters.status ?? ["active", "needs-review", "candidate"]);
  // The query's primary concept: the strongest one, when a phrase made it clearly stronger than the rest.
  const ranked = [...qConcepts.entries()].sort((a, b) => b[1] - a[1]);
  const primary = ranked.length && ranked[0][1] >= 3 && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  const roleHints = new Set(index.concepts.filter(concept => (primary ? concept.id === primary : qConcepts.has(concept.id))).map(concept => concept.role));
  const N = index.docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const scored: Hit[] = [];
  let bestKeyword = 0;
  const raw: { doc: Doc; keyword: number; matched: string[] }[] = [];
  for (const doc of index.docs) {
    const entry = doc.entry;
    if (!statuses.has(entry.status) || filters.exclude?.has(entry.id)) continue;
    if (filters.categories?.length && !filters.categories.includes(entry.category)) continue;
    if (filters.frameworks?.length && !entry.frameworks.some(item => filters.frameworks!.includes(item))) continue;
    if (filters.tools?.length && !entry.compatible_tools.some(tool => filters.tools!.includes(tool))) continue;
    let keyword = 0;
    const matched: string[] = [];
    for (const token of qTokens) {
      const tf = doc.tf.get(token);
      if (!tf) continue;
      const df = index.df.get(token) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      keyword += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / index.avgLength)));
      matched.push(token);
    }
    bestKeyword = Math.max(bestKeyword, keyword);
    raw.push({ doc, keyword, matched });
  }
  for (const { doc, keyword, matched } of raw) {
    const concept = cosine(qConcepts, doc.concepts);
    const spelling = cosine(qGrams, doc.grams);
    if (!keyword && concept < 0.05 && spelling < 0.2) continue;
    // Keyword relevance counts in absolute terms too: a weak best hit is still weak.
    const keywordScore = bestKeyword ? (keyword / bestKeyword) * Math.min(1, bestKeyword / 6) : 0;
    // With a primary concept, what the component is about counts for more than the words it shares.
    let score = primary ? 0.35 * keywordScore + 0.5 * concept + 0.15 * spelling : 0.5 * keywordScore + 0.35 * concept + 0.15 * spelling;
    // The query is about something (it names concepts) and this component is about none of it:
    // a shared word alone ("order" in "order book" and "daily order range") is a weak match.
    if (qConcepts.size && concept === 0) score *= 0.55;
    // …and one that isn't about what the query is mainly about ranks below those that are.
    else if (primary && !doc.concepts.has(primary)) score *= 0.7;
    const entry = doc.entry;
    if (roleHints.size && roleHints.has(entry.layout?.role ?? entry.role)) score += 0.05;
    if (entry.quality?.rendered === false) score *= 0.6;
    else if (entry.status === "needs-review") score *= 0.75;
    scored.push({ entry, score: Math.round(Math.min(1, score) * 1000) / 1000, keyword: Math.round(keywordScore * 100) / 100, concept: Math.round(concept * 100) / 100, spelling: Math.round(spelling * 100) / 100, matched, concepts: [...doc.concepts.keys()].filter(id => qConcepts.has(id)) });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, limit);
}
