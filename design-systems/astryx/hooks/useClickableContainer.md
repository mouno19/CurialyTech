package: @astryxdesign/core

# useClickableContainer

Makes a container element clickable while preserving nested interactive element behavior. Solves the "nested interactive elements" problem: when a card is clickable but contains buttons/links, clicking those should NOT trigger the card's action. Detects interactive ancestors between the click target and the container, and ignores text selections. Supports href navigation (including middle-click and Ctrl/Cmd+click for new tabs).

## Best Practices

- **Do:** Attach onClick, onMouseUp and onPointerDown to the container element: full click handling including middle-click, and no touch pressed state for a press on a nested control.
- **Do:** Use inside ClickableCard or SelectableCard for the standard card interaction pattern.
- **Do:** For a pressable surface without Card chrome, such as a quoted message that jumps on press, compose it yourself: this hook on the surface; `usePressFeedback()` and `interactionOverlayStyles.backgroundColor` (from `@astryxdesign/core/utils`) on the same element for the hover tint and touch press; a native `<button>` (or an `<a>` for a destination) inside `VisuallyHidden` as the named control and interactiveRef; and `focusOutlineStyles.focusWithin` (from `@astryxdesign/core/utils`) on the surface for the shared focus ring, the one ClickableCard draws. The `Core/Hooks/useClickableContainer` story has the full recipe.
- **Don't:** Use when the entire container is a single interactive element; just use a <button> or <a> directly.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseClickableContainerOptions` | - | Configuration object for the clickable container. **(required)** |
| `options.containerRef` | `RefObject<HTMLElement \| null>` | - | Ref to the outer container element. **(required)** |
| `options.interactiveRef` | `RefObject<HTMLElement \| null>` | - | Ref to the primary interactive element inside (link, button). If no onClick or href is provided, clicks are proxied to this element. |
| `options.onClick` | `(event: MouseEvent<HTMLElement>) => void` | - | Click handler fired when the container surface (not a nested interactive element) is clicked. |
| `options.href` | `string` | - | Navigation URL. When provided, clicking the container navigates to this URL. |
| `options.target` | `string` | - | Link target (e.g., '_blank'). Used with href for navigation behavior. |
| `options.disabled` | `boolean` | `false` | Whether the container is disabled. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `onClick` | `(event: MouseEvent<HTMLElement>) => void` | Click handler to attach to the container element. |
| `onMouseUp` | `(event: MouseEvent<HTMLElement>) => void` | Mouse up handler to attach to the container (handles middle-click navigation for href). |
| `onPointerDown` | `(event: PointerEvent<HTMLElement>) => void` | Pointer down handler to attach to the container. On a container that paints its press with usePressFeedback, it drops a touch press that starts on a nested interactive element, which does not activate the container. A mouse :active press paint is unchanged. Without it, the container keeps its click rules and its pressed state for every press. |


Block templates: astryx component <name> --blocks for ClickableCard, SelectableCard
