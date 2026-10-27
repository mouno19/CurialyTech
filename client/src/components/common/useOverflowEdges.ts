import { useEffect, type RefObject } from "react";

/**
 * For horizontal scrollers such as .tabs: sets data-overflow="start" | "end" | "start end" so CSS
 * fades the cut-off edge instead of showing a scrollbar, and keeps the selected child
 * ([data-state=active] / [aria-selected=true]) in view by adjusting scrollLeft (never
 * scrollIntoView, which also scrolls ancestors). The element should be position: relative.
 */
export function useOverflowEdges(ref: RefObject<HTMLElement | null>, { revealSelected = true }: { revealSelected?: boolean } = {}) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = element;
      const edges = [scrollLeft > 1 && "start", scrollLeft + clientWidth < scrollWidth - 1 && "end"].filter(Boolean).join(" ");
      if (edges) element.dataset.overflow = edges;
      else delete element.dataset.overflow;
    };
    const reveal = () => {
      if (!revealSelected) return;
      const selected = element.querySelector<HTMLElement>('[data-state="active"], [aria-selected="true"]');
      if (!selected) return;
      const left = selected.offsetLeft;
      const right = left + selected.offsetWidth;
      if (left < element.scrollLeft) element.scrollLeft = Math.max(0, left - 24);
      else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth + 24;
    };
    reveal();
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const changes = new MutationObserver(() => {
      reveal();
      update();
    });
    changes.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "aria-selected"] });
    return () => {
      element.removeEventListener("scroll", update);
      resize.disconnect();
      changes.disconnect();
    };
  }, [ref, revealSelected]);
}
