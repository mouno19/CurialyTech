package: @astryxdesign/core

# useSnapPaging

Gives a Carousel iOS paging on native snap's stops: pass the value as hasSnap={useSnapPaging()}. Under a finger and on a trackpad swipe, a flick moves one view, or one item with {pages: 'item'}, and the row rests on an item's start edge. A mouse wheel keeps native snapping. Only a carousel given the value loads the paging code.

## Best Practices

- **Do:** Use it for a row read one view at a time, such as onboarding screens or a photo strip, where a fast flick must not skip past the next view.
- **Do:** Pass {pages: 'item'} when several items show at once and each flick should move only one of them.
- **Don't:** Use it for a row people scan quickly; plain hasSnap keeps native momentum, which can pass several items in one swipe.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `{pages?: 'view' \| 'item'}` | `{pages: 'view'}` | What one flick moves. 'view' moves one view and lands on the item start edge nearest one viewport on; 'item' moves one item. A new value applies from the next flick. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `paging` | `SnapPaging` | Snap paging for Carousel's hasSnap. The value is the same for the component's life, and Carousel keeps the value it first attached. |


Block templates: astryx component <name> --blocks for Carousel
