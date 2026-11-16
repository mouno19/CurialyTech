package: @astryxdesign/core

# useMultiCombobox

Tracks the active option of a multi-select combobox and handles its keys, while DOM focus stays on the control. It powers MultiSelector; unlike useCombobox, toggling an option keeps the list open, and rows can carry an action cell. It renders nothing and sets no attributes: the caller renders the control and the list, and wires the ARIA attributes from what it returns.

## Best Practices

- **Do:** Render each option with `id={getItemId(index)}` and pass `activeDescendantId` as the control's `aria-activedescendant`.
- **Do:** Use `isGrid` only when rows carry a control next to the option; give each action cell `id={getActionCellId(index)}`.
- **Do:** Announce the number of results through useAnnounce when the options change for a new query.
- **Don't:** Close the list after each toggle; a multi-select stays open so several options can be picked in a row.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseMultiComboboxOptions` | - | Configuration object. **(required)** |
| `options.selectableItems` | `MultiSelectorOptionData[]` | - | The options in the same order as they render. Options with `disabled` cannot be toggled and are skipped while moving through the open list. Opening never lands on a disabled option: ArrowUp opens on the last enabled option, and ArrowDown, a press, Enter or Space on the first enabled option. **(required)** |
| `options.isOpen` | `boolean` | - | Whether the list is shown. The caller owns this state. **(required)** |
| `options.onOpen` | `() => unknown` | - | Called to show the list. Return `false` to refuse; the hook then leaves the highlight alone. **(required)** |
| `options.onClose` | `() => void` | - | Called to hide the list. The highlight resets first. **(required)** |
| `options.onToggle` | `(itemValue: string) => void` | - | Called with the value of the option to add or remove. Toggling keeps the list open. **(required)** |
| `options.listboxId` | `string` | - | The listbox (or grid) element's id. Option and action-cell ids are derived from it. **(required)** |
| `options.hasSearch` | `boolean` | `false` | Whether the list has its own search field. Space then types instead of toggling, opening by a press or Enter does not pre-highlight (ArrowDown and ArrowUp still open on the first and last enabled option), Delete and Backspace edit the query, and type-to-select is off. Home and End still jump to the first and last option, so a search input that keeps them for the caret should stop them before this handler and rely on PageUp and PageDown. |
| `options.onClear` | `() => void` | - | Clears every selected value. When provided, Delete or Backspace on the closed control clears them, so clearing is not pointer-only. Ignored while the list is open or with `hasSearch`. |
| `options.hasValue` | `boolean` | `false` | Whether anything is selected. The Delete and Backspace clear is skipped when false. |
| `options.isGrid` | `boolean` | `false` | Whether each row pairs an option cell with an action cell. The inline-end arrow then moves the highlight to the row's action and the inline-start arrow back, following visual direction in right-to-left layouts, and Enter on the action runs `onActivateAction` instead of toggling. |
| `options.rowHasAction` | `(index: number) => boolean` | - | In a grid, whether the row at `index` has an action cell to move to. |
| `options.onActivateAction` | `(index: number) => void` | - | In a grid, runs the control in the highlighted row's action cell. The selection does not change. |
| `options.isDisabled` | `boolean` | `false` | Whether the control ignores clicks and keys. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `highlightedIndex` | `number` | Index of the active row, or -1 when none is active. |
| `setHighlightedIndex` | `(index: number) => void` | Sets the active row, for example after filtering. The highlight lands on the row's option cell. |
| `highlightedCell` | `'option' \| 'action'` | Which cell of the active row is highlighted; `'action'` only in a grid. |
| `activeDescendantId` | `string \| undefined` | The id to pass as the control's `aria-activedescendant`: the active option, or its action cell in a grid. Undefined while the list is closed or nothing is active. |
| `getItemId` | `(index: number) => string` | The id to render on the option at `index`. |
| `getActionCellId` | `(index: number) => string` | In a grid, the id to render on the action cell of row `index`. |
| `onTriggerClick` | `() => void` | Toggles the list from a press on the control. |
| `onKeyDown` | `(e: React.KeyboardEvent) => void` | Key handler for the control that keeps focus. ArrowDown and ArrowUp open the list or move the active row; Enter (and Space without search) toggles the active option and keeps the list open; Escape and Tab close it; Home, End, PageUp and PageDown jump to the first or last option; without search, typed characters move to the next option whose label starts with them, as in Selector (a repeated letter cycles, and a single letter searches from the option after the active one), and Space still toggles. |
| `onItemMouseEnter` | `(item: MultiSelectorOptionData, index: number, cell?: 'option' \| 'action') => void` | Makes the hovered option, or its action cell, active without scrolling the list or moving focus. |


Block templates: astryx component <name> --blocks for MultiSelector
