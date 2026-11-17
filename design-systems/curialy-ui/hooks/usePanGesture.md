package: @curialy/ui

# usePanGesture

Reports a drag on an element as values, for a surface the product moves itself: a card that follows the finger, a drawer pulled by its handle. A finger, a mouse and a pen all drive it. A mouse or pen drag that starts on selectable text selects that text, and the pan reports nothing. Give that text `user-select: none`. The drag claims its touch at UIKit’s 10 pt, as `UIPanGestureRecognizer` does, so a tap stays a tap, and a press or a long press is never reported as a pan. With `axis`, a scroll across that axis that starts on the element stays the page’s; without it, the pan takes a drag in any direction, so a finger’s scroll that starts on the element moves the element instead of the page. A trackpad scroll still scrolls the page. The hook is a thin layer over `createPanGesture`, the same API for code without React. A drag has no keyboard or assistive-technology path of its own: whatever the drag does needs another way to do it, such as buttons or arrow keys (WCAG 2.5.7). The pan moves nothing itself, so Reduce Motion applies to the motion you drive from it: honor the user’s reduced-motion setting in the animation that moves the element. Where a component already offers the behavior, use its prop instead: BottomSheet’s `snapPoints`, Carousel’s `hasSnap`.

## Best Practices

- **Do:** Move the element from `translation` added to where it was when the drag began, so it moves with the finger from the moment the drag claims it.
- **Do:** At `ended`, hand `velocity` to the animation that settles the element, so a flick carries on at the speed it was released.
- **Do:** Give every drag another way to do the same thing from a keyboard and from assistive technology, such as buttons, arrow keys or a menu.
- **Do:** Use a component's own prop when it covers the job: BottomSheet's `snapPoints` for a sheet, Carousel's `hasSnap` for paging.
- **Don't:** Hold the drag offset in a large component’s state: each `changed` event renders the component that holds it.
- **Don't:** Recognize taps or long presses with it; `useLongPress` and the components’ own press handling own those.

## Accessibility

- **Keyboard and assistive technology:** A drag has no keyboard or assistive-technology path of its own: whatever the drag does needs another way to do it, such as buttons, arrow keys or a menu.
- **Reduce Motion:** The pan moves nothing itself, so Reduce Motion applies to the motion you drive from it: a settle or a throw goes to its end without travel when the person asks for reduced motion.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `ref` | `RefObject<Element \| null>` | - | The element to drag. The hook creates one pan for the element behind the ref, creates a new one when the ref moves to another node or `axis` changes, and destroys it at unmount; a drag in progress then ends without a `cancelled` event, since an effect never calls `onPan`. **(required)** |
| `options` | `PanGestureOptions` | - | Configuration object. **(required)** |
| `options.axis` | `'x' \| 'y'` | - | Limits the drag to one axis. A drag along the other axis is not reported, and that component of every value reads 0. Omit it to report both axes. |
| `options.onPan` | `(event: PanGestureEvent) => void` | - | Called with `{state, translation, velocity}` as the drag begins, changes, ends at the release, or is cancelled. `state` is 'began', 'changed', 'ended' or 'cancelled'. `translation` is the movement since the drag began, in pixels: the travel the drag needed to begin is not part of it, so an element that follows it does not jump. `velocity` is in pixels per second; at 'ended' it is the release velocity (0 when the finger rested before lifting), and at 'cancelled' it is 0. Read through a ref: a new function each render re-creates nothing. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `void` | `void` | Nothing: the hook hands out no recognizer. Without React, `createPanGesture(element, options)` takes the same options and returns `{destroy}`, which removes every listener it added and cancels a drag in progress. |


Block templates: design_system component <name> --blocks for BottomSheet, Carousel
