package: @astryxdesign/core

# RadioListItem

Individual radio item w/ label, description, content slots.

**Import:** `import {RadioListItem} from '@astryxdesign/core/RadioList';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | - | Primary label. String or ReactNode; nested controls keep their behavior. **(required)** |
| `aria-label` | `string` | - | Plain-text radio name replacing the derived label. Use when visible text is absent; otherwise retain every visible label word. |
| `value` | `string` | - | Value of this radio item. **(required)** |
| `description` | `ReactNode` | - | Secondary content below label. String or ReactNode. |
| `align` | `'center' \| 'start' \| 'first-line'` | `'center'` | Start/end content alignment, passed to Item: 'center' (default), 'start', or 'first-line' (centered on the label's first line). |
| `isDisabled` | `boolean` | `false` | Whether this individual radio item disabled. |
| `startContent` | `ReactNode` | - | Content rendered before radio circle. |
| `endContent` | `ReactNode` | - | Content rendered after label. |
