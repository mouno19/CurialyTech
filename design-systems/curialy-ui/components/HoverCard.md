package: @curialy/ui

# HoverCard

HoverCard shows additional info on hover/focus. Use for profile cards, link summaries, inline definitions.

**Import:** `import {HoverCard} from '@curialy/ui/HoverCard';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trigger | Yes | The element that opens the hover card on hover or focus: a button, link, or inline text. |
| Card | Yes | The floating overlay with the preview content, anchored to the trigger. |
| Body | Yes | The main content area: profile info, link summary, or any rich content. |
| Actions | No | Optional buttons inside the card for follow-up actions like Follow or Message. |

## Best Practices

- **Do:** Keep content supplementary; hover cards should enhance understanding without blocking the primary workflow.
- **Do:** Provide a dashed underline on text triggers so users know the element is hoverable.
- **Do:** Use the hook API (useHoverCard) when you need more control over timing or placement.
- **Do:** Leave touchTrigger on auto so a tap opens the card on triggers that do nothing else, and stays out of the way on triggers that perform an action.
- **Don't:** Place critical actions or required information inside a hover card; users may miss content that only appears on hover.
- **Don't:** Use a hover card when a simple Tooltip or Popover would suffice.
- **Don't:** Use a HoverCard for content the user must interact with; it disappears when the cursor leaves.
- **Don't:** Put the trigger inside SVG <foreignObject>: Chromium cannot anchor to it, so the card opens at the viewport corner. Use an HTML trigger positioned over the SVG node.
- **Do:** Prefer a block context over a direct <p>, heading, or link placement. Those placements work when necessary through a corrective portal, but DOM/tab order may differ.

## Components

### HoverCard

Component wrapper for hover card overlay; richer overlay triggered on hover/focus.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Trigger. Text children (strings/numbers, incl. `Edited {when}`; holes like false/null ignored) are wrapped in a focusable inline span. With elements, the first element is wired (no ref needed). |
| `content` | `ReactNode` | - | Hover card content. **(required)** |
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'above'` | Position relative to anchor element. Logical: start/end follow the popover's inherited direction (RTL mirrors). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'center'` | Alignment along placement axis. Logical: start/end follow the popover's inherited direction (RTL mirrors). |
| `delay` | `number` | `300` | Show delay in ms. |
| `hideDelay` | `number` | `200` | Hide delay in ms. |
| `focusTrigger` | `'auto' \| 'always' \| 'never'` | `'auto'` | Controls when focus events trigger hover card. |
| `touchTrigger` | `'auto' \| 'tap' \| 'none'` | `'auto'` | Tap behavior where there is no hover. auto = tap opens unless the trigger acts (button/link/control; an aria-disabled control does not act); tap = always opens; none = never on touch. Tap-opened cards close on a tap outside. |
| `isEnabled` | `boolean` | `true` | Enable/disable hover + focus triggers. |
| `label` | `string` | - | Accessible name for the popup. With label: named role="dialog"; without: role="group". |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback when visibility changes; true=shown, false=hidden. |
| `hasHoverIndication` | `'auto' \| boolean` | `'auto'` | Dashed underline on a text trigger. auto = text children (strings/numbers, holes ignored); no effect on element triggers. |
| `isDefaultOpen` | `boolean` | - | Show hover card on mount. Still dismissible. |
| `isOpen` | `boolean` | - | Controlled open state. true holds open; false holds closed against hover and focus. Escape calls onOpenChange(false) without closing; setting false returns focus inside the card to the trigger. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for the card surface (hover-card target). |
| `className` | `string` | - | Class added to the card surface. |
| `style` | `CSSProperties` | - | Inline styles for the card surface. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-hover-card` | - | - | - |

Override in defineTheme:
```ts
components: {
  'hover-card': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  hover-card: {
    base: {
      borderRadius: '...',
    },
  },
}
```
