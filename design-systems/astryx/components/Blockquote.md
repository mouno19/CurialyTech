package: @astryxdesign/core

# Blockquote

A quotation block with a rule on its inline-start edge and secondary text color. Use to highlight quoted content, testimonials, or excerpts.

**Import:** `import {Blockquote} from '@astryxdesign/core/Blockquote';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Rule | Yes | The border on the inline-start edge, drawn with --color-border-emphasized. |
| Quotation | Yes | The quoted content, passed as children. Renders inside the <blockquote> element. |
| Attribution | No | The source, passed as cite. Renders as a <cite> element below the quotation. |

## Best Practices

- **Do:** Use for quoted text, testimonials, or highlighted excerpts.
- **Do:** Provide cite when source is known.
- **Do:** Pass the source via cite, not inside children.
- **Don't:** Use for callouts/notes; use Banner instead.
- **Don't:** Wrap the attribution in <footer>; it becomes a contentinfo landmark.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | blockquote content **(required)** |
| `cite` | `ReactNode` | - | optional attribution rendered as <cite> after the quote |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout; must be stylex.create() value |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-blockquote` | - | - | - |

Override in defineTheme:
```ts
components: {
  'blockquote': {
    base: { /* CSS properties */ },
  },
}
```
