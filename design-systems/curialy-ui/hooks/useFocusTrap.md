package: @curialy/ui

# useFocusTrap

Traps focus within a container element following the WAI-ARIA dialog focus trap pattern. Listens to focus events on the document and redirects focus back into the container if a Tab from inside it moves focus out. Handles both Tab and Shift+Tab wrapping. A Tab pressed while focus is outside the container is left to the page, so an open non-modal surface never takes over the focus order of the page. When the trap deactivates or unmounts, focus is restored to the element that was focused before activation, unless focus was already moved elsewhere or never entered the trap (so popups that keep focus on their trigger, like comboboxes, are unaffected). Mouse clicks outside the container are not intercepted; use a light-dismiss handler for that.

## Best Practices

- **Do:** Call focusFirst() when opening a dialog/modal to move focus into the trapped region.
- **Do:** Provide an onEscape callback to close the dialog when Escape is pressed.
- **Do:** Rely on the built-in focus restoration on close; only add your own onHide focus handling when you need to send focus somewhere other than the previously-focused element.
- **Don't:** Use on non-modal content like tooltips or dropdowns; those need light-dismiss, not focus trapping.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseFocusTrapOptions` | - | Configuration object for the focus trap. **(required)** |
| `options.isActive` | `boolean` | - | Whether the focus trap is currently active. **(required)** |
| `options.onEscape` | `() => void` | - | Callback when Escape key is pressed inside the trapped container. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `containerRef` | `React.RefObject<HTMLElement \| null>` | Ref to attach to the container element that should trap focus. |
| `focusFirst` | `() => void` | Focuses the first focusable element inside the container. |


Block templates: design_system component <name> --blocks for Dialog, DatePicker
