package: @astryxdesign/core

# ChatMessageList

presentational msg container w/ density context + infinite scroll; auto-scroll owned by ChatLayout

**Import:** `import {ChatMessageList} from '@astryxdesign/core/Chat';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | msg elements (ChatMessage or ChatSystemMessage) **(required)** |
| `emptyState` | `ReactNode` | - | content when no msgs |
| `scrollToTopAction` | `() => Promise<void>` | - | async action at scroll top; load older msgs |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | visual density; flows to children via context |
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | top-level row gap; defaults to density spacing; override for independent LLM/tool rows |
| `align` | `'top' \| 'bottom'` | `'bottom'` | 'top'\|'bottom' (def bottom); bottom spacer pushes short lists down, top starts at top; overflow scrolls same either way |
| `isStreaming` | `boolean` | `false` | assistant streaming? marks log aria-busy so SR announces the completed msg once |
