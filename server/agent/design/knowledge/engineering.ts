import { askedFor, mentions } from "../intent";
import type { DesignIntent, WorkspaceFacts } from "../types";
import type { UiFit } from "../../../design-systems/ui-system";

// Compact React 19 and Next.js frontend engineering guidance, added to the brief only when the
// workspace, Curialy UI system, or request uses React or Next.js (omitted for the Reviewer, Vue, static HTML, etc.).

const REACT_WORDS = ["react", "reactjs", "react.js", "next.js", "nextjs"];
const REACT_FRAMEWORKS = new Set(["React", "Next.js"]);
const OTHER_TARGETS = [
  "vue", "nuxt", "svelte", "sveltekit", "angular", "solidjs", "solid-js", "astro",
  "htmx", "jquery", "plain html", "vanilla html", "vanilla js", "vanilla javascript",
  "single html file", "one html file", "no framework",
];
// Strip the English verb "react to / react when / react on" so "particles react to cursor" never triggers React guidance.
const stripReactVerb = (text: string) => text.replace(/\breacts?\s+(?:to|when|on|against)\b/gi, "respond ");

export function engineeringGuidance(facts: WorkspaceFacts, intent: DesignIntent, system?: UiFit): string | null {
  if (!intent.ui) return null;
  const scrubbed = { original: stripReactVerb(intent.original), latest: stripReactVerb(intent.latest) };
  const scrubbedText = stripReactVerb(intent.text);
  const namedReact = askedFor(scrubbed, REACT_WORDS);
  const refusedReact = !namedReact && REACT_WORDS.some(word => mentions(scrubbedText, word));
  if (refusedReact && !facts.existing) return null;
  const onUiSystem = system === "project" || system === "requested" || system === "recommended";
  const workspaceReact = facts.framework !== null && REACT_FRAMEWORKS.has(facts.framework);
  if (!workspaceReact && !onUiSystem && !namedReact) return null;
  if (!workspaceReact && !onUiSystem && askedFor(scrubbed, OTHER_TARGETS) && !askedFor(scrubbed, ["next.js", "nextjs", "reactjs", "react.js"])) return null;
  return [
    "- React 19: pass `ref` as a prop (no `forwardRef`) and read context via `use(Context)`; compute derived values in render (not `useEffect`); never nest component declarations; use `count > 0 ? <Badge /> : null` (never `count && <Badge />`).",
    "- Composition: prefer explicit variants, `children` slots and compound components over boolean mode-props; decouple state/actions providers from views.",
    "- Waterfalls & bundles: run independent async work via `Promise.all`; use direct imports (no broad barrels), lazy-load heavy chart/3D/editor modules (`lazy` / `next/dynamic`), and wrap filter/tab updates in `startTransition` or `useDeferredValue`.",
    "- View transitions: use `document.startViewTransition` (or `<ViewTransition>`) with a plain fallback — directional slide only for `list -> detail` depth, crossfade or `none` for lateral tabs.",
  ].join("\n");
}
