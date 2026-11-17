package: @curialy/ui

# Switch

A toggle control for on/off states that take effect immediately. Supports labels, descriptions, loading states, and validation. Use it for settings or preferences that apply instantly. For changes requiring a form submission, use a checkbox instead. Under a finger it moves like the iOS switch on every touch screen: a press lifts the thumb, a drag across flips it, lifting the finger commits, and a tap toggles through the browser’s click. The thumb keeps its circle and size on every device, and under a coarse pointer the invisible hit area grows toward 44 × 44 px, stopping halfway to any neighbouring control so a tap goes to the nearer one. With reduced motion on, a change cross-fades on a touch screen and is immediate with a mouse.

**Import:** `import {Switch} from '@curialy/ui/Switch';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Field | Yes | Container arranging the switch, label, and feedback. |
| Track | Yes | Pill-shaped surface that shows the off or on state. |
| Thumb | Yes | Indicator that moves across the track when state changes. |
| Label | Yes | Text identifying the setting controlled by the switch. |
| Description | No | Helper text below the label. |
| Spinner | No | Loading indicator shown inside the thumb while busy. |
| Status message | No | Error, warning, or success message below the switch. |

## Best Practices

- **Do:** Use for settings that apply immediately; the toggle should take effect without a separate save action.
- **Do:** Pair with a clear, concise label that describes the setting being controlled.
- **Don't:** Use for options that require a form submission to take effect; use a checkbox instead.
- **Don't:** Use a switch for multi-state values; it's strictly on/off.
- **Don't:** Wrap a disabled switch in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Accessibility

- **Track and thumb:** The on and off tracks must each have at least 3:1 contrast with the surface behind them, and the thumb with its track. For Hover and Pointer down, measure the final colors after the tint and the pressed overlay are applied.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ref` | `React.Ref<HTMLInputElement>` | - | ref forwarded to underlying <input> |
| `label` | `string` | - | Label text (always rendered for a11y). **(required)** |
| `value` | `boolean` | - | Whether switch is on or off. **(required)** |
| `onChange` | `(checked: boolean, e: ChangeEvent<HTMLInputElement>) => void` | - | Fired when switch state changes. |
| `changeAction` | `(checked: boolean, e: ChangeEvent<HTMLInputElement>) => void \| Promise<void>` | - | Async action after onChange; triggers optimistic UI + loading spinner until resolved. |
| `isLoading` | `boolean` | `false` | Loading state; shows spinner in thumb. |
| `isLabelHidden` | `boolean` | `false` | Visually hides label; still accessible to screen readers. |
| `description` | `string` | - | Description text below label. |
| `isDisabled` | `boolean` | `false` | Whether switch is disabled. |
| `size` | `'sm' \| 'md'` | `'md'` | Size variant controlling track and thumb dimensions. sm (32x20px) matches sm checkbox/radio vertical rhythm; md (40x24px, default) matches md checkbox/radio vertical rhythm. |
| `htmlName` | `string` | - | HTML name attr for the checkbox; submits "on" when on. |
| `disabledMessage` | `string` | - | Explains why the switch is disabled. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the switch focusable via aria-disabled (toggling stays blocked). Use this instead of wrapping a disabled Switch in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| `isOptional` | `boolean` | `false` | Whether field is optional; mutually exclusive w/ isRequired. |
| `isRequired` | `boolean` | `false` | Whether switch is required; mutually exclusive w/ isOptional. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Status indicator w/ type + message; colored message box, sets aria-invalid on error. |
| `onFocus` | `(e: FocusEvent<HTMLInputElement>) => void` | - | Fired when switch receives focus. |
| `onBlur` | `(e: FocusEvent<HTMLInputElement>) => void` | - | Fired when switch loses focus. |
| `labelIcon` | `IconType` | - | Icon before label text. |
| `labelTooltip` | `string` | - | Tooltip text in info icon at label end. |
| `labelPosition` | `'start' \| 'end'` | `'end'` | Which side label appears; "start" places before switch. |
| `labelSpacing` | `'hug' \| 'spread'` | `'hug'` | Spacing behavior; "hug" places next to each other, "spread" pushes to opposite ends (full width). |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-switch` | `data-size`, `data-checked`, `data-disabled` | size | checked, disabled |
| `cui-switch-thumb` | `data-size`, `data-checked` | size | checked |
| `cui-switch-field` | `data-label-position`, `data-label-spacing` | labelPosition, labelSpacing | - |
| `cui-switch-label` | - | - | - |

Override in defineTheme:
```ts
components: {
  'switch': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'checked': { /* state-specific */ },
  },
  'switch-thumb': {
    base: { /* CSS properties */ },
    'checked': { /* state-specific */ },
  },
}
```
