package: @curialy/ui

# Overlay

Overlay layers compact actions or supporting content over media, cards, or bounded surfaces with optional dark/light scrim and hover/focus/controlled reveal. Host attributes and DOM handlers reach the root element.

**Import:** `import {Overlay} from '@curialy/ui/Overlay';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Base content | No | The media, card, or bounded surface that the overlay sits on top of. |
| Scrim | No | Optional dark or light overlay background that improves content contrast. |
| Overlay content | Yes | Actions, labels, or supporting content rendered above the base surface. |

## Best Practices

- **Do:** Use for short contextual actions/labels tied to the underlying surface.
- **Do:** Keep content compact and legible over the scrim.
- **Don't:** Do not use for floating anchored surfaces; use Popover, Tooltip, or Dialog.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `ReactNode` | - | overlay content inside scrim; required **(required)** |
| `children` | `ReactNode` | - | base media/card/surface beneath overlay |
| `showOn` | `'hover' \| 'always' \| 'focus' \| 'hover-or-focus'` | `'always'` | visibility trigger; hover also focus-visible; default always |
| `isOpen` | `boolean` | - | controlled visibility override |
| `scrim` | `'dark' \| 'light' \| false` | `'dark'` | dark/light scrim or false for no scrim; default dark |
| `position` | `'fill' \| 'bottom' \| 'top'` | `'fill'` | scrim placement: fill, bottom strip, or top strip |
| `align` | `'start' \| 'center' \| 'end'` | `'end'` | content alignment inside scrim |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |
| `className` | `string` | - | additional root class names |
| `style` | `React.CSSProperties` | - | inline root styles; prefer xstyle |
| `ref` | `Ref<HTMLDivElement>` | - | forwarded root div ref |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-overlay` | - | - | - |
| `cui-overlay-scrim` | `data-position` | position | - |

Override in defineTheme:
```ts
components: {
  'overlay': {
    base: { /* CSS properties */ },
  },
  'overlay-scrim': {
    base: { /* CSS properties */ },
  },
}
```
