package: @astryxdesign/core

# DropdownMenuRadioItem

one option in a DropdownMenuRadioGroup (menuitemradio)

**Import:** `import {DropdownMenuRadioItem} from '@astryxdesign/core/DropdownMenu';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | item's value within the group (matched vs group value) **(required)** |
| `label` | `ReactNode` | - | primary label text **(required)** |
| `description` | `ReactNode` | - | secondary text below label |
| `icon` | `IconType` | - | icon before label |
| `isDisabled` | `boolean` | `false` | disabled (aria-disabled); reached by arrows/typeahead, focusable, inert |
| `endContent` | `ReactNode` | - | content after label+description |
| `ref` | `React.Ref<HTMLElement>` | - | forwarded to the row root (the role="menuitemradio" element) |
