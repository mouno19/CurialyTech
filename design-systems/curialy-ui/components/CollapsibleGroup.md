package: @curialy/ui

# CollapsibleGroup

coordinates multiple Collapsible instances; single or multiple open. no wrapper DOM unless dividers enabled.

**Import:** `import {CollapsibleGroup} from '@curialy/ui/Collapsible';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'single' \| 'multiple'` | `'single'` | one or many items open simultaneously |
| `defaultValue` | `string \| string[]` | - | default open item(s) (uncontrolled); string for single, array for multiple |
| `value` | `string \| string[]` | - | controlled open item(s) |
| `onChange` | `(value: string \| string[]) => void` | - | callback on open items change |
| `hasDividers` | `boolean` | `false` | draw hairline dividers between items; enables wrapper div + 'balanced' density; use bare Collapsible children |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | - | row padding 'compact' \| 'balanced' \| 'spacious'; defaults 'balanced' with dividers, else unpadded |
| `chevronPosition` | `'start' \| 'end'` | `'end'` | logical chevron position for direct items: 'end' (default trailing, down/up) \| 'start' (leading, inward/down with RTL mirroring); per-item prop wins |
| `children` | `ReactNode` | - | Collapsible instances to coordinate **(required)** |
| `ref` | `React.Ref<HTMLElement>` | - | Ref forwarded to the group wrapper when hasDividers renders one. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for the group wrapper when hasDividers renders one. Must be a stylex.create() value. |
| `className` | `string` | - | CSS class name for the group wrapper when hasDividers renders one. Prefer xstyle for styling. |
| `style` | `CSSProperties` | - | Inline styles for the group wrapper when hasDividers renders one. Prefer xstyle for StyleX-optimized styling. |
| `data-testid` | `string` | - | Test selector forwarded to the group wrapper when hasDividers renders one. |
