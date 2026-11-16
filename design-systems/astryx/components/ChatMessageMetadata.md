package: @astryxdesign/core

# ChatMessageMetadata

composable metadata row; renders timestamp · footer · status; reverses for user sender

**Import:** `import {ChatMessageMetadata} from '@astryxdesign/core/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Metadata row | Yes | Sender-aware line containing the visible metadata items. |
| Timestamp | No | Caller-supplied time content at the start of the logical sequence. |
| Footer | No | Caller-supplied information or actions between time and status. |
| Status | No | Localized delivery icon and text when a status is supplied. |

## Best Practices

- **Do:** Put metadata in the last bubble metadata slot when the message uses bubbles, so it follows the bubble content.
- **Do:** Pass timestamp and footer content independently; separators are omitted for non-rendering scalar slots. Composite React nodes are used as supplied.
- **Don't:** Do not supply footer actions without their own accessible names and interaction behavior; the metadata row does not own those controls.
- **Don't:** Do not put the same metadata on both a bubble and its enclosing message.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `timestamp` | `ReactNode` | - | timestamp content; string or Timestamp |
| `footer` | `ReactNode` | - | footer content; model info, reaction btns, copy btn |
| `status` | `'sending' \| 'sent' \| 'delivered' \| 'read' \| 'error'` | - | delivery status; shows icon+label |
