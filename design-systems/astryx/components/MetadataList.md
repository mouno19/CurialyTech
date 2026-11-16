package: @astryxdesign/core

# MetadataList

MetadataList displays key-value pairs for object attributes like quality, condition, and status, in a structured layout. Use it for detail panels, settings summaries, and record information.

**Import:** `import {MetadataList} from '@astryxdesign/core/MetadataList';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Title | No | Optional title for the metadata list. |
| Label | Yes | The key label for each metadata entry. |
| Metadata | Yes | The value displayed in various formats. |
| Disclosure | No | Collapse/expand control for the list. |

## Best Practices

- **Do:** Choose label position based on content: "start" for short values, "top" for long or complex values.
- **Do:** Collapse long lists with `maxNumOfItems` to keep the page scannable.
- **Do:** Give each MetadataListItem a short label that names its value. Assistive technology reads each label with its value as a term and its definition.
- **Do:** The title does not name the list or add a heading. Pass a heading element as the title when the list needs a place in the page outline.
- **Don't:** Use for extensive form input; use a form layout instead.
- **Don't:** Use for data that doesn't have a clear key-value structure.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Metadata items (MetadataListItem components). **(required)** |
| `columns` | `'multi' \| 'single' \| number` | `'single'` | Column layout mode. |
| `label` | `{ position?: 'start' \| 'top', width?: number \| string }` | `{ position: 'start' } (vertical single-column) / { position: 'top' } (multi-column or horizontal)` | Label display configuration. position controls label placement, width sets a custom label column width. Defaults to { position: 'top' } for multi-column layouts. Position is ignored in horizontal mode, which always uses { position: 'top' }. |
| `maxNumOfItems` | `number` | - | Maximum items to show before collapsing with a show more/less toggle. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Layout orientation. Horizontal mode flows items in a row with flex-wrap. |
| `title` | `ReactNode` | - | Optional title or heading above the list. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be a stylex.create() value. |
| `className` | `string` | - | CSS class name for the root element. Prefer xstyle for styling; className is provided for integration with non-StyleX systems. |
| `style` | `CSSProperties` | - | Inline styles for the root element. Prefer xstyle for styling; inline styles bypass StyleX optimization. |

## Components

### MetadataListItem

See `astryx component MetadataListItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-metadata-list` | `data-columns`, `data-orientation` | columns, orientation | - |
| `astryx-metadata-list-item` | - | - | - |

Override in defineTheme:
```ts
components: {
  'metadata-list': {
    base: { /* CSS properties */ },
    'columns:value': { /* variant-specific */ },
  },
  'metadata-list-item': {
    base: { /* CSS properties */ },
  },
}
```
