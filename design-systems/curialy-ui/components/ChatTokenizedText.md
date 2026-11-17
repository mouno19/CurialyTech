package: @curialy/ui

# ChatTokenizedText

Use for stored chat text containing serialized token values; unmatched text is preserved.

**Import:** `import {ChatTokenizedText} from '@curialy/ui/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Tokenized text | Yes | The inline root that preserves unmatched text and carries the chat-tokenized-text theme target. |
| Rendered token | No | Inline token content rendered by Badge for structured tokens or by the caller for custom tokens. |

## Best Practices

- **Do:** Reuse composer token definitions for display.
- **Do:** Use stable non-empty serialized values.
- **Don't:** Replace the surrounding message meaning with token labels.
- **Don't:** Move component-owned behavior into custom token renderers.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `string` | - | plain text msg w/ serialized token values; matching patterns become inline content **(required)** |
| `tokens` | `ChatComposerToken[]` | - | token defs; literal values matched in caller order; empty values ignored |
| `xstyle` | `StyleXStyles` | - | additional StyleX styles for root wrapper |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-chat-tokenized-text` | - | - | - |

Override in defineTheme:
```ts
components: {
  'chat-tokenized-text': {
    base: { /* CSS properties */ },
  },
}
```
