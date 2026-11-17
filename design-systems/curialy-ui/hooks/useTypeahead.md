package: @curialy/ui

# useTypeahead

Adds APG type-to-focus search to a collection: printable keystrokes are buffered (resetting after a pause), and the first item whose label starts with the buffer (ignoring case, accents, the stroked letters đ ł ø ħ ŧ ƀ and Turkish ı/İ, the same in every locale; a typed accent prefers the exact match) is reported through onMatch. Pressing the same letter repeatedly cycles through the matches rather than filtering deeper. It moves nothing itself; pair it with the collection's own focus management, most often useListFocus or useGridFocus.

## Best Practices

- **Do:** Wire onMatch to the focus manager you already have (useListFocus.focusItem) instead of moving focus yourself.
- **Do:** Let it see the key event first and fall through to arrow-key navigation only when it returns false.
- **Do:** Pass getCurrentIndex so repeated presses of one letter walk through matches instead of sticking on the first.
- **Don't:** Use it on a text input; the field already receives the characters, and typeahead would fight the value.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseTypeaheadOptions` | - | Configuration object. **(required)** |
| `options.getItemLabels` | `() => ReadonlyArray<string \| null \| undefined>` | - | Returns the item labels in DOM order. A null or empty entry marks a non-matchable slot and keeps indices aligned with the caller's items. **(required)** |
| `options.onMatch` | `(index: number) => void` | - | Called with the index of the matched item so the caller can focus or select it; typically useListFocus's focusItem. **(required)** |
| `options.getCurrentIndex` | `() => number` | `() => -1` | The index to search from, usually the focused item, so repeated presses of one letter cycle through matches. A negative value means nothing is current. |
| `options.resetMs` | `number` | `750` | Milliseconds of inactivity after which the typed buffer resets. |
| `options.isDisabled` | `(index: number) => boolean` | - | Whether an index should be skipped, e.g. disabled items. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `onKeyDown` | `(e: React.KeyboardEvent \| KeyboardEvent) => boolean` | Keydown handler. Returns true when it consumed a printable character, so the caller can stop its own key handling. |
| `reset` | `() => void` | Clears the pending buffer, e.g. when the collection closes. |


Block templates: design_system component <name> --blocks for DropdownMenu, Selector, TreeList
