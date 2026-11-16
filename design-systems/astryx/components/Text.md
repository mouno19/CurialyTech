package: @astryxdesign/core

# Text

Text renders styled body text and headings. Text for body copy with semantic types, Heading for h1–h6 with theme tokens.

**Import:** `import {Text} from '@astryxdesign/core/Text';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Text | Yes | Polymorphic text element that renders the supplied content with themed typography. |
| Heading | No | Referenced Heading member that renders the supplied content as a semantic h1–h6 element. |
| Truncation tooltip | No | Tooltip-owned surface available only when Text or Heading is measured as truncated and truncation tooltips are enabled. |

## Best Practices

- **Do:** Semantic type (body, label, supporting, large, code) instead of manual size/weight.
- **Do:** accessibilityLevel on Heading when visual level differs from document outline.
- **Do:** maxLines for truncation; tooltip shows full text on hover.
- **Do:** hasTabularNumbers for aligned numeric columns.
- **Don't:** Override size/weight when a semantic type already matches.
- **Don't:** Skip heading levels; sequential h1 → h2 → h3.
- **Don't:** Raw <p>/<h1>/<span>; use Text/Heading for theme tokens.
- **Don't:** `variant` prop, which does not exist. Use `type` for text styling or Heading for headings.
- **Don't:** Text for headings: use Heading with level (1–6).

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit'` | `'body'` | Semantic text type. Determines size, weight, and line-height from the theme. 'inherit' takes all three from the surrounding text instead. Themes may add custom types. Note: this prop is called `type`, not `variant`. |
| `children` | `ReactNode` | - | Text content. **(required)** |
| `size` | `'4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl'` | - | Explicit font size override. Overrides the size from `type` but preserves other type properties. Prefer using `type` alone. |
| `color` | `'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit'` | - | Text color. Defaults to 'secondary' for the 'supporting' type, 'primary' for all others. Themes may add custom colors. |
| `weight` | `'normal' \| 'medium' \| 'semibold' \| 'bold'` | - | Font weight override. |
| `display` | `'inline' \| 'block'` | `'inline'` | Display type. Silently overridden to 'block' when maxLines > 0 or hasCapsize is true. |
| `as` | `'span' \| 'p' \| 'div' \| 'label'` | `'span'` | HTML element to render. |
| `maxLines` | `number` | `0` | Maximum lines before truncation. 0 means no truncation. When set, shows a tooltip on hover if content is truncated. |
| `hasTruncateTooltip` | `boolean \| 'above' \| 'below' \| 'start' \| 'end'` | `true` | Controls tooltip behavior for truncated text. true shows the tooltip at the default position, false disables it, or a placement string ('above' \| 'below' \| 'start' \| 'end') sets a specific position. |
| `wordBreak` | `'break-word' \| 'break-all'` | - | Word break behavior when truncating. Defaults to 'break-all' for single-line truncation, 'break-word' otherwise. Without truncation, a token longer than its line (a URL, an ID) wraps (`overflow-wrap: break-word`), so in ordinary flow text does not make the page scroll sideways. Inside a flex row, give the flex child `min-width: 0` so it can shrink. A container you style with `overflow-wrap: anywhere` does not reach this text; Astryx's own containers pass their wrap through. |
| `textWrap` | `'wrap' \| 'nowrap' \| 'balance' \| 'pretty'` | - | Text wrapping behavior. |
| `justify` | `'start' \| 'center' \| 'end'` | `'start'` | Text alignment (justification). Uses logical values (start/end) for i18n/RTL compatibility. |
| `hasCapsize` | `boolean` | `false` | Enable optical alignment using text-box-trim. Forces block display. |
| `hasStrikethrough` | `boolean` | `false` | Apply strikethrough text decoration. |
| `hasTabularNumbers` | `boolean` | `false` | Use tabular (monospace) numbers for aligned numeric data. |
| `id` | `string` | - | HTML id attribute. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Components

### Heading

See `astryx component Heading` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-heading` | `data-level`, `data-color`, `data-type`, `data-weight` | level, color, type, weight | - |
| `astryx-text` | `data-type`, `data-size`, `data-color` | type, size, color | - |

Override in defineTheme:
```ts
components: {
  'heading': {
    base: { /* CSS properties */ },
    'level:value': { /* variant-specific */ },
  },
  'text': {
    base: { /* CSS properties */ },
  },
}
```
