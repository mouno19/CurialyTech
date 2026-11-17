package: @curialy/ui

# useAnimatedLayout

Returns a handle to pass to a component whose size changes, such as TreeList or Collapsible. When that component changes size, it and the content after it inside `containerRef` animate together on one shared motion role. Fixed and stuck sticky elements stay put, the glide never scrolls the area, and Reduce Motion is respected. It applies under every pointer, a mouse included. Without the handle a component keeps its jump: content after it takes its place at once. Content after the change may mix Curialy UI components and your own elements; none of it opts in.

## Best Practices

- **Do:** Create one handle per scroll container or panel and pass the same handle to every component in it whose size changes.
- **Do:** Pass the ref you already give ScrollableArea as containerRef; ScrollableArea does not register itself.
- **Don't:** Wrap the content after a disclosure in an extra element to make it move; everything after the change inside the container moves on its own.
- **Don't:** Animate height yourself alongside it; the glide moves content with a compositor translate and never animates height.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.containerRef` | `RefObject<HTMLElement \| null>` | - | The area the glide stays inside: the ref you already give your scroll container or panel. A ScrollableArea ref reaches its native scroll viewport, so pass that. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `animatedLayout` | `AnimatedLayout` | An opaque handle with no public members. Pass it to the animatedLayout prop of a component whose size changes, such as TreeList or Collapsible. |


Block templates: design_system component <name> --blocks for TreeList, Collapsible, ScrollableArea
