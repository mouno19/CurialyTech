package: @astryxdesign/core

# LayoutHeader

Top bar for page titles, app bars, toolbars.

**Import:** `import {LayoutHeader} from '@astryxdesign/core/Layout';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Header content. |
| `hasDivider` | `boolean` | `false` | Border at bottom edge; unset uses the Layout default. |
| `height` | `SizeValue` | - | Header height. |
| `label` | `string` | - | Accessible label for landmark element. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Padding on every edge; replaces the layout inset. 0 is full bleed. |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-end (bottom) padding override; wins over padding on that edge. 0 docks the last child on the header bottom edge. |
| `role` | `AriaRole` | - | ARIA landmark role. |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the header element. |
