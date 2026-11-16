package: @astryxdesign/core

# useToast

Hook for showing toast notifications from anywhere in your component tree. Returns a function that accepts toast options and shows the notification. Works automatically with LayerProvider or self-mounts a fallback viewport.

## Best Practices

- **Do:** Use for transient success/error feedback that does not require user action.
- **Do:** Set uniqueID to deduplicate toasts from rapid user actions.
- **Don't:** Use for critical errors that require acknowledgment; use AlertDialog instead.
- **Don't:** Call useToast in the same component that renders LayerProvider; it must be called from a child component inside the provider.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `showToast` | `(options: ToastOptions) => () => void` | Show a toast notification. Returns a dismiss function. Options include body (ReactNode), type ("info" \| "error"), isAutoHide, autoHideDuration, endContent, uniqueID, and collisionBehavior. |


Block templates: astryx component <name> --blocks for Toast, Banner, AlertDialog
