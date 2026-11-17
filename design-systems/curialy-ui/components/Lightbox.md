package: @curialy/ui

# Lightbox

A fullscreen overlay for viewing images and videos at full resolution. Supports single-item and gallery modes with prev/next navigation and swiping, optional zoom and pan for images, and native video controls.

**Import:** `import {Lightbox} from '@curialy/ui/Lightbox';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Viewer overlay | Yes | Full-viewport dialog overlay that contains the active media and controls. |
| Media | Yes | Active image or video presented inside the viewer. |
| Close button | Yes | Button that closes the viewer. |
| Previous button | No | Gallery button that moves to the previous media item. |
| Next button | No | Gallery button that moves to the next media item. |
| Caption | No | Caller-provided caption displayed below the active media, in a band at the bottom of the viewer. It shows at most two lines, for a single photo as for a gallery; a longer caption ends in an inline "more" link that opens it in full over the photo. |
| Counter | No | Current position and total shown in gallery mode. |

## Best Practices

- **Do:** Always provide alt text for every image.
- **Do:** Use gallery mode with onIndexChange for multi-image sets.
- **Do:** Enable hasZoom only when viewing high-resolution images that benefit from close inspection.
- **Don't:** Use for content other than images and videos; one media item at a time.
- **Don't:** Nest interactive content inside captions; keep them plain text.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the lightbox is open. **(required)** |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback when open state changes (including a photo dragged down). **(required)** |
| `media` | `LightboxMedia \| LightboxMedia[]` | - | Single media object or array for gallery mode. **(required)** |
| `index` | `number` | - | Current index in gallery mode. |
| `onIndexChange` | `(index: number) => void` | - | Callback when gallery index changes (buttons, keys or a swipe). |
| `hasZoom` | `boolean` | `false` | Enable zoom (pinch or ctrl-wheel, double-tap or double-click, Enter/Space, or +/-; 0 resets) and pan (drag, trackpad scroll, or arrow keys) for images. |
| `defaultIndex` | `number` | `0` | Initial image index in gallery mode for uncontrolled usage. |
| `hasAutoPlay` | `boolean` | `false` | Automatically start video playback when a video media item is shown. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-lightbox` | - | - | - |

Override in defineTheme:
```ts
components: {
  'lightbox': {
    base: { /* CSS properties */ },
  },
}
```
