package: @curialy/ui

# DropdownMenuGroup

Use to give related compound-menu rows one visible and programmatic name.

**Import:** `import {DropdownMenuGroup} from '@curialy/ui/DropdownMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Group | Yes | The role="group" wrapper containing the heading and menu rows. |
| Heading | No | Visible non-interactive title content that names the group and carries the dropdown-menu-section-heading theme target. |
| Rows | No | Menu items, selectable items, radio groups, or submenus owned by DropdownMenu. |

## Best Practices

- **Do:** Short title that explains the rows' relationship.
- **Do:** Non-interactive title keeps every action in menu arrow navigation.
- **Don't:** Controls in title. Put them in DropdownMenu header or footer instead.
- **Don't:** Group unrelated rows.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `ReactNode` | - | non-interactive heading above the rows; names the group |
| `children` | `ReactNode` | - | the grouped menu rows |
| `xstyle` | `StyleXStyles` | - | StyleX styles on the role="group" wrapper |
| `className` | `string` | - | CSS class on the role="group" wrapper |
| `style` | `React.CSSProperties` | - | inline styles on the role="group" wrapper |
| `ref` | `React.Ref<HTMLDivElement>` | - | ref forwarded to the role="group" wrapper |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-dropdown-menu-section-heading` | - | - | - |

Override in defineTheme:
```ts
components: {
  'dropdown-menu-section-heading': {
    base: { /* CSS properties */ },
  },
}
```
