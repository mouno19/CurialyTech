import type { DesignEntry } from "../types";

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
];
