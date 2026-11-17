package: @curialy/ui

# TableHeader

<thead> wrapper for children mode; holds the header row

**Import:** `import {TableHeader} from '@curialy/ui/Table';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | The <thead> rows. **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-table-header` | - | - | - |

Override in defineTheme:
```ts
components: {
  'table-header': {
    base: { /* CSS properties */ },
  },
}
```
