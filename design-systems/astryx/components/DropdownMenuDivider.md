package: @astryxdesign/core

# DropdownMenuDivider

separator row for compound menus; compound peer of the data API's {type: "divider"}; host attributes reach the separator, role/orientation stay owned

**Import:** `import {DropdownMenuDivider} from '@astryxdesign/core/DropdownMenu';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `xstyle` | `StyleXStyles` | - | StyleX styles applied after the menu spacing |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-dropdown-menu-divider` | - | - | - |

Override in defineTheme:
```ts
components: {
  'dropdown-menu-divider': {
    base: { /* CSS properties */ },
  },
}
```
