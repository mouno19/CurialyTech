package: @curialy/ui

# ChatDictationButton

Toggle button for voice dictation in chat composer. Pairs with useChatDictation. Shows mic icon when idle, animated frequency bars when listening. Goes in sendActions slot.

**Import:** `import {ChatDictationButton} from '@curialy/ui/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Microphone icon | Yes | Shown in the idle state. Indicates that tapping will start voice input. |
| Frequency bars | No | Animated equalizer bars that replace the icon during listening. React to real microphone volume. |
| Ghost button | Yes | The underlying Button with ghost variant and isIconOnly, providing the hit target and focus ring. |

## Best Practices

- **Do:** Place in sendActions slot of ChatComposer next to send button.
- **Do:** Pass inputRef to useChatDictation for interim ghost text in input.
- **Do:** Enable hasSounds for audio feedback on start/stop.
- **Don't:** Don't use outside chat composer context. Designed for composer send-action layout only.
- **Don't:** Don't forget unsupported case. Button auto-hides but composer should work without it.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `dictation` | `UseSpeechRecognitionReturn` | - | return from useChatDictation/useSpeechRecognition; controls state **(required)** |
| `size` | `'sm' \| 'md'` | `'md'` | btn size |
| `isHiddenWhenUnsupported` | `boolean` | `true` | hide unsupported dictation; false keeps disabled btn visible |
| `label` | `string` | - | a11y label override |
| `xstyle` | `StyleXStyles` | - | extra StyleX styles |
