package: @astryxdesign/core

# AspectRatio

Maintains a fixed width-to-height ratio for its children as its container resizes. Use it for media containers like videos, images, thumbnails, or any content that needs consistent proportions. It takes its width from the container and derives its height from the ratio, so it needs an ancestor with a definite width.

**Import:** `import {AspectRatio} from '@astryxdesign/core/AspectRatio';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Ratio box | Yes | The outer element that holds the aspect ratio and clips overflow. Carries the `astryx-aspect-ratio` theme target, and the elliptical clip when `shape` is `ellipse`. |
| Content slot | Yes | A wrapper that fills the ratio box and positions the child. With `fit` set it also sizes the child; without it the child styles itself. |

## Best Practices

- **Do:** Express the ratio as a fraction for readability — `ratio={16 / 9}` rather than `ratio={1.78}`. It is a number, so the string form `ratio="16/9"` is a type error.
- **Do:** Use for media that needs consistent proportions across screen sizes.
- **Do:** Use `fit="cover"` for images and video so the component sizes the child; the child should not repeat `width`/`height`/`objectFit` styles.
- **Do:** Pass one child. With `fit` set, every direct child is stretched to fill the box, so put an overlay or caption inside a single wrapper child rather than passing it as a second child.
- **Do:** Describe media children with `alt`, or `alt=""` when the image is decorative. AspectRatio adds no role and no accessible name of its own, so the child carries the whole accessible description.
- **Do:** For a breakpoint-dependent ratio, override the ratio responsively: pass an `aspectRatio` rule via `xstyle` (StyleX), or override `aspect-ratio` from your own unlayered CSS under a `@media`/`@container` rule; component styles live in the `astryx-base` cascade layer, so unlayered consumer CSS wins. Give an `xstyle` rule a `default` branch alongside the conditional one (`{default: 3, '@container ...': '3 / 2'}`); with only the conditional branch the ratio is unset outside the query and the box collapses.
- **Don't:** Use for general layout containers; use standard layout components instead.
- **Don't:** Nest AspectRatio containers; one level is sufficient.
- **Don't:** Constrain the height on its own. The width comes from the container, so a `height` or `maxHeight` by itself clamps the box off ratio; pair it with `width: "auto"` to size from the height instead.
- **Don't:** Place it in a shrink-to-fit parent such as `inline-flex`, `width: fit-content` or a floated box. It contributes no intrinsic width there and collapses to zero.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ratio` | `number` | - | width/height ratio (e.g. 16/9, 1); class-level declaration (never inline) so xstyle/unlayered-CSS @container overrides win **(required)** |
| `shape` | `'rectangle' \| 'ellipse'` | `'rectangle'` | container shape: 'rectangle' (default) \| 'ellipse' (circle at ratio 1) |
| `fit` | `'cover' \| 'contain' \| 'center'` | - | child layout: 'cover' fill+crop \| 'contain' fill+letterbox \| 'center' natural size; omitted = child styles itself |
| `children` | `ReactNode` | - | content positioned absolutely to fill container **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX layout customization via stylex.create() |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-aspect-ratio` | `data-shape` | shape | - |

Override in defineTheme:
```ts
components: {
  'aspect-ratio': {
    base: { /* CSS properties */ },
    'shape:value': { /* variant-specific */ },
  },
}
```
