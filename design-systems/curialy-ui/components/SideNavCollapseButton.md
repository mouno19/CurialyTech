package: @curialy/ui

# SideNavCollapseButton

Toggle button for sidenav collapse. Place inside SideNav (reads context) or outside (pass the same controlled collapsible config both get). Icon-only ghost button by default.

**Import:** `import {SideNavCollapseButton} from '@curialy/ui/SideNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `collapsible` | `{isCollapsed: boolean, onCollapsedChange: (isCollapsed: boolean) => void, defaultIsCollapsed?: boolean, hasButton?: boolean, buttonLabel?: string}` | - | Controlled collapsible config, same object SideNav gets, all keys allowed. Only needed when button rendered outside sidenav. |
| `handleRef` | `RefObject<SideNavImperativeCollapseHandle \| null>` | - | Deprecated. Pass collapsible instead. |
| `label` | `string` | - | Custom label. Text button w/ chevron when provided, icon-only when omitted. |
| `size` | `'sm' \| 'md' \| 'lg'` | - | Button size. Inherits from the container ('sm' in a SideNav footer), else 'md'. |
| `children` | `ReactNode` | - | Custom content. Overrides default chevron icon + label. |
