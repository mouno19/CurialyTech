package: @astryxdesign/core

# DropdownMenuItem

one pointer-menu action/destination row; parent owns keyboard, row owns activation, state, destination, content, and root inputs

**Import:** `import {DropdownMenuItem} from '@astryxdesign/core/DropdownMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Row | Yes | The role="menuitem" root that owns activation, disabled state, destination behavior, and theme state. |
| Content | Yes | The non-interactive label plus optional icon, description, and end content. |

## Best Practices

- **Do:** Use href for a destination so LinkProvider, modified clicks, middle clicks, and browser link affordances remain available.
- **Do:** Use hasCloseOnSelect=false only when activation reports a result in place on the same row.
- **Don't:** Put buttons, links, or other focusable controls inside label, description, or endContent. Each menu row is one interactive target.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `IconType` | - | icon before label |
| `label` | `ReactNode` | - | primary label text **(required)** |
| `description` | `ReactNode` | - | secondary text below label |
| `onClick` | `(event: MouseEvent) => void` | - | selection callback (event); keyboard activation = synthesized click w/ modifiers; skipped for a modified click on an href row |
| `href` | `string` | - | row is a real anchor w/ role=menuitem; modified/middle click keeps browser meaning |
| `target` | `'_blank' \| '_self'` | - | link target ('_blank' \| '_self'), with href |
| `rel` | `string` | - | link rel; noopener noreferrer added for _blank |
| `isDisabled` | `boolean` | `false` | unavailable; removes destinations and suppresses activation |
| `endContent` | `ReactNode` | - | non-interactive content after label+description |
| `hasCloseOnSelect` | `boolean` | `true` | false keeps the menu open on activation (in-place result on the item) |
| `variant` | `'default' \| 'destructive'` | `'default'` | 'destructive' renders the item in the error color for dangerous actions |
| `xstyle` | `StyleXStyles` | - | StyleX styles for root container |
| `ref` | `React.Ref<HTMLElement>` | - | forwarded to the row root (the role="menuitem" element) |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-dropdown-menu-item` | `data-size`, `data-variant` | default, destructive | - |

Override in defineTheme:
```ts
components: {
  'dropdown-menu-item': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
}
```
