package: @astryxdesign/core

# Toast

Brief non-blocking notification for action confirmations and temporary info. Use where user needs feedback not decisions: saves, deletes, status changes. useToast() hook for production (safe-area positioning, responsive message wrapping, stacking, auto-dismiss, dedup via ToastViewport). Enters, exits, or swipe-dismisses toward configured edge; touch is claimed only after dominant edge-directed intent; swipe reports manual. Pen uses the direct-contact gesture; mouse drag stays off to preserve text selection and the close control remains available. Set isAutoHide false explicitly for must-remain actions/messages. Toast renders inline for previews/docs/static showcases. Host data-* attrs on Toast reach the toast element; role, live-region, theme attrs stay owned.

**Import:** `import {Toast} from '@astryxdesign/core/Toast';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Body | Yes | The primary message text describing what happened or what the user should know. |
| End content | No | A trailing action like an Undo button or a link, placed after the body text. |
| Dismiss button | Yes | A close button that lets the user manually dismiss the toast before auto-hide. |

## Best Practices

- **Do:** Short messages, a few words: "Changes saved", "Message sent".
- **Do:** Short Undo action in endContent for reversible ops; set isAutoHide false when it must remain available.
- **Do:** uniqueID to dedup repeated action toasts.
- **Do:** Error type for failures needing attention; persists until dismissed.
- **Don't:** Don't use for critical blocking errors. Use Banner for persistent in-context messaging.
- **Don't:** Don't put long/multi-line content; disappears in 5s, user may not finish reading.
- **Don't:** Don't show form validation errors. Use inline field validation instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `body` | `ReactNode` | - | primary message content **(required)** |
| `type` | `'info' \| 'error'` | `'info'` | toast type; controls bg color; error persists until dismissed |
| `isAutoHide` | `boolean` | - | auto-dismiss; true for info, false for error |
| `autoHideDuration` | `number` | `5000` | ms before auto-dismiss; timed content must satisfy WCAG 2.2.1 |
| `endContent` | `ReactNode` | - | trailing end content (undo btn, link); keep action labels short |
| `uniqueID` | `string` | - | unique id for dedup |
| `collisionBehavior` | `'overwrite' \| 'ignore'` | `'overwrite'` | behavior when matching uniqueID exists |
| `onHide` | `(reason: "auto" \| "manual") => void` | - | callback when toast removed |
| `onDismiss` | `(reason: "auto" \| "manual") => void` | - | Callback fired when the toast is dismissed. **(required)** |
| `renderContent` | `(toast: ToastContentRenderProps) => ReactNode` | - | custom inner layout; receives content, resolved settings + dismiss callback; no injected fallback control |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-toast` | `data-type` | type | - |

Override in defineTheme:
```ts
components: {
  'toast': {
    base: { /* CSS properties */ },
    'type:value': { /* variant-specific */ },
  },
}
```
