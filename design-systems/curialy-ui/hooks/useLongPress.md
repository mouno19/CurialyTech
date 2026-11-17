package: @curialy/ui

# useLongPress

Detects a single-finger press-and-hold and reports where it happened, so touch users can reach affordances that a pointer gets from right-click. iOS Safari never synthesizes a contextmenu event on long-press, which makes this the only touch route into a cursor-positioned surface such as ContextMenu. The press cancels on movement, lift, multi-touch or unmount. The hold is timed on the touch events’ own timestamps: when a busy page handles the lift late, a finger held for the full delay still reports its long press, before the lift acts.

## Best Practices

- **Do:** Use the reported point to position the surface you open, so it appears under the finger.
- **Do:** Pair it with the pointer contextmenu handler rather than replacing it; this hook only covers touch.
- **Don't:** Use it for the primary action of a control; press-and-hold is undiscoverable as the only way to do something.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseLongPressOptions` | - | Configuration object. **(required)** |
| `options.onLongPress` | `(point: {x: number; y: number}) => void` | - | Fired with the touch start point once the press is held for delayMs. **(required)** |
| `options.disabled` | `boolean` | `false` | When true, the returned touch handlers are inert. |
| `options.delayMs` | `number` | `500` | Hold duration before the press fires, in milliseconds. |
| `options.moveCancelPx` | `number` | `10` | Movement past this distance on either axis cancels the press, treating it as a scroll or drag. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `handlers` | `UseLongPressHandlers` | onTouchStart, onTouchMove, onTouchEnd and onTouchCancel to spread onto the target element. |


Block templates: design_system component <name> --blocks for ContextMenu
