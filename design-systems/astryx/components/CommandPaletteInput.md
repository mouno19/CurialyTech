package: @astryxdesign/core

# CommandPaletteInput

search input; auto-focus on mount; wires to context inside CommandPalette

**Import:** `import {CommandPaletteInput} from '@astryxdesign/core/CommandPalette';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Input | Yes | The surrounding inline layout for the search glyph, query field, and trailing content. |
| Search glyph | Yes | A decorative search icon before the query field. |
| Query field | Yes | The native text field. It is a searchbox when standalone without popup attributes and a combobox when popup relationships are supplied or CommandPalette context is present. |
| Loading spinner | No | A delayed pending indicator shown before trailing content while search is busy. |
| Trailing content | No | Caller-provided supporting content such as a clear control or shortcut hint. |

## Best Practices

- **Do:** Pass a concise label that identifies what can be searched when "Search commands" does not describe it; the placeholder is never the field's name.
- **Do:** Use endContent for short supporting controls or shortcut hints at the trailing edge.
- **Don't:** Override combobox role or popup state. CommandPaletteInput owns those semantics when connected to CommandPalette.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `placeholder` | `string` | `'Search…'` | input placeholder text |
| `label` | `string` | - | accessible label for the query field; default "Search commands", never the placeholder |
| `hasAutoFocus` | `boolean` | `true` | auto-focus on mount; auto-disabled in inline mode |
| `endContent` | `ReactNode` | - | trailing content after spinner |
| `value` | `string` | - | search value; reads context when omitted inside palette |
| `onValueChange` | `(value: string) => void` | - | called on change; writes context when omitted inside palette |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-command-palette-input` | - | - | - |

Override in defineTheme:
```ts
components: {
  'command-palette-input': {
    base: { /* CSS properties */ },
  },
}
```
