package: @astryxdesign/core

# useInputStatusIcon

Builds the on-field status affordance for a bordered input and its accessibility wiring, so every input in the family behaves the same for a given status. The attached variant renders a plain glyph and leaves the text to the message box; the detached variant renders nothing here, because the message box already carries its own icon; the tooltip variant renders a real focusable button whose tooltip is reachable by keyboard, pointer, touch and assistive tech. Use it when building a bordered input, not for field-level messaging.

## Best Practices

- **Do:** Render statusIcon inside the input container and merge describedBy into the control's aria-describedby list.
- **Do:** Let it decide when nothing should render; pass isInGroup and the variant through rather than branching at the call site.
- **Don't:** Use it to convey the status by icon alone; the tooltip variant is the only one that carries the message, so the others still need a message box.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseInputStatusIconOptions` | - | Configuration object. **(required)** |
| `options.status` | `InputStatus` | - | The input's status (type plus message), or undefined when there is none. |
| `options.statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How the status is presented relative to the input. |
| `options.isInGroup` | `boolean` | `false` | Whether the input sits inside an InputGroup, which owns status rendering itself. |
| `options.size` | `IconSize` | `'md'` | Size of the on-field icon. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `statusIcon` | `ReactNode` | The affordance to render inside the input container: a plain icon, or a focusable info-tip button with its tooltip. Null when no icon should render. |
| `describedBy` | `string \| undefined` | ID to add to the input's aria-describedby, present exactly when a tooltip element is in the DOM, so there is never a dangling reference. |


Block templates: astryx component <name> --blocks for TextInput, TextArea, NumberInput, DateInput, FileInput, FieldStatus, InputGroup
