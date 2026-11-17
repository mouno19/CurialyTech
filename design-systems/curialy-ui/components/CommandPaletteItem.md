package: @curialy/ui

# CommandPaletteItem

one result option; context owns selection, highlight, identity, and close

**Import:** `import {CommandPaletteItem} from '@curialy/ui/CommandPalette';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Item | Yes | The option root that carries selection, disabled, item identity, interaction, and theme state. |
| Content | Yes | Caller-provided non-interactive label and supporting presentation. |

## Best Practices

- **Do:** Keep each value unique within the result list so highlight, active-descendant identity, and selection resolve to the same item.
- **Do:** Inside CommandPalette, each item is an option in the listbox popup of the WAI-ARIA combobox pattern: keyboard focus stays in the query field, arrow keys move the highlight through aria-activedescendant, and Enter selects the highlighted item.
- **Don't:** Nest buttons, links, or other interactive controls inside an item. Option semantics make descendants presentational, so use non-interactive content such as icons, descriptions, and shortcut hints, and activate the option itself.
- **Don't:** Treat isHighlighted as selection. Highlight is the active keyboard result; isSelected represents the chosen value.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | unique value for identity, highlight lookup, and selection **(required)** |
| `children` | `ReactNode` | - | non-interactive label and supporting content **(required)** |
| `onSelect` | `(value: string) => void` | - | called after pointer activation; palette keyboard selection uses root onValueChange |
| `isHighlighted` | `boolean` | `false` | active keyboard result; derived from context when omitted |
| `isSelected` | `boolean` | `false` | selected value in picker mode; derived from palette value when omitted |
| `isDisabled` | `boolean` | `false` | unavailable; suppresses pointer activation |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-command-palette-item` | `data-highlighted`, `data-selected`, `data-disabled` | - | highlighted, selected, disabled |

Override in defineTheme:
```ts
components: {
  'command-palette-item': {
    base: { /* CSS properties */ },
    'highlighted': { /* state-specific */ },
  },
}
```
