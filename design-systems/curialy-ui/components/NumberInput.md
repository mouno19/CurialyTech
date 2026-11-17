package: @curialy/ui

# NumberInput

A form input for numeric values with built-in validation, min/max constraints, and step controls. Use NumberInput for quantities, measurements, percentages, and similar inputs.

**Import:** `import {NumberInput} from '@curialy/ui/NumberInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | The label for the number input. |
| Description | No | Additional description text below the label. |
| Icon | No | An optional icon within the input. |
| Placeholder | No | Placeholder text shown when the input is empty. |
| Number steppers | No | Optional buttons that increment or decrement by the configured step. |

## Best Practices

- **Do:** Pasted formatted numbers parse: 1,234,234,234 commits as 1234234234 under the field's locale. Typing is never intercepted.
- **Do:** Set min, max, and step to guide users toward valid values.
- **Do:** Show units (e.g. "%" or "GB") so users know what the number represents.
- **Do:** Set isWheelEnabled={false} when the input appears in a scrolling surface where wheel gestures should always scroll the page.
- **Don't:** Use NumberInput for free-form text that happens to contain numbers; use TextInput instead.
- **Don't:** Set both isOptional and isRequired on the same field.
- **Don't:** Wrap a disabled NumberInput in Tooltip to explain why it's disabled. Use the disabledMessage prop, which attaches the reason to the field itself.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text (always rendered for accessibility). **(required)** |
| `value` | `number \| null \| undefined` | - | Current input value. **(required)** |
| `onChange` | `(value: number) => void` | - | Callback when a valid text edit commits on blur/Enter, or a step/clear control changes the value. **(required)** |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size variant. |
| `isLabelHidden` | `boolean` | - | Visually hide label (still accessible to screen readers). |
| `description` | `string` | - | Text between label + input. |
| `isOptional` | `boolean` | - | Field optional (mutually exclusive w/ isRequired). |
| `onKeyDown` | `(e: KeyboardEvent<HTMLInputElement>) => void` | - | Callback fired on keydown events on the input. |
| `isRequired` | `boolean` | - | Field required (mutually exclusive w/ isOptional). |
| `isDisabled` | `boolean` | - | Input disabled. |
| `isReadOnly` | `boolean` | `false` | Read-only: value visible + still submits, but not editable. Unlike isDisabled: not dimmed. |
| `disabledMessage` | `string` | - | Explains why input is disabled. With isDisabled, shows tooltip on hover/focus + keeps input focusable via aria-disabled (field becomes read-only). Use instead of wrapping a disabled NumberInput in Tooltip. |
| `placeholder` | `string` | - | Placeholder text. |
| `labelTooltip` | `string` | - | Tooltip text in info icon at label end. |
| `startIcon` | `IconType` | - | Icon at input start. |
| `labelIcon` | `IconType` | - | Icon before label text. |
| `status` | `{type: 'error' \| 'warning' \| 'success', message?: string}` | - | Validation status w/ optional message; nothing shows while typing; at Enter/blur, unreadable text, a fraction when isIntegerOnly, or any number while min > max stays w/ the field's own error message in place of status, unless status is an error w/ message (still announced + aria-invalid); warning/success never hide it; out-of-range numbers clamp. |
| `onEntryErrorChange` | `(error: {kind: 'unreadable' \| 'fractional' \| 'outOfRange', text: string, value?: number} \| null) => void` | - | (error\|null) on each typed-rejection change, starting only at Enter/blur: kind 'unreadable'\|'fractional' (isIntegerOnly)\|'outOfRange' (min > max), text, value (fractional/outOfRange); also on an edit to valid/empty, new value/min/max/isIntegerOnly, disable; never twice for one rejection; null on unmount mid-rejection; word it via an error status w/ message |
| `entryErrorBehavior` | `'complete' \| 'blur-or-enter'` | `the nearest FormLayout's defaultEntryErrorBehavior, else 'complete'` | 'complete'\|'blur-or-enter': when the field's own rejection shows (not when validation runs; not React Aria validationBehavior; never changes status). A typed number is complete only at Enter/blur, so both values behave the same: message, aria-invalid, styling, announcement and onEntryErrorChange report wait for Enter/blur; valid or emptied text clears at once. Default: nearest FormLayout defaultEntryErrorBehavior, else complete |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| `min` | `number \| null` | - | Minimum value allowed. |
| `max` | `number \| null` | - | Maximum value allowed. |
| `step` | `number \| null` | `1` | Step increment. |
| `formatValue` | `(value: number) => string` | - | Formats committed value at rest; raw number is shown while editing. |
| `isWheelEnabled` | `boolean` | `true` | Allow focused wheel gestures to step value. Defaults to true. |
| `hasNumberSteppers` | `boolean` | `false` | Show increment + decrement buttons on fine pointers; hidden on coarse pointers. Defaults to false. |
| `units` | `string \| null` | - | Units suffix (e.g. "%" or "GB"). |
| `isIntegerOnly` | `boolean` | - | Only allow integer values. |
| `hasClear` | `boolean` | `false` | Shows clear button when input has value. onChange also accepts null on clear. |
| `htmlName` | `string` | - | HTML name for form submissions; while blur keeps rejected text, posts the committed number until an edit or a new value. |
| `autoComplete` | `string` | - | HTML autocomplete attribute. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `hasAutoFocus` | `boolean` | - | Focus input on mount. |
| `onFocus` | `(e: FocusEvent<HTMLInputElement>) => void` | - | Callback on focus. |
| `onBlur` | `(e: FocusEvent<HTMLInputElement>) => void` | - | Callback on blur. |
| `onEnter` | `() => void` | - | Callback on Enter key. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-number-input` | `data-size`, `data-status`, `data-disabled`, `data-readonly` | size, status | disabled, readonly |

Override in defineTheme:
```ts
components: {
  'number-input': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
}
```
