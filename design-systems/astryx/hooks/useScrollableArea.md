package: @astryxdesign/core

# useScrollableArea

Adds canonical axis-aware scroll behavior to structure owned by the caller. An axis is effective only when its computed overflow is scroll-capable and geometry exceeds the shared 1px tolerance. Both viewport and content boxes are observed.

## Best Practices

- **Do:** Pass already-resolved props and refs through both prop getters, then spread each returned object once.
- **Do:** Use viewport keyboard ownership only when the viewport itself should enter the tab order; provide a concise accessible label.
- **Do:** Use contentOrViewport to delegate forward Tab entry to the first sequential native link or button when it preserves native scroll keys. Inputs, composite widgets, and nested scroll areas retain the named viewport stop. Shift+Tab from the delegated first child skips the viewport; pointer and programmatic focus stay on it.
- **Do:** Use content keyboard ownership when your integration already supplies keyboard access to the full scroll range. Automatic delegation checks current content at each keyboard entry without continuously tracking its focusability.
- **Do:** Pass caller `xstyle` through `getViewportProps`; the getter composes it with fitting clip, active overflow, and Sticky containment.
- **Do:** Give a viewport-owned tab stop a visible focus indicator; compose `focusOutlineStyles.focusVisible` (or an equivalent) into the viewport `xstyle`, as ScrollableArea does.
- **Don't:** Attach only the viewport getter. A real observed content box is required for live overflow changes.
- **Don't:** Declare overflow through caller props on the viewport; the getter owns overflow declarations and strips conflicting inline values.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseScrollableAreaOptions` | - | Logical scroll intent, fixed or automatic keyboard owner, overscroll policy, and fitting Sticky containment. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `getViewportProps` | `<E extends HTMLElement>(props?: ScrollableElementProps<E>) => ScrollableElementProps<E>` | Consumes caller viewport props, xstyle, and refs; composes fitting/active overflow, Sticky containment, accessibility, chaining, and owner registration. |
| `getContentProps` | `<E extends HTMLElement>(props?: ScrollableElementProps<E>) => ScrollableElementProps<E>` | Composes caller content-box props, xstyle, and refs with content observation. |
| `state` | `ScrollableAreaState` | Stable inline and block effective-scroll and logical-edge state. |


Block templates: astryx component <name> --blocks for ScrollableArea
