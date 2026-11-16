package: @astryxdesign/core

# LayoutPanel

Sidebar for navigation, settings, inspector panels.

**Import:** `import {LayoutPanel} from '@astryxdesign/core/Layout';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Panel content. |
| `hasDivider` | `boolean` | `false` | Line on the content-facing edge (start slot: inline end; end slot: inline start); without it or padding, panel and content share one gap. Layout defaultHasDividers does not apply. False beside a ResizeHandle with its own line. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Padding on every edge; replaces the automatic inset and the shared gap. 0 is full bleed. |
| `isScrollable` | `boolean` | `true` | Enable scrollable overflow. |
| `label` | `string` | - | Accessible label for landmark element; also names the region while it scrolls (default "Content"). |
| `role` | `AriaRole` | - | ARIA landmark role. |
| `width` | `number \| string` | - | Panel width. Numbers = pixels, strings as-is. Ignored when resizable provided; hook controls width. width={region.size} beside a ResizeHandle given the region props: inert while collapsed; focus inside moves to the handle on collapse. |
| `resizable` | `ResizableRegion \| ResizableProps` | - | useResizable() output or its props. Hook drives panel width; place ResizeHandle adjacent. Hook values slide; hand-built ones do not. Focus inside moves to the handle on collapse; inert while collapsed. |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the panel element. |
