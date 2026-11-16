package: @astryxdesign/core

# createReorderable

Makes a collection's rows reorderable. On a touch screen a finger held still on a row's handle for a moment picks it up (a flick on the handle still scrolls): the row stays in its place, dimmed, while a copy of it follows the finger and an accent line marks where it would land; the other rows stay still, the page scrolls near its edges, and on release the rows rearrange. A pen held still on a handle where the primary pointer is coarse picks the row up as a finger does. A mouse, or a pen where the primary pointer is fine, drags a handle at once the same way, and the rows take their places without motion; a cancelled drag puts everything back at once. Without a drag, the handle toggles reorder mode for its row (a click, Space or Enter): each arrow key moves the row a place at once, and Escape or another activation ends the mode, keeping the moves; screen readers hear each move with the row's place and neighbours, and a hint shows the moves and Done as buttons, for taps alone. The reorder code ships with this function: a collection without the prop loads none of it.

## Best Practices

- **Do:** Give each row a stable key from your data, a string or a number (`itemKey={item.id}`), and apply each move by rendering the items in their new order in the same task.
- **Do:** Use `isReorderable` for rows that must stay put, such as a pinned first row.
- **Do:** Offer reorder mode from your own UI too, such as a row's context menu, with `reorderable.start(item.id)`.
- **Don't:** Use React's `key` as the reorder key, or index-based keys: a move changes every index after it.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `onReorder` | `(move: {key: Key; to: number}) => void` | - | Called once per committed move (a drop, or each move in reorder mode) with the moved item's key and its index after the move, in the full order of the collection's items. Apply it by rendering the items in their new order. A cancelled move calls nothing. The latest function given is the one called, so the object may be made on every render. **(required)** |
| `isReorderable` | `(key: Key) => boolean` | - | Whether the item with this key can move. An item it rejects shows no handle and cannot be picked up; one at either end of the collection also bounds the others, so nothing drops beyond it and a keyboard move into it is refused. Every item moves without it. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `reorderable` | `Reorderable` | The collection's reorder behavior: pass it as `List`'s `reorderable` prop, with an `itemKey` on each `ListItem`. Make it once per collection (with useMemo); one made on every render still works. Its one method, `start(key)`, enters reorder mode for that item from your own UI (a Move item in its context menu, a toolbar button): the focus moves to its handle, as activating it does; a key that cannot move or is not mounted does nothing and warns in development. One object may serve several collections, each reordering on its own; `start` then uses the one mounted last. |


Block templates: astryx component <name> --blocks for List
