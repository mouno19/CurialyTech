// Code that runs inside the page. Each export is serialised by Playwright (page.evaluate /
// addInitScript), so it must be self-contained: no imports, no closure over module scope.

/**
 * Installs window.__uiCheck (idempotent): facts(), focusStep(), focusFinish(), motion(), menu().
 * Evaluate it once per document before calling the probes.
 */
export function installProbes() {
  if (window.__uiCheck) return;
  const INTERACTIVE = [
    "a[href]", "button", "input:not([type=\"hidden\"])", "select", "textarea", "summary",
    "[role=\"button\"]", "[role=\"link\"]", "[role=\"tab\"]", "[role=\"menuitem\"]", "[role=\"menuitemradio\"]", "[role=\"menuitemcheckbox\"]",
    "[role=\"checkbox\"]", "[role=\"radio\"]", "[role=\"switch\"]", "[role=\"option\"]", "[role=\"combobox\"]", "[role=\"textbox\"]",
    "[role=\"searchbox\"]", "[role=\"slider\"]", "[role=\"spinbutton\"]", "[role=\"treeitem\"]",
  ].join(",");
  // Floating layers (portalled menus, popovers, dialogs, tooltips) must fit the viewport vertically too.
  const LAYER = "[data-radix-popper-content-wrapper],[role=\"menu\"],[role=\"listbox\"],[role=\"dialog\"],[role=\"alertdialog\"],[role=\"tooltip\"]";
  const FIELD = "input,select,textarea,[role=\"textbox\"],[role=\"combobox\"],[role=\"searchbox\"],[role=\"slider\"],[role=\"spinbutton\"]";

  const cut = (value, n = 90) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > n ? `${text.slice(0, n - 1)}…` : text;
  };
  const describe = el => {
    if (!el || el.nodeType !== 1) return String(el && el.nodeName ? el.nodeName : el);
    let out = el.tagName.toLowerCase();
    if (el.id) out += `#${el.id}`;
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (classes.length) out += `.${classes.join(".")}`;
    const role = el.getAttribute("role");
    if (role) out += `[role=${role}]`;
    const name = el.getAttribute("aria-label") || el.getAttribute("title") || (el.childElementCount < 8 ? el.textContent : "");
    if (name && name.trim()) out += ` "${cut(name, 48)}"`;
    return out;
  };
  const box = el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
  };

  // Accessible name, approximated the way the spec lists it: aria-labelledby, aria-label, <label>,
  // content (text, img alt, svg <title>), title. A placeholder is not a name.
  const textOf = (node, includeHidden) => {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.textContent;
        continue;
      }
      if (child.nodeType !== 1 || child.getAttribute("aria-hidden") === "true") continue;
      if (!includeHidden) {
        const style = getComputedStyle(child);
        if (style.display === "none" || style.visibility === "hidden") continue;
      }
      const tag = child.tagName.toLowerCase();
      if (tag === "img") out += ` ${child.getAttribute("alt") ?? ""} `;
      else if (tag === "svg") out += ` ${child.querySelector("title")?.textContent ?? ""} `;
      else if (child.getAttribute("aria-label")) out += ` ${child.getAttribute("aria-label")} `;
      else out += ` ${textOf(child, includeHidden)} `;
    }
    return out.replace(/\s+/g, " ").trim();
  };
  const accName = el => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(node => textOf(node, true) || node.getAttribute("aria-label") || "").join(" ").trim();
      if (text) return text;
    }
    const label = (el.getAttribute("aria-label") || "").trim();
    if (label) return label;
    if (el.labels && el.labels.length) {
      const text = [...el.labels].map(node => textOf(node, false)).join(" ").trim();
      if (text) return text;
    }
    if (el instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(el.type)) return el.value.trim() || (el.type === "button" ? "" : el.type);
      if (el.type === "image") return (el.alt || "").trim();
    }
    if (!el.matches(FIELD)) {
      const text = textOf(el, false);
      if (text) return text;
    }
    return (el.getAttribute("title") || "").trim();
  };

  // The nearest ancestor that cuts the element off: "scroll" (reachable by scrolling) or "clip".
  const container = (el, r) => {
    for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const p = node.getBoundingClientRect();
        const outX = r.left < p.left - 2 || r.right > p.right + 2;
        const outY = r.top < p.top - 2 || r.bottom > p.bottom + 2;
        if ((outX && /auto|scroll/.test(style.overflowX)) || (outY && /auto|scroll/.test(style.overflowY))) return { kind: "scroll", node, rect: p };
        if ((outX && /hidden|clip/.test(style.overflowX)) || (outY && /hidden|clip/.test(style.overflowY))) return { kind: "clip", node, rect: p };
      }
      if (style.position === "fixed") break;
    }
    return null;
  };
  // Deliberately parked off-screen until focused (skip links, closed drawers): positioned and fully outside.
  const parked = el => {
    for (let node = el, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
      const position = getComputedStyle(node).position;
      if (position === "absolute" || position === "fixed") return true;
    }
    return false;
  };
  const inlineLink = el => el.tagName === "A" && getComputedStyle(el).display === "inline" && [...(el.parentElement?.childNodes ?? [])].some(node => node !== el && node.nodeType === 3 && node.textContent.trim());

  async function facts(opts) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const root = document.documentElement;
    const out = { url: location.pathname + location.search, title: document.title, vw, vh };

    // Document horizontal overflow (the user can scroll the whole page sideways).
    const px = Math.max(0, root.scrollWidth - root.clientWidth, root.scrollWidth - vw);
    out.overflow = { px, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, innerWidth: vw, bodyScrollWidth: document.body.scrollWidth };
    if (px > 1) {
      out.overflow.widest = [...document.body.querySelectorAll("*")]
        .map(el => ({ el, right: el.getBoundingClientRect().right }))
        .filter(item => item.right > vw + 1 && !container(item.el, item.el.getBoundingClientRect()))
        .sort((a, b) => b.right - a.right).slice(0, 5)
        .map(item => ({ el: describe(item.el), right: Math.round(item.right) }));
    }

    // Controls: outside the viewport, clipped, unnamed, small touch targets.
    const controls = [...document.querySelectorAll(INTERACTIVE)].filter(el => !el.closest("[aria-hidden=\"true\"],[inert]") && visible(el));
    out.controls = controls.length;
    out.offscreen = [];
    out.clipped = [];
    out.parked = [];
    out.unnamed = [];
    out.touch = [];
    out.scrollable = 0;
    for (const el of controls) {
      if (!accName(el)) out.unnamed.push({ el: describe(el), html: cut(el.outerHTML, 180) });
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) continue; // visually hidden (sr-only) controls
      const layer = el.closest(LAYER);
      const outX = r.left < -1 || r.right > vw + 1;
      const outY = Boolean(layer) && (r.top < -1 || r.bottom > vh + 1);
      const holder = container(el, r);
      if (outX || outY) {
        const gone = r.right <= 0 || r.left >= vw || (outY && (r.bottom <= 0 || r.top >= vh));
        const scrollerInView = holder && holder.kind === "scroll" && (!outX || (holder.rect.left >= -1 && holder.rect.right <= vw + 1)) && (!outY || (holder.rect.top >= -1 && holder.rect.bottom <= vh + 1));
        if (scrollerInView) out.scrollable++;
        else if (gone && parked(el)) out.parked.push(describe(el));
        else out.offscreen.push({ el: describe(el), box: box(el), vw, vh, by: holder ? `${holder.kind} ${describe(holder.node)}` : null });
      } else if (holder && holder.kind === "clip") {
        out.clipped.push({ el: describe(el), box: box(el), by: describe(holder.node) });
      }
      const disabled = el.disabled || el.getAttribute("aria-disabled") === "true";
      if (opts.phone && !outX && !disabled && (r.width < opts.touchMin - 0.5 || r.height < opts.touchMin - 0.5) && !inlineLink(el)) out.touch.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
    }

    // Images: missing alt, and broken ones (a broken-image icon is never an acceptable state).
    const images = [...document.images];
    out.imgNoAlt = images.filter(img => !img.hasAttribute("alt")).map(img => ({ el: describe(img), src: cut(img.getAttribute("src"), 120) }));
    out.brokenImages = [];
    for (const img of images) {
      if (!visible(img) || !img.complete || img.naturalWidth > 0 || !(img.currentSrc || img.getAttribute("src"))) continue;
      const broken = await Promise.race([img.decode().then(() => false, () => true), new Promise(resolve => setTimeout(() => resolve(false), 400))]);
      if (broken) out.brokenImages.push({ el: describe(img), src: cut(img.currentSrc || img.src, 140), alt: img.getAttribute("alt") });
    }

    const ids = new Map();
    for (const el of document.querySelectorAll("[id]")) if (el.id) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    out.duplicateIds = [...ids].filter(([, n]) => n > 1).map(([id, count]) => ({ id, count, first: describe(document.getElementById(id)) }));
    out.emptyTablists = [...document.querySelectorAll("[role=\"tablist\"]")].filter(list => !list.querySelector("[role=\"tab\"]")).map(describe);

    // Vendor names and secrets: visible text (incl. screen-reader text) and every attribute value.
    const test = new RegExp(opts.vendor.source, opts.vendor.flags.replace("g", ""));
    const all = new RegExp(opts.vendor.source, `${opts.vendor.flags.replace("g", "")}g`);
    out.vendor = [];
    const scan = (where, text, el) => {
      if (!text || !test.test(text)) return;
      all.lastIndex = 0;
      for (let match = all.exec(text); match && out.vendor.length < 30; match = all.exec(text)) {
        out.vendor.push({ where, match: match[0], context: cut(text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60), 160), el: el ? describe(el) : undefined });
      }
    };
    scan("text", document.body.innerText);
    scan("title", document.title);
    for (const el of document.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        if (attr.name === "class" || attr.name === "style" || /^(data|blob):/i.test(attr.value)) continue;
        scan(`@${attr.name}`, attr.value, el);
      }
    }

    // Audit probes (reported as warnings).
    out.frames = [...document.querySelectorAll("iframe")].map(frame => ({ el: describe(frame), titled: Boolean(frame.title || frame.getAttribute("aria-label")), src: cut(frame.getAttribute("src"), 120) }));
    out.h1 = [...document.querySelectorAll("h1")].filter(visible).map(h1 => ({ text: cut(h1.textContent, 60), width: Math.round(h1.getBoundingClientRect().width) }));
    const topTitle = document.querySelector("header h1, .topbar h1");
    out.topbarTitleWidth = topTitle && visible(topTitle) ? Math.round(topTitle.getBoundingClientRect().width) : null;
    // LAYOUT-1: an icon stacked above its label inside a control.
    out.stackedIcons = [];
    for (const el of controls) {
      const icon = el.querySelector("svg.lucide");
      if (!icon || !visible(icon)) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: node => (node.textContent.trim() && !node.parentElement.closest("svg,.sr-only,[aria-hidden=\"true\"]") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      const textNode = walker.nextNode();
      if (!textNode) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const t = range.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      if (t.height && i.height && (i.bottom <= t.top + 1 || t.bottom <= i.top + 1)) out.stackedIcons.push(describe(el));
    }
    // LAYOUT-2: the composer's send group wrapped below its tools.
    const send = document.querySelector(".composer-send");
    const tools = document.querySelector(".composer-tools");
    if (send && tools && visible(send) && visible(tools)) {
      const s = send.getBoundingClientRect();
      const t = tools.getBoundingClientRect();
      const bar = send.closest(".composer");
      out.composer = { sendBelowTools: s.top >= t.bottom - 1, overflowPx: bar ? bar.scrollWidth - bar.clientWidth : 0 };
    }
    // LAYOUT-5: which pane a phone task page opened on.
    const pane = document.querySelector(".pane-switch [role=\"tab\"][aria-selected=\"true\"]");
    out.selectedPane = pane ? cut(pane.textContent, 30) : null;
    return out;
  }

  // Focus: one snapshot per Tab press, compared with the unfocused styles at the end.
  const ringStyle = node => {
    const style = getComputedStyle(node);
    const before = getComputedStyle(node, "::before");
    const after = getComputedStyle(node, "::after");
    return {
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, boxShadow: style.boxShadow,
      pseudo: `${before.outlineStyle} ${before.outlineWidth} ${before.boxShadow} | ${after.outlineStyle} ${after.outlineWidth} ${after.boxShadow}`,
    };
  };
  const hasOutline = s => s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && !/^(transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/.test(s.outlineColor);

  function focusStep() {
    const trail = (window.__uiCheckFocus ||= []);
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      trail.push({ none: true });
      return trail.length;
    }
    const chain = [];
    for (let node = el; node && node.nodeType === 1 && chain.length < 4; node = node.parentElement) chain.push(node);
    const r = el.getBoundingClientRect();
    const shown = visible(el) || el.tagName === "IFRAME";
    const inViewport = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    let obscured = null;
    if (shown && inViewport) {
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) obscured = describe(hit);
    }
    trail.push({ el, chain, focused: chain.map(ringStyle), desc: describe(el), shown, inViewport, obscured, frame: el.tagName === "IFRAME" });
    return trail.length;
  }

  function focusFinish() {
    const trail = window.__uiCheckFocus || [];
    window.__uiCheckFocus = [];
    if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === "function") document.activeElement.blur();
    return trail.map(step => {
      if (step.none) return { none: true };
      const unfocused = step.chain.map(node => (node.isConnected ? ringStyle(node) : null));
      const self = step.focused[0];
      const was = unfocused[0];
      let via = null;
      if (hasOutline(self)) via = "outline";
      else if (self.boxShadow !== "none" && (!was || was.boxShadow !== self.boxShadow)) via = "box-shadow";
      else if (was && was.pseudo !== self.pseudo) via = "pseudo-element";
      else if (step.focused.slice(1).some((style, index) => {
        const then = unfocused[index + 1];
        return then && ((hasOutline(style) && !hasOutline(then)) || style.boxShadow !== then.boxShadow);
      })) via = "ancestor";
      return { el: step.desc, via, outline: `${self.outlineStyle} ${self.outlineWidth}`, boxShadow: cut(self.boxShadow, 80), shown: step.shown, inViewport: step.inViewport, obscured: step.obscured, frame: step.frame };
    });
  }

  // Animations still running (reduced motion must stop them all; ≤1 ms is the CSS kill switch).
  function motion() {
    const reduce = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : null;
    return document.getAnimations().filter(animation => animation.playState === "running").map(animation => {
      const timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : {};
      const target = animation.effect && animation.effect.target;
      // Where it runs and what the cascade says now (a stale style shows up as a mismatch).
      const within = [];
      for (let node = target && target.parentElement; node && within.length < 4; node = node.parentElement) within.push(describe(node));
      const computed = target && target.nodeType === 1 && typeof window.getComputedStyle === "function" ? window.getComputedStyle(target) : null;
      return {
        type: animation.constructor ? animation.constructor.name : "Animation",
        name: animation.animationName || animation.transitionProperty || animation.id || "",
        duration: typeof timing.duration === "number" ? Math.round(timing.duration * 100) / 100 : String(timing.duration),
        iterations: timing.iterations === Infinity ? "infinite" : timing.iterations,
        target: target ? describe(target) : null,
        pseudo: (animation.effect && animation.effect.pseudoElement) || null,
        reduce,
        computed: computed ? `${computed.animationName} ${computed.animationDuration} ${computed.animationIterationCount}` : null,
        connected: Boolean(target && target.isConnected),
        within,
      };
    }).filter(item => (typeof item.duration === "number" && item.duration > 1) || item.iterations === "infinite");
  }

  // LAYOUT-3: the model menu must sit inside the viewport, below the top bar, with "Auto" visible.
  function menu() {
    const open = [...document.querySelectorAll("[role=\"menu\"]")].find(visible);
    if (!open) return { open: false };
    const r = open.getBoundingClientRect();
    const bar = document.querySelector("header.topbar, header");
    const auto = [...open.querySelectorAll("[role=\"menuitemradio\"],[role=\"menuitem\"]")].find(item => /^\s*auto\b/i.test(item.textContent || ""));
    const a = auto ? auto.getBoundingClientRect() : null;
    return {
      open: true, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
      topbarBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : 0, innerHeight, innerWidth,
      items: open.querySelectorAll("[role^=\"menuitem\"]").length,
      autoVisible: Boolean(a && a.top >= Math.max(0, r.top) - 1 && a.bottom <= Math.min(innerHeight, r.bottom) + 1),
    };
  }

  window.__uiCheck = { facts, focusStep, focusFinish, motion, menu };
}

/**
 * How many px of content are scrolled out of sight: in an open dialog (its body scrolls), else in
 * the app's scroll areas (the shell's .page) or the document. run.mjs grows the viewport by this
 * much for a "tall" screenshot, so one image holds the whole page or dialog.
 */
export function contentOverflow() {
  // Only scroll areas that grow with the viewport: a fixed-height scroller (a table capped at
  // 320px, one inside a closed <details>) would add its overflow again on every round.
  const GROWS = ".page, .app-content, .dialog-body, .sheet-body";
  const shown = el => el.getBoundingClientRect().height > 0 && (typeof el.checkVisibility !== "function" || el.checkVisibility());
  const layers = [...document.querySelectorAll("[role=\"dialog\"],[role=\"alertdialog\"]")].filter(el => shown(el) && !el.classList.contains("nav-drawer"));
  let extra = layers.length ? 0 : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const scrollers = layers.length ? layers.flatMap(layer => [...layer.querySelectorAll(GROWS)]) : [...document.querySelectorAll(GROWS)];
  for (const el of scrollers) {
    if (!shown(el) || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    extra = Math.max(extra, el.scrollHeight - el.clientHeight);
  }
  return Math.ceil(extra);
}

/**
 * Init script for live runs. Playwright cannot stream a fulfilled response, and a finished SSE
 * body makes a real EventSource reconnect. For the task ids in `liveIds` this EventSource fetches
 * the same routed text/event-stream body, replays events up to the sync's maxSeq at once, delivers
 * the later ("live") events 80 ms apart, and then stays open like a running server stream.
 * Every other URL gets the browser's own EventSource.
 */
export function installHeldEventSource(liveIds) {
  if (window.top !== window || !window.EventSource || window.__uiCheckSse) return;
  const Native = window.EventSource;
  const state = (window.__uiCheckSse = { opened: 0, pending: 0, delivered: 0, closed: 0 });
  const LIVE = /\/api\/agent\/tasks\/([^/?#]+)\/events(?:[?#]|$)/;
  const PACE_MS = 80;

  const parse = text => {
    const blocks = [];
    for (const raw of text.replace(/\r\n?/g, "\n").split("\n\n")) {
      let type = "message";
      let id = null;
      const data = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") type = value || "message";
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
      if (data.length) blocks.push({ type, id, data: data.join("\n") });
    }
    return blocks;
  };

  class HeldEventSource extends EventTarget {
    constructor(url, init) {
      super();
      this.url = new URL(String(url), location.href).href;
      this.withCredentials = Boolean(init && init.withCredentials);
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._abort = new AbortController();
      this._timers = new Set();
      this._queued = 0;
      state.opened += 1;
      void this._run();
    }
    close() {
      if (this.readyState === 2) return;
      this.readyState = 2;
      state.closed += 1;
      this._abort.abort();
      for (const timer of this._timers) clearTimeout(timer);
      this._timers.clear();
      state.pending -= this._queued;
      this._queued = 0;
    }
    _fire(type, event) {
      const handler = this[`on${type}`];
      if (typeof handler === "function") {
        try {
          handler.call(this, event);
        } catch (error) {
          setTimeout(() => {
            throw error;
          });
        }
      }
      this.dispatchEvent(event);
    }
    _deliver(block) {
      state.delivered += 1;
      this._fire(block.type, new MessageEvent(block.type, { data: block.data, lastEventId: block.id ?? "", origin: location.origin }));
    }
    _fail() {
      if (this.readyState === 2) return;
      this.readyState = 2;
      state.closed += 1;
      this._fire("error", new Event("error"));
    }
    async _run() {
      let text;
      try {
        const response = await fetch(this.url, { headers: { accept: "text/event-stream" }, credentials: this.withCredentials ? "include" : "same-origin", cache: "no-store", signal: this._abort.signal });
        if (this.readyState === 2) return;
        if (!response.ok || !/text\/event-stream/i.test(response.headers.get("content-type") || "")) return this._fail();
        text = await response.text();
      } catch {
        return this._fail();
      }
      if (this.readyState === 2) return;
      this.readyState = 1;
      this._fire("open", new Event("open"));
      let mark = Infinity;
      let delay = 0;
      for (const block of parse(text)) {
        if (this.readyState === 2) return;
        if (block.type === "sync") {
          try {
            const sync = JSON.parse(block.data);
            if (typeof sync.maxSeq === "number") mark = sync.maxSeq;
          } catch {
            /* the client treats a malformed sync itself */
          }
        }
        const seq = Number(block.id);
        const live = block.type === "message" && Number.isFinite(seq) && seq > mark;
        if (!live && delay === 0) {
          this._deliver(block);
          continue;
        }
        delay += PACE_MS;
        this._queued += 1;
        state.pending += 1;
        const timer = setTimeout(() => {
          this._timers.delete(timer);
          this._queued -= 1;
          state.pending -= 1;
          if (this.readyState !== 2) this._deliver(block);
        }, delay);
        this._timers.add(timer);
      }
      // No "end": a live run's stream stays open.
    }
  }
  HeldEventSource.CONNECTING = 0;
  HeldEventSource.OPEN = 1;
  HeldEventSource.CLOSED = 2;

  function EventSource(url, init) {
    const match = LIVE.exec(String(url));
    let id = null;
    try {
      id = match ? decodeURIComponent(match[1]) : null;
    } catch {
      id = null;
    }
    return id && liveIds.includes(id) ? new HeldEventSource(url, init) : new Native(url, init);
  }
  EventSource.prototype = Native.prototype;
  EventSource.CONNECTING = 0;
  EventSource.OPEN = 1;
  EventSource.CLOSED = 2;
  window.EventSource = EventSource;
}

export const heldEventSourceScript = liveIds => `(${installHeldEventSource.toString()})(${JSON.stringify(liveIds)});`;
