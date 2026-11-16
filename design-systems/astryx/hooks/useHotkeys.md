package: @astryxdesign/core

# useHotkeys

Registers global keyboard shortcuts with a single window keydown listener per hook instance. Handlers live in a ref, so re-renders never re-subscribe. Skips events from typing targets (input, textarea, select, contenteditable) unless allowInInputs, skips defaultPrevented events, and calls preventDefault() on match. SSR-safe.

## Best Practices

- **Do:** Use for app-level shortcuts like command palettes (mod+k), help overlays (shift+/), and navigation keys.
- **Do:** Pair with the Kbd component to display the same combo you register; both resolve "mod" per platform identically.
- **Do:** Use isDisabled to suspend shortcuts while a modal or wizard owns the keyboard, instead of unmounting the hook.
- **Don't:** Use for focus-scoped keyboard navigation inside a widget; use useListFocus or useGridFocus instead.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `hotkeys` | `Hotkey[]` | - | Shortcut registrations. Each entry: `{ keys, onPress, allowInInputs?, isDisabled? }`. `keys` is a "+"-separated combo like "mod+k", "shift+/", "escape"; "mod" is ⌘ on macOS and Ctrl elsewhere. `onPress` receives the KeyboardEvent after preventDefault(). `allowInInputs` (default false) lets the hotkey fire while typing in inputs/textareas/selects/contenteditable. `isDisabled` temporarily disables the entry. **(required)** |


Block templates: astryx component <name> --blocks for Kbd
