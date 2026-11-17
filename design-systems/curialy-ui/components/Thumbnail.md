package: @curialy/ui

# Thumbnail

Compact square image preview. Shimmer while uploading, image on success, placeholder when empty. Use in chat composers, file lists, or small media previews.

**Import:** `import {Thumbnail} from '@curialy/ui/Thumbnail';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Image | No | The preview image, displayed as a square with cover fit. |
| Placeholder | No | An image silhouette icon shown when no src is provided. |
| Remove button | No | An overlaid close button in the top-right corner. Appears when onRemove is set. Sits on a fixed --color-overlay scrim with an --color-on-dark icon to stay visible on any image. |
| Upload overlay | No | A semi-transparent overlay with a spinner, shown when isLoading is true and a src preview is available. |
| Skeleton | No | A shimmer animation shown when isLoading is true and no src is set. |

## Best Practices

- **Do:** Always set label (file name) for a11y; powers screen reader announce + hover tooltip.
- **Do:** isLoading w/o src → skeleton; isLoading w/ src → spinner overlay. Two distinct loading states.
- **Do:** onClick adds button semantics + hover overlay; pair with lightbox for full preview.
- **Don't:** Don't use for non-image files (PDF, xlsx); use file attachment component with icon instead.
- **Don't:** Don't omit alt when src present; screen readers need image content description, not just label.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | Image source URL. |
| `alt` | `string` | - | Alt text for image. Omitted → explicitly decorative (alt="" + role="presentation" + aria-hidden); dev warn when src set with no alt and no label. |
| `label` | `string` | - | Accessible label (file name). Tooltip on hover, aria-label. |
| `onRemove` | `(e: React.MouseEvent) => void` | - | (e) => void. Overlaid remove button callback. |
| `onClick` | `(e: React.MouseEvent) => void` | - | (e) => void. Adds button semantics + hover overlay. |
| `isLoading` | `boolean` | `false` | Skeleton (no src) or upload overlay (with src). Default: false. |
| `isDisabled` | `boolean` | `false` | Disabled state. Default: false. |
| `showRemoveOn` | `'always' \| 'hover'` | `'hover'` | When remove button shows: hover (default: reveal on hover/focus, stays visible under coarse primary pointer, e.g. phone/tablet) \| always. Only when onRemove set. |
| `xstyle` | `StyleXStyles` | - | stylex.create() for layout. |
| `className` | `string` | - | CSS class. Prefer xstyle. |
| `style` | `CSSProperties` | - | Inline styles. Prefer xstyle. |
| `data-testid` | `string` | - | Test selector. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-thumbnail` | - | - | - |

Override in defineTheme:
```ts
components: {
  'thumbnail': {
    base: { /* CSS properties */ },
  },
}
```
