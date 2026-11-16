package: @astryxdesign/core

# Code

Use for short function names, variables, paths, and CLI flags inside prose. Use CodeBlock for standalone or multi-line snippets.

**Import:** `import {Code} from '@astryxdesign/core/Code';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | The semantic code element that contains the inline code content and paints the background, typography, padding, and radius. |

## Best Practices

- **Do:** Use for short technical references inside prose.
- **Do:** Set size='inherit' to match surrounding text size and line height.
- **Don't:** Use for multi-line or standalone snippets; use CodeBlock instead.
- **Don't:** Use as an interactive control; pair with Button or Link for actions.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | inline code content. **(required)** |
| `color` | `'primary' \| 'secondary' \| 'inherit'` | `'primary'` | text color: primary, secondary, or inherited from surrounding text. |
| `size` | `'inherit'` | - | set to 'inherit' to take the surrounding font size and line height. |
| `ref` | `React.Ref<HTMLElement>` | - | ref forwarded to the semantic code element. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be a stylex.create() value, not an inline style object. |
| `className` | `string` | - | CSS class for the root; prefer xstyle. |
| `style` | `CSSProperties` | - | inline styles for the root; prefer xstyle. |
| `data-testid` | `string` | - | test selector for automated testing frameworks. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-code` | `data-color`, `data-size` | color, size | - |

Override in defineTheme:
```ts
components: {
  'code': {
    base: { /* CSS properties */ },
    'color:value': { /* variant-specific */ },
  },
}
```
