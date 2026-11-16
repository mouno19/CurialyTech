package: @astryxdesign/core

# TopNavMegaMenu

Nav item w/ full-width mega menu panel on hover. Slots API w/ items+featured ReactNode props. Mobile drawer inline collapsible.

**Import:** `import {TopNavMegaMenu} from '@astryxdesign/core/TopNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Trigger button visible label. **(required)** |
| `items` | `ReactNode` | - | Menu items slot: typically TopNavMegaMenuItem, accepts any ReactNode. |
| `featured` | `ReactNode` | - | Featured content slot: right panel desktop, below items in drawer. |
| `delay` | `number` | `150` | Show delay ms on hover. |
| `hideDelay` | `number` | `250` | Hide delay ms after mouse leaves. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Fired on open/close. For coordinating wrapper styles. |
