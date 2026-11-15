// Writes the style archetypes (server/agent/design/knowledge/archetypes.ts, the one source) for the
// component library: a token set per archetype (component-library/tokens/<id>.json, the roles every
// component is adapted by, the template's own colours as aliases so its blocks re-skin, and the
// colours the library copy replaces with their text-safe shades), and
// component-library/anime-templates/archetypes.json for the block importer.
//   node node_modules/tsx/dist/cli.mjs scripts/components/export-archetypes.mts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, type Archetype } from "../../server/agent/design/knowledge/archetypes";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = path.resolve(HERE, "../../component-library");
const TEMPLATES = path.join(LIBRARY, "anime-templates");

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const reddish = (hex: string) => { const h = hue(hex); return h >= 0 && (h < 20 || h > 340); };
const greenish = (hex: string) => { const h = hue(hex); return h >= 80 && h < 200; };
const yellowish = (hex: string) => { const h = hue(hex); return h >= 30 && h < 70; };
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** #abc → #aabbcc. */
const long = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join("")}` : hex).toLowerCase();

/** The template's own :root colours (hex only). */
function rootColors(archetype: Archetype) {
  const html = fs.readFileSync(path.join(TEMPLATES, archetype.file), "utf8");
  const root = /:root\s*{([^}]*)}/.exec([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n"))?.[1] ?? "";
  return Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/g)].map(match => [match[1], long(match[2])]));
}

function tokenSet(archetype: Archetype) {
  const t = archetype.tokens;
  const own = rootColors(archetype);
  // The library copy of the template's blocks uses the text-safe shades: the muted text colour, and the
  // accent when a label on it fails too (then it is a fill under labels as well as text).
  const replaced: Record<string, string> = {};
  if (archetype.textSafe?.muted) replaced[t.muted.toLowerCase()] = archetype.textSafe.muted;
  if (archetype.textSafe?.accent && contrast(t.onAccent, t.accent) < 4.5) replaced[t.accent.toLowerCase()] = archetype.textSafe.accent;
  const accent = replaced[t.accent.toLowerCase()] ?? t.accent;
  const known = new Set(Object.values(t).map(hex => hex.toLowerCase()));
  const extras = Object.values(own).filter(hex => !known.has(hex) && hex !== t.bg);
  const candidates = [accent, t.accent2, ...extras];
  const series = [...new Set([accent, t.accent2, ...extras, archetype.textSafe?.muted ?? t.muted, t.text, t.line])].slice(0, 6);
  const colors = {
    background: t.bg, surface: t.surface, surface2: t.surface2, border: t.line, text: t.text,
    muted: archetype.textSafe?.muted ?? t.muted,
    accent,
    positive: candidates.find(greenish) ?? t.accent2,
    negative: candidates.find(reddish) ?? (archetype.mode === "dark" ? "#ff6b6b" : "#c2413b"),
    warning: candidates.find(yellowish) ?? t.accent2,
    ...Object.fromEntries(series.map((hex, index) => [`series${index + 1}`, hex])),
  };
  // The template's own colours, by role, so its blocks (which use them) are re-skinned too.
  const aliases: Record<string, string> = {};
  for (const [name, hex] of Object.entries(own)) {
    if (replaced[hex]) continue;
    if (Object.values(colors).map(value => value.toLowerCase()).includes(hex)) continue;
    aliases[hex] = /gold-light|accent2|red2|light/.test(name) ? "accent" : "series2";
  }
  return {
    id: archetype.id, name: `${archetype.name} (${archetype.mode})`, mode: archetype.mode, source: `anime-templates/${archetype.file}`,
    colors, aliases, replaced,
    fonts: { display: `"${archetype.fonts.display}", serif`.replace(/, serif$/, /Mincho|Playfair|Fraunces|Serif/.test(archetype.fonts.display) ? ", serif" : ", system-ui, sans-serif"), sans: `"${archetype.fonts.text}", system-ui, sans-serif`, ...(archetype.fonts.extra ? { extra: `"${archetype.fonts.extra}", system-ui, sans-serif` } : {}) },
    radius: { card: archetype.radius },
  };
}

fs.mkdirSync(path.join(LIBRARY, "tokens"), { recursive: true });
for (const archetype of ARCHETYPES) fs.writeFileSync(path.join(LIBRARY, "tokens", `${archetype.id}.json`), `${JSON.stringify(tokenSet(archetype), null, 2)}\n`);
fs.writeFileSync(path.join(TEMPLATES, "archetypes.json"), `${JSON.stringify(ARCHETYPES.map(archetype => ({
  id: archetype.id, name: archetype.name, style: archetype.style, file: archetype.file, mode: archetype.mode, concept: archetype.concept, fits: archetype.fits, signals: archetype.signals, blocks: archetype.blocks,
})), null, 2)}\n`);
console.log(`${ARCHETYPES.length} token sets and archetypes.json written`);
