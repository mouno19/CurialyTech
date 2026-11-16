package: @astryxdesign/core

# Kbd

Renders a keyboard shortcut as styled key badges. Use Kbd in tooltips, menus, and help text to show key combinations.

**Import:** `import {Kbd} from '@astryxdesign/core/Kbd';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Shortcut | Yes | Group that presents the complete keyboard shortcut and its accessible name. |
| Key badge | Yes | Painted key badge rendered once for each key in the shortcut. |

## Best Practices

- **Do:** Place shortcuts near the action they trigger: in a tooltip, menu item, or inline instruction.
- **Do:** Use mod instead of ctrl or cmd; it automatically adapts to the user's platform.
- **Do:** Let Kbd name the shortcut: screen readers hear the keys as words, such as "Command + K". Kbd ignores an aria-label you pass; to name it from visible text, use aria-labelledby.
- **Don't:** Use Kbd as the only way to discover an action; shortcuts should supplement visible controls, not replace them.
- **Don't:** Expect Kbd to handle the key press. It only shows the keys; listen for the shortcut in your own code.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `keys` | `string` | - | Shortcut string. "+" separates keys. Special: mod (⌘ on Apple, Ctrl elsewhere), ctrl, alt, shift (Apple symbols on Apple, text elsewhere), meta (⌘ on Apple platforms, Win elsewhere and before hydration), enter, backspace, escape, tab, up, down, left, right, plus. Aliases: esc for escape, return for enter. **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be stylex.create() value. |
| `className` | `string` | - | CSS class for root element. Prefer xstyle; className for non-StyleX integration. |
| `style` | `CSSProperties` | - | Inline styles for root element. Prefer xstyle; inline styles bypass StyleX optimization. |
| `ref` | `React.Ref<HTMLSpanElement>` | - | Ref forwarded to shortcut group element. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-kbd` | - | - | - |

Override in defineTheme:
```ts
components: {
  'kbd': {
    base: { /* CSS properties */ },
  },
}
```
