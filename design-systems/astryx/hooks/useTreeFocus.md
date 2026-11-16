package: @astryxdesign/core

# useTreeFocus

Manages roving-tabindex focus and the WAI-ARIA tree keyboard model. ArrowUp/ArrowDown/Home/End roam linearly over the visible treeitems (skipping disabled ones), while ArrowRight/ArrowLeft carry tree semantics (expand/collapse, move to first-child/parent). Enter/Space activate, and printable characters trigger typeahead.

## Best Practices

- **Do:** Use for hierarchical tree widgets: wire onToggleExpand to your expansion state and onActiveChange to a single roving tab stop.
- **Do:** Attach both treeRef and handleKeyDown to the role="tree" container element.
- **Don't:** Use for linear lists (prefer useListFocus) or 2D grids (prefer useGridFocus); those traversals differ from a tree.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseTreeFocusOptions` | - | Configuration object for tree focus behavior. |
| `options.itemSelector` | `string` | `'[role="treeitem"]'` | Selector for visible treeitems within the tree, in DOM order. |
| `options.isItemDisabled` | `(item: HTMLElement) => boolean` | - | Predicate for whether a treeitem is disabled and must be skipped during navigation. Defaults to reading `data-tree-disabled` / `aria-disabled`. |
| `options.getLevel` | `(item: HTMLElement) => number` | - | Reads the 1-based nesting level of a treeitem. Defaults to the `aria-level` attribute. |
| `options.onToggleExpand` | `(id: string) => void` | - | Called to expand/collapse the treeitem with the given id (ArrowRight on a collapsed parent, ArrowLeft on an expanded parent, Enter/Space on a parent without its own action). |
| `options.onActivate` | `(item: HTMLElement, id: string \| undefined) => boolean \| void` | - | Called when Enter/Space activates a treeitem. Return true when handled; return false/undefined to let the hook fall back to toggling expansion. |
| `options.onActiveChange` | `(id: string \| undefined) => void` | - | Notified when the hook moves focus to a treeitem. Consumers use this to move a single roving tab stop. |
| `options.hasRovingTabIndex` | `boolean` | `false` | When true, the hook owns a single roving tab stop across the visible treeitems (stamps tabindex 0/-1, repairs on mount, moves with navigation). Preserves an existing tabindex="0" seed on mount. Attach the returned `handleFocus` to keep the stop in sync after clicks. |
| `options.typeahead` | `boolean` | `true` | Whether typeahead (jump to next item whose text starts with the typed characters, ignoring case, accents, the stroked letters đ ł ø ħ ŧ ƀ and Turkish ı/İ in every locale) is enabled. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `treeRef` | `React.RefObject<HTMLElement \| null>` | Ref to attach to the tree container element (role="tree"). |
| `handleKeyDown` | `(e: React.KeyboardEvent) => void` | Key down handler to attach to the tree container. |
| `handleFocus` | `(e: React.FocusEvent) => void` | Focus handler to attach to the container's onFocus. Keeps the roving tab stop in sync when hasRovingTabIndex is enabled; a no-op otherwise, so always safe to attach. |
| `focusFirst` | `() => void` | Focus the first enabled visible treeitem. |
| `focusLast` | `() => void` | Focus the last enabled visible treeitem. |


Block templates: astryx component <name> --blocks for TreeList
