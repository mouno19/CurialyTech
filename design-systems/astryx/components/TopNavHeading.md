package: @astryxdesign/core

# TopNavHeading

Product/suite heading for TopNav; logo+heading text w/ smart interaction boundaries, optional menu popover, superheading/subheading w/ independent links.

**Import:** `import {TopNavHeading} from '@astryxdesign/core/TopNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `logo` | `ReactNode` | - | Logo before heading text. Image, NavIcon, or ReactNode. |
| `heading` | `string` | - | Product/app name. |
| `headingHref` | `string` | - | Link for heading (product home). Only href + no menu → whole heading is link. |
| `superheading` | `string` | - | Text above heading (suite name). Smaller secondary style. |
| `superheadingHref` | `string` | - | Link for superheading. Independent inline link when menu present. |
| `subheading` | `string` | - | Text below heading (account context). Smaller secondary style. |
| `subheadingHref` | `string` | - | Link for subheading. Independent inline link when menu present. |
| `headerEndContent` | `ReactNode` | - | Trailing edge content (badge, status indicator). |
| `menu` | `ReactNode` | - | Popover dropdown content. Shows chevron auto. No hrefs → whole header triggers; with hrefs → chevron area triggers. |
| `as` | `LinkComponentType` | - | Custom link component. Overrides LinkProvider default. Must accept href, className, style, children. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles. Must be stylex.create() value. |
