package: @curialy/ui

# Breadcrumbs

Breadcrumbs show a trail of links from root to current page. Use at the top of detail pages, settings, or nested content.

**Import:** `import {Breadcrumbs} from '@curialy/ui/Breadcrumbs';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trail | Yes | The ordered list of links from root to current page. |
| Item | Yes | A single step in the trail. Renders as a link or plain text for the current page. |
| Separator | Yes | The character between items. Defaults to "/" but can be customized. |
| Icon | No | An optional icon before an item label, like a home icon on the first item. |

## Best Practices

- **Do:** Place above the page heading so user sees location before reading content.
- **Do:** Keep labels short + matching page titles they link to: "Settings" not "Application Settings Page".
- **Do:** Use supporting variant in dense UIs where the breadcrumb should be subtle.
- **Do:** Last item plain text, not a link; represents current page; done automatically when you set isCurrent.
- **Do:** Implements APG Breadcrumb: labelled nav landmark + ol + aria-current="page". A menu crumb also implements APG Menu Button (Enter/Space/ArrowDown to open, Escape to close).
- **Do:** Give each trail its own label when a page renders more than one.
- **Don't:** Use as primary navigation; breadcrumbs supplement, not replace, a main nav.
- **Don't:** Show on top-level pages with no parent.
- **Don't:** Let the trail exceed 5 levels; simplify the hierarchy instead.
- **Do:** Built-in / mirrors automatically in RTL. Leave bidi-mirrored › alone; mirror custom arrows and Icons once.
- **Don't:** Mirror a separator that already mirrors itself: › is Bidi_Mirrored and flips under RTL on its own. → and Icon separators are not, so those need rtlStyles.mirror via xstyle.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | BreadcrumbItem elements to render inside the breadcrumb trail. **(required)** |
| `separator` | `ReactNode` | `'/'` | Separator rendered between breadcrumb items. The built-in slash mirrors automatically in RTL. |
| `variant` | `'default' \| 'supporting'` | `'default'` | Visual variant: supporting is smaller with secondary text styling. |
| `label` | `string` | `'Breadcrumb'` | Accessible label for the nav landmark (aria-label). |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Components

### BreadcrumbItem

Individual breadcrumb item. Renders as a link when href is provided, or as plain text for the current page.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Label content for the breadcrumb item. **(required)** |
| `href` | `string` | - | URL the breadcrumb links to; omit for non-navigable items. |
| `onClick` | `(e: MouseEvent) => void` | - | Click handler for the breadcrumb item. |
| `isCurrent` | `boolean` | - | Marks this item as the current page, applying aria-current="page". When omitted, the last item is auto-detected if no item is explicitly current; pass false to opt out. |
| `startIcon` | `ReactNode` | - | Icon rendered before the item label. |
| `as` | `LinkComponentType` | - | Custom link component to render instead of <a>. Overrides the provider-level default from LinkProvider. Only applies to non-current items. |
| `menu` | `DropdownMenuOption[] \| ReactNode` | - | Menu opened when the item is activated, using the same item API as DropdownMenu/MoreMenu/ContextMenu (a DropdownMenuOption[] array or composed DropdownMenuItem children). Renders a link-styled menu trigger with a chevron and aria-haspopup="menu". Takes precedence over href/onClick. |
| `menuSize` | `'sm' \| 'md' \| 'lg'` | - | Size passed to the menu items. Defaults from the breadcrumb variant ('supporting' → 'sm', otherwise 'md'). |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-breadcrumb-item` | `data-variant` | default, supporting | - |
| `cui-breadcrumb-item-menu-trigger` | `data-variant` | default, supporting | - |
| `cui-breadcrumb-menu` | - | - | - |
| `cui-breadcrumbs` | `data-variant` | default, supporting | - |

Override in defineTheme:
```ts
components: {
  'breadcrumb-item': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
  'breadcrumb-item-menu-trigger': {
    base: { /* CSS properties */ },
  },
}
```
