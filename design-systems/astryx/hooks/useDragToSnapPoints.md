package: @astryxdesign/core

# useDragToSnapPoints

Lets a drag move an element along one axis and settles it on snap points when the finger lifts, the way an iOS sheet settles on its detents: on the nearest snap point to where it is, on the next one in its direction after a quick flick, and back where it started when the finger was moving back. The settle continues the release's velocity. For a bottom sheet, use BottomSheet's `snapPoints`; for a scrolling row, Carousel's `hasSnap`. Outside React, use `createDragToSnapPoints`.

## Best Practices

- **Do:** Offer the same positions without a drag: buttons or keys that call `settleTo`.
- **Do:** Keep the settled index in state from `onSettle`, and render what the position means from it.
- **Don't:** Use it for a sheet or a carousel: their own props already settle the way people expect.

## Accessibility

- **Keyboard and assistive technology:** A drag is one way in, never the only one. Give each snap point a control a keyboard and a screen reader can reach, such as Expand and Collapse buttons, and call `settleTo` from it. When a position changes what the element shows, announce the change.
- **Reduce Motion:** When the person asks for reduced motion, the settle after a touch drag becomes a short cross-fade into the snap point, as does any settle on a device whose primary pointer is coarse, such as a tablet; after a mouse or pen drag elsewhere it lands at once. `settleTo` fades on such a device and lands at once with a fine primary pointer. While the finger is down, the element still follows it.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `ref` | `RefObject<HTMLElement \| null>` | - | A ref to the element a drag moves, along `axis` only. **(required)** |
| `options.axis` | `'x' \| 'y'` | - | The axis the element moves along. A new one creates the drag again, starting where the element is. **(required)** |
| `options.snapPoints` | `number[]` | - | Offsets in px along `axis` from the element's resting position, such as `[0, 240, 480]`, sorted before use (`onSettle` and `settleTo` count in that order); an empty list makes the drag do nothing. Unlike BottomSheet's `snapPoints`, they are not fractions of the viewport. New ones create the drag again and nothing more: the element stays where it is, a settle in flight included, and the next drag or `settleTo` starts there. **(required)** |
| `options.flickThreshold` | `number` | `1008` | A release faster than this, in px/s, carries to the next snap point in its direction. The default is the flick speed measured for UIKit's sheet. A new one creates the drag again, as new snap points do. |
| `options.onSettle` | `(index: number) => void` | - | Called with the snap point's index once the element settles on it. The latest function is the one called, so it may be new on every render. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `settleTo` | `(index: number) => void` | Settles the element on the snap point at `index` without a drag: the keyboard path. The same function on every render. |


Block templates: astryx component <name> --blocks for BottomSheet, Carousel
