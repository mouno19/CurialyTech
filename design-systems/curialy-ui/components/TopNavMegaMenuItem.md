package: @curialy/ui

# TopNavMegaMenuItem

Individual mega menu item. Renders in desktop popover grid + mobile drawer modes via context.

**Import:** `import {TopNavMegaMenuItem} from '@curialy/ui/TopNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | - | Display title. **(required)** |
| `description` | `string` | - | Description below title. |
| `icon` | `ReactNode` | - | Left icon element. |
| `href` | `string` | - | Navigation URL. |
| `onClick` | `() => void` | - | Click callback. |
| `as` | `LinkComponentType` | - | Custom link component, overrides LinkProvider default. |
