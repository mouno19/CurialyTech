package: @curialy/ui

# ChatLayoutScrollButton

floating scroll-to-bottom btn; fades in when scrolled up, expands w/ label for new msgs. Default in ChatLayout; override via scrollButton prop.

**Import:** `import {ChatLayoutScrollButton} from '@curialy/ui/Chat';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isVisible` | `boolean` | - | btn visibility: bind to scroll-position check **(required)** |
| `label` | `string` | - | optional label; expands btn (e.g. "New messages") |
| `onClick` | `() => void` | - | click handler **(required)** |
