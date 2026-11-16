package: @astryxdesign/core

# FieldLabel

label group for one control or a caller-labelled group; supporting text, optionality, icon, tooltip

**Import:** `import {FieldLabel} from '@astryxdesign/core/Field';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text. **(required)** |
| `inputID` | `string` | - | ID of the associated control. **(required)** |
| `labelID` | `string` | - | ID of the label element for caller-owned aria-labelledby. |
| `isGroupLabel` | `boolean` | `false` | Render a group-label span instead of a native label. |
| `isLabelHidden` | `boolean` | `false` | Visually hide label and description. |
| `isDisabled` | `boolean` | `false` | Use disabled label presentation. |
| `isOptional` | `boolean` | `false` | Show localized optional exception indicator. |
| `isRequired` | `boolean` | `false` | Show localized required exception indicator. |
| `labelIcon` | `ReactNode \| IconType` | - | Icon type or rendered icon content before label text. |
| `labelTooltip` | `string` | - | Help text for the info button after the label. |
| `description` | `ReactNode` | - | Supporting content outside the accessible name. |
| `descriptionID` | `string` | - | ID for caller-owned aria-describedby wiring. |
| `ref` | `React.Ref<HTMLLabelElement>` | - | Ref forwarded to the label element; group mode renders a span. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for the label element. |
| `className` | `string` | - | CSS class name for the label element. |
| `style` | `React.CSSProperties` | - | Inline styles for the label element. |
