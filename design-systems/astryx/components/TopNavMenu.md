package: @astryxdesign/core

# TopNavMenu

Nav item w/ hover-triggered popover menu containing rich items w/ icon, title, optional description.

**Import:** `import {TopNavMenu} from '@astryxdesign/core/TopNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Trigger button visible label. **(required)** |
| `items` | `TopNavMenuItemData[]` | - | Menu items in hover popover. href follows the Link navigation rule; rejected destinations do not navigate. **(required)** |
| `delay` | `number` | `150` | Show delay ms on hover. |
| `hideDelay` | `number` | `200` | Hide delay ms after mouse leaves. |
