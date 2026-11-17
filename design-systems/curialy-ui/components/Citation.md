package: @curialy/ui

# Citation

Inline reference to external source. Attribute info in AI responses, articles, or anywhere provenance needed.

**Import:** `import {Citation} from '@curialy/ui/Citation';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | The root wrapper. Accepted source URLs render an anchor; missing or rejected URLs render an inert span. |
| Icon | No | An optional source icon shown before the label text. Accepts a favicon/logo image URL (via source.src) or a React node such as an Curialy UI <Icon>. Only available in the label variant. |
| Label text | No | The source title, truncated with ellipsis when it exceeds the max width. Shown in the label variant. |
| Number | No | The citation index displayed as a superscript badge. Shown in the number variant. |

## Best Practices

- **Do:** Use label variant when source title adds meaningful context.
- **Do:** Use number variant for compact inline references in body text, like footnotes.
- **Don't:** Mix label and number variants in same paragraph. Pick one style per context.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `source` | `CitationSource` | - | citation source with title, url, optional image src, and optional icon. url follows the Link href navigation rule; rejected destinations stay visible without navigation. Image src handling is separate. **(required)** |
| `number` | `number` | - | display index for this citation. **(required)** |
| `variant` | `'label' \| 'number'` | `'label'` | display style: label chip with source title or compact numbered badge. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-citation` | `data-variant` | label, number | - |

Override in defineTheme:
```ts
components: {
  'citation': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```
