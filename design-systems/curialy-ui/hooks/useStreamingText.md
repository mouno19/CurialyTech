package: @curialy/ui

# useStreamingText

Smooths bursty streamed text into a steady character-by-character reveal using requestAnimationFrame. Decouples arrival rate from display rate. Advances on word and syntax boundaries to avoid slicing mid-markdown or mid-word, preventing visual glitches with markdown renderers. Animation timing derives from Curialy UI motion tokens via useTheme when available, with sensible fallbacks outside a theme provider. Snaps to full text when isStreaming becomes false.

## Best Practices

- **Do:** Pass the accumulated text (not individual chunks) as targetText; the hook handles incremental reveal internally.
- **Do:** Set isStreaming to false when the stream completes to snap to the final text.
- **Do:** Use speed='instant' for non-animated contexts like search results or when reduced motion is preferred.
- **Don't:** Use for static text that does not change; the hook adds unnecessary overhead for non-streaming content.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `targetText` | `string` | - | The full target text to reveal. As new chunks arrive, update this value with the accumulated text. **(required)** |
| `isStreaming` | `boolean` | - | Whether text is currently being streamed. When false, the hook returns the full targetText immediately. **(required)** |
| `options` | `UseStreamingTextOptions` | - | Optional configuration for streaming behavior. |
| `options.speed` | `'natural' \| 'fast' \| 'instant'` | `'natural'` | Speed preset for text reveal. 'natural' is steady ~2 chars/frame, 'fast' scales with backlog ~4 chars/frame, 'instant' returns full text with no animation. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `displayedText` | `string` | The portion of targetText to render. Grows steadily toward the full targetText during streaming, or equals targetText when not streaming. |


Block templates: design_system component <name> --blocks for Markdown
