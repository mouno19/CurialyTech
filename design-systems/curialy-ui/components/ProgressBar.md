package: @curialy/ui

# ProgressBar

A horizontal bar showing the completion progress of a task. Use it for operations where the duration is known, or as an animated indicator when progress can't be calculated. Supports semantic color variants, value labels, and custom formatting. Under a finger a new value animates as on iOS: linearly, in proportion to how far it moves (a full track takes one second at the theme's default tempo), and the fill keeps a minimum visible length above zero.

**Import:** `import {ProgressBar} from '@curialy/ui/ProgressBar';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Progress bar | Yes | Container arranging the label row and progress track. |
| Label | Yes | Text naming the operation, optionally hidden visually while remaining accessible. |
| Value text | No | Formatted determinate value shown beside the label when requested. |
| Track | Yes | Remaining-progress rail that carries the progressbar semantics. |
| Fill | Yes | Painted segment showing completed progress or indeterminate movement. |
| Mark | No | Labeled target tick positioned on a determinate track. |

## Best Practices

- **Do:** Use a determinate bar when the total amount of work is known, and indeterminate when it's not.
- **Do:** Choose a color variant that matches the context: accent for general progress, success for completion, warning or error for alerts.
- **Do:** Always provide a label, even if hidden; screen readers need it to announce what's loading.
- **Don't:** Place icons or labels inside the bar; compose them alongside it using layout components.
- **Don't:** Use a progress bar for instant actions; it's meant for operations that take noticeable time.
- **Don't:** Use multiple progress bars stacked together for the same operation; use one bar with a value label instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | accessible label **(required)** |
| `value` | `number` | `0` | Current value (ignored when indeterminate). |
| `max` | `number` | `100` | Maximum value. |
| `isLabelHidden` | `boolean` | `false` | Visually hide label (remains accessible). |
| `hasValueLabel` | `boolean` | `false` | Show formatted value text (ignored when indeterminate). |
| `formatValueLabel` | `(value: number, max: number) => string` | - | Custom value label formatter; defaults to percentage string. |
| `variant` | `'accent' \| 'success' \| 'warning' \| 'error' \| 'neutral'` | `'accent'` | Semantic color variant. |
| `isIndeterminate` | `boolean` | `false` | Animated loading indicator for unknown progress. Under reduced motion it pulses in place instead of sliding. |
| `marks` | `ReadonlyArray<{value: number; label: string}>` | - | Fixed target marks ({value, label?}) drawn on the track in the 0..max scale; stay visible past the fill. Marks inside the fill take the variant on-color; marks on the bare track take the primary text color (secondary when disabled). A label reveals a tooltip on hover/focus. Ignored when indeterminate. |
| `isDisabled` | `boolean` | `false` | Visually disabled: grays out fill and text. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-progress-bar` | `data-variant` | accent, success, warning, error, neutral | - |
| `cui-progress-bar-fill` | `data-variant` | accent, success, warning, error, neutral | - |
| `cui-progress-bar-track` | - | - | - |
| `cui-progress-bar-mark` | `data-variant`, `data-placement` | accent, success, warning, error, neutral | - |

Override in defineTheme:
```ts
components: {
  'progress-bar': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
  'progress-bar-fill': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  progress-bar: {
    base: {
      width: '...',
      height: '...',
    },
  },
}
```
