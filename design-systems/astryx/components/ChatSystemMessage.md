package: @astryxdesign/core

# ChatSystemMessage

Use for concise non-sender content in chat. Default is a factual status row; divider is a labelled date/section break.

**Import:** `import {ChatSystemMessage} from '@astryxdesign/core/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| System message | Yes | The noninteractive status row that carries the chat-system-message theme target. |
| Content | Yes | The concise caller-provided message or divider label. |
| Icon content | No | Rendered before the message in the default variant; the divider variant currently does not render it. |
| Divider | No | A labelled horizontal Divider rendered by the divider variant. |

## Best Practices

- **Do:** Keep visible content concise and self-contained.
- **Do:** Use divider for temporal/section boundaries and default for factual notices.
- **Don't:** Use for sender-authored content; use ChatMessage and ChatMessageBubble.
- **Don't:** Rely on icon artwork as the only source of meaning.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | factual React content: date, join/leave, status change; long default content wraps **(required)** |
| `variant` | `'default' \| 'divider'` | `'default'` | default=centered text, divider=horizontal lines via Divider for date/section breaks |
| `icon` | `ReactNode` | - | optional caller icon; rendered before default message; divider currently does not render it |
| `xstyle` | `StyleXStyles` | - | additional StyleX layout styles |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-chat-system-message` | `data-variant` | default, divider | - |

Override in defineTheme:
```ts
components: {
  'chat-system-message': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```
