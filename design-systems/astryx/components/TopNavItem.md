package: @astryxdesign/core

# TopNavItem

Nav link for TopNav startContent; renders as anchor w/ hover+selected states.

**Import:** `import {TopNavItem} from '@astryxdesign/core/TopNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Visible text or aria-label when isIconOnly is true. **(required)** |
| `href` | `string` | - | Navigation URL. |
| `isSelected` | `boolean` | `false` | Sets aria-current="page"+highlighted styles. |
| `isDisabled` | `boolean` | `false` | Sets aria-disabled, drops href/target (no navigation), prevents interaction. |
| `isIconOnly` | `boolean` | `false` | Renders the item as a square icon-only element. When true, label becomes the aria-label and visible text is hidden. Requires icon to be set. |
| `icon` | `ReactNode` | - | Icon before label. |
| `children` | `ReactNode` | - | Custom content instead of label text. |
| `as` | `LinkComponentType` | - | Custom link component. Overrides LinkProvider default. Must accept href, className, style, children. |
