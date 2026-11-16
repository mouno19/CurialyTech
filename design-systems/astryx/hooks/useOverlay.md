package: @astryxdesign/core

# useOverlay

Adds overlay behavior to a container you already render, such as a Card or a custom media frame, without the wrapper Overlay adds. Spread containerRef and containerProps on the container, then render element (or renderOverlay(children)) once inside it. The scrim is absolutely positioned, so it covers the nearest positioned ancestor: the container itself, or a positioned section inside it such as an image area. Visibility is CSS-driven from the container's :hover and :focus-within, so with showOn 'hover' a keyboard user reveals the content by moving focus into the container. Hidden content is not focusable, so the container needs a focusable element before the overlay content in tab order. A revealed scrim takes pointer input over the area it covers, so put that element outside the scrim, or use a top or bottom strip and keep it in the part the strip leaves uncovered.

## Best Practices

- **Do:** Use showOn 'hover' for actions on media cards: it also reveals on keyboard focus within the container.
- **Do:** Put a focusable element (a link or the card title) before the overlay content in the container, so Tab reveals the content and the next Tab reaches it.
- **Do:** Use the Overlay component when you do not already have a container element to attach to.
- **Don't:** Put the only way to reach an action behind hover with nothing focusable before it; keyboard users cannot focus content that is hidden.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseOverlayOptions` | - | Overlay configuration. Every field is optional. |
| `options.content` | `ReactNode` | - | Content to render inside the scrim. When set, the hook returns it pre-rendered as element. |
| `options.showOn` | `'hover' \| 'always' \| 'focus' \| 'hover-or-focus'` | `'always'` | Visibility trigger, read with CSS from the container. 'hover' also reveals on focus within the container for keyboard users; 'hover-or-focus' is an alias for it. On a touch device (hover: none), a hover overlay toggles on a tap on the container instead. |
| `options.isOpen` | `boolean` | - | Controlled visibility. When set, it takes precedence over showOn and the touch toggle. |
| `options.scrim` | `'dark' \| 'light' \| false` | `'dark'` | Scrim background. false renders the content with no scrim background. |
| `options.position` | `'fill' \| 'bottom' \| 'top'` | `'fill'` | Where the scrim sits: over the whole positioned area, or as a strip along its bottom or top edge. |
| `options.align` | `'start' \| 'center' \| 'end'` | `'end'` | Alignment of the content within the scrim. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `containerRef` | `RefObject<HTMLElement \| null>` | Attach to the container element. |
| `containerProps` | `OverlayContainerProps` | Spread on the same container: className and style mark it as the overlay scope (positioned, clipped), and on a touch device with a hover overlay onClick and onMouseUp toggle it on a tap. |
| `element` | `ReactElement \| null` | The scrim with options.content, ready to render once inside the container. null when content is not set. |
| `renderOverlay` | `(children: ReactNode) => ReactElement` | Renders the scrim around the children you pass, for content that changes or a scrim you mount yourself. Use it or element, not both. |


Block templates: astryx component <name> --blocks for Overlay, Card, AspectRatio
