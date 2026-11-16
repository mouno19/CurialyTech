package: @astryxdesign/core

# CommandPaletteList

scrollable results container; role=listbox standalone, and in CommandPalette only while results exist

**Import:** `import {CommandPaletteList} from '@astryxdesign/core/CommandPalette';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | items, groups, empty states **(required)** |
| `label` | `string` | `'Commands'` | a11y label for listbox |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |
