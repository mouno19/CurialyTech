package: @curialy/ui

# ContextMenu

A right-click context menu that appears at the cursor position. Use to provide contextual actions for specific elements or regions.

**Import:** `import {ContextMenu} from '@curialy/ui/ContextMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trigger area | Yes | Caller-provided region that accepts right-click, keyboard context-menu, and long-press input. |
| Pointer menu surface | No | Cursor-positioned menu panel used by the pointer presentation. |
| Pointer action row | No | DropdownMenu-owned action, selectable option, or submenu row in the pointer presentation. |
| Touch sheet frame | No | BottomSheet panel, content area, handle, and optional scrim that host touch actions. |
| Touch menu surface | No | ContextMenu-owned content panel rendered inside the touch sheet frame. |
| Touch action list | No | Spacious List that groups data-driven touch actions. |
| Touch action row | No | ListItem button used for a data-driven action or drill-in entry in the touch presentation. |

## Best Practices

- **Do:** Keep items concise and action-oriented.
- **Do:** Group related actions with sections and dividers.
- **Do:** Use adaptive presentation for cursor popover on desktop and BottomSheet on compact touch.
- **Do:** Ensure actions are also accessible via other UI elements.
- **Do:** Keep a visible mobile entry point for important actions.
- **Don't:** Use as the only way to access important actions.
- **Don't:** Place more than 10–12 items without grouping.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | The trigger area: right-click on this content to open the menu. **(required)** |
| `items` | `ContextMenuOption[]` | - | Data-driven menu entries. Pass exactly one of `items` or `menuContent`. Each entry is one of: an action item `{label, onClick?, icon?, isDisabled?, variant?, items?}` (nested `items` open a flyout in popover presentation and drill into a new view in bottom-sheet presentation; variant `"destructive"` renders it in the error color), a divider `{type: "divider"}`, or a section `{type: "section", title?, items: [...action items]}`. |
| `menuContent` | `ReactNode` | - | Custom JSX menu content for compound mode. Pass exactly one of `menuContent` or `items`. |
| `menuWidth` | `number \| string` | `'160px'` | Custom menu width. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size of menu items: controls padding density. |
| `label` | `string` | `'Context menu'` | Accessible name for the menu surface, announced when it opens. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback fired when the menu opens or closes. |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | `'popover'` | Presentation policy. `popover` opens at the pointer position, `bottom-sheet` always uses an action sheet, and `adaptive` uses the BottomSheet on a compact touch screen: a coarse primary pointer, and a viewport narrower than the theme `md` breakpoint (768px by default) or shorter than 500px. |
| `isDisabled` | `boolean` | `false` | When true, right-click shows the native browser context menu instead. |
| `triggerXstyle` | `StyleXStyles \| StyleXStyles[]` | - | Styles applied to the trigger wrapper. Accepts `stylex.create()` values, not inline style objects. |
| `triggerAs` | `'div' \| 'span'` | `'div'` | The element the trigger wrapper renders as. 'div' is a block; 'span' an inline wrapper, so a reference inside prose can own a context menu without breaking the text flow. |

## Components

### ContextMenuItem

See `design_system component ContextMenuItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-context-menu` | - | - | - |

Override in defineTheme:
```ts
components: {
  'context-menu': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  context-menu: {
    base: {
      borderRadius: '...',
      padding: '...',
    },
  },
}
```
