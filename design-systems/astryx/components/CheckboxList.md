package: @astryxdesign/core

# CheckboxList

CheckboxList shows a small group of checkboxes so users can turn several options on or off at once. Place it in settings pages, filter panels, or forms where every choice should be visible without scrolling. For a single standalone checkbox (like "I agree to the terms"), use CheckboxInput instead. If only one option can be picked, use RadioList. If the list is long enough to need searching or scrolling, use MultiSelector instead.

**Import:** `import {CheckboxList} from '@astryxdesign/core/CheckboxList';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Group | Yes | Container for the labeled checkbox group. |
| Group label | Yes | Text identifying what the checkbox options represent. |
| Description | No | Helper text below the group label. |
| Options list | Yes | List containing the available checkbox options. |
| Option row | Yes | Selectable row containing one option. |
| Checkbox | Yes | Selection indicator for an option. |
| Option label | Yes | Primary content identifying an option. |
| Option description | No | Secondary text below an option label. |
| End content | No | Caller-provided content at the end of an option row. |
| Spinner | No | Loading indicator shown inside the pending checkbox. |
| Status message | No | Error, warning, or success message below the group. |

## Best Practices

- **Do:** Keep the list short: three to seven options is the sweet spot. Beyond that, switch to MultiSelector which adds search and scrolling.
- **Do:** Turn on dividers (hasDividers) when items have helper text underneath; without them the labels and descriptions blur together.
- **Do:** Write a group label that says what the choices represent: "Export formats" tells users more than "Options".
- **Don't:** Show a CheckboxList when the user can only pick one thing; that is what RadioList is for.
- **Don't:** Put buttons or links inside the trailing slot (endContent); the whole row is already tappable, so a nested button creates two competing click targets.
- **Don't:** Wrap a disabled CheckboxList in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text for the checkbox group (always rendered for accessibility). **(required)** |
| `children` | `ReactNode` | - | CheckboxListItem elements. **(required)** |
| `value` | `string[]` | - | The currently selected values (collection mode). |
| `onChange` | `(values: string[]) => void` | - | Callback fired when the selected values change. |
| `changeAction` | `(values: string[]) => void \| Promise<void>` | - | Async action on change with optimistic updates. While the promise is pending, the toggled item shows a spinner inside its checkbox and is marked aria-busy. |
| `isLabelHidden` | `boolean` | `false` | Whether to visually hide the label. |
| `description` | `string` | - | Description text displayed below the label. |
| `isOptional` | `boolean` | `false` | Whether the group is optional. Shows the optional indicator after the group label, unless a surrounding FormLayout already makes fields optional by default. |
| `isRequired` | `boolean` | `false` | Whether the group needs at least one checked box. Shows the required indicator after the group label by the same rules as every input field. While no box is checked, the browser blocks submit and moves focus to the first box that is neither disabled nor read-only, with its own message. A disabled or read-only group requires nothing. Show your own error text through status. Mutually exclusive with isOptional. |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | Spacing density for list items. |
| `hasDividers` | `boolean` | `false` | Whether to show dividers between items. |
| `isDisabled` | `boolean` | `false` | Whether all checkbox items are disabled. |
| `disabledMessage` | `string` | - | Explains why the group is disabled. Applies to the whole-group disabled state (isDisabled), not per item. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the checkboxes focusable via aria-disabled (toggling stays blocked). Use this instead of wrapping a disabled CheckboxList in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| `isReadOnly` | `boolean` | `false` | Whether all checkbox items are read-only. Displays the current state at full opacity but prevents interaction. Unlike isDisabled, read-only checkboxes are not visually dimmed. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Status indicator ({ type, message }). |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| `containerClassName` | `string` | - | Class name for the field container. Same targeting as `containerXstyle`. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. Same targeting as `containerXstyle`. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box: the element that paints the border and background and holds icons and end controls. Never the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Components

### CheckboxListItem

See `astryx component CheckboxListItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-checkbox-list` | - | - | - |

Override in defineTheme:
```ts
components: {
  'checkbox-list': {
    base: { /* CSS properties */ },
  },
}
```
