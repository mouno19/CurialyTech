package: @curialy/ui

# DropdownMenu

A dropdown menu that displays a list of actionable items in a popup triggered by a button. Use to present action options as a next step in a process, or to offer contextual actions without cluttering the interface.

**Import:** `import {DropdownMenu} from '@curialy/ui/DropdownMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trigger button | Yes | Button that opens and closes the selected menu presentation. |
| Trigger indicator icon | No | Optional trailing chevron shown by a labeled trigger when hasChevron is enabled. |
| Pointer menu surface | No | Anchored top-level or nested menu panel used by the pointer presentation. |
| Pointer action row | No | Action, selectable option, or submenu trigger row in an anchored menu. |
| Icon-rendered item icon | No | Optional semantic or component icon rendered through Icon at the start of an action row. |
| Caller-rendered item start content | No | Optional arbitrary React content rendered directly at the start of an action row. |
| Checkbox indicator | No | Decorative shared checkbox indicator for a checkbox action row. |
| Radio indicator | No | Decorative shared radio indicator with an additional menu-owned target. |
| Pointer section heading | No | Heading that labels a group of rows in an anchored menu: a data-driven section or a compound DropdownMenuGroup. |
| Pointer divider | No | Divider between groups in an anchored menu. |
| Pointer submenu indicator icon | No | Trailing chevron that identifies an action row as a nested flyout trigger. |
| Touch sheet frame | No | BottomSheet panel, content area, handle, and optional scrim that host touch actions. |
| Touch menu surface | No | Menu-owned content panel rendered inside the touch sheet frame. |
| Touch heading | No | Current action-sheet title, updated when a nested action view is opened. |
| Touch action list | No | Spacious List that groups actions in the touch presentation. |
| Touch action row | No | ListItem button used for an action or drill-in entry in the touch presentation. |
| Touch divider | No | Divider between action groups in the touch presentation. |

## Best Practices

- **Do:** Keep menu items concise and action-oriented so users can scan options quickly.
- **Do:** Use sections and dividers to group related actions when the menu has many items.
- **Do:** For a short, flat action set, use presentation="bottom-sheet" when product policy calls for a modal touch surface.
- **Do:** Use presentation="adaptive" when the same short action set should remain anchored on pointer layouts and become a BottomSheet on compact coarse-pointer layouts.
- **Do:** For a hierarchy that cannot fit as adjacent flyouts on a compact touch surface, a product may explicitly use a drill-in interaction with a Back action.
- **Do:** Choose presentation explicitly in product code. A compact, coarse-pointer, hover-free media query is one useful policy, but DropdownMenu does not impose a universal device breakpoint.
- **Do:** When the content is no longer a short list of immediate actions, reevaluate the interaction and choose a component that matches the actual task; content traits alone do not determine the component.
- **Don't:** Use a DropdownMenu for navigation; use a navigation component instead.
- **Don't:** Place more than 10–12 items in a single menu without grouping them into sections.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `button` | `DropdownMenuButtonProps` | `{ label: 'Menu' }` | Props for the trigger button (Button props except onClick). Mutually exclusive with `renderTrigger`. |
| `renderTrigger` | `(props: DropdownMenuTriggerProps) => ReactNode` | - | Render the control the menu hangs off — an IconButton, a chip, an avatar, a list row — instead of the built-in Button. Spread the given props onto it: they carry the press model (a mouse opens on press-down, a finger or a pen opens as it presses), the keyboard opens, the toggle click, and `aria-haspopup`/`aria-expanded`/`aria-controls`/`id`; the menu is then named by that control through `aria-labelledby`. Mutually exclusive with `button`. |
| `items` | `DropdownMenuOption[]` | - | Array of menu entries. Each entry is one of: an action item `{label, onClick?, href?, target?, rel?, icon?, description?, endContent?, isDisabled?, variant?, hasCloseOnSelect?, id?}` (`href` makes the row a real link, so a modified click keeps the browser's meaning; variant `"destructive"` renders it in the error color; `endContent` holds trailing content such as a keyboard-shortcut hint; `id` is the row's stable React key, needed only when the array reorders or filters), a divider `{type: "divider"}`, or a section `{type: "section", title?, id?, items: [...action items]}`. **(required)** |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | - | Presentation surface for data-driven items. 'popover' stays anchored, 'bottom-sheet' always renders the actions in a modal BottomSheet, and 'adaptive' uses a BottomSheet on compact coarse-pointer layouts while remaining anchored elsewhere. Compound children currently support popover only. Omitted, the menu is anchored, and under a finger or a pen, on every device, its trigger opens as it is pressed (inside a scroll view, after the 150 ms content-touch delay), and the opening finger picks after moving 10 px. Pass 'popover' to keep the pointer behavior on every device, a 500 ms hold included. |
| `isMenuOpen` | `boolean` | - | Controlled open state for the menu. Mounting with true renders the menu open without moving focus into it; focus moves to the first item only when the menu opens after mount. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback fired when the open state changes. |
| `menuWidth` | `number \| string` | - | Minimum width for the popover presentation. Length values may grow for content; intrinsic and CSS-wide keywords select the preferred inline size. Every form is capped to the available viewport space. Defaults to matching the trigger width up to that cap. |
| `menuMaxHeight` | `number` | - | Maximum height in pixels for the popover presentation, for a menu that must fit its rows. Lifts the default 300px cap; the viewport still bounds it. |
| `header` | `ReactNode` | - | Content above the rows and outside the menu itself — a filter field, a toggle. A menu holds only its rows, so a control that is not a row goes here or in `footer`, never among the rows. It keeps its own keys and presses. With a header or footer the popover is a modal dialog around the menu: Tab and Shift+Tab move through the header, the menu and the footer and wrap at either end, and Escape closes. The bottom sheet shows it above the actions. |
| `footer` | `ReactNode` | - | Content below the rows and outside the menu itself — a "Create" button. Tab from the menu moves into it, and Tab past its last control wraps to the start of the dialog (see `header`). The bottom sheet shows it below the actions. |
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'below'` | Popover placement relative to the trigger. Ignored by the bottom-sheet presentation. Logical: start/end resolve against the menu's own inherited direction (RTL mirrors). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'start'` | Popover alignment along the placement axis. Ignored by the bottom-sheet presentation. Logical: start/end follow the menu's own inherited direction (RTL mirrors). |
| `onClick` | `() => void` | - | Callback fired for accepted trigger activation. The trailing click from the same press that light-dismissed the menu is ignored. |
| `hasChevron` | `boolean` | `true` | Whether to show a chevron icon on the trigger button. Set to false for icon-only triggers. |
| `children` | `ReactNode` | - | Compound-mode menu content: DropdownMenuItem, DropdownMenuDivider, DropdownMenuSubMenu (a flyout on a laptop, a drilled-in view with a Back row on a phone), and the selectable items. Mutually exclusive with `items`. |

## Components

### DropdownMenuItem

See `design_system component DropdownMenuItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-dropdown-menu` | `data-presentation` | presentation | - |
| `cui-dropdown-menu-item` | `data-size`, `data-variant` | size, variant | - |
| `cui-dropdown-menu-radio` | `data-size`, `data-checked`, `data-disabled` | size | checked, disabled |
| `cui-dropdown-menu-section-heading` | - | - | - |
| `cui-dropdown-menu-divider` | - | - | - |
| `cui-dropdown-menu-indicator-icon` | - | - | - |

Override in defineTheme:
```ts
components: {
  'dropdown-menu': {
    base: { /* CSS properties */ },
    'presentation:value': { /* variant-specific */ },
  },
  'dropdown-menu-item': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  dropdown-menu: {
    base: {
      borderRadius: '...',
      padding: '...',
    },
  },
}
```
