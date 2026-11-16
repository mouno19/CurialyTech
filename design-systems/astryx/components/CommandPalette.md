package: @astryxdesign/core

# CommandPalette

CommandPalette is a searchable dialog for quick access to commands, navigation, and actions. Use it as a keyboard-driven launcher powered by SearchSource for filtering and selection.

**Import:** `import {CommandPalette} from '@astryxdesign/core/CommandPalette';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Dialog | Yes | Modal surface that contains the command palette. |
| Input | Yes | Search region containing the query field and its supporting visuals. |
| Search glyph | Yes | Search symbol rendered by Icon in the default Input. |
| Query field | Yes | Native text field used to enter a search query. |
| Loading spinner | No | Spinner shown in the default Input while a search is pending. |
| List | Yes | Scrollable results container: a listbox while selectable results exist, otherwise the Empty state as plain content. |
| Item | No | Selectable command result rendered inside the List. |
| Group | No | Optional collection of Items that share a heading. |
| Group heading | No | Visible heading rendered for a Group. |
| Empty | No | Message shown when the current result set is empty. |
| Footer | No | Footer region for default keyboard guidance or caller-provided content. |
| Keyboard shortcut | No | Painted key badges rendered by Kbd in the default Footer guidance. |

## Best Practices

- **Do:** Provide a searchSource with bootstrap results so users see useful options before typing.
- **Do:** Use auxiliaryData.group on items to automatically organize results into labeled sections.
- **Do:** Provide a specific label when more than one command palette can appear in the same product surface.
- **Do:** Keep renderItem content non-interactive; each rendered row is one option, so buttons and links cannot be nested inside it.
- **Don't:** Intercept query-field keyboard events without preserving active IME composition and native Home/End caret movement.
- **Don't:** Use CommandPalette for simple dropdowns or menus; use Menu or Selector for inline selections.
- **Don't:** Add too many groups or items; curate results to keep the palette fast and scannable.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the command palette dialog is visible. **(required)** |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Called when the palette visibility changes. **(required)** |
| `searchSource` | `SearchSource<T>` | - | Search source providing items via search(query) and bootstrap(). Use createStaticSource for static lists. **(required)** |
| `input` | `ReactNode` | `<CommandPaletteInput />` | Input slot. Defaults to CommandPaletteInput with standard behavior. |
| `footer` | `ReactNode` | `<CommandPaletteFooter />` | Footer slot. Defaults to CommandPaletteFooter showing keyboard hints. |
| `renderItem` | `(item: T, isSelected: boolean) => ReactNode` | - | Per-item render function for non-interactive presentation content such as labels, icons, descriptions, and shortcut hints. Do not return buttons or links inside the option. Auto-grouping by auxiliaryData.group is preserved. When omitted, renders label text. |
| `emptySearchText` | `ReactNode` | `'No results'` | Content shown when a search query returns no results. |
| `emptyBootstrapText` | `ReactNode` | `'Type to search'` | Content shown when there is no search query and bootstrap() returns nothing. |
| `value` | `string` | - | Controlled selected value for picker mode. |
| `onValueChange` | `(value: string) => void` | - | Called when the selected value changes in picker mode. |
| `label` | `string` | `'Command palette'` | Accessible label for the command palette dialog. |
| `width` | `number \| string` | `640` | Width of the dialog. |
| `maxHeight` | `number \| string` | `480` | Maximum height of the dialog. |
| `isInline` | `boolean` | `false` | Renders command palette content inline without modal behavior. Automatically disables input auto-focus and initial highlighted-item auto-scroll. For documentation previews and showcases only. |

## Components

### CommandPaletteInput

See `astryx component CommandPaletteInput` for props and usage.

### CommandPaletteList

See `astryx component CommandPaletteList` for props and usage.

### CommandPaletteItem

See `astryx component CommandPaletteItem` for props and usage.

### CommandPaletteGroup

See `astryx component CommandPaletteGroup` for props and usage.

### CommandPaletteFooter

See `astryx component CommandPaletteFooter` for props and usage.

### CommandPaletteEmpty

See `astryx component CommandPaletteEmpty` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-command-palette-empty` | - | - | - |
| `astryx-command-palette-footer` | - | - | - |
| `astryx-command-palette-group` | - | - | - |
| `astryx-command-palette-group-heading` | - | - | - |
| `astryx-command-palette-input` | - | - | - |
| `astryx-command-palette-item` | `data-highlighted`, `data-selected`, `data-disabled` | - | highlighted, selected, disabled |
| `astryx-command-palette-list` | - | - | - |

Override in defineTheme:
```ts
components: {
  'command-palette-empty': {
    base: { /* CSS properties */ },
  },
  'command-palette-footer': {
    base: { /* CSS properties */ },
  },
}
```
