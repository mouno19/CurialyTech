package: @astryxdesign/core

# ChatComposerInput

rich input for composer; trigger menus (@/commands), inline tokens, msg history, paste/drop files, 16px iOS font-size floor to prevent zoom. Use in ChatComposer input slot when you need more than plain textarea.

**Import:** `import {ChatComposerInput} from '@astryxdesign/core/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Input root | Yes | The themed container that forwards the root ref and BaseProps styling seams. |
| Editable surface | Yes | The labeled contenteditable textbox or combobox that owns text, selection, keyboard, paste, and drop behavior. |
| Placeholder | No | Visual guidance shown only while the serialized draft is empty. |
| Trigger menu | No | The suggestion popup rendered while a configured trigger is active. |
| Inline token | No | A non-editable badge or custom rendering with a stable serialized value. |

## Best Practices

- **Do:** Use handleRef for programmatic text or token insertion; inserted text follows the same onChange pipeline as typing.
- **Do:** Use onFiles for files pasted or dropped onto the editor, and keep file validation and upload progress in the product layer.
- **Don't:** Use custom token rendering for ordinary mentions or commands; prefer the structured badge form so tokens remain predictable and themeable.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `handleRef` | `React.Ref<ChatComposerInputHandle>` | - | imperative handle (insertToken/expandToken/insertText/focus/getValue) |
| `value` | `string` | - | controlled value; pair w/ onChange for two-way binding |
| `onChange` | `(value: string) => void` | - | value change handler; serialized string includes token placeholders |
| `placeholder` | `string` | `'Type a message...'` | placeholder when empty |
| `maxRows` | `number` | `8` | max visible rows before scroll; lower for compact layouts |
| `triggers` | `ChatComposerTrigger[]` | - | typeahead trigger defs; character(@/)+searchSource+onSelect returning token; emptySearchText (ReactNode) for no matches |
| `debounceMs` | `number` | `150` | debounce for async search to avoid excess requests |
| `hasHistory` | `boolean` | `true` | ArrowUp/Down to recall previous submissions |
| `label` | `string` | `'Message input'` | a11y label for screen readers |
| `isDisabled` | `boolean` | `false` | disabled; use during streaming or unmet prereqs |
| `onPaste` | `(event, text) => boolean \| void` | - | plain-text paste callback; return true when handled, otherwise built-in token/plain insertion runs |
| `pasteAsToken` | `UseChatPasteAsTokenReturn \| false` | - | paste-as-token behavior; >200 chars by default, false for inline-only, or custom useChatPasteAsToken() result |
| `onFiles` | `(files: File[]) => void` | - | file paste/drop handler; use for attachments |
| `onSubmit` | `(value: string) => void` | - | Enter w/o Shift handler; serialized value includes token placeholders |
| `onKeyDown` | `(event) => void` | - | keydown handler before built-in Enter/history (after trigger menu); preventDefault() to suppress default submit (touch newline) or act on event to add behavior (Cmd/Ctrl+Enter). IME composition always respected |
| `enterKeyHint` | `'enter' \| 'done' \| 'go' \| 'next' \| 'previous' \| 'search' \| 'send'` | `'send'` | touch keyboard Return key label (enterkeyhint); default send since Enter sends; pass enter when onKeyDown makes Enter a newline on touch |
