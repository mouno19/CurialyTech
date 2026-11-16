package: @astryxdesign/core

# CommandPaletteFooter

footer w/ kbd hints; default=arrow/Enter/Escape hints via Kbd

**Import:** `import {CommandPaletteFooter} from '@astryxdesign/core/CommandPalette';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Footer | Yes | Supporting region that presents default guidance or caller-provided footer content. |
| Keyboard shortcut | No | Default Kbd badges for navigation, selection, and dismissal. |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | custom content; default renders kbd hints |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-command-palette-footer` | - | - | - |

Override in defineTheme:
```ts
components: {
  'command-palette-footer': {
    base: { /* CSS properties */ },
  },
}
```
