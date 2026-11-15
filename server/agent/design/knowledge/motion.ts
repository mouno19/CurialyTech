import type { DesignEntry } from "../types";
import type { GrantedLook } from "./archetypes";

// Motion and immersive (canvas, WebGL) guidance. The reference corpus is mostly video work, so its
// mechanics are kept and its pacing is cut down to interface timings.

export const MOTION: DesignEntry[] = [
  {
    id: "motion-basics",
    title: "Motion basics",
    discipline: "motion",
    rules: [
      "Every animation has a job: feedback, a state change, spatial continuity, or one moment of delight. Motion the user did not trigger stays rare.",
      "Durations: 100-150 ms for micro-interactions, 200-300 ms for menus, toasts and expansions, 300-500 ms for large moves; exits about 25% faster than entrances.",
      "Easing: entrances decelerate (cubic-bezier(0.2, 0, 0, 1) or (0.16, 1, 0.3, 1)), exits accelerate; never linear for movement; no bounce or elastic overshoot in product UI.",
      "Animate transform and opacity; list transition properties (never transition: all); will-change only while something animates.",
      "Under @media (prefers-reduced-motion: reduce), remove translate, scale, parallax and auto-scroll, and keep short opacity fades.",
    ],
    sources: ["Material 3 motion", "IBM Carbon motion", "NN/g animation duration", "web.dev animations guide", "WCAG 2.2 2.3.3"],
  },
  {
    id: "motion-orchestration",
    title: "One orchestrated moment",
    discipline: "motion",
    needs: ["motion"],
    rules: [
      "One orchestrated sequence beats scattered effects: for example a hero entrance of 600-900 ms in total, container first, then content with 40-80 ms staggers (at most 6 items), all settled within a second.",
      "Headline pull-up: words or lines rise from translateY(0.5em) with opacity, 500-700 ms ease-out, 60-80 ms apart; keep the real text in the DOM (aria-label on the heading when words are split into spans).",
      "Containers before content: a panel's frame moves first and its content changes after it settles (about 150 ms crossfade, 8-12 px shift).",
      "Motion answers intent: press feedback within 100 ms, drags follow the pointer 1:1 and release with matching velocity, springs critically damped for opacity and color and damped (ratio 0.8 or more) for movement, so nothing visibly bounces.",
      "Anything that moves by itself for more than 5 s needs a pause control (WCAG 2.2.2), and nothing flashes more than 3 times a second.",
    ],
    sources: ["corpus:iamtanzil-120030", "corpus:verbove-268381", "corpus:khlaseek-dsgner-877659", "corpus:morse-369333", "corpus:fleyta88-443662", "Material 3 springs", "WCAG 2.2 2.2.2, 2.3.1"],
  },
  {
    id: "scroll-motion",
    title: "Scroll-driven sections",
    discipline: "motion",
    needs: ["scroll"],
    rules: [
      "Reveals are an enhancement: content starts visible, and the hidden starting state is added by script (a class on <html>) only for content below the fold, so a script failure never ships a blank page.",
      "Link effects to scroll with CSS scroll-driven animations (animation-timeline: view()) inside @supports, or one IntersectionObserver or requestAnimationFrame progress value per section. No scroll hijacking, no custom smooth scrolling.",
      "Sticky scrollytelling: a sticky visual with text steps scrolling past; each step changes one thing; on phones and under reduced motion it becomes plain stacked content.",
      "Parallax only as a subtle depth cue (10-20% speed difference) on decorative layers, never on text, and off under reduced motion.",
      "Long reads get a progress cue: a thin bar scaled with transform: scaleX() or chapter markers.",
    ],
    sources: ["web.dev scroll-driven animations", "corpus:twoclipping-551116", "corpus:brainextends-606193", "impeccable-catalogue"],
  },
  {
    id: "state-transitions",
    title: "State changes and continuity",
    discipline: "motion",
    signals: ["transition", "tab", "tabs", "filter", "switch", "picker", "toggle", "modal", "sheet", "drawer", "morph", "configurator", "swatch"],
    optional: true,
    rules: [
      "Shared-element changes: the View Transitions API (document.startViewTransition) with a plain fallback, or FLIP (measure, invert, play) with transform.",
      "Dialogs and popovers: @starting-style with transition-behavior: allow-discrete, about 200 ms in and 150 ms out.",
      "Keep one persistent anchor across states (the product image, a selected-tab indicator that stretches and slides) so the eye follows the change.",
      "Color or theme changes: transition a registered custom property (@property) or crossfade two images over 250-400 ms.",
    ],
    sources: ["MDN View Transitions", "corpus:morse-369333", "corpus:thegrootdev-966114", "corpus:0xnicc0-516612"],
  },
  {
    id: "timelines",
    title: "Sequences on one clock",
    discipline: "motion",
    needs: ["motion"],
    signals: ["intro", "sequence", "timeline", "loop", "demo", "animated", "story", "showreel"],
    rules: [
      "Drive any sequence longer than a few transitions from one clock: a pure render(t) or a single Web Animations or GSAP timeline, with no setTimeout chains and no unseeded randomness. It can then be paused, scrubbed (?t=), tested, and given a clean reduced-motion end state.",
      "Fix the numbers before coding (durations, delays, distances, curves) as named constants or tokens, and review the result as still frames at key moments.",
    ],
    sources: ["corpus:flxrnc-251921", "corpus:0xkarmi-129839", "corpus:tanabe-fragm-706979", "corpus:verbove-268381"],
  },
  {
    id: "showcase-effects",
    title: "Effects that do not ship on real pages",
    discipline: "motion",
    needs: ["motion", "immersive"],
    rules: [
      { text: "Leave video techniques out of pages: per-beat flashes, screen shake, whip-pans, a camera that never rests, RGB split or glitch beyond a 1-2 frame accent, and stacks of particles, glows and lens flares.", unless: ["game", "screen shake", "particles", "music video"] },
      "Real-time motion blur and full-screen grain or scan lines redrawn every frame cost a lot and lower text contrast; if texture is needed, a static noise image at 3-5% opacity.",
      "Copy drawn only as canvas pixels or glyph paths needs a real text layer (or an aria-label) for screen readers, search and translation.",
      "Sound never autoplays: it starts from a control, and everything works muted.",
    ],
    sources: ["corpus:pound75423-464968", "corpus:nonbiri-ai-110674", "corpus:notdwd-998633", "corpus:humzaakhalid-537875", "WCAG 2.2 2.3.1, 1.4.2"],
  },
  {
    id: "webgl-3d",
    title: "3D and WebGL on a page",
    discipline: "immersive",
    needs: ["immersive"],
    signals: ["3d", "three.js", "threejs", "webgl", "webgpu", "r3f", "react-three", "shader", "orbit", "model"],
    rules: [
      "Budget first: cap devicePixelRatio at 1.5-2, pause rendering when the canvas is off-screen or the tab is hidden, load the 3D library after first paint, and degrade on phones (fewer objects, no post-processing).",
      "Detect WebGL support and ship a still poster fallback; under reduced motion show a still frame or a slow, user-driven view.",
      "Keep text, labels and controls in HTML over the canvas (crisp, selectable, accessible); the canvas gets role=\"img\" and an aria-label.",
      "Orbit and drag with pointer events plus buttons or keys as an alternative; damp the camera, clamp zoom and polar angle (avoid looking straight down), and interpolate zoom on a log scale.",
      "Real dimensions and counts (metres, part counts) give more convincing geometry than adjectives; an explode or cut-away control shows the inside.",
    ],
    sources: ["corpus:aichrislee-378670", "corpus:mrkindey-267498", "corpus:tanabe-fragm-322001", "corpus:voxyz-ai-345550", "corpus:everestchris6-399895", "three.js manual"],
  },
  {
    id: "canvas-2d",
    title: "Canvas, particles and generative art",
    discipline: "immersive",
    needs: ["immersive"],
    signals: ["canvas", "particle", "particles", "generative", "pixel", "simulation", "game"],
    rules: [
      "Size the canvas backing store to devicePixelRatio (capped) and redraw on resize; run one requestAnimationFrame loop and draw from state and time, not accumulated drift.",
      "Pool objects (no allocations per frame), cap counts (around 2,000 particles on phones) and stop the loop when hidden.",
      "Pixel art: integer scaling, image-rendering: pixelated and a locked palette.",
    ],
    sources: ["corpus:majidmanzarpour-927543", "corpus:zacxbt-944604", "corpus:0xsolty-735200", "MDN canvas optimization"],
  },
  {
    id: "explainers",
    title: "Interactive explainers",
    discipline: "immersive",
    signals: ["explain", "explainer", "explorable", "interactive", "diagram", "simulation", "educational", "history", "how it works", "mechanism"],
    optional: true,
    rules: [
      "Accuracy is part of the design: simulate the real mechanism, use real figures with their uncertainty, and mark illustrative values as such.",
      "Expose the mechanism through one control at a time (a slider, an explode toggle, a step button); each step changes one thing and one line of text explains it.",
      "Derive every view from one source of truth: one dataset or state drives the picture, the labels and the narration.",
    ],
    sources: ["corpus:astrothewizard-618782", "corpus:gdgtify-393073", "corpus:godsboy7777-150194", "corpus:curieuxexplorer-016717", "corpus:agioyaz-986461"],
  },
  {
    id: "motion-mixture",
    title: "Motion from the library: a mixture, not a showcase",
    discipline: "motion",
    needs: ["motion"],
    rules: [
      "Pick a few pieces by job and mix them: at most one hero moment (a background, a 3D object or a canvas study), one headline treatment, one or two scroll patterns, one card treatment, one button treatment, one navigation pattern and one loading state. Never a whole suite, and never two pieces doing the same job.",
      "At most one continuously running animation (a canvas or a looping background) on screen at a time; it pauses when off-screen or the tab is hidden (IntersectionObserver, visibilitychange).",
      "Every piece takes the design's tokens: colours by role, --cx-ease and the --cx-duration-* values for timing. A borrowed piece never brings its own palette, font or easing.",
      "Under prefers-reduced-motion every piece has an end state: reveals show their content, loops stop on a still frame, pointer effects stay put. A running loop gets a pause control.",
      "Studies made for show (glitch, digital rain, gravity, particle bursts, cursor trails, audio visualizers) only when the user asks for them or the subject is a game, a music or a creative-lab site.",
    ],
    sources: ["component-library/motion-components", "component-library/motion-mocks/scroll-transition-showcase", "WCAG 2.2 2.2.2, 2.3.3"],
  },
  {
    id: "interactive-motion",
    title: "Pointer and press interactions",
    discipline: "motion",
    signals: ["magnetic", "tilt", "hover", "cursor", "pointer", "ripple", "spotlight", "micro-interaction", "microinteraction", "interactive", "press", "glow"],
    optional: true,
    rules: [
      "Magnetic pull: move the element by 20-35% of the pointer's offset, at most 8-14 px, with a short ease back on leave; only on fine pointers (@media (hover: hover) and (pointer: fine)).",
      "3D tilt: 6-12 degrees at most, perspective 700-1000 px, a light or shine layer that follows the pointer, and reset on leave; never on text-heavy cards.",
      "Press feedback within 100 ms: scale 0.97-0.98 or a 2-4 px press, a ripple from the touch point, and the keyboard gets the same response on Enter and Space.",
      "Pointer-driven light (spotlight, border glow) uses a radial gradient positioned by CSS variables updated in one requestAnimationFrame, not per event.",
    ],
    sources: ["component-library/motion-components/07_animated_card_components.html", "component-library/motion-components/10_interactive_button_showcase.html", "corpus:morse-369333"],
  },
  {
    id: "scroll-kit",
    title: "Scroll reveals and progress (the scroll motion kit)",
    discipline: "motion",
    needs: ["scroll"],
    signals: ["reveal", "on scroll", "scroll animation", "stagger", "pin", "zoom", "progress", "horizontal scroll", "sticky"],
    rules: [
      "Reveal: one IntersectionObserver per element (threshold 0.15-0.2), translate 24-40 px from the chosen direction plus opacity, 700-900 ms on cubic-bezier(0.22, 1, 0.36, 1), delays in 80-140 ms steps; the React kit's Reveal and useInView do exactly this.",
      "Section progress (parallax, pinning, horizontal stories, sticky scenes): one value 0-1 per section from getBoundingClientRect in a requestAnimationFrame on a passive scroll listener (the kit's useElementProgress), applied with transform only.",
      "Pinned and horizontal sequences become plain stacked content on phones and under reduced motion; images that zoom or pin keep a static, full-size fallback.",
    ],
    sources: ["component-library/motion-mocks/scroll-transition-showcase/src/App.tsx", "component-library/motion-components/06_scroll_animation_showcase.html"],
  },
];

// ---- The motion library ----
// The staged motion suites (component-library/motion-components, ten files of ten studies) and the
// scroll motion mock (component-library/motion-mocks/scroll-transition-showcase, React). Every piece is
// registered in the component library under its id; a design picks a few by slot and puts them on
// its own tokens (synthesis.ts, motionMixture), never a whole suite.

/** The timing every design's tokens carry (tokens.css: --cx-ease, --cx-duration-*, --cx-stagger): the scroll mock's ease and interface durations. */
export const MOTION_TIMING = { ease: "cubic-bezier(0.22, 1, 0.36, 1)", fast: "150ms", base: "300ms", reveal: "800ms", stagger: "80ms" };

/** Where a piece of motion sits in a page: a mixture takes at most one per slot (data and scroll excepted). */
export type MotionSlot = "hero" | "type" | "scroll" | "surface" | "control" | "navigation" | "feedback" | "data" | "ambient";
/** What it costs to run: CSS only, a script on events, or a continuous animation loop. */
export type MotionCost = "css" | "script" | "loop";

export type MotionFamily = {
  id: string; name: string; file: string; tokens: string; slot: MotionSlot; category: string; role: string;
  /** Default tools that may use it. */
  tools: string[];
};
export type MotionPiece = {
  id: string; family: string; name: string; how: string;
  /** Request words that ask for it. */
  signals: string[];
  slot: MotionSlot; cost: MotionCost;
  /** Looks it is built on (a chosen piece makes them deliberate). */
  looks?: GrantedLook[];
  /** A study for creative or game work: used only when asked for by name. */
  showcase?: boolean;
  /** The scroll mock has a React version (registered as `${id}-react`). */
  react?: string;
};

const WEB = ["web-design", "ui-ux-design", "frontend-development"];
export const MOTION_FAMILIES: MotionFamily[] = [
  { id: "motion-canvas", name: "Creative canvas studies", file: "01_creative_canvas_experiments.html", tokens: "motion-canvas", slot: "hero", category: "motion", role: "content", tools: WEB },
  { id: "motion-type", name: "Kinetic typography", file: "02_kinetic_typography_collection.html", tokens: "motion-type", slot: "type", category: "motion", role: "header", tools: WEB },
  { id: "motion-3d", name: "3D motion", file: "03_3d_motion_components.html", tokens: "motion-3d", slot: "hero", category: "motion", role: "content", tools: WEB },
  { id: "motion-bg", name: "Animated backgrounds", file: "04_animated_background_effects.html", tokens: "motion-backgrounds", slot: "hero", category: "motion", role: "header", tools: WEB },
  { id: "motion-chart", name: "Animated data visualizations", file: "05_animated_data_visualizations.html", tokens: "motion-charts", slot: "data", category: "data-visualization", role: "chart", tools: ["data-analytics", "dashboard-builder", "web-design", "frontend-development"] },
  { id: "motion-scroll", name: "Scroll motion patterns", file: "06_scroll_animation_showcase.html", tokens: "motion-scroll", slot: "scroll", category: "motion", role: "section", tools: WEB },
  { id: "motion-card", name: "Animated cards", file: "07_animated_card_components.html", tokens: "motion-cards", slot: "surface", category: "motion", role: "content", tools: WEB },
  { id: "motion-nav", name: "Animated navigation", file: "08_animated_navigation_components.html", tokens: "motion-navigation", slot: "navigation", category: "navigation", role: "navigation", tools: [...WEB, "dashboard-builder"] },
  { id: "motion-loader", name: "Loading states", file: "09_loading_animation_components.html", tokens: "motion-loading", slot: "feedback", category: "feedback", role: "content", tools: [...WEB, "dashboard-builder", "data-analytics"] },
  { id: "motion-button", name: "Interactive buttons", file: "10_interactive_button_showcase.html", tokens: "motion-buttons", slot: "control", category: "motion", role: "content", tools: WEB },
];

type PieceSpec = [id: string, name: string, how: string, signals: string[], cost: MotionCost, extra?: Partial<MotionPiece>];
const family = (familyId: string, specs: PieceSpec[]): MotionPiece[] => {
  const owner = MOTION_FAMILIES.find(item => item.id === familyId)!;
  return specs.map(([id, name, how, signals, cost, extra]) => ({ id: `${familyId}-${id}`, family: familyId, name, how, signals, slot: owner.slot, cost, ...extra }));
};

export const MOTION_PIECES: MotionPiece[] = [
  ...family("motion-canvas", [
    ["cursor-trail", "Cursor trail", "a fading constellation of points follows the pointer", ["cursor trail", "mouse trail", "cursor effect"], "loop", { slot: "ambient", showcase: true }],
    ["liquid-image", "Liquid image distortion", "dragging across an image bends it like water", ["liquid image", "image distortion", "ripple image", "distort"], "loop"],
    ["morphing-blobs", "Morphing blobs", "organic blobs drift and lean toward the pointer", ["morphing blob", "blobs", "organic shapes"], "loop", { looks: ["violet"] }],
    ["magnetic-field", "Magnetic field", "a button whose field of lines bends toward the pointer", ["magnetic field"], "loop", { slot: "control", showcase: true }],
    ["path-drawing", "Path drawing", "a hand-drawn SVG route traces itself, replayable", ["path drawing", "line drawing", "svg path", "draw on scroll", "route animation"], "script", { slot: "scroll" }],
    ["spotlight-reveal", "Spotlight reveal", "a pointer-driven spotlight uncovers a hidden message", ["spotlight reveal", "flashlight", "reveal on hover"], "script"],
    ["particle-burst", "Particle burst", "a shape breaks into particles and comes back together", ["particle burst", "explode", "particles"], "loop", { showcase: true }],
    ["shape-transition", "Shape transition", "one silhouette morphs from shape to shape", ["shape morph", "shape transition", "morphing shape"], "script"],
    ["audio-spectrum", "Audio spectrum", "a spectrum that moves only after the user presses play", ["audio spectrum", "audio visualizer", "music visualizer", "equalizer"], "loop", { showcase: true }],
    ["gravity-playground", "Gravity playground", "bodies pulled toward the pointer; a tap pushes them away", ["gravity", "physics playground", "physics"], "loop", { showcase: true }],
  ]),
  ...family("motion-type", [
    ["kinetic-headline", "Kinetic headline", "letters move on their own staggered beat", ["kinetic headline", "kinetic type", "kinetic typography", "animated headline"], "css"],
    ["text-scramble", "Text scramble", "characters scramble and resolve into the word, on demand", ["text scramble", "scramble", "decode text", "decrypt"], "script"],
    ["typewriter", "Typewriter", "text types out one character at a time, with play and pause", ["typewriter", "typing effect", "typed text"], "script"],
    ["gradient-flow", "Gradient text flow", "a gradient flows through the letters", ["gradient text", "gradient flow", "flowing gradient"], "css", { looks: ["gradient-text"] }],
    ["split-reveal", "Split text reveal", "words rise from a mask one after another, replayable", ["split text", "word reveal", "text reveal", "headline reveal"], "css"],
    ["rotating-3d", "3D rotating text", "words flip through a rotating 3D stack", ["rotating text", "rotating words", "flip text", "3d text"], "css"],
    ["variable-weight", "Variable weight", "a variable font breathes between light and heavy", ["variable font", "variable weight", "font weight animation"], "css"],
    ["glitch", "Glitch typography", "an RGB-split glitch in short bursts", ["glitch", "glitch text", "rgb split"], "css", { showcase: true }],
    ["circular", "Circular text", "a phrase circles a center mark", ["circular text", "text on a circle", "rotating badge", "spinning text"], "css", { looks: ["marquee"] }],
    ["scroll-driven", "Scroll-driven type", "type scales and shifts as its frame scrolls", ["scroll-driven type", "type on scroll", "scroll text"], "script", { slot: "scroll" }],
  ]),
  ...family("motion-3d", [
    ["sphere", "Interactive sphere", "a lit CSS sphere follows the pointer", ["interactive sphere", "sphere", "globe"], "script"],
    ["product-showcase", "Product showcase", "drag to rotate a dimensional product", ["product showcase", "product viewer", "drag to rotate", "360 view", "rotate product"], "script"],
    ["isometric", "Floating isometric scene", "three blocks drift through an isometric world", ["isometric", "floating blocks"], "css"],
    ["cube-gallery", "Cube gallery", "a rotating cube with an image on each face", ["cube gallery", "rotating cube", "cube"], "script"],
    ["tunnel", "Perspective tunnel", "nested frames expand into the distance", ["perspective tunnel", "tunnel", "infinite zoom"], "css"],
    ["layered-parallax", "Layered parallax", "stacked planes shift with the pointer", ["layered parallax", "mouse parallax", "depth layers"], "script"],
    ["orbit", "Orbiting objects", "two satellites on adjustable orbits", ["orbiting", "orbit", "satellites", "planets"], "css"],
    ["morphing-geometry", "Morphing geometry", "a solid flows between silhouettes", ["morphing geometry", "morphing 3d", "shape shifting"], "css"],
    ["liquid-sphere", "Liquid sphere", "a soft sphere ripples toward the pointer", ["liquid sphere", "fluid orb", "blob sphere"], "script"],
    ["card-carousel", "3D card carousel", "swipe between three cards suspended in depth", ["3d carousel", "card carousel", "carousel"], "script", { slot: "surface" }],
  ]),
  ...family("motion-bg", [
    ["aurora", "Aurora gradient", "slow aurora bands behind the content", ["aurora", "northern lights"], "loop", { looks: ["violet"] }],
    ["particle-field", "Particle field", "a drifting constellation of linked points", ["particle field", "particle background", "particles background", "constellation"], "loop"],
    ["fluid-mesh", "Fluid mesh", "soft mesh-gradient pools of colour", ["mesh gradient", "fluid mesh", "gradient mesh"], "loop", { looks: ["violet"] }],
    ["starfield", "Starfield", "stars streaming past in depth", ["starfield", "stars", "space background", "warp"], "loop"],
    ["floating-orbs", "Floating orbs", "glowing orbs drift and answer the pointer", ["floating orbs", "orbs", "bokeh"], "loop", { looks: ["violet"] }],
    ["digital-matrix", "Digital matrix", "falling columns of glyphs", ["digital rain", "code rain", "matrix"], "loop", { showcase: true }],
    ["waveform", "Waveform", "layered waves moving slowly", ["waveform", "waves background", "sine waves"], "loop"],
    ["geometric-grid", "Geometric grid", "a grid that warps under the pointer", ["geometric grid", "grid background", "warp grid"], "loop"],
    ["noise-grain", "Noise and grain", "animated grain over a gradient", ["film grain", "grain", "noise"], "loop"],
    ["liquid-distortion", "Liquid distortion", "slow liquid ribbons of colour", ["liquid distortion", "liquid background"], "loop"],
  ]),
  ...family("motion-chart", [
    ["momentum-line", "Momentum line", "a line chart that draws itself point by point", ["animated line chart", "momentum line", "line draws"], "script"],
    ["channel-bars", "Channel comparison bars", "bars that grow in a stagger", ["animated bar chart", "growing bars", "bar race"], "script"],
    ["revenue-donut", "Revenue mix donut", "a donut whose segments sweep in", ["animated donut", "donut chart"], "script"],
    ["liquid-kpi", "Liquid KPI", "a liquid fill rises to the goal", ["liquid kpi", "liquid fill", "fill gauge", "goal gauge"], "script"],
    ["cumulative-area", "Cumulative area", "a gradient area that sweeps in over time", ["animated area chart", "cumulative area"], "script"],
    ["radial-indicators", "Radial indicators", "four rings that fill to their values", ["radial indicators", "radial progress", "progress rings", "ring chart"], "script"],
    ["activity-heatmap", "Activity heatmap", "cells fade in by intensity", ["animated heatmap", "activity heatmap", "contribution graph"], "script"],
    ["live-pulse", "Live data pulse", "a streaming series that updates on demand with a pulse", ["live data", "real-time chart", "realtime chart", "live chart", "streaming data"], "loop"],
    ["network", "Connected network", "select a node to trace its links", ["network graph", "node graph", "connected nodes"], "script"],
    ["funnel", "Conversion funnel", "funnel stages that flow in from visits to customers", ["animated funnel", "conversion funnel"], "script"],
  ]),
  ...family("motion-scroll", [
    ["reveal", "Scroll reveal", "content eases in as it enters the viewport (direction, duration, delay, threshold)", ["scroll reveal", "reveal on scroll", "fade in on scroll", "animate on scroll", "scroll animation", "on scroll"], "script", { react: "ScrollRevealDemo" }],
    ["staggered-grid", "Staggered grid", "a grid's items arrive one after another", ["staggered grid", "staggered", "stagger", "cascade"], "script", { react: "StaggeredGridDemo" }],
    ["parallax", "Parallax layers", "layers move at different speeds as the page scrolls", ["parallax"], "script", { react: "ParallaxDemo" }],
    ["horizontal-story", "Horizontal story", "vertical scroll drives a pinned horizontal sequence", ["horizontal scroll", "horizontal story", "side scroll"], "script", { react: "HorizontalStoryDemo" }],
    ["sticky-story", "Sticky storytelling", "a sticky frame changes scene by scene as the text scrolls past", ["scrollytelling", "sticky story", "sticky section", "storytelling", "sticky scroll"], "script", { react: "StickyStoryDemo" }],
    ["text-mask", "Text mask reveal", "lines rise from behind a clipping edge", ["text mask", "mask reveal", "line reveal"], "css", { react: "TextMaskDemo" }],
    ["page-curtain", "Page curtain", "a curtain sweeps across, swaps the scene and reveals it", ["page transition", "page curtain", "curtain", "wipe transition"], "script", { react: "PageCurtainDemo" }],
    ["circular-reveal", "Circular reveal", "a new scene grows from one point with a clip-path circle", ["circular reveal", "circle reveal", "clip-path reveal"], "css", { react: "CircularRevealDemo" }],
    ["progress", "Scroll progress", "a reading progress bar and ring", ["scroll progress", "reading progress", "progress indicator", "progress bar"], "script", { react: "ProgressDemo" }],
    ["pin-zoom", "Image pin and zoom", "an image pins and grows to the full frame as the page scrolls", ["pin and zoom", "zoom on scroll", "scroll zoom", "pinned image", "image zoom"], "script", { react: "PinZoomDemo" }],
  ]),
  ...family("motion-card", [
    ["tilt", "3D tilt card", "the card leans toward the pointer with a moving light", ["3d tilt", "tilt card", "hover tilt", "tilt"], "script"],
    ["flip", "Flip card", "a tap or click turns it to the back", ["flip card", "card flip"], "css"],
    ["glass", "Glass card", "a frosted pane with a passing reflection", ["glass card", "glassmorphism", "frosted"], "css", { looks: ["glass"] }],
    ["image-reveal", "Image reveal card", "a circular mask uncovers the picture on hover", ["image reveal", "hover reveal"], "css"],
    ["parallax", "Parallax card", "foreground and background drift apart with the pointer", ["parallax card", "depth card"], "script"],
    ["expandable", "Expandable card", "it opens to show the full story", ["expandable card", "expand card", "read more"], "css"],
    ["magnetic", "Magnetic floating card", "a spring pulls the card toward the pointer", ["magnetic card", "floating card"], "script"],
    ["border-glow", "Border glow card", "a bright edge tracks the pointer along the frame", ["border glow", "glowing border", "glow border"], "script"],
    ["stacked", "Stacked cards", "overlapping cards fan apart on tap", ["stacked cards", "card stack", "fan out"], "css"],
    ["spotlight", "Spotlight card", "a soft pool of light follows the pointer", ["spotlight card", "spotlight hover", "hover light"], "script"],
  ]),
  ...family("motion-nav", [
    ["morphing-hamburger", "Morphing hamburger", "three lines morph into a close icon and open a panel", ["hamburger", "menu icon", "mobile menu"], "css"],
    ["liquid-indicator", "Liquid tab indicator", "a fluid highlight slides to the selected item", ["liquid indicator", "sliding indicator", "tab indicator", "animated tabs"], "script"],
    ["glass-sidebar", "Floating glass sidebar", "translucent navigation with lit active states", ["glass sidebar", "floating sidebar"], "css", { looks: ["glass"] }],
    ["radial-menu", "Expandable radial menu", "a compact launcher unfolds into four destinations", ["radial menu", "speed dial", "fab menu", "circular menu"], "css"],
    ["fullscreen-overlay", "Fullscreen overlay menu", "large links arrive in a staggered sequence", ["fullscreen menu", "overlay menu", "full screen navigation"], "css"],
    ["magnetic", "Magnetic navigation", "links lean toward the pointer", ["magnetic navigation", "magnetic nav", "magnetic links"], "script"],
    ["mega-menu", "Animated mega menu", "grouped links open in a panel without losing your place", ["mega menu", "dropdown menu"], "css"],
    ["floating-dock", "Bottom floating dock", "a dock that magnifies the selected item", ["floating dock", "bottom dock", "dock", "bottom navigation"], "script"],
    ["scroll-aware", "Scroll-aware navbar", "a sticky header that compacts as the page scrolls", ["scroll-aware", "shrinking header", "sticky header", "navbar on scroll", "hide on scroll"], "script"],
    ["vertical-timeline", "Vertical timeline navigation", "a marker follows the section being read", ["timeline navigation", "scrollspy", "section marker", "table of contents"], "script"],
  ]),
  ...family("motion-loader", [
    ["orbit", "Orbit loader", "dots orbit a centre", ["orbit loader", "loading spinner", "spinner"], "css"],
    ["liquid", "Liquid loader", "a liquid fill with a determinate percentage", ["liquid loader", "fill loader"], "css"],
    ["dna", "DNA helix loader", "a twisting double helix of dots", ["dna", "helix"], "css"],
    ["progress-ring", "Progress ring", "a ring that fills to the percentage", ["progress ring", "circular progress"], "css"],
    ["segments", "Segmented loader", "segments light up in sequence", ["segmented progress", "segments loader", "steps loader"], "css"],
    ["wave", "Wave loader", "bars rise and fall in a wave", ["wave loader", "bars loader"], "css"],
    ["assembly", "Assembly loader", "blocks assemble into a shape", ["assembly loader", "building blocks loader"], "css"],
    ["skeleton", "Skeleton screen", "shimmering placeholders shaped like the content", ["skeleton screen", "skeleton", "shimmer", "content loading", "placeholder loading"], "css"],
    ["ai-thinking", "AI thinking indicator", "pulsing marks for a model at work", ["ai thinking", "thinking indicator", "typing indicator", "generating"], "css"],
    ["multi-stage", "Multi-stage progress", "prepare, process and finish stages with their states", ["multi-stage", "upload progress", "step progress", "stages"], "css"],
  ]),
  ...family("motion-button", [
    ["magnetic", "Magnetic button", "the button follows the pointer a little", ["magnetic button", "magnetic cta", "magnetic"], "script"],
    ["liquid-morph", "Liquid morph button", "an organic silhouette that keeps shifting", ["liquid button", "morph button", "blob button"], "css"],
    ["neon", "Neon glow button", "an electric edge with a soft pulse", ["neon button", "glow button", "neon"], "css", { looks: ["violet"] }],
    ["3d-press", "3D press button", "a tactile button that presses into depth", ["3d button", "press button", "tactile button", "pressable"], "css"],
    ["gradient-flow", "Gradient flow button", "a fill of colours that keeps flowing", ["gradient button", "animated gradient button"], "css"],
    ["particle-burst", "Particle burst button", "a small burst of particles on click", ["confetti", "particle button", "celebration"], "script"],
    ["glass", "Glass button", "frosted layers with light that follows the pointer", ["glass button"], "css", { looks: ["glass"] }],
    ["border-trace", "Border trace button", "a glint travels around the edge", ["border trace", "animated border", "traveling border"], "css"],
    ["morphing-toggle", "Morphing toggle", "a switch whose knob morphs between two states", ["morphing toggle", "toggle", "switch"], "css"],
    ["ripple", "Ripple button", "a ripple expands from the touch point", ["ripple", "ripple effect"], "script"],
  ]),
];

/** The scroll mock's hooks and wrappers, one React module (the React versions of the scroll patterns use the same). */
export const MOTION_KIT = {
  id: "motion-react-scroll-kit", name: "Scroll motion kit (React)",
  how: "useInView (IntersectionObserver), Reveal (direction up/down/left/right, duration, delay, threshold), useElementProgress and page progress, all on --ease: cubic-bezier(0.22, 1, 0.36, 1)",
};
