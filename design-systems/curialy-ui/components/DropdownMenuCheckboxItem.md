package: @curialy/ui

# DropdownMenuCheckboxItem

checkable menu item (menuitemcheckbox); independent boolean toggle

**Import:** `import {DropdownMenuCheckboxItem} from '@curialy/ui/DropdownMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Checkable row | Yes | The menuitemcheckbox root that owns the accessible name, checked state, focus, and activation. |
| Label/content | Yes | Caller content laid out by Item: the required label plus optional description, icon, and end content. |
| Checkbox marker | Yes | Decorative shared Indicator chrome that visualizes checked and disabled state without adding a second control. |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | - | primary label text |
| `description` | `ReactNode` | - | secondary text below label |
| `icon` | `IconType` | - | icon before label |
| `value` | `boolean` | - | checked state (controlled, w/ onChange) |
| `onChange` | `(checked: boolean) => void` | - | fired w/ next checked state on toggle |
| `isDisabled` | `boolean` | `false` | disabled (aria-disabled); reached by arrows/typeahead, focusable, inert |
| `hasCloseOnSelect` | `boolean` | `false` | close menu on toggle (default false, stays open) |
| `ref` | `React.Ref<HTMLElement>` | - | forwarded to the row root (the role="menuitemcheckbox" element) |
| `endContent` | `ReactNode` | - | content after label+description |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-dropdown-menu-item` | `data-size` | size | - |

Override in defineTheme:
```ts
components: {
  'dropdown-menu-item': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
}
```
