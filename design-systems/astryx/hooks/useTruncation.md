package: @astryxdesign/core

# useTruncation

Detects whether an element's text is cut off — single-line overflow or clamped to several lines — and gives back the full text, updating when the size or the content changes. Built on a shared ResizeObserver and a shared MutationObserver, so hundreds of table cells create one observer of each kind, and a first measurement runs batched in a microtask after the commit instead of forcing a layout pass per text during mount. Use it wherever a truncated cell should show its full content only when it is actually truncated: compose a Tooltip off isTruncated and fullText instead of always rendering one. Text and Heading build their truncation tooltips on it; reach for it directly when composing truncation feedback into your own component.

## Best Practices

- **Do:** Render the full-content Tooltip only when isTruncated is true, and read the tooltip text from fullText: a cell that fits shows no tooltip, and the text always matches what was measured.
- **Do:** Apply the matching clamp yourself next to the hook — white-space: nowrap for maxLines 1, -webkit-line-clamp for more — so what the user sees and what the hook measures stay the same shape.
- **Do:** Reuse one useTruncation instance per measured element; the ref callback cleans up its own observers, so swapping elements is safe.
- **Don't:** Compare scrollHeight to offsetHeight yourself for clamped text: with -webkit-line-clamp active browsers report the clamped size, which is exactly the case the Range measurement exists for.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseTruncationOptions` | - | Configuration object. **(required)** |
| `options.maxLines` | `number` | - | Maximum number of lines before truncation. 1 detects single-line overflow (scrollWidth against offsetWidth); values above 1 detect a -webkit-line-clamp cut by measuring the real content height with a Range, bypassing the clamped scrollHeight. 0 disables detection: isTruncated stays false and fullText stays empty. **(required)** |
| `options.isExpanded` | `boolean` | `false` | Pass true while the text is shown in full; the hook keeps reporting whether it is cut off when clamped. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `RefCallback<HTMLElement>` | Ref callback to attach to the text element being measured. Re-attaching to another element re-observes it and cleans up the previous observation. |
| `isTruncated` | `boolean` | Whether the text is currently cut off. Drives composing a Tooltip with the full text: render the tooltip only when this is true, so a cell that fits shows none. |
| `fullText` | `string` | The element's current text content, captured on every measurement, for the tooltip a truncated cell shows. Follows content changes that resize nothing (a fixed-width status line whose text swaps). |


Block templates: astryx component <name> --blocks for Text, Heading, Tooltip
