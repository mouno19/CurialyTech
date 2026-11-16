package: @astryxdesign/core

# TableHeader

<thead> wrapper for children mode; holds the header row

**Import:** `import {TableHeader} from '@astryxdesign/core/Table';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | The <thead> rows. **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-table-header` | - | - | - |

Override in defineTheme:
```ts
components: {
  'table-header': {
    base: { /* CSS properties */ },
  },
}
```
