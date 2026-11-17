package: @curialy/ui

# useMenuPress

The press model of macOS and iOS menus, for any pointer: the row under the pointer when it is RELEASED is the row that acts, the highlight follows the pointer while it is held, a mouse opens the menu on press and can drag straight into it, and a finger or a pen opens it while still down: as it presses with no delay given, picking a row only after moving 10 px, or else once it is held for the delay. The pointer is tracked at document level by pointerId, so a finger that slid off the row it landed on is still followed; the click the browser reports at the end of a touch, aimed at the row where the touch began, is swallowed so nothing acts twice. DropdownMenu, ContextMenu, DropdownMenuSubMenu, Selector and the menu bottom sheet already mount it; reach for it directly only when building a menu-like surface of your own.

## Best Practices

- **Do:** Pass a selector for ENABLED rows only, so a disabled row or a divider under the pointer clears the highlight instead of lighting up.
- **Do:** Let the default highlight move focus in a menu; supply onHighlight only for a listbox that must keep focus on its combobox and highlight through aria-activedescendant.
- **Do:** Declare touch-action on the menu root: pinch-zoom when its rows fit, pan-y pinch-zoom when it scrolls, so the browser — not the hook — decides when a finger is scrolling, and a two-finger pinch still zooms the page.
- **Don't:** Act on a row from its own pointerdown or pointerup handler as well; the hook already activates the row under the release, and a second path acts twice.
- **Don't:** Read a row click with detail 0 as a keyboard activation; the hook dispatches its pointer activation with detail 0 too. Use isMenuPressActivation() to tell them apart.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseMenuPressOptions` | - | Configuration object. **(required)** |
| `options.menuRef` | `RefObject<HTMLElement \| null>` | - | The menu or listbox root — the surface whose rows a press picks from. **(required)** |
| `options.itemSelector` | `string` | - | Selector matching the ENABLED rows. A pointer over anything else inside the menu (a divider, a heading, a disabled row) highlights nothing. **(required)** |
| `options.triggerRef` | `RefObject<HTMLElement \| null>` | - | The control that opens the menu, when a press may start there. |
| `options.onTriggerPress` | `(pointerType: MenuPressPointerType) => boolean` | - | A mouse pressed the trigger, or a finger or a pen opened it: as it pressed, with no longPressDelayMs given, or else once it had rested for that delay. Open the menu under the held pointer and return whether it opened. Return false when the press closed an open menu instead. |
| `options.onHighlight` | `(row: HTMLElement \| null) => void` | - | Move the highlight; null clears it. Defaults to moving DOM focus with preventScroll onto the row, and onto the menu root when there is no row; after a pointer press that focus does not match :focus-visible. A picker that highlights through aria-activedescendant supplies its own. |
| `options.onActivate` | `(row: HTMLElement, release: PointerEvent) => void` | - | Act on the row under the release. Defaults to dispatching a click on the row that carries the release button and modifier keys. |
| `options.onDismiss` | `() => void` | - | Close the menu: a MOUSE was released outside it with nothing acting. A finger released outside leaves the menu open, so this is never called then. |
| `options.getScroller` | `() => HTMLElement \| null` | - | The element to scroll while a tracked pointer rests near its top or bottom edge. Defaults to the menu root when it overflows. |
| `options.longPressDelayMs` | `number` | - | How long a finger must rest on the trigger before the menu opens under it. Unset, a finger on every device opens the menu as it presses, or after 150 ms inside a scroll view. Set, it is that wait everywhere. A tap released sooner opens the menu through the trigger's click. |
| `options.isEnabled` | `boolean` | `true` | Whether the model is live. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `menuProps` | `{onPointerDown; "data-cui-menu-press": ""}` | Spread onto the menu root. Claims presses that begin inside it and marks the root as carrying the press model. |
| `triggerProps` | `{onPointerDown; onContextMenu}` | Spread onto the trigger: a mouse press opens the menu at once. A finger or a pen opens it while still down: as it presses, with no longPressDelayMs given (inside a scroll view, once the 150 ms content-touch delay passes with no scroll), or else once it is held for that delay. |
| `isTriggerClickFromPress` | `() => boolean` | Whether the click reaching the trigger belongs to the gesture that just pressed it. That press already opened or closed the menu, so the click must neither toggle nor reopen. |
| `cancel` | `() => void` | End the gesture in flight with nothing acting, for when the menu closes under it. |


Block templates: design_system component <name> --blocks for DropdownMenu, ContextMenu, Selector
