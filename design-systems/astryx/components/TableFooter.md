package: @astryxdesign/core

# TableFooter

<tfoot> wrapper for children mode; holds summary rows

**Import:** `import {TableFooter} from '@astryxdesign/core/Table';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | The <tfoot> rows. **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-table-footer` | - | - | - |

Override in defineTheme:
```ts
components: {
  'table-footer': {
    base: { /* CSS properties */ },
  },
}
```
