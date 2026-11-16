package: @astryxdesign/core

# CheckboxInput

CheckboxInput toggles a single on/off value. Use for settings, terms acceptance, opt-in choices. Use CheckboxList for groups.

**Import:** `import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Checkbox | Yes | The check box itself: unchecked, checked, or indeterminate. |
| Label | Yes | Text describing what the checkbox controls. Always present for accessibility. |
| Description | No | Helper text below the label with additional context. |
| Status message | No | An error, warning, or success message below the checkbox. |

## Best Practices

- **Do:** Always provide a visible label so user knows what they're toggling. Use isLabelHidden only when surrounding context makes it obvious.
- **Do:** Add a description for choices that need extra context, e.g. what "Share usage data" actually shares.
- **Do:** Use the indeterminate state for "select all" checkboxes when only some items in a group are selected.
- **Don't:** Use a checkbox for mutually exclusive choices; use RadioList when only one option can be selected.
- **Don't:** Use a checkbox for actions that take effect immediately; use a toggle switch or button instead.
- **Don't:** Wrap a disabled checkbox in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Accessibility

- **Checkbox box:** The box edge (unchecked) and fill (checked) must have at least 3:1 contrast with the surface behind them. For Hover and Pointer down, measure the final colors after the tint and the pressed overlay are applied.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ref` | `React.Ref<HTMLInputElement>` | - | ref forwarded to underlying <input> |
| `label` | `string` | - | label text; always rendered for a11y **(required)** |
| `isLabelHidden` | `boolean` | `false` | visually hide label (still accessible to screen readers) |
| `description` | `string` | - | text below label |
| `value` | `boolean \| 'indeterminate'` | - | checked, unchecked, or indeterminate **(required)** |
| `onChange` | `(checked: boolean, e: ChangeEvent<HTMLInputElement>) => void` | - | callback on state change |
| `changeAction` | `(checked: boolean, e: ChangeEvent<HTMLInputElement>) => void \| Promise<void>` | - | async action; fires after onChange, shows spinner while pending |
| `isLoading` | `boolean` | `false` | shows spinner + prevents interaction |
| `isDisabled` | `boolean` | `false` | disable checkbox |
| `htmlName` | `string` | - | HTML name attr for the checkbox; submits "on" when checked. |
| `disabledMessage` | `string` | - | Explains why the checkbox is disabled. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the checkbox focusable via aria-disabled (toggling stays blocked). Use this instead of wrapping a disabled CheckboxInput in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| `isReadOnly` | `boolean` | `false` | Whether the checkbox is read-only. Displays the current state at full opacity but prevents interaction. Unlike `isDisabled`, read-only checkboxes are not visually dimmed. |
| `isOptional` | `boolean` | `false` | mark field as optional (mutually exclusive w/ isRequired) |
| `isRequired` | `boolean` | `false` | mark field as required (mutually exclusive w/ isOptional) |
| `size` | `'sm' \| 'md'` | `'md'` | sm (compact) or md (default) |
| `onFocus` | `(e: FocusEvent<HTMLInputElement>) => void` | - | callback on focus |
| `onBlur` | `(e: FocusEvent<HTMLInputElement>) => void` | - | callback on blur |
| `labelIcon` | `ReactNode \| IconType` | - | semantic icon name or custom content before label text |
| `status` | `{ type: 'error' \| 'warning' \| 'success', message: string }` | - | error/warning/success with message; sets aria-invalid on error |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-checkbox-input` | `data-size` | size | - |
| `astryx-checkbox-indicator` | `data-size`, `data-checked`, `data-disabled` | size | checked, disabled |
| `astryx-checkbox-label` | - | - | - |

Override in defineTheme:
```ts
components: {
  'checkbox-input': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'checkbox-indicator': {
    base: { /* CSS properties */ },
    'checked': { /* state-specific */ },
  },
}
```
