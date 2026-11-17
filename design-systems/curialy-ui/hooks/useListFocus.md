package: @curialy/ui

# useListFocus

Manages keyboard navigation within a linear list following WAI-ARIA menu/listbox/toolbar patterns. Supports arrow key navigation (vertical, horizontal, or both), Home/End for boundaries, optional wrap-around, RTL, and Escape to close. Opt into hasRovingTabIndex for composite widgets (toolbars, segmented controls, tab strips) that own a single tab stop. Suitable for dropdown menus, toolbars, and any 1D focusable list.

## Best Practices

- **Do:** Set orientation to 'horizontal' for toolbars and tab bars, 'vertical' for dropdown menus.
- **Do:** Provide an onEscape callback for menus/dropdowns to return focus to the trigger.
- **Do:** Enable hasRovingTabIndex (and hasCaretGuard when the widget can contain text inputs) for toolbar-style composites that should be a single tab stop.
- **Don't:** Use for 2D grid navigation; prefer useGridFocus for grids and calendars.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseListFocusOptions` | - | Configuration object for list focus behavior. All fields are optional. |
| `options.itemSelector` | `string` | `'[role="menuitem"]'` | Selector for focusable items within the list. |
| `options.boundarySelector` | `string` | - | Selector identifying a list boundary, for lists that contain nested lists of the same kind (e.g. a menu with submenu flyouts). When set, item collection and key handling are scoped to this level's own container. Typically '[role="menu"]'. |
| `options.wrap` | `boolean` | `true` | Whether arrow navigation wraps around at the ends. |
| `options.onEscape` | `() => void` | - | Callback when Escape key is pressed (e.g., close menu). Supplying it also consumes the key (preventDefault); without it Escape passes through to the surrounding layer. |
| `options.orientation` | `'horizontal' \| 'vertical' \| 'both'` | `'vertical'` | Navigation orientation. 'horizontal' uses ArrowLeft/ArrowRight, 'vertical' uses ArrowUp/ArrowDown, 'both' accepts all four arrows. |
| `options.hasHomeEnd` | `boolean` | `true` | Whether Home/End jump to the first/last enabled item. |
| `options.hasPaging` | `boolean` | `false` | Whether PageDown/PageUp page through a scrolling list: PageDown moves to the last enabled item fully visible in the container, and pressed there again one viewport further; PageUp mirrors it. Neither wraps; in a list that does not scroll they act as End/Home. |
| `options.hasRovingTabIndex` | `boolean` | `false` | Opt into roving-tabindex ownership: the hook stamps a single tab stop (one item tabindex="0", the rest -1), repairs it as items mount/unmount or toggle disabled, and moves it with arrow navigation. When false, the hook only moves focus and never touches tabindex. |
| `options.hasCaretGuard` | `boolean` | `false` | When true, arrow keys are not stolen from a nested text input/textarea whose caret is not at the boundary in the direction of travel (or that has a selection), and are never stolen from a nested contenteditable (rich-text editor / chat composer). Preserves inline text editing within the list. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `listRef` | `React.RefObject<HTMLElement \| null>` | Ref to attach to the list container element. |
| `handleKeyDown` | `(e: React.KeyboardEvent) => void` | Key down handler to attach to the list container. |
| `handleFocus` | `(e: React.FocusEvent) => void` | Focus handler for the container. Keeps the roving tab stop in sync when hasRovingTabIndex is enabled; a no-op otherwise, so it is always safe to attach. |
| `focusItem` | `(index: number) => void` | Focus a specific item by index (clamped to valid range). |
| `focusFirst` | `() => boolean` | Focus the first enabled item. Returns true when an item was focused. |
| `focusLast` | `() => boolean` | Focus the last enabled item. Returns true when an item was focused. |
| `ownsEvent` | `(e: React.KeyboardEvent) => boolean` | Whether a key event belongs to this list level rather than a nested list sharing the same boundarySelector. Always true when no boundarySelector is set. Use to guard consumer-added key handling (Enter/Space, typeahead). |
| `getItems` | `() => HTMLElement[]` | This level's focusable items in DOM order (already scoped by boundarySelector). Build typeahead targets from this instead of re-querying. |


Block templates: design_system component <name> --blocks for TabMenu, Toolbar
