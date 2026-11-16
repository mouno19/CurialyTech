package: @astryxdesign/core

# useScrollLock

Locks page scroll while active and keeps the page where it is. The page gets overflow: hidden (on the root, or on body when its own overflow is the one the viewport uses), which stops wheel, keyboard and scrollbar scrolling, and overscroll-behavior-y: none on the root and body, which stops the overscroll bounce while the lock holds. Where the primary pointer is coarse (phones and tablets), a one-finger pan that would scroll the page is cancelled, because iOS Safari scrolls an overflow: hidden page under a finger; pans that a scroller inside the overlay can take, drags on a native range input, pinch-zoom, and one-finger drags on a pinch-zoomed page (which pan the zoomed view) still work. The scroll offset never changes, so nothing jumps when the lock starts or ends, and iOS Safari keeps its toolbar as it was. Where the hidden scrollbar takes layout space (desktop), the hook holds its gutter open with scrollbar-gutter: stable, so the page, including any position: fixed chrome, does not shift sideways.

## Best Practices

- **Do:** Use when opening full-screen modals or dialogs to prevent background content from scrolling.
- **Do:** Pass the same boolean that controls dialog visibility (e.g., isOpen) as the isLocked parameter.
- **Don't:** Use for non-modal overlays like popovers or tooltips; users should be able to scroll away from those.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `isLocked` | `boolean` | - | whether page scroll should be locked. **(required)** |


Block templates: astryx component <name> --blocks for Dialog
