package: @astryxdesign/core

# SideNavItem

Navigation item w/ icon, selected state, optional end content, nesting via children.

**Import:** `import {SideNavItem} from '@astryxdesign/core/SideNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Item label. **(required)** |
| `as` | `LinkComponentType` | - | Custom link component. |
| `icon` | `IconType` | - | Icon displayed in outline (unselected) variant. |
| `selectedIcon` | `IconType` | - | Icon displayed when item selected (filled variant). |
| `isSelected` | `boolean` | `false` | Marks this item as current page. |
| `isDisabled` | `boolean` | `false` | Disabled state. |
| `href` | `string` | - | Navigation URL. |
| `onClick` | `(e: MouseEvent) => void` | - | Click handler. |
| `endContent` | `ReactNode` | - | Passive right-side content only (badges, counts). Interactive controls go in actions. |
| `actions` | `ReactNode` | - | Row-level secondary controls (icon buttons, menus) rendered as siblings of the primary element, after the expand/collapse toggle and before nested children in DOM/focus order. Inherit the row control size via SizeContext (explicit size wins). Hidden when rail collapsed. Passive content goes in endContent; interactive content goes here. |
| `children` | `ReactNode` | - | Sub-items for nesting. Nested rows stay full width; content indents one step per level. |
| `collapsible` | `boolean \| { defaultIsCollapsed?: boolean, isCollapsed?: boolean, onCollapsedChange?: (isCollapsed: boolean) => void }` | `false` | Enables collapse for items w/ children. true=uncontrolled, object=controlled mode. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Row size variant: 'sm' \| 'md' \| 'lg'. |
