package: @curialy/ui

# Slider

A draggable control for selecting a numeric value or range within defined bounds. Supports single value and range selection, tick marks, custom value formatting, and vertical orientation. Use it when users need to explore a continuous range, such as volume, price, or percentage. Under a finger, on any touch device, it tracks as UISlider does: only the thumb takes a drag, through a target larger than it, the value follows the finger’s travel rather than jumping to it, a release coasts on before `onChangeEnd`, a swipe from the track scrolls the page, and a tap on the track or a mark sets the value when the finger lifts (the thumb springs there). A mouse drag on a thumb tracks the same way, past the same 10 px in any direction, with no lift or coast; a mouse press on the track moves the thumb there, and only a primary click presses. A pen drags as a finger does, claiming only along the track, and its drag ends at the release with no coast. A wheel or a trackpad scroll over the slider goes to whatever scrolls under it.

**Import:** `import {Slider} from '@curialy/ui/Slider';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text identifying the numeric setting controlled by the slider. |
| Description | No | Helper text between the label and the slider control. |
| Slider | Yes | Control row containing the track, thumb or thumbs, and optional text value. |
| Interactive control | Yes | Pointer and keyboard interaction surface containing the rail, fill, marks, and thumbs. |
| Track | Yes | Background rail representing the available numeric range. |
| Filled range | Yes | Accent segment from the minimum to a single value, or between two range values. |
| Tick mark | No | Position marker supplied through the marks collection. |
| Mark label | No | Optional text displayed beside a tick mark. |
| Thumb | Yes | Draggable value indicator; range mode renders a minimum and maximum thumb. |
| Value display | No | Formatted current value shown beside the slider when valueDisplay is text. |
| Value tooltip | No | Formatted current value shown in a tooltip when valueDisplay is tooltip. |
| Status message | No | Error, warning, or success message below the slider. |

## Best Practices

- **Do:** Always provide a label, even if visually hidden, so the slider is accessible to screen readers.
- **Do:** Format values with meaningful units like "$50" or "75%" instead of raw numbers.
- **Don't:** Use for precise numeric entry; pair with a text input or use NumberInput instead.
- **Don't:** Set a step size so large that only a few positions are possible; use SegmentedControl or radio buttons instead.
- **Don't:** Wrap a disabled slider in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Accessibility

- **Thumb:** The thumb must have at least 3:1 contrast with the track and the surface behind it. Pointer down is the whole drag: measure the thumb with the pressed overlay applied.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text (always rendered for a11y). **(required)** |
| `value` | `number \| [number, number]` | - | Current value; number for single thumb, [number, number] for range. **(required)** |
| `onChange` | `(value: number) => void \| (value: [number, number]) => void` | - | Fired on value change during drag. |
| `onChangeEnd` | `(value: number) => void \| (value: [number, number]) => void` | - | Fired when drag ends. |
| `min` | `number` | `0` | Minimum value. |
| `max` | `number` | `100` | Maximum value. |
| `step` | `number` | `1` | Step increment. |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Slider orientation. |
| `formatValue` | `(value: number) => string` | - | Custom value formatting fn for display + aria-valuetext. |
| `valueDisplay` | `'tooltip' \| 'text' \| 'none'` | `'tooltip'` | How current value is displayed. |
| `marks` | `Array<{ value: number; label?: string }>` | - | Tick marks at specified positions w/ optional labels. Unfilled marks use the track color; filled marks use the accent color. |
| `minStepsBetweenThumbs` | `number` | `0` | Min steps between thumbs in range mode; prevents overlap. |
| `isDisabled` | `boolean` | `false` | Whether slider is disabled. |
| `htmlName` | `string` | - | HTML name attr; hidden inputs carry the value (two in range mode). |
| `disabledMessage` | `string` | - | Explains why the slider is disabled. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the thumb focusable via aria-disabled (value changes stay blocked). Use this instead of wrapping a disabled Slider in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| `isOptional` | `boolean` | `false` | Whether field is optional. |
| `isRequired` | `boolean` | `false` | Whether field is required. |
| `isLabelHidden` | `boolean` | `false` | Visually hide label. |
| `description` | `string` | - | Description text below label. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Status indicator ({type, message}) for validation feedback. |
| `labelTooltip` | `string` | - | Tooltip text for info icon next to label. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-slider` | `data-orientation`, `data-disabled` | orientation | disabled |
| `cui-slider-control` | `data-orientation`, `data-disabled` | orientation | disabled |
| `cui-slider-track` | `data-orientation` | orientation | - |
| `cui-slider-thumb` | `data-orientation`, `data-disabled` | orientation | disabled |

Override in defineTheme:
```ts
components: {
  'slider': {
    base: { /* CSS properties */ },
    'orientation:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
  'slider-control': {
    base: { /* CSS properties */ },
    'disabled': { /* state-specific */ },
  },
}
```
