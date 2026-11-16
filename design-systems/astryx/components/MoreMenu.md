package: @astryxdesign/core

# MoreMenu

MoreMenu is a three-dot button that opens a list of actions. Use it for secondary actions that don't need to be always visible, like in table rows, card headers, or toolbars. Host data-* attrs reach the trigger button; name, id, disclosure attrs stay owned.

**Import:** `import {MoreMenu} from '@astryxdesign/core/MoreMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trigger button | Yes | Icon-only Button that provides the visible overflow-menu entry point. |
| Icon-resolved trigger icon | No | Default semantic three-dot artwork resolved from the active Icon registry. |
| Caller-rendered trigger content | No | Arbitrary React content supplied directly as the trigger icon override. |
| Menu surface | Yes | DropdownMenu panel that also carries MoreMenu’s current public target. |
| Pointer action row | No | Action or nested-action trigger row rendered by DropdownMenu in the anchored presentation. |
| Touch action row | No | ListItem button rendered by DropdownMenu in the BottomSheet presentation. |

## Best Practices

- **Do:** Use for overflow or secondary actions; keep primary actions visible outside the menu.
- **Do:** Use dividers or sections to group related actions when the menu has many items.
- **Do:** Use `presentation="adaptive"` when the visible overflow trigger should open a thumb-reachable BottomSheet on compact touch devices.
- **Don't:** Hide primary actions inside a MoreMenu; they should be directly visible.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `DropdownMenuOption[]` | - | Menu items (actions, dividers, sections). Same type as DropdownMenu items. **(required)** |
| `label` | `string` | `'More options'` | Accessible label (aria-label) + tooltip text. |
| `variant` | `ButtonVariant` | `'ghost'` | Trigger button visual style variant. |
| `size` | `ButtonSize` | `'md'` | Trigger button size. |
| `icon` | `ReactNode` | - | Override default three-dot icon. Accepts any ReactNode. |
| `isDisabled` | `boolean` | `false` | Whether menu trigger disabled. |
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'below'` | Menu position relative to trigger. Logical (RTL mirrors). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'start'` | Alignment along the placement axis. 'end' aligns with the trigger's trailing edge. |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | - | Popover, BottomSheet, or adaptive compact-touch presentation. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback fired when the menu opens or closes. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-more-menu` | - | - | - |

Override in defineTheme:
```ts
components: {
  'more-menu': {
    base: { /* CSS properties */ },
  },
}
```
