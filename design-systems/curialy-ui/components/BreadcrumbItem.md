package: @curialy/ui

# BreadcrumbItem

individual breadcrumb; link w/ href, plain text for current page

**Import:** `import {BreadcrumbItem} from '@curialy/ui/Breadcrumbs';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | label content **(required)** |
| `href` | `string` | - | link URL; omit for non-navigable items |
| `onClick` | `(e: MouseEvent) => void` | - | click handler |
| `isCurrent` | `boolean` | - | marks current page w/ aria-current="page"; omitted auto-detects the last item; false opts out |
| `startIcon` | `ReactNode` | - | icon before label |
| `menu` | `DropdownMenuOption[] \| ReactNode` | - | DropdownMenuOption[] \| children; opens a menu trigger (aria-haspopup="menu"); reuses the DropdownMenu item API |
| `menuSize` | `'sm' \| 'md' \| 'lg'` | - | menu item size; defaults from variant (supporting→sm, else md) |
| `as` | `LinkComponentType` | - | custom link component; overrides LinkProvider default |
