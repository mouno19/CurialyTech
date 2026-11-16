package: @astryxdesign/core

# useClipboard

Copy-to-clipboard behavior: the clipboard write, a transient isCopied flag with its own reset timer, and an optional polite screen-reader announcement. Extracted so every copy affordance is a thin control over one implementation instead of re-deriving the timer and announcement. Rapid re-copies restart the reset timer so the confirmation always lasts the full duration, and the timer is cleaned up on unmount. CodeBlock and Timestamp build their built-in copy buttons on it; reach for it directly when building a copy affordance that is not a plain icon button (a menu item, a labeled text button, a copy-on-click value chip).

## Best Practices

- **Do:** Drive the copied confirmation (copy → check icon, label swap) off the returned isCopied flag rather than tracking your own state.
- **Do:** Pass a localized announce message so the copy is spoken by screen readers; swapping the button aria-label alone is not reliably announced.
- **Do:** For the common compact icon copy button, render a ghost IconButton with a "Copy" tooltip and wire onClick to copy(); the tooltip stays "Copy" and the icon flip is the confirmation.
- **Don't:** Track a separate copied useState alongside the hook; isCopied already reflects the copied window and resets itself.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseClipboardOptions` | - | Configuration object. |
| `options.announce` | `string` | - | Message announced to a polite live region on a successful copy. A swapped aria-label alone is not reliably announced, so pass the localized confirmation (e.g. "Copied") to have it spoken. Omit to skip the announcement. |
| `options.resetAfterMs` | `number` | `2000` | Milliseconds isCopied stays true after a successful copy before reverting. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `copy` | `(text: string) => Promise<boolean>` | Writes text to the clipboard. On success flips isCopied to true, announces the configured message, restarts the reset timer, and resolves true. A clipboard rejection is a silent no-op that leaves the copied state unchanged and resolves false. |
| `isCopied` | `boolean` | True for resetAfterMs after the most recent successful copy, then reverts. Drive the copied confirmation (e.g. a copy → check icon flip) off this. |


Block templates: astryx component <name> --blocks for CodeBlock, Timestamp, IconButton
