package: @curialy/ui

# ClickableCard

Interactive card for navigation/action targets. Nested interactive elements work independently.

**Import:** `import {ClickableCard} from '@curialy/ui/ClickableCard';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | Interactive div with hover/focus/active states. |
| Content | Yes | Children, which may include nested interactive elements. |

## Best Practices

- **Do:** Use for cards navigating to detail page or triggering single action.
- **Do:** Nest buttons/links freely inside; they handle own events.
- **Don't:** Use for toggling selection; use SelectableCard instead.
- **Don't:** Use w/ transparent variant + no padding only to borrow press model for surface owning its own box; compose chrome-free recipe in useClickableContainer docs instead (no Card styles).

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | accessibility label **(required)** |
| `onClick` | `(event: MouseEvent) => void` | - | click handler: fires on card surface only |
| `href` | `string` | - | navigation URL; every activation follows the shared navigation rule (see Link href) |
| `target` | `string` | `'_self'` | link target |
| `isDisabled` | `boolean` | `false` | disables card, removes link destination, keeps tab stop |
| `children` | `ReactNode` | - | Card content. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `4` | inner padding |
| `variant` | `'default' \| 'transparent' \| 'muted' \| 'blue' \| 'cyan' \| 'gray' \| 'green' \| 'orange' \| 'pink' \| 'purple' \| 'red' \| 'teal' \| 'yellow'` | `'default'` | background color variant |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth: none\|low\|med\|high; often raised to signal clickability |
| `width` | `SizeValue` | - | card width |
| `height` | `SizeValue` | - | card height |
| `maxWidth` | `SizeValue` | - | max card width |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-clickable-card` | `data-variant` | default, transparent, muted, blue, cyan, gray, green, orange, pink, purple, red, teal, yellow | - |

Override in defineTheme:
```ts
components: {
  'clickable-card': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```
