package: @curialy/ui

# SegmentedControlItem

individual segment; renders as radio button in control

**Import:** `import {SegmentedControlItem} from '@curialy/ui/SegmentedControl';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | unique segment value; matched against parent **(required)** |
| `label` | `string` | - | segment label; visible unless isLabelHidden **(required)** |
| `isLabelHidden` | `boolean` | `false` | hides label visually; label becomes aria-label |
| `icon` | `ReactNode` | - | icon before label |
| `isDisabled` | `boolean` | `false` | disables this item |
