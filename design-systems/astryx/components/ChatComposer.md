package: @astryxdesign/core

# ChatComposer

composer layout shell; named slots (drawer/header/input/footer/send) w/ page-radius + concentric inner radius

**Import:** `import {ChatComposer} from '@astryxdesign/core/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Composer frame | Yes | Outer composition root that groups the body with an optional status message above or below it. |
| Composer body | Yes | Rounded, elevated surface containing the header, input, and footer. |
| Drawer | No | Content before the body for attachments or other expandable context, typically ChatComposerDrawer. |
| Header | No | Row for start-aligned actions and end-aligned contextual information. |
| Input | Yes | Default ChatComposerInput or a custom editor connected through useChatComposerContext(). |
| Footer | Yes | Row for caller-supplied footer and send actions plus the primary action. |
| Send or stop action | Yes | Default ChatSendButton or a custom sendButton; it submits the current draft or requests interruption. |
| Status message | No | Error or warning feedback rendered before or after the composer body. |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onSubmit` | `(value: string) => void` | - | submit msg handler **(required)** |
| `onStop` | `() => void` | - | stop generation handler |
| `isStopShown` | `boolean` | `false` | whether the stop button is shown |
| `value` | `string` | - | controlled input value |
| `onChange` | `(value: string) => void` | - | controlled change handler |
| `placeholder` | `string` | `'Type a message...'` | placeholder when empty |
| `isDisabled` | `boolean` | `false` | disabled; use during streaming or unmet prereqs |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | visual density |
| `elevation` | `'none' \| 'low'` | `'low'` | resting elevation of composer body: low (default; low→med on hover/focus) \| none (flat with border); keyboard-focused editor gets the shared ring in either mode; pointer focus does not |
| `drawer` | `ReactNode` | - | slot: collapsible drawer above input: attachments, context chips, etc.; use ChatComposerDrawer |
| `headerActions` | `ReactNode` | - | slot: left header actions (attach, mention); icon-only sm buttons |
| `headerContext` | `ReactNode` | - | slot: right header context info (window usage, ProgressBar, text) |
| `input` | `ReactNode` | - | slot: custom input; replaces default. use ChatComposerInput for triggers/tokens, or wire any input via useChatComposerContext() (value/onChange/onSubmit/canSend + register focus on inputControlRef) |
| `footerActions` | `ReactNode` | - | slot: left footer actions (model selector etc) |
| `sendActions` | `ReactNode` | - | slot: actions left of send btn |
| `sendButton` | `ReactNode` | - | slot: custom send btn; replaces default |
| `status` | `{ type: 'error' \| 'warning'; message?: string }` | - | status msg below/above composer |
| `statusPosition` | `'top' \| 'bottom'` | `'bottom'` | status render position |
