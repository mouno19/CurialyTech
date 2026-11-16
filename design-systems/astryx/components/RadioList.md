package: @astryxdesign/core

# RadioList

A group of options where only one can be selected at a time. All options are visible at once, making it easy to compare choices. Use it when users need to pick one option from a small set.

**Import:** `import {RadioList} from '@astryxdesign/core/RadioList';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Header | No | Optional heading above the radio list. |
| Children | Yes | The radio list items rendered as selectable options. |
| Label/Value | Yes | The text label and associated value for each radio item. |

## Best Practices

- **Do:** Keep the number of options small: typically 2 to 7 choices.
- **Do:** Use clear, concise labels that differentiate each option at a glance.
- **Do:** Pre-select a default option when there's a sensible default; don't leave the group empty unless the choice is optional.
- **Don't:** Use when multiple selections are needed; use CheckboxList instead.
- **Don't:** Use for long lists; use Selector for better discoverability.
- **Don't:** Use horizontal layout with more than 4 options; it wraps awkwardly.
- **Don't:** Wrap a disabled RadioList in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Accessibility

- **Radio circle:** The circle edge (unselected) and fill (selected) must have at least 3:1 contrast with the surface behind them. For Hover and Pointer down, measure the final colors after the tint and the pressed overlay are applied.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text for the radio group (always rendered for accessibility). **(required)** |
| `value` | `string` | - | The currently selected value. **(required)** |
| `onChange` | `(value: string) => void` | - | Callback fired when the selected value changes. **(required)** |
| `children` | `ReactNode` | - | RadioListItem elements. **(required)** |
| `isLabelHidden` | `boolean` | `false` | Whether to visually hide the label. |
| `description` | `string` | - | Description text displayed below the label. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Layout direction of the radio items. |
| `isDisabled` | `boolean` | `false` | Whether all radio items are disabled. |
| `htmlName` | `string` | - | The HTML name attribute shared by the radio inputs, useful for form submissions. When omitted, a unique internal name still groups the radios. |
| `disabledMessage` | `string` | - | Explains why the group is disabled. Applies to the whole-group disabled state (isDisabled), not per item. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the radios focusable via aria-disabled (selection stays blocked). Use this instead of wrapping a disabled RadioList in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| `isRequired` | `boolean` | `false` | Whether the radio group is required. |
| `isOptional` | `boolean` | `false` | Whether the field is optional (mutually exclusive with isRequired). |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Status indicator ({ type, message }). |
| `size` | `'sm' \| 'md'` | `'md'` | Size of the radio controls. |
| `labelTooltip` | `string` | - | Tooltip text for an info icon next to the label. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| `containerClassName` | `string` | - | Class name for the field container. Same targeting as `containerXstyle`. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. Same targeting as `containerXstyle`. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box: the element that paints the border and background and holds icons and end controls. Never the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Components

### RadioListItem

See `astryx component RadioListItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-radio-list` | `data-orientation`, `data-size` | orientation, size | - |
| `astryx-radio-list-item` | `data-size`, `data-selected`, `data-disabled` | size | selected, disabled |
| `astryx-radio-indicator` | `data-size`, `data-checked`, `data-disabled` | size | checked, disabled |
| `astryx-radio-indicator-dot` | `data-size` | size | - |

Override in defineTheme:
```ts
components: {
  'radio-list': {
    base: { /* CSS properties */ },
    'orientation:value': { /* variant-specific */ },
  },
  'radio-list-item': {
    base: { /* CSS properties */ },
    'selected': { /* state-specific */ },
  },
}
```
