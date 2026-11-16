package: @astryxdesign/core

# useGridFocus

Manages keyboard navigation within a 2D grid following the WAI-ARIA grid pattern. Supports arrow keys for cell-to-cell navigation, Home/End for row boundaries, Ctrl+Home/Ctrl+End for grid boundaries, and Page Up/Down for custom callbacks (e.g., month navigation in calendars). Boundary navigation callbacks allow cross-grid navigation.

## Best Practices

- **Do:** Use for calendar date grids: wire onPageUp/onPageDown to month navigation and onNavigateBefore/onNavigateAfter for cross-month arrow key navigation.
- **Do:** Attach both gridRef and handleKeyDown to the grid container element.
- **Do:** For roving-tabindex grids (e.g. Calendar), set hasRovingTabIndex: true and attach handleFocus to the container onFocus; seed one focus target with tabindex=0 and the hook repairs and moves it.
- **Don't:** Use for simple linear lists; prefer useListFocus for 1D navigation.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseGridFocusOptions` | - | Configuration object for grid focus behavior. **(required)** |
| `options.columns` | `number` | - | Number of columns in the grid. Used for up/down navigation (moves by this many cells). **(required)** |
| `options.cellSelector` | `string` | `'button:not([disabled]), [tabindex]:not([tabindex="-1"])'` | Selector for cells within the grid. Should match ALL cell positions in DOM order (including disabled/empty) so grid geometry is preserved. |
| `options.isCellFocusable` | `(cell: HTMLElement) => boolean` | - | Predicate for whether a matched cell can receive focus. Omit to treat every matched cell as focusable. |
| `options.getFocusTarget` | `(cell: HTMLElement) => HTMLElement \| null` | - | Resolves the element to focus for a cell, e.g. a button inside a role="gridcell" wrapper. Omit to focus the cell itself. |
| `options.onNavigateBefore` | `(column: number, offset: number) => void` | - | Callback when navigation would go before the first cell. Receives the column index and offset (1 for horizontal, columns for vertical). |
| `options.onNavigateAfter` | `(column: number, offset: number) => void` | - | Callback when navigation would go after the last cell. Receives the column index and offset. |
| `options.onPageUp` | `(event: React.KeyboardEvent) => void` | - | Callback for Page Up key (e.g., navigate to previous month in calendars). Receives the key event, so `event.shiftKey` can select a larger step, such as a year. |
| `options.onPageDown` | `(event: React.KeyboardEvent) => void` | - | Callback for Page Down key (e.g., navigate to next month in calendars). Receives the key event, so `event.shiftKey` can select a larger step, such as a year. |
| `options.hasRovingTabIndex` | `boolean` | `false` | Own a single roving tab stop across the grid: one focusable cell (its resolved focus target) carries tabindex="0", the rest -1. Stamped/repaired on render and moved with arrow navigation. Attach the returned handleFocus to the container onFocus. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `gridRef` | `React.RefObject<HTMLElement \| null>` | Ref to attach to the grid container element. |
| `handleKeyDown` | `(e: React.KeyboardEvent) => void` | Key down handler to attach to the grid container. |
| `handleFocus` | `(e: React.FocusEvent) => void` | Focus handler for the grid container. Keeps the roving tab stop in sync when hasRovingTabIndex is enabled; a no-op otherwise, so always safe to attach. |
| `focusCell` | `(index: number) => void` | Focus a specific cell by index (clamped to valid range). |
| `focusFirst` | `() => void` | Focus the first focusable cell in the grid. |
| `focusLast` | `() => void` | Focus the last focusable cell in the grid. |


Block templates: astryx component <name> --blocks for Calendar
