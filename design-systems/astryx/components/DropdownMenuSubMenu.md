package: @astryxdesign/core

# DropdownMenuSubMenu

menu row that reveals a nested flyout of its own children/items (single component, not Sub/SubTrigger/SubContent); drills in on a phone

**Import:** `import {DropdownMenuSubMenu} from '@astryxdesign/core/DropdownMenu';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | - | primary label text for the trigger row **(required)** |
| `icon` | `IconType` | - | icon before label |
| `description` | `ReactNode` | - | secondary text below label |
| `children` | `ReactNode` | - | flyout menu items (same components as top level) **(required)** |
| `isDisabled` | `boolean` | `false` | renders trigger but never opens |
| `hasSpinner` | `boolean` | `false` | spinner instead of caret for async children |
| `menuWidth` | `number \| string` | - | minimum flyout width, capped to the viewport (default: content, min 160px) |
| `onOpenChange` | `(isOpen: boolean) => void` | - | called when flyout opens/closes |
| `presentation` | `'flyout' \| 'drill-in' \| 'adaptive'` | `'adaptive'` | 'flyout' beside the row \| 'drill-in' replaces the rows + Back row \| 'adaptive' (default) drills in on a coarse pointer |
| `delay` | `number` | `150` | hover wait before the flyout opens, ms (default 150) |
| `hideDelay` | `number` | `200` | how long the flyout stays after the pointer leaves, ms (default 200) |
| `header` | `ReactNode` | - | content above the rows, outside the menu; surface becomes a modal dialog named by the row (Tab wraps, Escape returns to the row) |
| `footer` | `ReactNode` | - | content below the rows, outside the menu; same rules as header |
| `menuDataTestId` | `string` | - | test id for the flyout or drilled-in role="menu" |
| `xstyle` | `StyleXStyles` | - | StyleX styles for the trigger row |
| `ref` | `React.Ref<HTMLElement>` | - | ref to the trigger row (role="menuitem") |
