package: @curialy/ui

# useLightbox

State management and accessible trigger wiring for Lightbox. Eliminates boilerplate for managing open state and current index. Returns trigger props with button role, tabIndex={0}, aria-haspopup="dialog", and keyboard activation handlers, along with a pre-wired Lightbox element that handles dismissal, next/previous navigation, and focus restoration.

## Best Practices

- **Do:** Spread getTriggerProps(index) onto image or thumbnail elements to give them accessible button semantics and keyboard activation.
- **Do:** Render lightbox.element once in your component JSX tree alongside the triggers.
- **Don't:** Manage separate isOpen or index state alongside useLightbox; the hook already tracks both.
- **Don't:** Add custom click or keydown handlers to open the lightbox when using triggerProps or getTriggerProps.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseLightboxOptions` | - | Configuration options for the lightbox. **(required)** |
| `options.media` | `LightboxMedia \| LightboxMedia[]` | - | Media to display in the lightbox. Pass a single object for one item, or an array for gallery mode. **(required)** |
| `options.hasZoom` | `boolean` | `false` | Enable zoom on double-click, or Enter/Space/+/- via keyboard (images only). When zoomed, drag or use arrow keys to pan. |
| `options.hasAutoPlay` | `boolean` | `false` | Whether video should autoplay when the lightbox opens. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `open` | `(index?: number) => void` | Open the lightbox, optionally at a specific gallery index (defaults to 0). |
| `close` | `() => void` | Close the lightbox. |
| `isOpen` | `boolean` | Whether the lightbox is currently open. |
| `index` | `number` | Current gallery index. |
| `element` | `ReactNode` | Pre-wired Lightbox component element to render in your JSX tree. |
| `triggerProps` | `{role: 'button', tabIndex: 0, 'aria-haspopup': 'dialog', onClick: () => void, onKeyDown: (e: React.KeyboardEvent) => void}` | Props to spread onto a single trigger element to open the lightbox at index 0 on click, Enter, or Space. |
| `getTriggerProps` | `(index: number) => {role: 'button', tabIndex: 0, 'aria-haspopup': 'dialog', onClick: () => void, onKeyDown: (e: React.KeyboardEvent) => void}` | Returns trigger props to spread onto an element to open the lightbox at a specific gallery index on click, Enter, or Space. |


Block templates: design_system component <name> --blocks for Lightbox, Grid, Thumbnail
