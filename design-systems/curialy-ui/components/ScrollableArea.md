package: @curialy/ui

# ScrollableArea

Use for a complete viewport/content composition; use useScrollableArea for existing structure.

**Import:** `import {ScrollableArea} from '@curialy/ui/ScrollableArea';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Viewport | Yes | The root native scroll container, accessible name owner, focus target while effective, and `cui-scrollable-area` theme target. |
| Content box | Yes | A real inner layout box observed together with the viewport. For inline scrolling it uses max-content inline sizing with a 100% minimum. |

## Best Practices

- **Do:** Always provide a concise label.
- **Do:** Prefer overscroll allow; contain only deliberate nested interactions.
- **Do:** Use content padding props to publish inset; use isFullBleed only for viewport escape.
- **Don't:** Nest another overflow wrapper around it.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `axis` | `'inline' \| 'block' \| 'both'` | `'block'` | logical scroll intent: 'inline' \| 'block' (default) \| 'both' |
| `label` | `string` | - | required accessible viewport name **(required)** |
| `role` | `'group' \| 'region'` | `'group'` | named viewport semantics: 'group' (default) \| 'region' (landmark-navigation entries only) |
| `overscroll` | `'allow' \| 'contain'` | `'allow'` | edge behavior: 'allow' (default) \| 'contain' on effective axes only |
| `width` | `SizeValue` | - | viewport width |
| `height` | `SizeValue` | - | viewport height |
| `maxWidth` | `SizeValue` | - | viewport maximum width |
| `minHeight` | `SizeValue` | - | viewport minimum height |
| `stickyContainment` | `'whenScrollable' \| 'always'` | `'whenScrollable'` | fitting Sticky ownership: 'whenScrollable' (default) \| 'always' |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `0` | content inset on every edge; defaults to 0 and publishes geometry |
| `paddingInline` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical inline-axis content inset |
| `paddingInlineStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical inline-start content inset |
| `paddingInlineEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical inline-end content inset |
| `paddingBlock` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical block-axis content inset |
| `paddingBlockStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical block-start content inset |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical block-end content inset |
| `isFullBleed` | `boolean` | `false` | opt-in viewport escape from inherited container padding |
| `children` | `ReactNode` | - | content inside the observed box |
| `xstyle` | `StyleXStyles` | - | viewport sizing and native scrollbar presentation overrides |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-scrollable-area` | `data-axis` | axis | - |

Override in defineTheme:
```ts
components: {
  'scrollable-area': {
    base: { /* CSS properties */ },
    'axis:value': { /* variant-specific */ },
  },
}
```
