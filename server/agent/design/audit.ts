import type { DesignAudit, Finding, FindingLevel, PageFacts, Surface, TextSample } from "./types";

// Scores what the collector measured. "fix" is the quality floor (WCAG 2.2 AA failures and broken
// layout), "improve" is craft (type, rhythm, motion hygiene), "note" is taste (generated-template
// signatures) and never blocks anything. Pure, so it is tested with plain JSON fixtures.

type Channel = [number, number, number];

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Channel) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG 2.x contrast ratio, unrounded (4.499 fails 4.5). */
export function contrast(a: Channel, b: Channel) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const hex = ([r, g, b]: Channel) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const blend = (fg: [number, number, number, number], bg: Channel): Channel => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as Channel;

/** Large text per WCAG: 24 px, or 18.66 px at bold weight (700 and up). */
export const largeText = (sample: Pick<TextSample, "size" | "weight">) => sample.size >= 24 || (sample.size >= 18.66 && sample.weight >= 700);

/** The worst contrast of a text sample against what may be behind it, and that background (null: unmeasurable). */
export function worstContrast(sample: TextSample): { ratio: number; bg: Channel } | null {
  if (!sample.bg || !sample.bg.length || sample.color[3] <= 0.05) return null;
  let worst: { ratio: number; bg: Channel } | null = null;
  for (const bg of sample.bg) {
    const ratio = contrast(blend(sample.color, bg), bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, bg };
  }
  return worst;
}
export const textContrast = (sample: TextSample) => worstContrast(sample)?.ratio ?? null;

const GENERIC_FONTS = /^(inter|roboto|arial|helvetica|helvetica neue|system-ui|-apple-system|blinkmacsystemfont|segoe ui|sans-serif|open sans|lato|ui-sans-serif)$/i;
const SYSTEM_FAMILIES = /^(system-ui|-apple-system|blinkmacsystemfont|segoe ui|sans-serif|serif|monospace|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|cursive|fantasy|arial|helvetica|helvetica neue|times|times new roman|georgia|courier|courier new|menlo|monaco|consolas|verdana|tahoma|trebuchet ms|sf mono|sf pro|sf pro text|sf pro display|roboto|noto sans|liberation sans|dejavu sans|apple color emoji|segoe ui emoji)$/i;
const DENSE: Surface[] = ["dashboard", "app", "docs"];

export type AuditOptions = {
  surface?: Surface;
  /** Looks the user asked for (gradient, glass, emoji, eyebrow, default-font, bounce, marquee): not reported. */
  allowed?: string[];
};

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** "1 control is", "3 controls are". */
const counted = (n: number, word: string, singular: string, many: string) => `${plural(n, word)} ${n === 1 ? singular : many}`;
const list = (items: string[], n = 3) => items.slice(0, n).join(", ") + (items.length > n ? ` and ${items.length - n} more` : "");

/** Size with the most characters among running text (not headings, not tiny labels). */
function bodySize(text: TextSample[]) {
  const weights = new Map<number, number>();
  for (const sample of text) if (!sample.heading && sample.chars >= 30) weights.set(sample.size, (weights.get(sample.size) ?? 0) + sample.chars);
  let best: number | null = null;
  let most = 0;
  for (const [size, chars] of weights) if (chars > most) { best = size; most = chars; }
  return best;
}
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

type Failing = { sample: TextSample; ratio: number; bg: Channel; need: number };

function failingContrast(facts: PageFacts): Failing[] {
  const failing: Failing[] = [];
  for (const sample of facts.text) {
    if (sample.chars < 2) continue;
    const worst = worstContrast(sample);
    if (!worst) continue;
    const need = largeText(sample) ? 3 : 4.5;
    // Text still fading in where it was seen: only clear failures count.
    const limit = sample.estimated ? need - 1 : need;
    if (worst.ratio < limit) failing.push({ sample, ...worst, need });
  }
  return failing.sort((a, b) => b.sample.chars - a.sample.chars);
}

function contrastFinding(failing: Failing[], viewport: Finding["viewport"]): Finding[] {
  if (!failing.length) return [];
  // The colors quoted are the pair that fails (for a gradient, its worst stop).
  const examples = failing.slice(0, 3).map(({ sample, ratio, bg, need }) => `${sample.el} ${ratio.toFixed(2)}:1 (${hex(blend(sample.color, bg))} on ${hex(bg)}, needs ${need}:1)`);
  return [{ id: viewport === "phone" ? "contrast-phone" : "contrast", level: "fix", viewport, message: `Text contrast too low on ${plural(failing.length, "element")}${viewport === "phone" ? " at phone width" : ""}: ${examples.join("; ")}.` }];
}

function typeFindings(desktop: PageFacts, phone: PageFacts | null, surface: Surface | undefined, allowed: Set<string>, stats: string[]): Finding[] {
  const findings: Finding[] = [];
  const text = desktop.text;
  const body = bodySize(text);
  const dense = surface ? DENSE.includes(surface) : false;
  const totalChars = text.reduce((sum, sample) => sum + sample.chars, 0) || 1;
  const headings = text.filter(sample => sample.heading);
  const largest = Math.max(0, ...headings.map(sample => sample.size));
  if (body !== null && body < (dense ? 13.5 : 15.5)) findings.push({ id: "body-size", level: "improve", viewport: "desktop", message: `Body text is ${body} px; use ${dense ? "14-16" : "16-18"} px for running text.` });
  const tiny = text.filter(sample => sample.size < 12 && sample.chars >= 3);
  if (tiny.length) findings.push({ id: "tiny-text", level: "improve", viewport: "desktop", message: `${plural(tiny.length, "text element")} below 12 px (e.g. ${list(tiny.map(sample => `${sample.el} ${sample.size} px`), 2)}); nothing functional should be that small.` });
  if (body !== null && largest > 0) {
    const ratio = largest / body;
    if (ratio < 1.5 && !dense) findings.push({ id: "flat-hierarchy", level: "improve", viewport: "desktop", message: `The largest heading is only ${ratio.toFixed(2)}× the body size (${largest} px vs ${body} px); make the hierarchy unmistakable with at least one jump of 1.5× or more.` });
    if (largest > 104) findings.push({ id: "oversized-heading", level: "improve", viewport: "desktop", message: `A ${largest} px heading on a 1280 px screen is oversized; keep display type around 48-80 px so content stays in view.` });
  }
  const phoneHeadings = phone?.text.filter(sample => sample.heading) ?? [];
  const phoneLargest = phoneHeadings.reduce<TextSample | null>((max, sample) => (!max || sample.size > max.size ? sample : max), null);
  if (phone && phoneLargest && (phoneLargest.size > 52 || phoneLargest.height > phone.viewport.height * 0.6)) {
    findings.push({ id: "phone-heading", level: "improve", viewport: "phone", message: `The ${phoneLargest.size} px heading (${phoneLargest.el}) takes ${Math.round((phoneLargest.height / phone.viewport.height) * 100)}% of the phone screen; size it to 32-44 px with clamp().` });
  }
  const sizes = new Map<number, number>();
  for (const sample of text) sizes.set(Math.round(sample.size), (sizes.get(Math.round(sample.size)) ?? 0) + sample.chars);
  const steps = [...sizes.values()].filter(chars => chars / totalChars >= 0.01).length;
  if (steps > 10) findings.push({ id: "type-scale", level: "improve", viewport: "desktop", message: `${steps} different font sizes are in use; settle on a scale of 6-9 steps.` });
  const bodySamples = text.filter(sample => !sample.heading && sample.chars >= 60 && sample.line > 0);
  const tight = bodySamples.filter(sample => sample.line / sample.size < 1.35);
  if (bodySamples.length >= 3 && tight.length / bodySamples.length > 0.5) findings.push({ id: "leading", level: "improve", viewport: "desktop", message: `Running text is set tight (line-height ${(tight[0].line / tight[0].size).toFixed(2)}); use 1.5-1.7 for body copy.` });
  const measure = median(text.filter(sample => sample.cpl !== null).map(sample => sample.cpl!));
  if (measure !== null && measure > 85) findings.push({ id: "measure", level: "improve", viewport: "desktop", message: `Paragraph lines run to about ${measure} characters; cap text at 60-75ch.` });

  const families = desktop.fonts.families;
  const familyChars = families.reduce((sum, family) => sum + family.chars, 0) || 1;
  const textFamilies = families.filter(family => family.chars / familyChars >= 0.03 && !/mono|code|courier|consolas|menlo/i.test(family.name));
  if (textFamilies.length > 3) findings.push({ id: "font-count", level: "improve", viewport: "desktop", message: `${textFamilies.length} font families carry the text (${list(textFamilies.map(family => family.name), 4)}); use one, or two that clearly differ.` });
  const top = families[0];
  if (top && top.chars / familyChars >= 0.85 && GENERIC_FONTS.test(top.name) && !allowed.has("default-font") && !dense) {
    findings.push({ id: "default-font", level: "note", viewport: "desktop", message: `All the type is ${top.name}, the reflex default; a face chosen for the subject would carry the direction (keep it if that is deliberate).` });
  }
  const loaded = new Set(desktop.fonts.loaded.map(name => name.toLowerCase()));
  const missing = families.filter(family => !SYSTEM_FAMILIES.test(family.name) && !loaded.has(family.name.toLowerCase()) && family.chars / familyChars >= 0.05).map(family => family.name);
  if (missing.length && desktop.fonts.loaded.length + missing.length > 0) findings.push({ id: "font-not-loaded", level: "improve", viewport: "desktop", message: `${list(missing)} ${missing.length === 1 ? "is" : "are"} declared but not loaded, so a fallback face shows; load ${missing.length === 1 ? "it" : "them"} or drop ${missing.length === 1 ? "it" : "them"} from the stack.` });

  const share = (family: { chars: number }) => `${Math.round((family.chars / familyChars) * 100)}%`;
  const bodyStat = body === null ? "no running text" : `body ${body} px${bodySamples[0] ? `/${(bodySamples[0].line / bodySamples[0].size).toFixed(2)}` : ""}`;
  const headingStat = largest ? `largest heading ${largest} px${body ? ` (${(largest / body).toFixed(1)}×)` : ""}` : "no headings";
  stats.push(`Type: ${families.slice(0, 3).map(family => `${family.name} ${share(family)}`).join(", ") || "no text measured"}; ${bodyStat}; ${headingStat}; ${plural(steps, "size")} in use.`);
  return findings;
}

function layoutFindings(desktop: PageFacts, phone: PageFacts | null): Finding[] {
  const findings: Finding[] = [];
  for (const facts of [phone, desktop]) {
    if (!facts) continue;
    const viewport = facts === phone ? "phone" : "desktop";
    const widest = facts.overflow.offenders.map(item => `${item.el} reaches ${item.right} px`);
    if (facts.overflow.px > 1) findings.push({ id: `overflow-${viewport}`, level: "fix", viewport, message: `At ${facts.viewport.width} px the page scrolls sideways by ${facts.overflow.px} px${widest.length ? ` (${list(widest, 2)})` : ""}; let it wrap, shrink or scroll inside its own container.` });
    // Hidden by overflow-x on html/body: nothing scrolls, but what sticks out is cut off.
    else if (facts.overflow.clipped > 8) findings.push({ id: `overflow-clipped-${viewport}`, level: "note", viewport, message: `At ${facts.viewport.width} px content reaches ${facts.overflow.clipped} px past the edge and is cut off by overflow-x${widest.length ? ` (${list(widest, 2)})` : ""}; make sure nothing that matters is in the cut-off part.` });
  }
  const meta = desktop.viewportMeta;
  if (meta === null) findings.push({ id: "viewport-meta", level: "fix", viewport: "phone", message: "No <meta name=\"viewport\">: phones show a zoomed-out desktop page. Add width=device-width, initial-scale=1." });
  else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*(0?\.\d+|1(\.0+)?)\b/i.test(meta)) findings.push({ id: "zoom-blocked", level: "fix", viewport: "phone", message: `The viewport meta blocks zooming (${meta}); remove maximum-scale and user-scalable=no.` });
  if (!desktop.lang) findings.push({ id: "lang", level: "fix", viewport: "both", message: "<html> has no lang attribute." });
  const h1 = desktop.headings.filter(level => level === 1).length;
  if (h1 === 0) findings.push({ id: "h1", level: "improve", viewport: "both", message: "The page has no visible h1." });
  else if (h1 > 1) findings.push({ id: "h1-count", level: "note", viewport: "both", message: `${h1} h1 headings; one per page is clearer for assistive technology.` });
  const skips = desktop.headings.filter((level, index) => index > 0 && level > desktop.headings[index - 1] + 1).length;
  if (skips) findings.push({ id: "heading-order", level: "improve", viewport: "both", message: `Heading levels are skipped ${plural(skips, "time")} (e.g. h2 to h4); keep them in order.` });
  if (!desktop.landmarks.main) findings.push({ id: "landmarks", level: "improve", viewport: "both", message: "No <main> landmark; wrap the primary content in <main> (with header and footer around it)." });
  const hidden = phone?.hidden ?? desktop.hidden;
  if (hidden.count >= 3 || hidden.chars >= 200) {
    findings.push({ id: "hidden-content", level: "fix", viewport: phone ? "phone" : "desktop", message: `${plural(hidden.count, "text block")} (${hidden.chars} characters) stayed invisible after scrolling the whole page${phone ? " with reduced motion on" : ""} (e.g. ${list(hidden.samples, 2)}). Content must be visible at rest: start visible and let scripts add the hidden starting state.` });
  } else if (hidden.count) {
    findings.push({ id: "hidden-content", level: "improve", viewport: phone ? "phone" : "desktop", message: `${plural(hidden.count, "text block")} stayed invisible after scrolling (${list(hidden.samples, 2)}); check it isn't waiting for an animation that never runs.` });
  }
  return findings;
}

function controlFindings(desktop: PageFacts, phone: PageFacts | null): Finding[] {
  const findings: Finding[] = [];
  const unnamed = [...new Set([...desktop.controls.unnamed, ...(phone?.controls.unnamed ?? [])])];
  if (unnamed.length) findings.push({ id: "control-names", level: "fix", viewport: "both", message: `${plural(unnamed.length, "control")} without an accessible name: ${list(unnamed)}. Give icon buttons an aria-label and links real text.` });
  const small = phone?.controls.small.length ? phone.controls.small : desktop.controls.small;
  if (small.length) findings.push({ id: "target-size", level: "fix", viewport: phone?.controls.small.length ? "phone" : "desktop", message: `${plural(small.length, "control")} smaller than 24×24 px and crowded: ${list(small.map(item => `${item.el} ${item.w}×${item.h}`))}. Enlarge the hit area (padding or a pseudo-element).` });
  if (phone && phone.controls.under44 >= 3) findings.push({ id: "touch-targets", level: "improve", viewport: "phone", message: `${counted(phone.controls.under44, "control", "is", "are")} under 44×44 px on the phone layout; give primary and touch controls at least 44 px.` });
  const focus = [...new Set([...desktop.focus.missing, ...(phone?.focus.missing ?? [])])];
  if (focus.length) findings.push({ id: "focus-visible", level: "fix", viewport: "both", message: `No visible focus style on ${list(focus)}; add a :focus-visible outline (2 px or thicker, with offset).` });
  const noAlt = [...new Set([...desktop.images.noAlt, ...(phone?.images.noAlt ?? [])])];
  if (noAlt.length) findings.push({ id: "alt-text", level: "fix", viewport: "both", message: `${plural(noAlt.length, "image")} without alt text: ${list(noAlt)} (alt="" if decorative).` });
  if (desktop.images.broken.length) findings.push({ id: "broken-images", level: "fix", viewport: "both", message: `${plural(desktop.images.broken.length, "image")} failed to load: ${list(desktop.images.broken)}.` });
  if (desktop.images.unsized >= 3) findings.push({ id: "image-size", level: "note", viewport: "both", message: `${desktop.images.unsized} images have no width/height or aspect-ratio, so the layout shifts as they load.` });
  const unlabeled = [...new Set([...desktop.fields.unlabeled, ...(phone?.fields.unlabeled ?? [])])];
  if (unlabeled.length) findings.push({ id: "field-labels", level: "fix", viewport: "both", message: `${plural(unlabeled.length, "form field")} without a label: ${list(unlabeled)}. A placeholder is not a label.` });
  if (phone && phone.fields.smallFont) findings.push({ id: "input-font", level: "improve", viewport: "phone", message: `${counted(phone.fields.smallFont, "input", "uses", "use")} text under 16 px on the phone layout, which makes iOS zoom in on focus.` });
  return findings;
}

function motionFindings(desktop: PageFacts, phone: PageFacts | null, allowed: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const animated = desktop.animations.running > 0 || desktop.styles.layoutKeyframes.length > 0 || desktop.styles.transitionAll > 0;
  // null: some stylesheets couldn't be read, so a missing rule can't be told from an unread one.
  if (animated && desktop.styles.reducedMotionRule === false) findings.push({ id: "reduced-motion", level: "improve", viewport: "both", message: "The page animates but has no prefers-reduced-motion rule; remove movement (translate, scale, parallax) under reduce and keep short fades." });
  // A requested marquee is still an accessibility matter (WCAG 2.2.2): only the wording changes.
  if (phone && phone.animations.infinite > 0) findings.push({ id: "reduced-motion-loops", level: "improve", viewport: "phone", message: `${counted(phone.animations.infinite, "animation", "keeps", "keep")} looping with reduced motion on; ${allowed.has("marquee") ? "keep the requested marquee, but stop it under reduced motion and give it a pause control" : `stop ${phone.animations.infinite === 1 ? "it" : "them"}, or give anything that moves for more than 5 s a pause control`}.` });
  if (desktop.styles.transitionAll >= 5) findings.push({ id: "transition-all", level: "improve", viewport: "desktop", message: `transition: all is set on ${desktop.styles.transitionAll} elements; list the properties (transform, opacity, color) instead.` });
  if (desktop.styles.layoutKeyframes.length) findings.push({ id: "layout-animation", level: "improve", viewport: "desktop", message: `Keyframes animate layout properties (${list(desktop.styles.layoutKeyframes)}); animate transform and opacity instead.` });
  return findings;
}

function tellFindings(desktop: PageFacts, allowed: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const styles = desktop.styles;
  if (styles.violetGradients && !allowed.has("violet")) findings.push({ id: "violet-gradient", level: "note", viewport: "desktop", message: `Purple/indigo gradients on ${plural(styles.violetGradients, "element")}: the stock generated look unless the brand calls for it.` });
  if (styles.gradientText && !allowed.has("gradient-text") && !allowed.has("violet")) findings.push({ id: "gradient-text", level: "note", viewport: "desktop", message: `Gradient-filled text on ${plural(styles.gradientText, "element")}; solid ink reads better and can't be contrast-checked.` });
  if (styles.backdrop >= 3 && !allowed.has("glass")) findings.push({ id: "glass", level: "note", viewport: "desktop", message: `Glass (backdrop-filter) on ${styles.backdrop} large elements; keep it for one floating layer at most.` });
  if (styles.sameShadow >= 6) findings.push({ id: "card-kit", level: "note", viewport: "desktop", message: `The same shadow is on ${styles.sameShadow} elements (the card-kit look); let spacing, type and dividers do more of the grouping.` });
  if (styles.eyebrows >= 3 && !allowed.has("eyebrow")) findings.push({ id: "eyebrows", level: "note", viewport: "desktop", message: `${styles.eyebrows} headings have a tracked all-caps label above them; keep labels that carry information and drop the rest.` });
  if (styles.accentWords >= 2) findings.push({ id: "accent-words", level: "note", viewport: "desktop", message: `${styles.accentWords} headings set one word apart in color or italic, a template habit; let the sentence carry the emphasis.` });
  if (styles.emoji >= 2 && !allowed.has("emoji")) findings.push({ id: "emoji-icons", level: "note", viewport: "desktop", message: `Emoji are used as icons ${plural(styles.emoji, "time")}; use one consistent SVG icon set.` });
  if (desktop.copy.lorem) findings.push({ id: "lorem", level: "fix", viewport: "both", message: "Lorem ipsum is still on the page; write real, specific copy." });
  if (desktop.copy.placeholders.length) findings.push({ id: "placeholders", level: "improve", viewport: "both", message: `Placeholder names in the copy (${list(desktop.copy.placeholders)}); use specific, plausible content.` });
  if (desktop.copy.buzzwords.length >= 2) findings.push({ id: "buzzwords", level: "note", viewport: "both", message: `Filler words in the copy (${list(desktop.copy.buzzwords, 4)}); say what the product literally does.` });
  if (desktop.perf.cls > 0.1) findings.push({ id: "layout-shift", level: "improve", viewport: "desktop", message: `Cumulative layout shift is ${desktop.perf.cls}; reserve space for images and late content.` });
  if (desktop.perf.nodes > 2000) findings.push({ id: "dom-size", level: "note", viewport: "desktop", message: `${desktop.perf.nodes} DOM nodes; keep it under about 1,500.` });
  return findings;
}

const ORDER: Record<FindingLevel, number> = { fix: 0, improve: 1, note: 2 };

// ---- Untrusted input ---------------------------------------------------------

const str = (value: unknown, max = 120) => (typeof value === "string" ? value : value == null ? "" : String(value)).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
const num = (value: unknown, min = 0, max = 1e9) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0; };
const many = <T>(value: unknown, max: number, map: (item: any) => T): T[] => (Array.isArray(value) ? value.slice(0, max).map(map) : []);
const rgb = (value: unknown): Channel => { const parts = Array.isArray(value) ? value : []; return [num(parts[0], 0, 255), num(parts[1], 0, 255), num(parts[2], 0, 255)]; };

/**
 * The collector's result, rebuilt with every field type-checked and every string clipped. It
 * comes from the page's own JavaScript context, which can override String.prototype.slice and
 * defeat any cap applied in the page, and its strings reach the model.
 */
export function cleanFacts(raw: unknown): PageFacts {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const count = (value: unknown) => num(value, 0, 1e6);
  return {
    viewport: { width: num(f.viewport?.width, 0, 20_000), height: num(f.viewport?.height, 0, 20_000) },
    scrollWidth: count(f.scrollWidth),
    scrollHeight: count(f.scrollHeight),
    lang: str(f.lang, 20),
    title: str(f.title),
    viewportMeta: f.viewportMeta == null ? null : str(f.viewportMeta),
    headings: many(f.headings, 80, level => num(level, 1, 6)),
    landmarks: { main: count(f.landmarks?.main), header: count(f.landmarks?.header), nav: count(f.landmarks?.nav), footer: count(f.landmarks?.footer) },
    overflow: { px: count(f.overflow?.px), clipped: count(f.overflow?.clipped), offenders: many(f.overflow?.offenders, 4, item => ({ el: str(item?.el), right: count(item?.right) })) },
    text: many(f.text, 500, item => ({
      el: str(item?.el), tag: str(item?.tag, 16), chars: count(item?.chars), size: num(item?.size, 0, 2000), weight: num(item?.weight, 0, 1000),
      line: num(item?.line, 0, 4000), tracking: num(item?.tracking, -10, 10), upper: Boolean(item?.upper), family: str(item?.family, 60),
      color: [...rgb(item?.color), num(Array.isArray(item?.color) ? item.color[3] : 1, 0, 1)] as [number, number, number, number],
      bg: item?.bg == null ? null : many(item.bg, 8, rgb), estimated: Boolean(item?.estimated), cpl: item?.cpl == null ? null : count(item.cpl),
      heading: Boolean(item?.heading), height: count(item?.height),
    })),
    hidden: { count: count(f.hidden?.count), chars: count(f.hidden?.chars), samples: many(f.hidden?.samples, 3, item => str(item)) },
    controls: { total: count(f.controls?.total), unnamed: many(f.controls?.unnamed, 8, item => str(item)), small: many(f.controls?.small, 8, item => ({ el: str(item?.el), w: count(item?.w), h: count(item?.h) })), under44: count(f.controls?.under44), checked: count(f.controls?.checked) },
    focus: { checked: count(f.focus?.checked), missing: many(f.focus?.missing, 8, item => str(item)) },
    images: { total: count(f.images?.total), noAlt: many(f.images?.noAlt, 8, item => str(item)), broken: many(f.images?.broken, 8, item => str(item, 80)), unsized: count(f.images?.unsized) },
    fields: { total: count(f.fields?.total), unlabeled: many(f.fields?.unlabeled, 8, item => str(item)), smallFont: count(f.fields?.smallFont) },
    fonts: { families: many(f.fonts?.families, 8, item => ({ name: str(item?.name, 60), chars: count(item?.chars) })), loaded: many(f.fonts?.loaded, 12, item => str(item, 60)) },
    styles: {
      gradients: count(f.styles?.gradients), violetGradients: count(f.styles?.violetGradients), gradientText: count(f.styles?.gradientText), backdrop: count(f.styles?.backdrop),
      shadows: count(f.styles?.shadows), sameShadow: count(f.styles?.sameShadow), radii: count(f.styles?.radii), transitionAll: count(f.styles?.transitionAll),
      layoutKeyframes: many(f.styles?.layoutKeyframes, 6, item => str(item, 60)), reducedMotionRule: f.styles?.reducedMotionRule === null ? null : Boolean(f.styles?.reducedMotionRule),
      eyebrows: count(f.styles?.eyebrows), emoji: count(f.styles?.emoji), accentWords: count(f.styles?.accentWords),
    },
    animations: { running: count(f.animations?.running), infinite: count(f.animations?.infinite), longestMs: num(f.animations?.longestMs, 0, 1e9) },
    copy: { lorem: Boolean(f.copy?.lorem), buzzwords: many(f.copy?.buzzwords, 8, item => str(item, 30)), placeholders: many(f.copy?.placeholders, 6, item => str(item, 40)) },
    perf: { lcpMs: f.perf?.lcpMs == null ? null : num(f.perf.lcpMs, 0, 1e7), lcpEl: f.perf?.lcpEl == null ? null : str(f.perf.lcpEl), cls: num(f.perf?.cls, 0, 100), nodes: count(f.perf?.nodes) },
    errors: many(f.errors, 12, item => str(item, 160)),
  };
}

export function auditPage(desktopFacts: PageFacts | null, phoneFacts: PageFacts | null, opts: AuditOptions = {}): DesignAudit | null {
  if (!desktopFacts && !phoneFacts) return null;
  const allowed = new Set(opts.allowed ?? []);
  const stats: string[] = [];
  // Without desktop facts the phone pass is scored on its own, every finding labelled "phone".
  const desktop = (desktopFacts ?? phoneFacts)!;
  const phone = phoneFacts;
  const desktopFailing = failingContrast(desktop);
  // The phone pass reports the text the desktop pass didn't already flag.
  const flagged = new Set(desktopFailing.map(item => item.sample.el));
  const phoneFailing = desktopFacts && phoneFacts ? failingContrast(phoneFacts).filter(item => !flagged.has(item.sample.el)) : [];
  let findings = [
    ...layoutFindings(desktop, desktopFacts ? phone : null),
    ...contrastFinding(desktopFailing, desktopFacts ? (phone ? "desktop" : "both") : "phone"),
    ...contrastFinding(phoneFailing, "phone"),
    ...controlFindings(desktop, phone),
    ...typeFindings(desktop, phone, opts.surface, allowed, stats),
    ...motionFindings(desktop, phone, allowed),
    ...tellFindings(desktop, allowed),
  ];
  if (!desktopFacts) {
    const seen = new Set<string>();
    findings = findings.map(finding => (finding.viewport === "desktop" || finding.viewport === "both" ? { ...finding, id: finding.id.replace(/-desktop$/, "-phone"), viewport: "phone" as const } : finding))
      .filter(finding => { const key = `${finding.id.replace(/-(desktop|phone)$/, "")}|${finding.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  const rule = desktop.styles.reducedMotionRule;
  stats.push(`Surfaces: ${plural(desktop.styles.gradients, "gradient")}${desktop.styles.violetGradients ? ` (${desktop.styles.violetGradients} purple)` : ""}, ${plural(desktop.styles.shadows, "shadow")}, ${plural(desktop.styles.radii, "corner radius", "corner radii")}; reduced-motion rule: ${rule === null ? "not readable from linked stylesheets" : rule ? "yes" : "no"}.`);
  if (phoneFacts) stats.push(`Phone ${phoneFacts.viewport.width}×${phoneFacts.viewport.height}: ${phoneFacts.overflow.px > 1 ? `scrolls sideways by ${phoneFacts.overflow.px} px` : "no sideways scroll"}, ${plural(phoneFacts.controls.under44, "control")} under 44 px, page ${phoneFacts.scrollHeight} px tall.`);
  const problems = [...(desktopFacts?.errors ?? []).map(error => `desktop ${error}`), ...(phoneFacts?.errors ?? []).map(error => `phone ${error}`)];
  // Stable sort: by level, then in the order the checks run.
  findings.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return { findings, stats, measured: { desktop: Boolean(desktopFacts), phone: Boolean(phoneFacts) }, problems };
}

/** The audit as the model reads it: what was measured and any check that couldn't run first, then findings by level, within `max` characters. */
export function auditText(audit: DesignAudit, max = 1800) {
  const count = (level: FindingLevel) => audit.findings.filter(finding => finding.level === level).length;
  const { desktop, phone } = audit.measured;
  const scope = desktop && phone ? "desktop 1280×800, phone 390×844 with reduced motion" : desktop ? "desktop 1280×800 only; the phone pass did not run" : "phone 390×844 with reduced motion only; the desktop checks did not run";
  const lines = [`Design audit (${scope}): ${count("fix")} to fix, ${count("improve")} to improve, ${plural(count("note"), "note")}.`];
  if (audit.problems.length) lines.push(`(Some checks could not run: ${list(audit.problems, 2)}.)`);
  const labels: Record<FindingLevel, string> = { fix: "To fix", improve: "To improve", note: "Notes" };
  for (const level of ["fix", "improve", "note"] as FindingLevel[]) {
    const items = audit.findings.filter(finding => finding.level === level);
    if (!items.length) continue;
    lines.push(`${labels[level]}:`);
    for (const finding of items) lines.push(`- ${finding.viewport === "both" ? "" : `[${finding.viewport}] `}${finding.message}`);
  }
  lines.push(...audit.stats);
  let text = "";
  let cut = false;
  for (const [index, line] of lines.entries()) {
    if (text.length + line.length + 1 > max) { cut = index < lines.length - audit.stats.length; break; }
    text += (text ? "\n" : "") + line;
  }
  return cut ? `${text}\n(more findings omitted)` : text;
}

/** Findings marked "fix", in a few words each, for the harness's design check. */
export const blockingFindings = (audit: DesignAudit | null) => audit?.findings.filter(finding => finding.level === "fix") ?? [];
