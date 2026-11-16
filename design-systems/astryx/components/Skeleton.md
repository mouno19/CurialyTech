package: @astryxdesign/core

# Skeleton

An animated shimmer placeholder that previews the shape of content while it loads. Use it to build loading screens that match the layout of the real content. For content with unknown dimensions, use Spinner instead.

**Import:** `import {Skeleton} from '@astryxdesign/core/Skeleton';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Placeholder | Yes | Painted shape that stands in for content while it loads. |

## Best Practices

- **Do:** Match the size and shape of the content being loaded to create a realistic placeholder.
- **Do:** Stagger multiple skeletons with the `index` prop for a natural wave animation.
- **Don't:** Use when the content dimensions are unknown; use Spinner instead.
- **Don't:** Combine with a Spinner on the same content area; pick one loading pattern.
- **Don't:** Show skeletons indefinitely; if loading takes too long, show an error or empty state instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | `number \| string` | `'100%'` | Width in pixels (number) or CSS value (string). |
| `height` | `number \| string` | `'100%'` | Height in pixels (number) or CSS value (string). |
| `radius` | `'none' \| 0 \| 1 \| 2 \| 3 \| 4 \| 'rounded'` | `3` | Border radius using design tokens. none for sharp, 0-4 for scale, rounded for pills. |
| `index` | `number` | `0` | Index for staggered animation timing. Element at index n starts at DELAY_TIME + (STAGGER_TIME × n). |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-skeleton` | - | - | - |

Override in defineTheme:
```ts
components: {
  'skeleton': {
    base: { /* CSS properties */ },
  },
}
```
