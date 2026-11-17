package: @curialy/ui

# Spinner

An animated loading indicator for processes with unknown duration, such as data fetching or form submission. Supports visible labels, multiple sizes, and a dark background variant. For content with known dimensions, use Skeleton instead.

**Import:** `import {Spinner} from '@curialy/ui/Spinner';`

## Best Practices

- **Do:** Provide a meaningful label to describe what is loading for screen reader users.
- **Do:** Use the "onMedia" shade when placed on dark or accent-colored backgrounds.
- **Don't:** Use for content areas with known dimensions; use Skeleton to preserve layout instead.
- **Don't:** Stack multiple spinners in the same view; use one to represent the overall loading state.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Spinner size: ring diameter (10px, 14px, 18px, 28px). |
| `shade` | `'default' \| 'onMedia' \| 'subtle' \| 'inherit'` | `'default'` | Color shade for light or dark backgrounds. |
| `label` | `ReactNode` | - | Visible content below spinner. String provides its accessible name unless aria-label is set. |
| `aria-label` | `string` | `'Loading'` | A11y name for screen readers. Defaults to label or a translated "Loading". |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be stylex.create() value, not inline style. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-spinner` | `data-size`, `data-shade` | size, shade | - |

Override in defineTheme:
```ts
components: {
  'spinner': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
}
```

**Themeable CSS variables** - additional properties that can be overridden in `defineTheme` component overrides.

| CSS Variable | Default | Description |
|-------------|---------|-------------|
| `--spinner-diameter` | `10px (sm), 14px (md), 18px (lg), 28px (xl)` | Diameter of the drawn ring. Set it on a size-variant target to retheme what each named size resolves to, e.g. spinner: { 'size:xl': { '--spinner-diameter': '2.5rem' } }. The rendered box is this plus the stroke width on each side, and follows automatically. Any length works: rem, em and calc() are resolved before the ring is drawn. |
| `--spinner-stroke-width` | `2px (sm), 3px (md), 3px (lg), 4px (xl)` | Stroke width of both circles the ring is drawn from: the moving arc and the track behind it. Set it per size alongside the diameter. One stroke width drives both, so 0 is honoured as a zero-width stroke and paints nothing at all rather than falling back to the default; for an arc with no track behind it, set --spinner-track-color to transparent instead. |
| `--spinner-color` | `var(--color-accent) (default), var(--color-text-secondary) (subtle), var(--color-on-dark) (onMedia), currentColor (inherit)` | Color of the moving arc. Defaults to the shade's token, so set it on a shade-variant target to retheme one shade (spinner: { 'shade:subtle': { '--spinner-color': 'var(--color-text-tertiary)' } }), or on the base target to retheme all four. Accepts any color notation, including var(), color-mix() and currentColor. |
| `--spinner-track-color` | `var(--color-track) (default, subtle), var(--color-on-dark) (onMedia), currentColor (inherit)` | Color of the track the arc travels on. Set it to `transparent` for an arc with no track. The onMedia and inherit shades draw the track at reduced alpha (30%) so it reads against an arbitrary backdrop; that fade applies to a themed color too. |
| `--spinner-arc-fraction` | `0.375 (135deg), same for every size` | Fraction of the ring the moving arc covers, as a plain number (not a percentage or angle). Set it on a size-variant target the same way as --spinner-diameter, e.g. spinner: { 'size:xl': { '--spinner-arc-fraction': '0.75' } } for a 270deg sweep. Only takes effect once the stylesheet loads; a render with no CSS (SSR, no-JS) always draws the default 135deg arc. |
