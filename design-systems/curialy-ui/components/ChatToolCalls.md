package: @curialy/ui

# ChatToolCalls

Displays tool or function call invocations from an LLM response. Single call renders inline; multiple calls collapse into a summary. Use inside assistant messages.

**Import:** `import {ChatToolCalls} from '@curialy/ui/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Status icon | Yes | A themed semantic success/error icon, or a spinner while the call is pending or running. |
| Tool name | Yes | The function or tool name displayed in monospace: bash, edit, read, web_search, etc. |
| Node badge | No | A neutral pill badge showing which sandbox or environment ran the tool, like cli:remote-server or workspace. |
| Target label | No | The target of the action (a file path, command, or search query) shown after the tool name. |
| Diff stats | No | Green additions and red deletions counts for edit operations, displayed inline after the target. |
| Duration | No | Execution time shown on the trailing edge for completed calls. |
| Group header | No | A wrench icon with a call count, shown when multiple calls are present. Clicking toggles between the summary and the full list. |

## Best Practices

- **Do:** Include target on every call: file path, command, or search query.
- **Do:** Show duration on completed calls so users understand timing.
- **Do:** Provide group label when count alone is ambiguous.
- **Do:** Provide resultDetail with code blocks for calls that produce output.
- **Do:** Set unique key on each call item when streaming for stable animations.
- **Don't:** Don't omit status; defaults to complete, misleading for running/failed calls.
- **Don't:** Don't display outside chat message context; designed for assistant messages.
- **Don't:** Don't wrap individual calls; component handles single vs. grouped layout automatically.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `calls` | `ChatToolCallItem[]` | - | tool call data array; name+status+target+duration+node+additions+deletions+resultDetail **(required)** |
| `label` | `string` | - | custom summary label; auto from count if omitted |
| `isExpanded` | `boolean` | - | controlled expanded state |
| `defaultIsExpanded` | `boolean` | `false` | default expanded state (uncontrolled) |
| `onExpandedChange` | `(isExpanded: boolean) => void` | - | expanded state change callback |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |
