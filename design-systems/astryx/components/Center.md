package: @astryxdesign/core

# Center

Center aligns content to the middle of its container. Use for empty states, loading screens, login forms.

**Import:** `import {Center} from '@astryxdesign/core/Center';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | A flexbox wrapper that aligns its children to the center along the chosen axis. |
| Content | Yes | Any children passed to Center. Typically a card, form, spinner, or empty state message. |

## Best Practices

- **Do:** Use a single-axis value only in horizontal writing, or after verifying the active writing mode. In vertical writing, the current implementation follows flex main/cross axes rather than the physical prop names.
- **Do:** In horizontal writing, give Center height when using axis="vertical"; centering needs available space on the selected flex axis.
- **Do:** Use isInline to center small elements (icons, badges) within a line of text without breaking text flow.
- **Do:** Keep semantic structure and accessible names on the content; Center adds no role or label.
- **Don't:** Wrap large page sections in Center. Use Layout or AppShell for page-level structure.
- **Don't:** Use Center for horizontal lists of items. Use Stack with hAlign="center" instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `axis` | `'both' \| 'horizontal' \| 'vertical'` | `'both'` | centering mode; outside horizontal writing, single-axis values follow flex main/cross axes |
| `width` | `SizeValue` | - | container width (px or CSS) |
| `height` | `SizeValue` | - | container height (px or CSS) |
| `maxWidth` | `SizeValue` | - | Maximum container width (px or CSS value). |
| `minHeight` | `SizeValue` | - | Minimum container height (px or CSS value). |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | inner padding on all sides (spacing step: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10) |
| `paddingInline` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical inline-axis padding; overrides padding on that axis |
| `paddingInlineStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical inline-start padding; physical edge depends on writing mode and direction |
| `paddingInlineEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical inline-end padding; physical edge depends on writing mode and direction |
| `paddingBlock` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical block-axis padding; overrides padding on that axis |
| `paddingBlockStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical block-start padding; physical edge depends on writing mode |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | logical block-end padding; physical edge depends on writing mode |
| `isInline` | `boolean` | `false` | use inline-flex for text/icons |
| `children` | `ReactNode` | - | content to center |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout (margins, positioning, sizing); must be stylex.create() value |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-center` | `data-axis` | axis | - |

Override in defineTheme:
```ts
components: {
  'center': {
    base: { /* CSS properties */ },
    'axis:value': { /* variant-specific */ },
  },
}
```
