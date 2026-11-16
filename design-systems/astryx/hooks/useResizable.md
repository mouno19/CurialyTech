package: @astryxdesign/core

# useResizable

Hook for adding drag-to-resize behavior to layout regions. Supports single-region and multi-region configurations with snap points, collapsible panels, localStorage persistence, and cascade resize ordering.

## Best Practices

- **Do:** Use percent(40, {min: pixel(333)}) for a 40% size with a 333px floor, or percent(10, {max: pixel(400)}) for a 10% size with a 400px ceiling. The options argument is required and carries a floor XOR a ceiling.
- **Do:** A structured default is an initial choice only; a structured minSize or maxSize remains live. State, persistence, callbacks, resize(), paint, and ARIA all use resolved pixel numbers.
- **Do:** Import percent and Table’s same pixel binding from @astryxdesign/core/Resizable/utils when constructing configuration in a Server Component; the root package exposes one pixel symbol and one percent symbol without collision.
- **Do:** Use with Layout or AppShell sidebar for resizable navigation panels.
- **Do:** Set autoSaveId to persist user-chosen sizes across page reloads.
- **Don't:** Set minSize too small; content becomes unreadable. Prefer collapsible for panels that can hide entirely.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultSize` | `SizeValue \| ResizableSize` | `250` | Initial size. Numbers, exact "Npx", and pixel(value) are pixels. Exact "N%" has no additional pixel bound. percent(value, {min: pixel(value)}) or percent(value, {max: pixel(value)}) adds one pixel floor or ceiling. A percentage resolves ONCE into pixels — against containerRef when supplied, against the viewport otherwise — and does not track its basis afterwards. The released broad number \| string type remains compatible; runtime validation is authoritative. |
| `minSize` | `ResizableSize` | `50` | Minimum size. Numbers, exact "Npx", and pixel(value) remain pixels; exact "N%" has no additional pixel bound; percent(value, {min: pixel(value)}) or percent(value, {max: pixel(value)}) adds exactly one. Percentage minimums re-resolve when their basis changes and clamp the current pixel selection. |
| `maxSize` | `ResizableSize` | `Infinity` | Maximum size. Numbers, exact "Npx", and pixel(value) remain pixels; exact "N%" has no additional pixel bound; percent(value, {min: pixel(value)}) or percent(value, {max: pixel(value)}) adds exactly one. Percentage maximums re-resolve when their basis changes and clamp the current pixel selection. |
| `containerRef` | `RefObject<HTMLElement \| null>` | - | The element a percentage is a share of. Caller-owned: the hook never infers one. Omitted, percentages use the viewport, which is the released behaviour. The ref may point at a different element over time — the basis follows it. Until that element is actually laid out (not yet mounted, display:none, detached) percentages use a temporary 1200px basis rather than its zero measurement, and nothing is persisted from it. |
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Which axis this region resizes along. Selects the container's inline or block content-box size as the percentage basis, and must match the direction given to ResizeHandle. |
| `collapsible` | `boolean` | `false` | Whether a lift or a key step below the collapsed threshold collapses the region to zero. |
| `snaps` | `number[]` | - | Pixel values to snap to during drag. |
| `autoSaveId` | `string` | - | Key for localStorage persistence of size and collapse state across sessions. |
| `defaultIsCollapsed` | `boolean` | `false` | Initial collapse state (uncontrolled). A persisted entry wins over it. |
| `isCollapsed` | `boolean` | - | Controlled collapse state. collapse(), expand(), a lift or a key step past the threshold, and a drag that reopens the region then report through onCollapseChange instead of changing state internally. |
| `onCollapseChange` | `(isCollapsed: boolean) => void` | - | Called once per collapse state change: a lift or a key step that closes the region, a drag or a key that reopens it, Enter, a double-click, or a call to collapse(), expand() or resize(). |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `size` | `number` | Current size in pixels. |
| `isCollapsed` | `boolean` | Whether the region is currently collapsed. |
| `collapse` | `() => void` | Programmatically collapse the region. |
| `expand` | `() => void` | Expand from collapsed state. |
| `resize` | `(size: number) => void` | Resize to a specific pixel value. |
| `props` | `ResizableProps` | Props to spread on the resizable component or pass to ResizeHandle. |


Block templates: astryx component <name> --blocks for Resizable, AppShell, Layout, SideNav
