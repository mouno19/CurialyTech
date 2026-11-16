package: @astryxdesign/core

# Dialog

Dialog displays a modal overlay that blocks page interaction. Use for delete confirmations, edit forms, terms acceptance. Modal and inline content uses theme body defaults and exits ancestor surface/group membership as a whole; explicit props and unrelated contexts remain unchanged. Provide intentional groups and complete required providers inside the dialog.

**Import:** `import {Dialog} from '@astryxdesign/core/Dialog';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Header | Yes | Title, optional subtitle, and close button. The title receives focus on open and labels the dialog via aria-labelledby. |
| Body | Yes | The main content area: text, forms, lists, or any layout. |
| Footer | No | Action buttons like Save/Cancel or Accept/Decline, aligned to the end. |
| Backdrop | Yes | Semi-transparent overlay behind the dialog that blocks page interaction. |

## Best Practices

- **Do:** Choose the right purpose: info for dismissable content, form to prevent accidental backdrop dismissal, required when user must respond.
- **Do:** Include a clear title in the header so users immediately understand what the dialog is asking.
- **Do:** Use purpose="form" for dialogs with inputs so user can't accidentally lose data by clicking the backdrop.
- **Do:** Keep dialogs focused on a single task; if content grows beyond what fits, consider a full page instead.
- **Don't:** Use a dialog for simple messages that could be shown inline or as a toast notification.
- **Don't:** Nest dialogs inside other dialogs; restructure the flow into steps within a single dialog instead.
- **Don't:** Use the fullscreen variant for simple confirmations; it's meant for complex content like editors or long forms.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the dialog is open. **(required)** |
| `onOpenChange` | `(isOpen: boolean) => unknown` | - | Callback when dialog visibility changes. **(required)** |
| `children` | `ReactNode` | - | Dialog content. **(required)** |
| `width` | `number \| string` | `400` | Preferred width of the dialog in pixels or any CSS value. Standard dialogs clamp to their container and the dynamic viewport with spacing-token gutters so narrow viewports keep content on screen. |
| `maxHeight` | `number \| string` | `'75dvh'` | Maximum height of the dialog. Defaults to a dynamic viewport value so browser UI changes are reflected where supported. |
| `position` | `DialogPosition` | - | Static position for the dialog; centered by default when omitted. Use logical `start`/`end` for inline offsets so positioned dialogs mirror correctly under RTL. |
| `variant` | `'standard' \| 'fullscreen'` | `'standard'` | Dialog variant: fullscreen expands to fill the entire viewport. |
| `purpose` | `'required' \| 'form' \| 'info'` | `'info'` | Controls dismissal behavior: required disables Escape and backdrop click; form disables backdrop click after interaction; info allows both. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Internal padding of the dialog using the spacing scale step. |
| `isInline` | `boolean` | `false` | Renders dialog content inline without the <dialog> element, backdrop, or modal behavior. For documentation previews and showcases only. |

## Components

### DialogHeader

See `astryx component DialogHeader` for props and usage.

### useImperativeDialog

See `astryx component useImperativeDialog` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-dialog` | `data-variant` | standard, fullscreen | - |
| `astryx-dialog-header` | - | - | - |
| `astryx-dialog-header-start-content` | - | - | - |
| `astryx-dialog-header-title-block` | - | - | - |
| `astryx-dialog-header-end-content` | - | - | - |
| `astryx-dialog-header-close-icon` | - | - | - |

Override in defineTheme:
```ts
components: {
  'dialog': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
  'dialog-header': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  dialog: {
    base: {
      borderRadius: '...',
      padding: '...',  // expands to container layout tokens
    },
  },
}
```
