package: @astryxdesign/core

# Tooltip

A short text hint that appears on hover or focus, anchored to a trigger element. Use it to describe icon-only buttons, show the full text of truncated labels, or provide supplementary context without cluttering the UI.

**Import:** `import {Tooltip} from '@astryxdesign/core/Tooltip';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Tooltip surface | Yes | Painted overlay surface that presents the tooltip. |
| Tooltip text | Yes | Tooltip content rendered within the surface. |

## Best Practices

- **Do:** Keep tooltip content concise: aim for under 140 characters of plain text.
- **Do:** Add a tooltip to icon-only buttons and controls that lack a visible label.
- **Do:** Set touchTrigger to tap when the trigger is a button whose only job is revealing the tooltip: touch has no hover, and auto keeps the tap for triggers that perform an action. For an info icon, use InfoTip, which also pins its help on a press.
- **Don't:** Place interactive elements like links or buttons inside a tooltip; use HoverCard or Popover instead.
- **Don't:** Use tooltips for essential information that users must see to complete a task.

## Components

### Tooltip

Component wrapper for tooltip display on hover/focus.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Trigger element(s) that activate tooltip. |
| `anchorRef` | `RefObject<HTMLElement>` | - | External anchor ref for sibling mode. |
| `content` | `ReactNode` | - | Tooltip content, typically short text. |
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'above'` | Position relative to anchor. Logical: start/end follow the popover's inherited direction (RTL mirrors). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'center'` | Alignment along placement axis. Logical: start/end follow the popover's inherited direction (RTL mirrors). |
| `delay` | `number` | `200` | Show delay in ms. |
| `hideDelay` | `number` | `0` | Hide delay in ms. |
| `focusTrigger` | `'auto' \| 'always' \| 'never'` | `'auto'` | Controls when focus events trigger tooltip. |
| `touchTrigger` | `'auto' \| 'tap' \| 'none'` | `'auto'` | Tap behavior where there is no hover. auto = tap opens unless the trigger acts (button/link/control; an aria-disabled control does not act); tap = always opens (a button whose only job is the tooltip; for an info icon use InfoTip); none = never on touch. |
| `isEnabled` | `boolean` | `true` | Enables/disables tooltip triggers. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback when visibility changes; true=shown, false=hidden. |
| `hasHoverIndication` | `'auto' \| boolean` | `'auto'` | Dashed underline on trigger element. |
| `isDefaultOpen` | `boolean` | - | Show tooltip on mount. Still dismissible. |
| `isOpen` | `boolean` | - | Controlled open state for the tooltip. Held closed, focus that would open it calls onOpenChange(true) and shows nothing; held open, Escape calls onOpenChange(false) and it stays. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-tooltip` | - | - | - |

Override in defineTheme:
```ts
components: {
  'tooltip': {
    base: { /* CSS properties */ },
  },
}
```
