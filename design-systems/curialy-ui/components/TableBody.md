package: @curialy/ui

# TableBody

<tbody> wrapper for children mode; holds the data rows; children mode does not add one for you

**Import:** `import {TableBody} from '@curialy/ui/Table';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | The <tbody> rows. **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-table-body` | - | - | - |

Override in defineTheme:
```ts
components: {
  'table-body': {
    base: { /* CSS properties */ },
  },
}
```
