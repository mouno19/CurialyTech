package: @astryxdesign/core

# ChatMessage

sender context wrapper; handles avatar+name+metadata+alignment by sender role

**Import:** `import {ChatMessage} from '@astryxdesign/core/Chat';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `sender` | `'user' \| 'assistant' \| 'system'` | - | who sent; controls alignment+layout **(required)** |
| `children` | `ReactNode` | - | free-form: bubbles, assets, tool calls, images; wrap non-bubble content in a ghost bubble to align with bubble text column **(required)** |
| `avatar` | `ReactNode` | - | avatar beside msg; null/boolean/"" omit slot; content rendering nothing collapses slot |
| `name` | `ReactNode` | - | sender name above body; labels msg; null/boolean/"" omit slot, content rendering nothing collapses it; both fall back to translated sender label; use when first child is raw |
| `metadata` | `ReactNode` | - | metadata below body; null/boolean/"" omit slot; content rendering nothing collapses slot; use when last child is raw |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | visual density; inherited from list context if unset |
