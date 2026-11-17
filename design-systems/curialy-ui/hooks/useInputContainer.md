package: @curialy/ui

# useInputContainer

Makes an input container wrapper clickable, delegating focus to the inner input/textarea when the user clicks non-interactive areas (icons, padding, status indicators). Built on top of useClickableContainer, so nested interactive elements (clear buttons, calendar toggles, links) are handled safely; clicking them does NOT steal focus from the input. Automatically detects input type: text-like inputs receive .focus(), while other types (checkbox, radio, file) receive .click().

## Best Practices

- **Do:** Use inside input wrapper components (TextInput, NumberInput, TimeInput, TextArea) to make the full container area clickable.
- **Do:** Attach both onClick and onMouseUp to the wrapper div for full interaction handling.
- **Don't:** Use on bare inputs without a wrapper; there is no benefit if the input already fills the full clickable area.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseInputContainerOptions` | - | Configuration object for the input container. **(required)** |
| `options.containerRef` | `RefObject<HTMLElement \| null>` | - | Ref to the outer container/wrapper element. **(required)** |
| `options.inputRef` | `RefObject<HTMLInputElement \| HTMLTextAreaElement \| HTMLElement \| null>` | - | Ref to the inner input or textarea element. **(required)** |
| `options.disabled` | `boolean` | `false` | Whether the input is disabled. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `onClick` | `(event: MouseEvent<HTMLElement>) => void` | Click handler to attach to the container wrapper. |
| `onMouseUp` | `(event: MouseEvent<HTMLElement>) => void` | Mouse up handler to attach to the container wrapper. |


Block templates: design_system component <name> --blocks for TextInput, NumberInput, TimeInput, TextArea
