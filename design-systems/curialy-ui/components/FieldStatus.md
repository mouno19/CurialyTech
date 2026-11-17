package: @curialy/ui

# FieldStatus

Validation feedback message for fields/custom controls. Supports error, warning, success and attached/detached variants. Announced via persistent live regions (assertive for errors, polite otherwise).

**Import:** `import {FieldStatus} from '@curialy/ui/FieldStatus';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Message box | Yes | Painted container for the validation feedback. |
| Detached icon | No | Leading status glyph shown only by the detached variant. |
| Message text | Yes | Text describing the validation status. |

## Best Practices

- **Do:** Use attached status below bordered inputs when message belongs to that input.
- **Do:** Use detached status for checkboxes, switches, and custom controls where overlap is visually awkward.
- **Don't:** Use FieldStatus for general alerts or page-level notices; use Banner or Toast instead.
- **Do:** Status announces when it appears and on message/type change only. On a repeated submit with unchanged errors, the form announces once via useAnnounce (error count + first error) and focuses the first invalid field.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'error' \| 'warning' \| 'success'` | - | error/warning/success status tone **(required)** |
| `message` | `string` | - | visible validation feedback text **(required)** |
| `id` | `string` | - | id for aria-describedby association |
| `variant` | `'attached' \| 'detached'` | `'attached'` | attached overlaps input; detached floats below |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-field-status` | `data-type`, `data-variant` | attached, detached | - |
| `cui-field-status-icon` | `data-type` | type | - |

Override in defineTheme:
```ts
components: {
  'field-status': {
    base: { /* CSS properties */ },
    'type:value': { /* variant-specific */ },
  },
  'field-status-icon': {
    base: { /* CSS properties */ },
  },
}
```
