package: @astryxdesign/core

# SideNavHeading

Product/suite/account heading w/ smart interaction boundary logic for links + menu popover.

**Import:** `import {SideNavHeading} from '@astryxdesign/core/SideNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `heading` | `string` | - | Product/app name. **(required)** |
| `icon` | `ReactNode` | - | Product/app icon. |
| `headingHref` | `string` | - | Link for heading. |
| `superheading` | `string` | - | Text above heading. |
| `superheadingHref` | `string` | - | Link for superheading. |
| `subheading` | `string` | - | Text below heading. |
| `subheadingHref` | `string` | - | Link for subheading. |
| `menu` | `ReactNode` | - | Menu content rendered inside popover. |
| `headerEndContent` | `ReactNode` | - | Content at trailing edge of heading row. For badges, status indicators, action buttons. Hidden when collapsed. |
