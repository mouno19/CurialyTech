package: @curialy/ui

# Heading

Semantic h1–6 w/ themed styling, themed sizing via type scale tokens, line-clamp truncation.

**Import:** `import {Heading} from '@curialy/ui/Heading';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `level` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | - | Heading level; determines HTML element + styling from theme (unless type is set). **(required)** |
| `type` | `'display-1' \| 'display-2' \| 'display-3'` | - | Display variant (display-1/2/3 or a theme-owned custom type); overrides visual styling from level. |
| `weight` | `'normal' \| 'medium' \| 'semibold' \| 'bold'` | - | Explicit font weight; wins over the visual type or heading-level default. |
| `children` | `ReactNode` | - | Heading content. **(required)** |
| `accessibilityLevel` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | - | aria-level override when different from level for document outline. |
| `color` | `'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit'` | `'primary'` | Text color. Themes may add custom colors. |
| `display` | `'inline' \| 'block'` | `'block'` | Display type; overridden to 'block' when maxLines>0 or hasCapsize. |
| `maxLines` | `number` | `0` | Max lines before truncation; 0=none. Shows tooltip if truncated. |
| `hasTruncateTooltip` | `boolean \| 'above' \| 'below' \| 'start' \| 'end'` | `true` | Tooltip for truncated text; true=default position, false=disabled, or a placement ('above' \| 'below' \| 'start' \| 'end'). |
| `wordBreak` | `'break-word' \| 'break-all'` | - | Word break behavior when truncating; defaults 'break-all' for single-line, 'break-word' otherwise. Untruncated long tokens wrap (overflow-wrap: break-word); a flex child needs min-width: 0; your own container's overflow-wrap: anywhere does not reach this text (Curialy UI containers pass theirs through). |
| `textWrap` | `'wrap' \| 'nowrap' \| 'balance' \| 'pretty'` | - | Text wrapping behavior. |
| `justify` | `'start' \| 'center' \| 'end'` | `'start'` | Text alignment (justification); logical values 'start' \| 'center' \| 'end' for RTL. |
| `hasCapsize` | `boolean` | `false` | Optical alignment via text-box-trim; forces block display. |
| `hasStrikethrough` | `boolean` | `false` | Strikethrough text decoration. |
| `id` | `string` | - | HTML id attribute. |
| `xstyle` | `StyleXStyles` | - | StyleX styles on the heading; stylex.create() value only. |
| `className` | `string` | - | CSS class on the heading. |
| `style` | `React.CSSProperties` | - | inline styles on the heading; with maxLines>1 the line clamp replaces WebkitLineClamp. |
| `ref` | `React.Ref<HTMLHeadingElement>` | - | ref to the heading element. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-heading` | `data-level`, `data-color`, `data-type`, `data-weight` | level, color, type, weight | - |

Override in defineTheme:
```ts
components: {
  'heading': {
    base: { /* CSS properties */ },
    'level:value': { /* variant-specific */ },
  },
}
```
