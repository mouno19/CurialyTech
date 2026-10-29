import type { PageFacts, RGBA, TextSample } from "./types";

// Runs INSIDE the page (the cloud browser), never on this server. It must stay self-contained: no
// imports and no references to module scope, because it is sent as source text. It only reads
// the page (styles, geometry, the CSSOM) apart from scrolling through it once, briefly making text
// hit-testable, and moving focus over a few controls; it never touches storage (the preview's
// origin is opaque).
//
// It errs towards "can't tell" rather than a false finding: a backdrop it can't resolve leaves the
// text's contrast unscored. The scoring happens server-side in audit.ts.

export type CollectOptions = {
  /** Text elements to measure (largest first in the summary; the rest are skipped). */
  maxText: number;
  /** Controls whose focus style is checked by focusing them. */
  focusChecks: number;
  /** Milliseconds to wait at each scroll step. */
  stepMs: number;
};

export const COLLECT_DEFAULTS: CollectOptions = { maxText: 450, focusChecks: 14, stepMs: 110 };

export async function collectPageFacts(opts: CollectOptions): Promise<PageFacts> {
  const errors: string[] = [];
  const attempt = <T,>(label: string, fn: () => T, fallback: T): T => {
    try { return fn(); } catch (error) { errors.push(`${label}: ${String((error as Error)?.message ?? error).slice(0, 140)}`); return fallback; }
  };
  const attemptAsync = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (error) { errors.push(`${label}: ${String((error as Error)?.message ?? error).slice(0, 140)}`); }
  };
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  // Let time-based entrance transitions finish before measuring. Scroll-driven ones (view() or
  // scroll() timelines) never finish while the page is still, so they are not waited for.
  let settleBudget = 3000;
  const settleAnimations = async (ms: number) => {
    const pending = (document.getAnimations?.() ?? []).filter(animation => animation.playState === "running" && animation.timeline === document.timeline && animation.effect?.getTiming().iterations !== Infinity);
    const wait = Math.min(ms, settleBudget);
    if (!pending.length || wait <= 0) return;
    const started = performance.now();
    await Promise.race([Promise.allSettled(pending.map(animation => animation.finished)), sleep(wait)]);
    settleBudget -= performance.now() - started;
  };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = document.documentElement;
  const body = document.body ?? root;
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const css = (el: Element) => { let style = styleCache.get(el); if (!style) { style = getComputedStyle(el); styleCache.set(el, style); } return style; };
  const hasContent = (style: CSSStyleDeclaration) => style.content !== "none" && style.content !== "normal";
  // Whether an element paints a ::before/::after with a background (a band or scrim drawn in CSS).
  const pseudoPaint = new Map<Element, boolean>();
  const paintsPseudo = (el: Element) => {
    let paints = pseudoPaint.get(el);
    if (paints === undefined) {
      paints = (["::before", "::after"] as const).some(which => {
        const own = getComputedStyle(el, which);
        return hasContent(own) && (rgba(own.backgroundColor)[3] > 0 || own.backgroundImage !== "none");
      });
      pseudoPaint.set(el, paints);
    }
    return paints;
  };

  const cut = (value: unknown, n = 60) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > n ? `${text.slice(0, n - 1)}…` : text;
  };
  const describe = (el: Element) => {
    let out = el.tagName.toLowerCase();
    if (el.id) out += `#${el.id.slice(0, 30)}`;
    const classes = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (classes.length) out += `.${classes.map(name => name.slice(0, 24)).join(".")}`;
    const label = el.getAttribute("aria-label") || (el.childElementCount < 6 ? el.textContent : "");
    if (label && label.trim()) out += ` "${cut(label, 32)}"`;
    return out;
  };

  // ---- Colors: any CSS color syntax to 8-bit sRGB through a 1×1 canvas (rgb() takes a fast path).
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map<string, RGBA>();
  const rgba = (value: string): RGBA => {
    if (!value || value === "transparent" || value === "none") return [0, 0, 0, 0];
    const cached = colorCache.get(value);
    if (cached) return cached;
    let out: RGBA = [0, 0, 0, 0];
    const fast = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
    if (fast) {
      const alpha = fast[4] === undefined ? 1 : fast[5] ? Number(fast[4]) / 100 : Number(fast[4]);
      out = [Number(fast[1]), Number(fast[2]), Number(fast[3]), alpha];
    } else if (paint) {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = "rgba(0, 0, 0, 0)";
      paint.fillStyle = value;
      paint.fillRect(0, 0, 1, 1);
      const data = paint.getImageData(0, 0, 1, 1).data;
      out = [data[0], data[1], data[2], data[3] / 255];
    }
    colorCache.set(value, out);
    return out;
  };
  const over = (top: RGBA, under: [number, number, number]): [number, number, number] => [0, 1, 2].map(i => Math.round(top[i] * top[3] + under[i] * (1 - top[3]))) as [number, number, number];
  const COLOR_FN = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
  const gradientStops = (image: string) => (image.match(COLOR_FN) ?? []).slice(0, 8).map(rgba);
  const hueOf = ([r, g, b]: RGBA) => {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.0001) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h, s, l };
  };
  const violet = (color: RGBA) => { const { h, s, l } = hueOf(color); return color[3] > 0.2 && h >= 235 && h <= 305 && s >= 0.35 && l >= 0.2 && l <= 0.85; };

  // ---- Visibility and naming (ported from scripts/ui-check/probes.mjs).
  const shown = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const check = (el as HTMLElement).checkVisibility;
    if (typeof check === "function") return check.call(el, { opacityProperty: true, visibilityProperty: true });
    const style = css(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
  };
  const laidOut = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const check = (el as HTMLElement).checkVisibility;
    return typeof check === "function" ? check.call(el) : css(el).display !== "none";
  };
  const labelOf = (el: Element) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(node => (node as Element).textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return (el.getAttribute("aria-label") || "").trim();
  };
  const textOf = (node: Element): string => {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { out += child.textContent; continue; }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.getAttribute("aria-hidden") === "true") continue;
      const style = css(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // aria-label/aria-labelledby name any element, an <svg> or <img> included.
      const label = labelOf(element);
      const tag = element.tagName.toLowerCase();
      if (label) out += ` ${label} `;
      else if (tag === "img") out += ` ${element.getAttribute("alt") ?? element.getAttribute("title") ?? ""} `;
      else if (tag === "svg") out += ` ${element.querySelector("title")?.textContent ?? ""} `;
      else out += ` ${textOf(element)} `;
    }
    return out.replace(/\s+/g, " ").trim();
  };
  const FIELD = "input,select,textarea,[role=\"textbox\"],[role=\"combobox\"],[role=\"searchbox\"],[role=\"slider\"],[role=\"spinbutton\"]";
  const accName = (el: Element) => {
    const label = labelOf(el);
    if (label) return label;
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const text = Array.from(labels).map(node => textOf(node)).join(" ").trim();
      if (text) return text;
    }
    if (el instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(el.type)) return el.value.trim() || (el.type === "button" ? "" : el.type);
      if (el.type === "image") return (el.alt || "").trim();
    }
    if (!el.matches(FIELD)) {
      const text = textOf(el);
      if (text) return text;
    }
    return (el.getAttribute("title") || "").trim();
  };
  // The nearest ancestor that clips or scrolls the element (its overflow is contained, not the page's).
  const contained = (el: Element, rect: DOMRect) => {
    for (let node = el.parentElement; node && node !== body && node !== root; node = node.parentElement) {
      const style = css(node);
      if (style.overflowX !== "visible") {
        const outer = node.getBoundingClientRect();
        if (rect.left < outer.left - 2 || rect.right > outer.right + 2) return true;
      }
      if (style.position === "fixed") break;
    }
    return false;
  };
  const positioned = (el: Element, depth = 6) => {
    for (let node: Element | null = el, level = 0; node && level < depth; node = node.parentElement, level++) {
      const position = css(node).position;
      if (position === "absolute" || position === "fixed") return true;
    }
    return false;
  };
  // Regions a control says are collapsed (aria-expanded="false" with aria-controls).
  const collapsed = new Set<Element>();
  attempt("collapsed", () => {
    for (const control of Array.from(document.querySelectorAll("[aria-expanded=\"false\"][aria-controls]"))) {
      for (const id of (control.getAttribute("aria-controls") ?? "").split(/\s+/)) {
        const region = id ? document.getElementById(id) : null;
        if (region) collapsed.add(region);
      }
    }
  }, undefined);
  // An alternative state of one component, stacked in the same place: the other slides of a fade
  // carousel, the other panels of a tab set. The hidden layer has a shown sibling of the same kind
  // (same tag, a shared class or role) covering at least half of it.
  const stackedAlternative = (el: Element) => {
    let layer: Element | null = null;
    for (let node: Element | null = el; node && node !== body && node !== root; node = node.parentElement) {
      const style = css(node);
      if (Number(style.opacity) === 0 || (style.visibility === "hidden" && node.parentElement && css(node.parentElement).visibility !== "hidden")) { layer = node; break; }
    }
    const parent = layer?.parentElement;
    if (!layer || !parent) return false;
    const box = layer.getBoundingClientRect();
    const area = box.width * box.height;
    if (area < 1) return false;
    const classesOf = (node: Element) => (typeof (node as HTMLElement).className === "string" ? (node as HTMLElement).className.split(/\s+/).filter(Boolean) : []);
    const classes = new Set(classesOf(layer));
    const role = layer.getAttribute("role");
    return Array.from(parent.children).some(other => {
      if (other === layer || other.tagName !== layer!.tagName || !shown(other)) return false;
      if (!((role && other.getAttribute("role") === role) || classesOf(other).some(name => classes.has(name)))) return false;
      const rect = other.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.right, box.right) - Math.max(rect.left, box.left)) * Math.max(0, Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top));
      return overlap >= area / 2;
    });
  };
  /** Content that is meant to be out of sight: menus, dialogs, closed panels, inactive slides and tabs, clipped-away accordions. */
  const tucked = (el: Element) => {
    if (el.closest("nav,dialog,[role=\"dialog\"],[role=\"menu\"],[role=\"listbox\"],[role=\"tooltip\"],[role=\"tabpanel\"],[aria-roledescription],[aria-hidden=\"true\"],[hidden],details:not([open]),[inert]")) return true;
    for (const region of collapsed) if (region.contains(el)) return true;
    if (stackedAlternative(el)) return true;
    // An ancestor that clips its overflow down to nothing, or clear of the text (max-height: 0).
    const rect = el.getBoundingClientRect();
    for (let node = el.parentElement; node && node !== body && node !== root; node = node.parentElement) {
      const style = css(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return true;
      if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) return true;
      break;
    }
    return false;
  };

  // The element that scrolls the page: the window, or the largest inner scroller when the document
  // itself doesn't scroll (app shells, full-screen snap sections, a body that scrolls).
  let scroller: Element | null = null;
  attempt("scroller", () => {
    const scrolling = document.scrollingElement ?? root;
    if (scrolling.scrollHeight > vh + 1) return;
    let area = 0;
    for (const el of [body, ...Array.from(body.querySelectorAll("*")).slice(0, 4000)]) {
      if (el.scrollHeight <= el.clientHeight + 1 || !/(auto|scroll|overlay)/.test(css(el).overflowY)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height > area) { area = rect.width * rect.height; scroller = el; }
    }
  }, undefined);
  const scrollTop = (top: number) => (scroller ? (scroller as Element).scrollTo({ top, behavior: "instant" }) : window.scrollTo({ top, behavior: "instant" }));
  const scrollHeight = () => (scroller ? (scroller as Element).scrollHeight : root.scrollHeight);

  // ---- Document facts.
  const facts: PageFacts = {
    viewport: { width: vw, height: vh },
    scrollWidth: root.scrollWidth,
    scrollHeight: scrollHeight(),
    lang: root.getAttribute("lang") ?? "",
    title: document.title,
    viewportMeta: document.querySelector("meta[name=\"viewport\"]")?.getAttribute("content") ?? null,
    headings: [],
    landmarks: { main: 0, header: 0, nav: 0, footer: 0 },
    overflow: { px: 0, clipped: 0, offenders: [] },
    text: [],
    hidden: { count: 0, chars: 0, samples: [] },
    controls: { total: 0, unnamed: [], small: [], under44: 0, checked: 0 },
    focus: { checked: 0, missing: [] },
    images: { total: 0, noAlt: [], broken: [], unsized: 0 },
    fields: { total: 0, unlabeled: [], smallFont: 0 },
    fonts: { families: [], loaded: [] },
    styles: { gradients: 0, violetGradients: 0, gradientText: 0, backdrop: 0, shadows: 0, sameShadow: 0, radii: 0, transitionAll: 0, layoutKeyframes: [], reducedMotionRule: false, eyebrows: 0, emoji: 0, accentWords: 0 },
    animations: { running: 0, infinite: 0, longestMs: 0 },
    copy: { lorem: false, buzzwords: [], placeholders: [] },
    perf: { lcpMs: null, lcpEl: null, cls: 0, nodes: document.getElementsByTagName("*").length },
    errors,
  };

  attempt("structure", () => {
    facts.headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=\"heading\"]"))
      .filter(shown).slice(0, 80)
      .map(el => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : Number(el.getAttribute("aria-level") || 2)));
    facts.landmarks = {
      main: document.querySelectorAll("main,[role=\"main\"]").length,
      header: document.querySelectorAll("header,[role=\"banner\"]").length,
      nav: document.querySelectorAll("nav,[role=\"navigation\"]").length,
      footer: document.querySelectorAll("footer,[role=\"contentinfo\"]").length,
    };
  }, undefined);

  attempt("overflow", () => {
    const px = Math.max(0, root.scrollWidth - root.clientWidth);
    if (px <= 1) return;
    // overflow-x on html (or on body when html's is visible) applies to the viewport: hidden or
    // clip means the page can't scroll sideways; what sticks out is cut off instead.
    const viewportOverflow = css(root).overflowX !== "visible" ? css(root).overflowX : css(body).overflowX;
    if (viewportOverflow === "hidden" || viewportOverflow === "clip") facts.overflow.clipped = px;
    else facts.overflow.px = px;
    facts.overflow.offenders = Array.from(body.querySelectorAll("*")).slice(0, 4000)
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(item => item.rect.right > vw + 1 && item.rect.width > 0 && !contained(item.el, item.rect))
      .sort((a, b) => b.rect.right - a.rect.right).slice(0, 4)
      .map(item => ({ el: describe(item.el), right: Math.round(item.rect.right) }));
  }, undefined);

  // ---- Text: measured while scrolling, where hit testing sees what is really painted under it.
  const candidates: Element[] = [];
  attempt("text-walk", () => {
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && candidates.length < 2000; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent?.trim()) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|TITLE)$/.test(el.tagName) || el instanceof SVGElement) continue;
      seen.add(el);
      candidates.push(el);
    }
  }, undefined);
  const ownText = (el: Element) => Array.from(el.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent ?? "").join("").replace(/\s+/g, " ").trim();

  // Layers that paint but are invisible to hit testing (pointer-events: none): a fixed WebGL
  // canvas, a background video, a decorative scrim. Text over one of them can't be scored from styles.
  const MEDIA = /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|SVG|OBJECT|EMBED)$/;
  const ghosts: Element[] = [];
  attempt("ghost-layers", () => {
    for (const el of Array.from(body.querySelectorAll("*")).slice(0, 5000)) {
      const style = css(el);
      if (style.pointerEvents !== "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < 4000) continue;
      if (MEDIA.test(el.tagName.toUpperCase()) || style.backgroundImage !== "none" || rgba(style.backgroundColor)[3] > 0 || style.filter !== "none") ghosts.push(el);
      if (ghosts.length >= 40) break;
    }
  }, undefined);

  /**
   * What is painted under the text, bottom layer first, as one color or one per gradient stop. null
   * when it can't be known from styles: an image, video or canvas, a filter or blend mode, a
   * painted ::before/::after, or (with no opaque layer at all) a dark canvas.
   */
  const composite = (layers: Element[], text: Element): [number, number, number][] | null => {
    const white: [number, number, number] = [255, 255, 255];
    let candidates: [number, number, number][] | null = null;
    let unknown = false;
    for (const node of layers) {
      const style = css(node);
      if (style.mixBlendMode !== "normal" || (node !== text && style.filter !== "none") || (style.backdropFilter && style.backdropFilter !== "none")) unknown = true;
      // An element's opacity applies to its background too.
      const opacity = Number(style.opacity || 1);
      const color = rgba(style.backgroundColor);
      const alpha = color[3] * opacity;
      if (alpha >= 0.999) { candidates = [[color[0], color[1], color[2]]]; unknown = false; }
      else if (alpha > 0) candidates = (candidates ?? [white]).map((below): [number, number, number] => over([color[0], color[1], color[2], alpha], below));
      const image = style.backgroundImage;
      if (MEDIA.test(node.tagName.toUpperCase())) unknown = true;
      else if (image && image !== "none") {
        const stops = /url\(/.test(image) || !/gradient\(/.test(image) ? [] : gradientStops(image);
        if (!stops.length) unknown = true;
        else {
          const base: [number, number, number] = (candidates ?? [white])[0];
          candidates = stops.map((stop): [number, number, number] => over([stop[0], stop[1], stop[2], stop[3] * opacity], base));
          if (opacity >= 0.999 && stops.every(stop => stop[3] >= 0.999)) unknown = false;
        }
      }
      // A painted pseudo-element (a band or scrim drawn with ::before) is a layer styles can't place.
      if (node !== text && paintsPseudo(node)) unknown = true;
    }
    if (unknown) return null;
    if (candidates) return candidates;
    // Nothing opaque behind the text: the canvas, which is dark under a dark color scheme.
    return /dark/.test(css(root).colorScheme) && !/light/.test(css(root).colorScheme) ? null : [white];
  };
  // A point on the element's own text: the middle of the first line box of its first text node
  // (the middle of a wrapped inline span can fall between its lines).
  const textPoint = (el: Element) => {
    const node = Array.from(el.childNodes).find(child => child.nodeType === 3 && (child.textContent ?? "").trim());
    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const line = Array.from(range.getClientRects()).find(rect => rect.width > 1 && rect.height > 1);
      if (line) return { x: line.left + Math.min(line.width, 200) / 2, y: line.top + line.height / 2 };
    }
    const rect = el.getBoundingClientRect();
    return { x: rect.left + Math.min(rect.width, 400) / 2, y: rect.top + rect.height / 2 };
  };
  /** The backdrop behind the text, by hit testing at its text point (null: unknown). */
  const covers = (ghost: Element, x: number, y: number) => {
    const box = ghost.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  };
  const backdrop = (el: Element, x: number, y: number) => {
    if (ghosts.some(ghost => !ghost.contains(el) && !el.contains(ghost) && covers(ghost, x, y))) return null;
    // Elements with pointer-events: none are invisible to hit testing, so the text is made
    // hit-testable for this one call.
    const own = el instanceof HTMLElement && css(el).pointerEvents === "none" ? el.style : null;
    const saved = own ? [own.getPropertyValue("pointer-events"), own.getPropertyPriority("pointer-events")] : null;
    own?.setProperty("pointer-events", "auto", "important");
    const stack = document.elementsFromPoint(x, y);
    if (own && saved) {
      if (saved[0]) own.setProperty("pointer-events", saved[0], saved[1]);
      else own.removeProperty("pointer-events");
    }
    const index = stack.indexOf(el);
    return index >= 0 ? composite([...stack.slice(index + 1).reverse(), el], el) : null;
  };
  const opacityChain = (el: Element) => {
    let alpha = 1;
    for (let node: Element | null = el; node && alpha > 0; node = node.parentElement) alpha *= Number(css(node).opacity || 1);
    return alpha;
  };
  const sampleOf = (el: Element, bg: [number, number, number][] | null, faded: boolean): TextSample => {
    const style = css(el);
    const size = parseFloat(style.fontSize) || 16;
    const color = rgba(style.color);
    const fg: RGBA = [color[0], color[1], color[2], color[3] * opacityChain(el)];
    const clipText = style.backgroundClip === "text" || (style as unknown as Record<string, string>).webkitBackgroundClip === "text";
    const tag = el.tagName.toLowerCase();
    let cpl: number | null = null;
    if (/^(p|li|blockquote|dd|figcaption)$/.test(tag)) {
      const full = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (full.length >= 120) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 4).map(rect => Math.round(rect.top)));
        if (tops.size >= 2) cpl = Math.round(full.length / tops.size);
      }
    }
    const own = ownText(el);
    return {
      el: describe(el),
      tag,
      chars: own.length,
      size: Math.round(size * 10) / 10,
      weight: Number(style.fontWeight) || 400,
      line: style.lineHeight === "normal" ? 0 : parseFloat(style.lineHeight) || 0,
      tracking: style.letterSpacing === "normal" ? 0 : Math.round(((parseFloat(style.letterSpacing) || 0) / size) * 1000) / 1000,
      upper: style.textTransform === "uppercase" || (own.length >= 4 && own === own.toUpperCase() && /[A-Z]/.test(own)),
      family: (style.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim(),
      color: fg,
      // Gradient-filled text has no single color to compare.
      bg: clipText ? null : bg,
      // Still partly transparent where it was seen (maybe fading in): only clear failures count.
      estimated: faded,
      cpl,
      heading: /^h[1-6]$/.test(tag) || el.getAttribute("role") === "heading" || Boolean(el.closest("h1,h2,h3,h4,h5,h6")),
      height: Math.round(el.getBoundingClientRect().height),
    };
  };

  // Each text element is looked at when it is well into view (its first line in the top 65% of
  // the screen, or wherever it is on the last screen), at most twice: a reveal that hasn't finished
  // gets a second look one step later. Text never seen opaque is reported by its best sighting.
  type Sighting = { sample: TextSample | null; hidden: boolean; looks: number };
  const sightings = new Map<Element, Sighting>();
  const done = new Set<Element>();
  const look = (el: Element, x: number, y: number) => {
    const chars = ownText(el).length;
    const seen = sightings.get(el) ?? { sample: null, hidden: false, looks: 0 };
    seen.looks++;
    sightings.set(el, seen);
    if (!chars || el.closest(":disabled,[aria-disabled=\"true\"]")) { done.add(el); return; }
    if (!shown(el)) {
      if (!seen.sample) seen.hidden = laidOut(el) && !tucked(el) && !positioned(el) && chars >= 20;
      if (seen.looks >= 3) done.add(el);
      return;
    }
    const faded = opacityChain(el) < 0.9;
    if (!seen.sample || seen.sample.estimated) {
      seen.sample = sampleOf(el, backdrop(el, x, y), faded);
      seen.hidden = false;
    }
    if (!faded || seen.looks >= 2) done.add(el);
  };

  // "instant": many pages set scroll-behavior: smooth, which would leave every measurement mid-scroll.
  await attemptAsync("scroll", async () => {
    await document.fonts?.ready;
    const step = Math.max(240, Math.round(vh * 0.6));
    const height = Math.min(scrollHeight(), 40_000);
    const stops: number[] = [];
    for (let y = 0; y < height && stops.length < 28; y += step) stops.push(y);
    for (const [index, y] of stops.entries()) {
      const last = index === stops.length - 1;
      scrollTop(y);
      await frame();
      await sleep(opts.stepMs);
      await settleAnimations(900);
      for (const el of candidates) {
        if (done.has(el) || sightings.size >= opts.maxText * 2) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) continue;
        const { x, y: top } = textPoint(el);
        if (x < 0 || x >= vw || top < 0 || top >= vh || (!last && top > vh * 0.65)) continue;
        attempt("measure", () => look(el, x, top), undefined);
      }
    }
    // A reveal still under way (or driven by script, which getAnimations can't see) gets one more
    // look at the middle of the screen before its text counts as hidden or faded.
    const unsettled = Array.from(sightings).filter(([el, seen]) => !done.has(el) || (seen.hidden && !seen.sample)).slice(0, 12);
    for (const [el] of unsettled) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      await frame();
      await sleep(250);
      await settleAnimations(600);
      const { x, y: top } = textPoint(el);
      if (x >= 0 && x < vw && top >= 0 && top < vh) attempt("measure", () => look(el, x, top), undefined);
    }
    scrollTop(0);
    await frame();
  });
  for (const [el, seen] of sightings) {
    if (seen.sample && facts.text.length < opts.maxText) facts.text.push(seen.sample);
    else if (!seen.sample && seen.hidden) {
      facts.hidden.count++;
      facts.hidden.chars += ownText(el).length;
      if (facts.hidden.samples.length < 3) facts.hidden.samples.push(describe(el));
    }
  }
  // Text never in view (inside side scrollers, fixed layers, past the last stop): its type is
  // measured, its contrast is not.
  attempt("unseen-text", () => {
    for (const el of candidates) {
      if (sightings.has(el) || facts.text.length >= opts.maxText) continue;
      if (shown(el) && ownText(el) && !el.closest(":disabled,[aria-disabled=\"true\"]")) facts.text.push(sampleOf(el, null, true));
    }
  }, undefined);

  // ---- Fonts.
  attempt("fonts", () => {
    const families = new Map<string, number>();
    for (const sample of facts.text) families.set(sample.family, (families.get(sample.family) ?? 0) + sample.chars);
    facts.fonts.families = Array.from(families.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, chars]) => ({ name, chars }));
    const loaded = new Set<string>();
    document.fonts?.forEach(face => { if (face.status === "loaded") loaded.add(face.family.replace(/["']/g, "")); });
    facts.fonts.loaded = Array.from(loaded).slice(0, 12);
  }, undefined);

  // ---- Controls, targets, names.
  attempt("controls", () => {
    const selector = "a[href],button,input:not([type=\"hidden\"]),select,textarea,summary,[role=\"button\"],[role=\"link\"],[role=\"tab\"],[role=\"checkbox\"],[role=\"radio\"],[role=\"switch\"],[role=\"menuitem\"],[role=\"option\"],[tabindex]:not([tabindex=\"-1\"])";
    const controls = Array.from(document.querySelectorAll(selector)).filter(el => !el.closest("[aria-hidden=\"true\"],[inert]") && shown(el)).slice(0, 400);
    facts.controls.total = controls.length;
    const inlineLink = (el: Element) => el.tagName === "A" && css(el).display === "inline" && Array.from(el.parentElement?.childNodes ?? []).some(node => node !== el && node.nodeType === 3 && (node.textContent ?? "").trim());
    // The hit area includes an absolutely positioned ::before/::after (a common way to enlarge it).
    const target = (el: Element) => {
      const rect = el.getBoundingClientRect();
      let width = rect.width;
      let height = rect.height;
      for (const which of ["::before", "::after"] as const) {
        const own = getComputedStyle(el, which);
        if (!hasContent(own) || (own.position !== "absolute" && own.position !== "fixed") || own.pointerEvents === "none") continue;
        width = Math.max(width, parseFloat(own.width) || 0);
        height = Math.max(height, parseFloat(own.height) || 0);
      }
      return { rect, width, height };
    };
    const boxes = controls.map(target);
    const small: number[] = [];
    controls.forEach((el, index) => {
      const { width, height } = boxes[index];
      if (!accName(el) && facts.controls.unnamed.length < 8) facts.controls.unnamed.push(describe(el));
      if (inlineLink(el) || (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) && el.labels?.length)) return;
      if (width < 44 || height < 44) facts.controls.under44++;
      if (width < 24 || height < 24) small.push(index);
    });
    // WCAG 2.5.8 spacing exception: an undersized target passes when a 24 px circle on its centre
    // touches no other target (and no other undersized target's circle).
    const distance = (x: number, y: number, rect: DOMRect) => Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
    for (const index of small) {
      const { rect, width, height } = boxes[index];
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const crowded = boxes.some((other, j) => j !== index && (distance(cx, cy, other.rect) < 12 || (small.includes(j) && Math.hypot(cx - (other.rect.left + other.rect.width / 2), cy - (other.rect.top + other.rect.height / 2)) < 24)));
      if (crowded && facts.controls.small.length < 8) facts.controls.small.push({ el: describe(controls[index]), w: Math.round(width), h: Math.round(height) });
    }
    facts.controls.checked = controls.length;
  }, undefined);

  // ---- Images and fields.
  attempt("media", () => {
    const images = Array.from(document.images).filter(img => laidOut(img));
    facts.images.total = images.length;
    for (const img of images) {
      const decorative = img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true" || img.closest("[aria-hidden=\"true\"]");
      const named = img.hasAttribute("alt") || Boolean(labelOf(img)) || Boolean(img.getAttribute("title"));
      if (!named && !decorative && facts.images.noAlt.length < 8) facts.images.noAlt.push(describe(img));
      if (img.complete && img.naturalWidth === 0 && (img.currentSrc || img.getAttribute("src")) && facts.images.broken.length < 8) facts.images.broken.push(cut(img.getAttribute("src"), 80));
      if (!img.getAttribute("width") && !img.getAttribute("height") && css(img).aspectRatio === "auto") facts.images.unsized++;
    }
    for (const el of Array.from(document.querySelectorAll("[role=\"img\"]"))) {
      if (shown(el) && !accName(el) && facts.images.noAlt.length < 8) facts.images.noAlt.push(describe(el));
    }
    const fields = Array.from(document.querySelectorAll("input:not([type=\"hidden\"]):not([type=\"submit\"]):not([type=\"button\"]):not([type=\"reset\"]):not([type=\"image\"]),select,textarea")).filter(shown);
    facts.fields.total = fields.length;
    for (const field of fields) {
      if (!accName(field) && facts.fields.unlabeled.length < 8) facts.fields.unlabeled.push(describe(field));
      const type = (field as HTMLInputElement).type;
      if (!["checkbox", "radio", "range", "color", "file"].includes(type) && (parseFloat(css(field).fontSize) || 16) < 16) facts.fields.smallFont++;
    }
  }, undefined);

  // ---- Styles: the signatures of generated templates, and motion hygiene.
  attempt("styles", () => {
    const shadows = new Map<string, number>();
    const radii = new Set<string>();
    const all = Array.from(body.querySelectorAll("*")).slice(0, 5000);
    for (const el of all) {
      const style = css(el);
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 1) continue;
      if (style.backgroundImage.includes("gradient(")) {
        facts.styles.gradients++;
        if (area > 2000 && gradientStops(style.backgroundImage).some(violet)) facts.styles.violetGradients++;
      }
      if (style.backgroundClip === "text" || (style as unknown as Record<string, string>).webkitBackgroundClip === "text") facts.styles.gradientText++;
      const blur = style.backdropFilter || (style as unknown as Record<string, string>).webkitBackdropFilter;
      if (blur && blur !== "none" && area > 20_000) facts.styles.backdrop++;
      if (style.boxShadow !== "none") {
        facts.styles.shadows++;
        shadows.set(style.boxShadow, (shadows.get(style.boxShadow) ?? 0) + 1);
      }
      if (style.borderRadius !== "0px" && (style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.borderStyle !== "none")) radii.add(style.borderRadius);
      const durations = style.transitionDuration.split(",").map(value => parseFloat(value) || 0);
      if (style.transitionProperty.split(",").map(value => value.trim()).includes("all") && durations.some(value => value > 0)) facts.styles.transitionAll++;
    }
    facts.styles.sameShadow = Math.max(0, ...Array.from(shadows.values()));
    facts.styles.radii = radii.size;
    // Eyebrows: a short tracked all-caps label directly above a heading.
    for (const heading of Array.from(document.querySelectorAll("h1,h2,h3"))) {
      const previous = heading.previousElementSibling;
      if (!previous || !shown(previous)) continue;
      const text = (previous.textContent ?? "").trim();
      const style = css(previous);
      const size = parseFloat(style.fontSize) || 16;
      const caps = style.textTransform === "uppercase" || (text.length >= 3 && text === text.toUpperCase() && /[A-Z]/.test(text));
      if (caps && text.length <= 60 && size <= 15 && (parseFloat(style.letterSpacing) || 0) / size >= 0.05) facts.styles.eyebrows++;
    }
    // One word set apart in a headline (a different color or italic).
    for (const heading of Array.from(document.querySelectorAll("h1,h2,h3"))) {
      const headingStyle = css(heading);
      const accents = Array.from(heading.querySelectorAll("span,em,i,mark,strong,b")).filter(child => {
        const words = (child.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
        const own = css(child);
        return words >= 1 && words <= 3 && (own.color !== headingStyle.color || (own.fontStyle === "italic" && headingStyle.fontStyle !== "italic") || own.backgroundClip === "text");
      });
      if (accents.length) facts.styles.accentWords++;
    }
    // Emoji that render as pictures by default (not ©, ™, ★ or arrows, which are text symbols).
    const pictograph = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
    for (const el of Array.from(body.querySelectorAll("span,i,div,li,button,a,h1,h2,h3,h4,p,strong"))) {
      if (el.childElementCount > 2) continue;
      const text = (el.textContent ?? "").trim();
      if (!text || !pictograph.test(text)) continue;
      const iconOnly = text.length <= 4 && !/[a-z0-9]/i.test(text);
      const leading = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)/u.test(text) && /^(LI|BUTTON|A|H1|H2|H3|H4|P|STRONG)$/.test(el.tagName);
      if ((iconOnly || leading) && shown(el)) facts.styles.emoji++;
    }
    // CSSOM: reduced-motion rules and keyframes that animate layout properties. Linked sheets are
    // unreadable from the preview's opaque origin; then "no rule found" means "can't tell".
    const LAYOUT_PROPS = /^(width|height|top|left|right|bottom|margin|padding|min-|max-|inset)/;
    let found = false;
    let unreadable = 0;
    const walk = (rules: CSSRuleList, depth: number) => {
      if (depth > 6) return;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule && /prefers-reduced-motion/.test(rule.conditionText ?? rule.media.mediaText)) found = true;
        if (rule instanceof CSSKeyframesRule) {
          const props = new Set<string>();
          for (const frame of Array.from(rule.cssRules) as CSSKeyframeRule[]) for (let i = 0; i < frame.style.length; i++) props.add(frame.style[i]);
          if (Array.from(props).some(prop => LAYOUT_PROPS.test(prop)) && facts.styles.layoutKeyframes.length < 6) facts.styles.layoutKeyframes.push(rule.name);
        }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested && !(rule instanceof CSSKeyframesRule)) walk(nested, depth + 1);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try { walk(sheet.cssRules, 0); } catch { unreadable++; }
    }
    if (!found) found = Array.from(document.querySelectorAll("script")).some(script => /prefers-reduced-motion/.test(script.textContent ?? ""));
    facts.styles.reducedMotionRule = found ? true : unreadable ? null : false;
  }, undefined);

  attempt("animations", () => {
    for (const animation of document.getAnimations?.() ?? []) {
      if (animation.playState !== "running") continue;
      facts.animations.running++;
      const timing = animation.effect?.getTiming();
      if (timing?.iterations === Infinity) facts.animations.infinite++;
      const duration = typeof timing?.duration === "number" ? timing.duration : 0;
      facts.animations.longestMs = Math.max(facts.animations.longestMs, duration);
    }
  }, undefined);

  attempt("copy", () => {
    const text = ((body as HTMLElement).innerText ?? "").slice(0, 80_000);
    facts.copy.lorem = /lorem ipsum|dolor sit amet/i.test(text);
    const buzz = ["unlock", "elevate", "supercharge", "seamless", "seamlessly", "effortless", "effortlessly", "revolutionize", "revolutionise", "next-gen", "cutting-edge", "world-class", "game-changing", "game changer", "empower", "unleash", "synergy", "best-in-class"];
    facts.copy.buzzwords = buzz.filter(word => new RegExp(`\\b${word}\\b`, "i").test(text)).slice(0, 8);
    facts.copy.placeholders = ["John Doe", "Jane Doe", "Acme", "Your Name", "Company Name", "example@example.com", "Feature One", "Feature 1"].filter(word => text.includes(word)).slice(0, 6);
  }, undefined);

  // ---- Focus, last: focusing can run the page's own handlers (a menu that opens on focus), so
  // nothing is measured after it except timing entries. A focus ring can sit on the control, on
  // its parent (:focus-within) or on a pseudo-element, and transitions started by the focus are
  // finished before reading, so `transition: all` doesn't hide the ring's end state.
  attempt("focus", () => {
    const focusables = Array.from(document.querySelectorAll("a[href],button,input:not([type=\"hidden\"]),select,textarea,[tabindex]:not([tabindex=\"-1\"])"))
      .filter(el => !el.closest("[aria-hidden=\"true\"],[inert]") && shown(el) && !(el as HTMLButtonElement).disabled)
      .slice(0, opts.focusChecks) as HTMLElement[];
    const ring = (style: CSSStyleDeclaration) => (style.outlineStyle === "none" || parseFloat(style.outlineWidth) === 0 ? "" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`);
    const lookOf = (el: Element) => {
      const own = getComputedStyle(el);
      const parts = [ring(own), own.boxShadow, own.borderColor, own.backgroundColor, own.color, own.textDecorationLine];
      for (const which of ["::before", "::after"] as const) {
        const style = getComputedStyle(el, which);
        if (hasContent(style)) parts.push(ring(style), style.boxShadow, style.borderColor, style.backgroundColor, style.opacity);
      }
      const parent = el.parentElement;
      if (parent) { const style = getComputedStyle(parent); parts.push(ring(style), style.boxShadow); }
      return parts.join("|");
    };
    const finishTransitions = () => {
      for (const animation of document.getAnimations?.() ?? []) if (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition) animation.finish();
    };
    for (const el of focusables) {
      const before = lookOf(el);
      el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
      if (document.activeElement !== el) continue;
      finishTransitions();
      facts.focus.checked++;
      const outlined = Boolean(ring(getComputedStyle(el)));
      if (!outlined && before === lookOf(el) && facts.focus.missing.length < 8) facts.focus.missing.push(describe(el));
      el.blur();
      finishTransitions();
    }
  }, undefined);

  await attemptAsync("perf", async () => {
    const entries = (type: string) => new Promise<PerformanceEntry[]>(resolve => {
      try {
        const found: PerformanceEntry[] = [];
        const observer = new PerformanceObserver(list => { found.push(...list.getEntries()); });
        observer.observe({ type, buffered: true } as PerformanceObserverInit);
        setTimeout(() => { observer.disconnect(); resolve(found); }, 60);
      } catch { resolve([]); }
    });
    const lcp = (await entries("largest-contentful-paint")).at(-1) as (PerformanceEntry & { element?: Element; startTime: number }) | undefined;
    if (lcp) { facts.perf.lcpMs = Math.round(lcp.startTime); facts.perf.lcpEl = lcp.element ? describe(lcp.element) : null; }
    facts.perf.cls = Math.round((await entries("layout-shift")).reduce((sum, entry) => sum + ((entry as unknown as { hadRecentInput: boolean }).hadRecentInput ? 0 : (entry as unknown as { value: number }).value), 0) * 1000) / 1000;
  });

  return facts;
}

/**
 * Source text for page.evaluate. Sent as a string (with a no-op __name, which some TypeScript
 * runners inject around functions) so it runs the same from the bundle, tests and scripts.
 */
export function collectorScript(opts: CollectOptions = COLLECT_DEFAULTS) {
  return `(() => { const __name = (fn) => fn; return (${collectPageFacts.toString()})(${JSON.stringify(opts)}); })()`;
}
