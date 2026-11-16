package: @astryxdesign/core

# LayoutContent

Scrollable main content area.

**Import:** `import {LayoutContent} from '@astryxdesign/core/Layout';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Content. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Internal padding on spacing scale. Overrides layout container default. |
| `isScrollable` | `boolean` | `true` | Enable scrollable overflow. With arithmetic contentWidth values, the scrollport reaches open sides while context-aware insets align children. |
| `label` | `string` | - | Accessible label for landmark element; also names the region while it scrolls (default "Content"). |
| `role` | `AriaRole` | - | ARIA landmark role. |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the content region element. |
