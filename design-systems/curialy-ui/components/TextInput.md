package: @curialy/ui

# TextInput

TextInput collects short-form text like names, emails, or search queries. Use it for single-line values where the expected input is brief. Pair it with validation status to guide users through required or formatted fields.

**Import:** `import {TextInput} from '@curialy/ui/TextInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text that identifies the field. Always rendered for accessibility even when visually hidden. |
| Description | No | Helper text between the label and the input that provides additional context or formatting hints. |
| Start icon | No | A leading icon inside the input that hints at the expected content, like a magnifying glass for search. |
| Placeholder | No | Hint text shown when the input is empty. Disappears on focus. |
| Clear button | No | A trailing × button that resets the value and returns focus to the input. |
| Spinner | No | Loading indicator that appears during async actions like server-side validation. |
| Status icon | No | A trailing icon (error, warning, or success) that communicates validation state. |

## Best Practices

- **Do:** Always provide a visible label so users know what the field is for. Only hide the label when surrounding context makes it obvious, like a search bar with a magnifying-glass icon.
- **Do:** Use validation status with a message to explain what went wrong: "Email must include @" is better than just turning the border red.
- **Do:** Size the input to match the expected content length so users can gauge how much to type: small for zip codes, medium for names, large for URLs.
- **Do:** Add a clear button for search and filter inputs so users can quickly reset without selecting all text.
- **Do:** Tell a touch keyboard what the field holds: `type="email"`, `"tel"` or `"url"` for those values, `inputMode="numeric"` for digits that are not a number (a one-time code), `enterKeyHint` for what Return does (Search, Send, Next), and `autoComplete` so AutoFill can fill it.
- **Don't:** Don't use placeholder text as a replacement for a label; placeholders disappear on focus and are not reliably read by screen readers.
- **Don't:** Don't use TextInput for multi-line content like comments or descriptions; use TextArea instead.
- **Don't:** Don't mark every field as required; only flag mandatory fields so users are not overwhelmed by validation errors.
- **Don't:** Don't wrap a disabled TextInput in Tooltip to explain why it's disabled. Use the disabledMessage prop, which attaches the reason to the field itself.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'text' \| 'password' \| 'email' \| 'search' \| 'tel' \| 'url'` | `'text'` | HTML input type. |
| `label` | `string` | - | Label text for input; always rendered for a11y. **(required)** |
| `value` | `string` | - | Current input value. **(required)** |
| `onChange` | `(value: string, e: ChangeEvent<HTMLInputElement>) => void` | - | Fired on input value change. |
| `changeAction` | `(value: string, e: ChangeEvent<HTMLInputElement>) => void \| Promise<void>` | - | Async action after onChange (if not prevented). Triggers optimistic update+spinner while pending. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size variant of input. |
| `isLabelHidden` | `boolean` | `false` | Visually hides label; keeps screen reader access. |
| `description` | `string` | - | Description text between label+input. |
| `isOptional` | `boolean` | `false` | Shows "Optional" indicator. Mutually exclusive w/ isRequired. |
| `isRequired` | `boolean` | `false` | Shows "Required" indicator+sets aria-required. Mutually exclusive w/ isOptional. |
| `onEnter` | `() => void` | - | Callback fired when the user presses the Enter key. IME-safe: Enter used to commit a Japanese/Chinese/Korean conversion does not fire it. |
| `onKeyDown` | `(e: KeyboardEvent<HTMLInputElement>) => void` | - | Callback fired on keydown events on the input. |
| `isDisabled` | `boolean` | `false` | Disables input, prevents interaction, dims element. |
| `isReadOnly` | `boolean` | `false` | Read-only: value visible + still submits, but not editable. Unlike isDisabled: not dimmed. |
| `disabledMessage` | `string` | - | Explains why input is disabled. With isDisabled, shows tooltip on hover/focus + keeps input focusable via aria-disabled (field becomes read-only). Use instead of wrapping a disabled TextInput in Tooltip. |
| `isLoading` | `boolean` | `false` | Loading state w/ spinner+aria-busy. |
| `placeholder` | `string` | - | Placeholder when input empty. |
| `labelTooltip` | `string` | - | Tooltip in info icon at label end. |
| `startIcon` | `IconType` | - | SVG icon at input start (e.g. heroicons or lucide). |
| `status` | `{type: 'error' \| 'warning' \| 'success', message?: string}` | - | Validation status; colored border+icon. Message floats below. Error sets aria-invalid. |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| `hasClear` | `boolean` | `false` | Shows clear button when input has value. Clears value on click. |
| `hasAutoFocus` | `boolean` | `false` | Auto-focus input on mount. |
| `htmlName` | `string` | - | HTML name attr for form submissions. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. Without a width the field can shrink with its row, so a filter bar never overflows; use `<HStack wrap="wrap">` when the controls should move to a second line instead. |
| `autoComplete` | `string` | - | Native autocomplete attr, forwarded unchanged. Does not affect the controlled value. |
| `enterKeyHint` | `'enter' \| 'done' \| 'go' \| 'next' \| 'previous' \| 'search' \| 'send'` | - | What the Return key of a touch keyboard says (the native `enterkeyhint`). iOS gives `done`, `go`, `next`, `search` and `send` their own key (a glyph on iOS 26: a checkmark, an arrow, a chevron, a magnifier, an up arrow); `enter` and `previous` keep the plain Return key. Chrome on Android (Gboard) gives every value its own key, `enter` and `previous` included; with no hint the key reads Next while another field follows, and a `type="url"` field shows Next instead of `go` while another field follows. It only labels the key: what Enter does stays with your handlers. |
| `inputMode` | `'none' \| 'text' \| 'tel' \| 'url' \| 'email' \| 'numeric' \| 'decimal' \| 'search'` | - | Which touch keyboard the field asks for (the native `inputmode`) without changing what it accepts: `numeric` brings up the number pad, `decimal` the decimal pad, `tel` the phone pad, `search` the web-search keyboard (whose Return key reads Go on iOS even with `enterKeyHint="search"`; Chrome on Android shows the Enter key for `inputMode="search"` alone). |
| `autoCapitalize` | `'off' \| 'none' \| 'on' \| 'sentences' \| 'words' \| 'characters'` | - | When a touch keyboard capitalizes as you type (the native `autocapitalize`). Unset, iOS capitalizes sentences, except in a URL field. `off` and `none` never capitalize; `on` and `sentences` capitalize each sentence. |
| `hasAutoCorrect` | `boolean` | - | Whether a touch keyboard corrects words as you type (the native `autocorrect`). Unset, the browser decides; turn it off for usernames, codes and other values that are not words. |
| `hasSpellCheck` | `boolean` | - | Whether misspelled words are underlined (the native `spellcheck`). Unset, the browser decides. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-text-input` | `data-size`, `data-status`, `data-disabled`, `data-readonly` | size, status | disabled, readonly |

Override in defineTheme:
```ts
components: {
  'text-input': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
}
```
