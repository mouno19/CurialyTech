package: @curialy/ui

# DropdownMenuDivider

separator row for compound menus; compound peer of the data API's {type: "divider"}; host attributes reach the separator, role/orientation stay owned

**Import:** `import {DropdownMenuDivider} from '@curialy/ui/DropdownMenu';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `xstyle` | `StyleXStyles` | - | StyleX styles applied after the menu spacing |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-dropdown-menu-divider` | - | - | - |

Override in defineTheme:
```ts
components: {
  'dropdown-menu-divider': {
    base: { /* CSS properties */ },
  },
}
```
