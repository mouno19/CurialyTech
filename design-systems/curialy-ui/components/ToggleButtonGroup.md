package: @curialy/ui

# ToggleButtonGroup

groups toggle btns for exclusive/multi-select; discriminated union on type; on touch a press slides across toggles like a menu and only the one lifted on toggles; a mouse press stays native; finger targets grow toward 44 px, up to half the gap to a neighbour

**Import:** `import {ToggleButtonGroup} from '@curialy/ui/ToggleButton';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | ToggleButton children; each member needs a value. Group owns pressed state; member isPressed/onPressedChange/pressedChangeAction are ignored. Selection uses group onChange, with no member Action transition. **(required)** |
| `label` | `string` | - | a11y label (aria-label) **(required)** |
| `type` | `'single' \| 'multiple'` | `'single'` | selection mode: single or multiple |
| `value` | `string \| null \| string[]` | - | selected value(s); type depends on mode **(required)** |
| `onChange` | `(value: string \| null \| string[]) => void` | - | selection change cb **(required)** |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | layout direction |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | default btn size; individual btns override |
| `isDisabled` | `boolean` | `false` | all btns disabled |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |
| `data-testid` | `string` | - | test selector |
