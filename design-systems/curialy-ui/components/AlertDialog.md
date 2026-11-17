package: @curialy/ui

# AlertDialog

AlertDialog confirms destructive/irreversible action (delete, revoke access, discard changes). Implements WAI-ARIA APG Alert Dialog pattern (https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/): role="alertdialog", aria-labelledby title, aria-describedby description, focus into dialog on open + back to trigger on close, no outside-click dismissal, Escape cancels. Dialog preserves requested width + clamps it to container/dynamic viewport gutters. Generic Dialog footers wrap while consumers own action order. AlertDialog owns confirmation action layout: >640px horizontal buttons may move to another row; <=640px puts the destructive action above Cancel and makes both buttons full width regardless of pointer/hover capability. Button labels remain single-line. Body scrolls when height constrained. Every pointer: both actions tracked as one group like iOS alerts (action under pointer highlights at once, highlight follows pointer between actions, release runs action under pointer, release off both runs nothing); keyboard/AT keep each button click. To show w/o managing open state, use useImperativeAlertDialog hook: call alert.show(options) + render alert.element in tree.

**Import:** `import {AlertDialog} from '@curialy/ui/AlertDialog';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Title | Yes | The question being asked. Renders as a level-2 heading and labels the dialog via aria-labelledby. |
| Description | Yes | What will happen if the user confirms. Linked to the dialog via aria-describedby. |
| Cancel button | Yes | Ghost button that dismisses without acting. Takes initial focus, and Escape does the same thing. |
| Action button | Yes | The confirming action. Destructive by default; shows a spinner while isActionLoading is set. |
| Backdrop | Yes | Overlay behind the dialog that blocks page interaction. Clicking it does not dismiss. |
| Dialog surface | Yes | The modal panel that holds the title, description, and buttons. |

## Best Practices

- **Do:** Make action button label specific: "Delete project" > "OK"/"Confirm".
- **Do:** Describe consequences in description so user knows outcome before confirming.
- **Do:** Keep cancel as initial focus: least destructive choice is preselected even when narrow visual/DOM order places it after the destructive action.
- **Do:** Use concise action labels; >640px complete buttons may move to another row, and <=640px puts the destructive action above Cancel with both buttons full width regardless of pointer type.
- **Don't:** Use AlertDialog for non-destructive actions; use standard Dialog instead.
- **Don't:** Rely on color alone for danger; the action label should say what happens.
- **Don't:** Close from onAction before work finishes; hold open w/ isActionLoading, call onOpenChange(false) when it settles.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the dialog is open. **(required)** |
| `onOpenChange` | `(isOpen: boolean) => unknown` | - | Visibility change callback. **(required)** |
| `title` | `string` | - | Dialog title. Linked via aria-labelledby. **(required)** |
| `description` | `string` | - | Consequence description. Linked via aria-describedby. **(required)** |
| `actionLabel` | `string` | - | Action button label. **(required)** |
| `onAction` | `() => unknown` | - | Called when action button is clicked. Does NOT auto-close. **(required)** |
| `cancelLabel` | `string` | `'Cancel'` | Cancel button label. |
| `actionVariant` | `ButtonVariant` | `'destructive'` | Action button variant. |
| `isActionLoading` | `boolean` | - | Shows loading spinner on the action button. |
| `width` | `number \| string` | `400` | Requested dialog width. Dialog preserves this preferred width and clamps it to the container and dynamic viewport with token gutters. |
| `isInline` | `boolean` | `false` | Renders alert dialog content inline without modal behavior. For documentation previews and showcases only. Not being a modal, the inline path renders role="group" instead of role="alertdialog". |

## Components

### useImperativeAlertDialog

See `design_system component useImperativeAlertDialog` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-alert-dialog` | - | - | - |

Override in defineTheme:
```ts
components: {
  'alert-dialog': {
    base: { /* CSS properties */ },
  },
}
```
