package: @curialy/ui

# CheckboxListItem

Individual checkbox item w/ label, description, end content slot. Collection mode inside CheckboxList with value; standalone inside List or CheckboxList without value. On a touch screen a toggleable row presses as one target, box included; with a fine primary pointer the box keeps its own press.

**Import:** `import {CheckboxListItem} from '@curialy/ui/CheckboxList';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | - | Primary label. String or ReactNode; nested controls keep their behavior. A ReactNode names the checkbox from its visible text. **(required)** |
| `aria-label` | `string` | - | Plain-text checkbox name replacing the one derived from label. Use when visible text is absent; otherwise retain every visible label word. |
| `value` | `string` | - | Identity key. Required when parent CheckboxList has a value array (throws without it). |
| `description` | `ReactNode` | - | Secondary content below label. String or ReactNode. Exposed as the checkbox's accessible description via aria-describedby. |
| `endContent` | `ReactNode` | - | Content rendered after label area. |
| `align` | `'center' \| 'start' \| 'first-line'` | `'center'` | Start/end content alignment, passed to Item: 'center' (default), 'start', or 'first-line' (centered on the label's first line). |
| `isDisabled` | `boolean` | `false` | Whether this individual item is disabled. |
| `isLoading` | `boolean` | `false` | Item loading: spinner inside checkbox + blocks interaction. Auto-set on toggled item while parent changeAction pending. |
| `isChecked` | `boolean \| 'indeterminate'` | - | Direct checked state in standalone mode (inside List, or CheckboxList without value). Ignored when parent CheckboxList has a value array. |
| `onCheck` | `(checked: boolean) => void` | - | Direct check handler in standalone mode (inside List, or CheckboxList without value). Ignored when parent CheckboxList has a value array; its onChange gets the change. |

## Examples

### Rich label with an overriding aria-label

```tsx
<CheckboxListItem
  label={<span>Pro plan <Badge label="Recommended" /></span>}
  aria-label="Pro plan Recommended option"
  value="pro"
/>
```
