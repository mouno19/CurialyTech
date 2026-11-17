package: @curialy/ui

# useOverflow

Measures children rendered in a hidden container to determine how many fit in the available width without flickering. Uses ResizeObserver to react to container and measured-child size changes. The measurement container should hold all items plus an optional overflow indicator element (identified by a data-overflow-indicator attribute).

## Best Practices

- **Do:** Render all items into the measureRef container (hidden) and only the first visibleCount items into the containerRef container (visible).
- **Do:** Include an overflow indicator (e.g., "+N more" button) as the last child of the measurement container with a data-overflow-indicator attribute.
- **Don't:** Use for vertical overflow; this hook measures horizontal width only.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `itemCount` | `number` | - | Total number of items to measure for overflow. **(required)** |
| `options` | `UseOverflowOptions` | - | Configuration object for overflow behavior. |
| `options.gap` | `number` | `0` | Gap between items in pixels. Used in width calculations. |
| `options.minVisibleItems` | `number` | `0` | Minimum number of items to always show, even if they don't fit. |
| `options.collapseFrom` | `'start' \| 'end'` | `'end'` | which end to collapse items from. |
| `options.behavior` | `'observeParent' \| 'observeSelf'` | `'observeSelf'` | Which element to observe for overflow calculations. 'observeParent' uses the container's parent element width, allowing the visible container to remain content-sized. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `containerRef` | `React.RefCallback<HTMLElement>` | Ref callback to attach to the visible container element. |
| `measureRef` | `React.RefCallback<HTMLElement>` | Ref callback to attach to the hidden measurement container that holds all items. |
| `visibleCount` | `number` | Number of items that fit in the visible container. |
| `hasOverflow` | `boolean` | Whether any items are overflowing (visibleCount < itemCount). |


Block templates: design_system component <name> --blocks for OverflowList, Breadcrumb
