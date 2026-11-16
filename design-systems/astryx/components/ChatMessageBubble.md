package: @astryxdesign/core

# ChatMessageBubble

styled bubble container; reads sender from context; supports name/metadata slots, group corners, ghost variant

**Import:** `import {ChatMessageBubble} from '@astryxdesign/core/Chat';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | bubble content: text, Markdown, any ReactNode **(required)** |
| `variant` | `'filled' \| 'ghost'` | `'filled'` | filled (sender bg) or ghost (transparent, keeps padding) |
| `name` | `ReactNode` | - | sender name above bubble; omits non-rendering scalars; keeps numeric 0 aligned |
| `metadata` | `ReactNode` | - | metadata below bubble; omits non-rendering scalars; keeps numeric 0 aligned |
| `group` | `'first' \| 'middle' \| 'last'` | - | position in multi-bubble group; controls corner radius reduction |
| `width` | `SizeValue` | - | bubble width (number=px, string=as-is); replaces default max(80%,280px) cap; ghost+width="100%" spans full message column |
