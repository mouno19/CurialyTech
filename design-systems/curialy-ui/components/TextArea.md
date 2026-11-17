package: @curialy/ui

# TextArea

Multi-line input for comments, descriptions, messages. Use when input spans multiple lines; use TextInput for single-line.

**Import:** `import {TextArea} from '@curialy/ui/TextArea';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text identifying the multi-line field. |
| Description | No | Helper text between the label and the input. |
| Input container | Yes | Painted boundary containing the text area and its overlays. |
| Text area | Yes | Multi-line control that displays and edits the value. |
| Placeholder | No | Hint text shown inside the empty text area. |
| Start icon | No | Curialy UI Icon rendered at the start when startIcon is a semantic name or icon component. |
| Custom start content | No | Caller-provided ReactNode rendered at the start instead of an Curialy UI Icon. |
| Spinner | No | Loading indicator shown at the end of the input container. |
| Status icon | No | Error, warning, or success icon shown inside the input. |
| Character counter | No | Current and maximum character counts shown inside the input container. |
| Field status message | No | Attached or detached error, warning, or success message associated with the field. |
| Tooltip status message | No | Tooltip surface presenting the status message for the tooltip variant. |

## Best Practices

- **Do:** Visible label or isLabelHidden with descriptive label for screen readers.
- **Do:** Set maxLength for character counter when a limit exists.
- **Do:** Return stays a line break; relabel it (enterKeyHint) only if your Enter handling matches.
- **Do:** Use status prop for inline validation: success, warning, error.
- **Do:** Add description or placeholder for context; never placeholder alone as label.
- **Don't:** Avoid TextArea for single-line values; use TextInput.
- **Don't:** Don't use placeholder as only label; disappears on focus, not accessible.
- **Don't:** Don't show status message without status type; border and icon draw attention.
- **Don't:** Don't wrap a disabled TextArea in Tooltip to explain the disabled state; use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ref` | `React.Ref<HTMLTextAreaElement>` | - | ref forwarded to underlying <textarea>. |
| `label` | `string` | - | Label text for textarea; always rendered for a11y. **(required)** |
| `value` | `string` | - | Current textarea value. **(required)** |
| `onChange` | `(value: string, e: ChangeEvent<HTMLTextAreaElement>) => void` | - | Fired on textarea value change. |
| `changeAction` | `(value: string, e: ChangeEvent<HTMLTextAreaElement>) => void \| Promise<void>` | - | Async action after onChange in React transition. Enables useOptimistic. |
| `isLabelHidden` | `boolean` | `false` | Visually hides label; keeps screen reader access. |
| `description` | `string` | - | Helper text between label+textarea. |
| `isOptional` | `boolean` | `false` | Shows "Optional" indicator. Mutually exclusive w/ isRequired. |
| `isRequired` | `boolean` | `false` | Shows "Required" indicator+sets aria-required. Mutually exclusive w/ isOptional. |
| `isDisabled` | `boolean` | `false` | Disables textarea, prevents interaction. |
| `isReadOnly` | `boolean` | `false` | Read-only: value visible + still submits, but not editable. Unlike isDisabled: not dimmed. |
| `disabledMessage` | `string` | - | Explains why textarea is disabled. With isDisabled, shows tooltip on hover/focus + keeps textarea focusable via aria-disabled (field becomes read-only). Use instead of wrapping a disabled TextArea in Tooltip. |
| `isLoading` | `boolean` | `false` | Loading state w/ spinner inside input. |
| `placeholder` | `string` | - | Placeholder when textarea empty. |
| `rows` | `number` | `3` | Visible text rows. |
| `maxLength` | `number` | - | Max chars allowed. Shows counter (current/max) inside the container, bottom-right beneath the text. No native enforcement; over-limit shows red + a warning icon and is announced to screen readers. |
| `htmlMaxLength` | `number` | - | The native `maxlength` attribute: the browser stops typing past this many UTF-16 code units (an emoji can take two or more). It is separate from `maxLength`, the soft counter of user-perceived characters: it works without the counter, and it neither shows nor changes the counter. It can stop typing before the counter reaches its limit. TextArea adds no truncation or validation of its own, so a longer controlled value stays as set. The attribute is in the server-rendered HTML, so it applies before hydration. Validate on the server too: the browser limit does not bind requests that skip the UI. |
| `status` | `{ type: 'warning' \| 'error' \| 'success'; message?: string }` | - | Colored border+icon status. Optional floating message below textarea. |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| `labelTooltip` | `string` | - | Tooltip in info icon at label end. |
| `startIcon` | `IconType` | - | Icon inside leading edge of textarea wrapper. |
| `hasSpellCheck` | `boolean` | `true` | Enables/disables browser spell checking. |
| `hasAutoFocus` | `boolean` | `false` | Auto-focus textarea on mount. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Textarea size; affects internal padding. Height controlled by rows. |
| `onPaste` | `(e: ClipboardEvent<HTMLTextAreaElement>) => void` | - | Fired on paste into textarea. |
| `htmlName` | `string` | - | HTML name attr for form submissions. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `onFocus` | `(e: FocusEvent<HTMLTextAreaElement>) => void` | - | Callback on focus. |
| `onBlur` | `(e: FocusEvent<HTMLTextAreaElement>) => void` | - | Callback on blur. |
| `autoComplete` | `string` | - | Native autocomplete attr, forwarded unchanged. Does not affect the controlled value. |
| `enterKeyHint` | `'enter' \| 'done' \| 'go' \| 'next' \| 'previous' \| 'search' \| 'send'` | - | What the Return key of a touch keyboard says (the native `enterkeyhint`). iOS gives `done`, `go`, `next`, `search` and `send` their own key (a glyph on iOS 26: a checkmark, an arrow, a chevron, a magnifier, an up arrow); `enter` and `previous` keep the plain Return key. Chrome on Android (Gboard) gives every value its own key; with no hint a TextArea keeps Return. It only labels the key: what Enter does stays with your handlers. |
| `inputMode` | `'none' \| 'text' \| 'tel' \| 'url' \| 'email' \| 'numeric' \| 'decimal' \| 'search'` | - | Which touch keyboard the field asks for (the native `inputmode`) without changing what it accepts: `numeric` brings up the number pad, `decimal` the decimal pad, `tel` the phone pad, `search` the web-search keyboard (whose Return key reads Go on iOS even with `enterKeyHint="search"`). |
| `autoCapitalize` | `'off' \| 'none' \| 'on' \| 'sentences' \| 'words' \| 'characters'` | - | When a touch keyboard capitalizes as you type (the native `autocapitalize`). Unset, iOS capitalizes sentences. `off` and `none` never capitalize; `on` and `sentences` capitalize each sentence. |
| `hasAutoCorrect` | `boolean` | - | Whether a touch keyboard corrects words as you type (the native `autocorrect`). Unset, the browser decides; turn it off for usernames, codes and other values that are not words. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-text-area` | `data-size`, `data-status`, `data-disabled`, `data-readonly` | size, status | disabled, readonly |
| `cui-text-area-control` | - | - | - |
| `cui-text-area-counter` | - | - | - |

Override in defineTheme:
```ts
components: {
  'text-area': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
  'text-area-control': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  text-area: {
    base: {
      paddingInline: '...',
    },
  },
}
```
