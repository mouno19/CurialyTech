import { askedFor } from "../intent";
import type { DesignIntent, WorkspaceFacts } from "../types";

// Compact React 19 and Next.js frontend engineering guidance, added to the brief only when the
// workspace or request uses React or Next.js (omitted for the Reviewer, static HTML, Vue, etc.).

const REACT_WORDS = ["react", "next.js", "nextjs"];
const REACT_FRAMEWORKS = new Set(["React", "Next.js"]);

export function engineeringGuidance(facts: WorkspaceFacts, intent: DesignIntent): string | null {
  if (!intent.ui) return null;
  const namedReact = askedFor(intent, REACT_WORDS);
  const refusedReact = !namedReact && REACT_WORDS.some(word => intent.text.includes(word));
  if (refusedReact && !facts.existing) return null;
  const workspaceReact = facts.framework !== null && REACT_FRAMEWORKS.has(facts.framework);
  if (!workspaceReact && !namedReact) return null;
  return [
    "- React 19: pass `ref` as a prop (no `forwardRef`) and read context via `use(Context)`; compute derived values in render (not `useEffect`); never nest component declarations; use `count > 0 ? <Badge /> : null` (never `count && <Badge />`).",
    "- Composition: prefer explicit variants, `children` slots and compound components over boolean mode-props; decouple state/actions providers from views.",
    "- Waterfalls & bundles: run independent async work via `Promise.all`; use direct imports (no broad barrels), lazy-load heavy chart/3D/editor modules (`lazy` / `next/dynamic`), and wrap filter/tab updates in `startTransition` or `useDeferredValue`.",
    "- View transitions: use `document.startViewTransition` (or `<ViewTransition>`) with a plain fallback — directional slide only for `list -> detail` depth, crossfade or `none` for lateral tabs.",
  ].join("\n");
}
