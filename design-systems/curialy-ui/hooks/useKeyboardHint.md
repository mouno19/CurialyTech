package: @curialy/ui

# useKeyboardHint

Shows an ephemeral "← → to navigate" hint anchored to the focused item the first time a roving-tabindex composite (Toolbar, TabList, SegmentedControl, etc.) receives keyboard focus. It teaches sighted keyboard users that arrow keys move within the group. The hint renders arrow keys with Kbd in the top layer (popover="manual") and is CSS-anchor-positioned to the focused element, so overflow containers never clip it. It stays until the first arrow press, Escape, or blur, and does not re-show for that instance. Escape closes only the hint, through the shared layer dismissal stack, and keeps focus where it is. Toolbar, TabList, and SegmentedControl wire this in automatically; reach for the hook directly only when building a custom roving-tabindex widget.

## Best Practices

- **Do:** Compose the returned onFocus/onKeyDown with your existing focus handlers rather than replacing them: call onKeyDown first (it only dismisses, never prevents), then your navigation handler.
- **Do:** Render hintElement as the last child of the composite container; it is position:fixed in the top layer and aria-hidden, so it never affects layout or the accessibility tree.
- **Do:** Match orientation to the arrow keys your widget actually responds to so the hint shows the correct icons.
- **Don't:** Use for single controls or widgets without roving-tabindex navigation; the hint only makes sense where arrows move focus within a group.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseKeyboardHintOptions` | - | Configuration object for the keyboard hint. |
| `options.orientation` | `'horizontal' \| 'vertical' \| 'both'` | `'horizontal'` | Which arrow-key axis the composite navigates, controlling which arrow icons the hint shows (← → for horizontal, ↑ ↓ for vertical, all four for both). |
| `options.dismissAfterMs` | `number` | `undefined (no time limit)` | Milliseconds before the hint dismisses itself after appearing. Leave it unset: by default the hint stays until an arrow press, Escape, or blur. A time limit can remove the hint before someone has read it (WCAG 1.4.13). |
| `options.isEnabled` | `boolean` | `true` | Whether the hint is enabled. Set to false to suppress it for a specific instance (e.g. a disabled or read-only widget). |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `hintElement` | `ReactNode` | The popover hint element to render inside the composite container (as the last child). Portals to the top layer via popover="manual", renders arrow keys with Kbd, and manages its own visibility; render it unconditionally. |
| `onFocus` | `(e: React.FocusEvent) => void` | Attach to the container onFocus. Shows the hint on the first keyboard-focus (:focus-visible) entry from outside the composite. |
| `onBlur` | `(e: React.FocusEvent) => void` | Attach to the container onBlur. Hides the hint when focus leaves the composite entirely, and re-anchors when focus moves within. |
| `onKeyDown` | `(e: React.KeyboardEvent) => void` | Attach to the container onKeyDown. Dismisses the hint on the first arrow press (the user has discovered the interaction). Never prevents default or stops propagation. |


Block templates: design_system component <name> --blocks for Toolbar, TabList, SegmentedControl
