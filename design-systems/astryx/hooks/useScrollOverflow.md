package: @astryxdesign/core

# useScrollOverflow

Tracks scroll overflow state for a horizontally scrollable container. Returns a ref callback and state booleans that update as the user scrolls, the container resizes, or its content changes (a child added, removed or resized, or a new gap or padding). Uses scroll event listeners, ResizeObserver and MutationObserver for reactive updates. Tolerance of 1px is applied to avoid sub-pixel false positives.

## Best Practices

- **Do:** Use to show/hide scroll navigation buttons or fade edges on carousels and horizontal lists.
- **Do:** Apply the scrollRef to a container with overflow-x: auto or overflow-x: scroll.
- **Don't:** Use for vertical scroll tracking; this hook only measures horizontal overflow.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `scrollRef` | `React.RefCallback<HTMLElement>` | Ref callback to attach to the horizontally scrollable container element. |
| `overflowStart` | `boolean` | Whether content overflows the start edge (left in LTR, right in RTL). |
| `overflowEnd` | `boolean` | Whether content overflows the end edge (right in LTR, left in RTL). |
| `hasOverflow` | `boolean` | Whether the container has any scroll overflow at all (scrollWidth > clientWidth). |


Block templates: astryx component <name> --blocks for Carousel
