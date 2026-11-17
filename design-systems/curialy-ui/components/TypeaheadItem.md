package: @curialy/ui

# TypeaheadItem

Default dropdown item renderer. Label w/ optional icon, description, avatar. Exported for custom renderItem.

**Import:** `import {TypeaheadItem} from '@curialy/ui/Typeahead';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `item` | `SearchableItem` | - | Search result item to render. **(required)** |
| `icon` | `ReactNode` | - | Icon/avatar before label. |
| `description` | `string` | - | Text below label. |
| `isDisabled` | `boolean` | `false` | Visually disabled. |
| `group` | `string` | - | No effect. Group results via `item.auxiliaryData.group` in the search source. |
