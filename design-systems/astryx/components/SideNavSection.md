package: @astryxdesign/core

# SideNavSection

Section grouping w/ optional title, subtitle, end content.

**Import:** `import {SideNavSection} from '@astryxdesign/core/SideNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | - | Section title. **(required)** |
| `subtitle` | `string` | - | Section subtitle. |
| `children` | `ReactNode` | - | Section items. |
| `endContent` | `ReactNode` | - | Right-side content in section header. |
| `isHeaderHidden` | `boolean` | `false` | Visually hides section header while keeping accessible to screen readers. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. |
