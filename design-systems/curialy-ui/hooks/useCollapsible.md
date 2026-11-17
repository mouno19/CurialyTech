package: @curialy/ui

# useCollapsible

Reusable hook that encapsulates the collapsible state machine. Supports three modes: group-controlled (inside CollapsibleGroup), controlled (isOpen + onOpenChange), and uncontrolled (self-managed with defaultIsOpen). Used internally by Card and Section.

## Best Practices

- **Do:** Use the hook directly when building custom collapsible components that need Curialy UI collapsible behavior without Collapsible wrapper.
- **Do:** For accordion behavior, wrap items in CollapsibleGroup and pass unique value props.
- **Don't:** Pass local isOpen, defaultIsOpen, or onOpenChange expecting them to run for a value-bound group item; the group owns that state and notification path.
- **Don't:** Implement your own open/close state when useCollapsible already provides it; the hook handles group coordination automatically.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `isCollapsible` | `boolean \| CollapsibleConfig` | - | Enable collapsible behavior. true = self-managed (starts open). Pass config object for controlled mode or custom defaults. |
| `value` | `string` | - | Unique identifier within an CollapsibleGroup. When present and inside a group, state is managed by the group. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `isEnabled` | `boolean` | Whether collapsible behavior is active. |
| `isOpen` | `boolean` | Whether the content is currently expanded. |
| `toggle` | `() => void` | Toggle open/closed state. Dispatches to group, controlled callback, or internal state. |


Block templates: design_system component <name> --blocks for Collapsible, Card, Section
