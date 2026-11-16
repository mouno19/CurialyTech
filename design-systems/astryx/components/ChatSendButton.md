package: @astryxdesign/core

# ChatSendButton

circular send/stop toggle btn for composer; reads ChatComposerContext; all context vals overridable via props

**Import:** `import {ChatSendButton} from '@astryxdesign/core/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Action button | Yes | Circular icon-only Button that exposes the translated Send or Stop name and carries the chat-send-button theme target. |

## Best Practices

- **Do:** Place ChatSendButton inside ChatComposer when its readiness and send or stop lifecycle should follow composer context.
- **Do:** For standalone use, provide the state and matching onSend or onStop callback explicitly.
- **Do:** Keep the translated Send or Stop accessible name intact when supplying custom icon artwork; the icon is decorative and must not be the only name source.
- **Don't:** Do not render the stop state without a working onStop callback from props or ChatComposer context.
- **Don't:** Do not expect isDisabled to disable the stop action; it applies only to the send state.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isStopShown` | `boolean` | - | stop button visibility; defaults to context |
| `isDisabled` | `boolean` | - | disabled; defaults to !canSend from context |
| `onSend` | `() => void` | - | send click handler; defaults to context onSubmit |
| `onStop` | `() => void` | - | stop click handler; defaults to context onStop |
| `sendIcon` | `ReactNode` | - | custom send icon; default arrowUp from registry |
| `stopIcon` | `ReactNode` | - | custom stop icon; default stop from registry |
| `size` | `'sm' \| 'md'` | `'md'` | btn size |
| `xstyle` | `StyleXStyles` | - | additional StyleX styles |
