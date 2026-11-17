package: @curialy/ui

# TabMenu

Overflow menu trigger; shows selected option's label. Host attributes/DOM handlers reach the trigger button, not the popup/options; role, tab stop and disclosure attributes stay owned.

**Import:** `import {TabMenu} from '@curialy/ui/TabList';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Trigger text (when no option selected) + dropdown heading. **(required)** |
| `options` | `TabMenuOption[]` | - | Menu options array rendered in dropdown. **(required)** |
