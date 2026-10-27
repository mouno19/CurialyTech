import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// Follow a growing log (conversation, activity, terminal, thinking) only while the reader is at
// its end. The decision is a pure step function (tested in stickToBottom.test.ts); the hook feeds
// it scroll events, item counts and size changes, and scrolls by setting scrollTop directly
// (never scrollIntoView, which also scrolls ancestors and the page).

export const STICK_THRESHOLD = 80;

export type StickModel = {
  /** New content scrolls into view. */
  following: boolean;
  /** Items that arrived while not following (the "N new" on the pill). */
  unseen: number;
  /** scrollTop at the last scroll event (direction of the reader's scroll). */
  lastTop: number;
};

export type StickInput =
  /** programmatic: the event came from our own scrollTop write. */
  | { type: "scroll"; top: number; height: number; client: number; programmatic: boolean }
  /** Content grew; added = new items (0 for growth inside an item: streamed text, a late image). */
  | { type: "grow"; added: number }
  /** The user just sent a message: show it and what follows. */
  | { type: "sent" }
  /** "Jump to latest". */
  | { type: "jump" };

export type StickStep = { model: StickModel; scroll: boolean };

export const initialStick = (following = true): StickModel => ({ following, unseen: 0, lastTop: 0 });

export const distanceFromBottom = (top: number, height: number, client: number) => Math.max(0, height - client - top);

/**
 * One decision. At the very bottom: follow. A scroll up by the reader: stop following at once
 * (otherwise streamed growth would keep pulling a trackpad back down while it is inside the
 * threshold). Back within `threshold` of the bottom: follow again. Our own scrolls change nothing.
 */
export function stickStep(model: StickModel, input: StickInput, threshold = STICK_THRESHOLD): StickStep {
  switch (input.type) {
    case "scroll": {
      if (input.programmatic) return { model: { ...model, lastTop: input.top }, scroll: false };
      const distance = distanceFromBottom(input.top, input.height, input.client);
      const movedUp = input.top < model.lastTop - 1;
      let following = model.following;
      if (distance <= 1) following = true;
      else if (movedUp) following = false;
      else if (distance <= threshold) following = true;
      return { model: { following, unseen: following ? 0 : model.unseen, lastTop: input.top }, scroll: false };
    }
    case "grow":
      if (model.following) return { model: model.unseen ? { ...model, unseen: 0 } : model, scroll: true };
      return { model: input.added > 0 ? { ...model, unseen: model.unseen + input.added } : model, scroll: false };
    case "sent":
    case "jump":
      return { model: { ...model, following: true, unseen: 0 }, scroll: true };
  }
}

export type StickView = { following: boolean; unseen: number; away: boolean };

export type StickToBottom = StickView & {
  /** Show the pill: not following and scrolled away from the end. */
  showJump: boolean;
  jump: () => void;
  /** Call right before the user's own message is added: it and the reply stay in view. */
  stickNext: () => void;
  /** Scroll so `element` is near the top and stop following (e.g. "View logs" → the error). */
  reveal: (element: HTMLElement | null) => void;
};

type Options = {
  threshold?: number;
  /** Number of items in the log; an increase while not following counts as unseen. */
  count?: number;
  /** false: leave the scroller alone (e.g. a finished terminal); the model still tracks the reader. */
  enabled?: boolean;
  /**
   * The scroller element itself, when it can be replaced (a layout change remounts it): listeners
   * move to the new element, which continues where the reader was (following: at the bottom).
   */
  element?: HTMLElement | null;
};

/**
 * Stick-to-bottom for a scroll container whose first element child holds the content.
 * Growth is observed with a ResizeObserver (late images, code highlighting, streamed text);
 * a pane that was hidden (display:none) gets its position back when it is shown again.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, { threshold = STICK_THRESHOLD, count = 0, enabled = true, element: watched }: Options = {}): StickToBottom {
  const model = useRef<StickModel>(initialStick());
  const [view, setView] = useState<StickView>({ following: true, unseen: 0, away: false });
  const expected = useRef<number | null>(null);
  const lastCount = useRef(count);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const publish = useCallback(() => {
    const element = ref.current;
    const away = element ? distanceFromBottom(element.scrollTop, element.scrollHeight, element.clientHeight) > threshold : false;
    const { following, unseen } = model.current;
    setView(previous => (previous.following === following && previous.unseen === unseen && previous.away === away ? previous : { following, unseen, away }));
  }, [ref, threshold]);

  const scrollTo = useCallback((top: number) => {
    const element = ref.current;
    if (!element || element.clientHeight === 0) return;
    if (Math.abs(element.scrollTop - top) <= 1) return;
    element.scrollTop = top;
    expected.current = element.scrollTop;
    // The scroll event for this write fires before the next frame's callbacks; forget it after that.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      expected.current = null;
    }));
  }, [ref]);

  const toBottom = useCallback(() => {
    const element = ref.current;
    if (element) scrollTo(element.scrollHeight - element.clientHeight);
  }, [ref, scrollTo]);

  const run = useCallback((input: StickInput) => {
    const step = stickStep(model.current, input, threshold);
    model.current = step.model;
    if (step.scroll && enabledRef.current) toBottom();
    publish();
  }, [threshold, toBottom, publish]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // A new element (remounted after a layout change) starts where the reader was.
    if (watched !== undefined) {
      if (model.current.following) toBottom();
      else model.current = { ...model.current, lastTop: element.scrollTop };
      publish();
    }
    const onScroll = () => {
      const programmatic = expected.current !== null && Math.abs(element.scrollTop - expected.current) <= 1;
      run({ type: "scroll", top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight, programmatic });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    let hidden = element.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === 0) {
        hidden = true;
        return;
      }
      if (hidden) {
        // Shown again after display:none, which resets scrollTop in some browsers.
        hidden = false;
        if (model.current.following) toBottom();
        else scrollTo(model.current.lastTop);
      } else if (model.current.following && enabledRef.current) {
        toBottom();
      }
      publish();
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [ref, run, toBottom, scrollTo, publish, watched]);

  // Before paint, so a followed log never shows a frame of the old position.
  useLayoutEffect(() => {
    const added = count - lastCount.current;
    lastCount.current = count;
    if (added > 0) run({ type: "grow", added });
  }, [count, run]);

  const jump = useCallback(() => run({ type: "jump" }), [run]);
  const stickNext = useCallback(() => run({ type: "sent" }), [run]);
  const reveal = useCallback((target: HTMLElement | null) => {
    const element = ref.current;
    if (!element || !target) return;
    model.current = { ...model.current, following: false };
    const top = target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - 12;
    scrollTo(Math.max(0, top));
    model.current = { ...model.current, lastTop: element.scrollTop };
    publish();
  }, [ref, scrollTo, publish]);

  return { ...view, showJump: !view.following && view.away, jump, stickNext, reveal };
}

/** For panes that only need their scroll position back after being hidden (display:none). */
export function useScrollMemory(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let top = element.scrollTop;
    let hidden = element.clientHeight === 0;
    const onScroll = () => {
      if (element.clientHeight > 0) top = element.scrollTop;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === 0) hidden = true;
      else if (hidden) {
        hidden = false;
        element.scrollTop = top;
      }
    });
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [ref]);
}
