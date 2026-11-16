package: @astryxdesign/core

# Step

Individual step within a Stepper. Renders a progress-bar segment, an indicator, and a label with optional description. Progress (completed/active/not-started) is derived from the parent Stepper's activeStep and this step's step index.

**Import:** `import {Step} from '@astryxdesign/core/Stepper';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `step` | `number` | - | Zero-based index of this step. Used to derive progress (completed/active/not-started) relative to the parent activeStep. **(required)** |
| `label` | `string` | - | Step label text. Kept to a single line and ellipsized when the step is narrower than the label, so a row of horizontal steps stays the same height and the track under them stays straight. The full string is still read out as part of the step, so a truncated label costs nothing in the accessible name — but short labels survive narrow layouts better. **(required)** |
| `description` | `string` | - | Optional description shown below the label for additional context. |
| `children` | `ReactNode` | - | Content rendered below the label and description. Useful in vertical steppers for form fields or detailed step content. In a compact horizontal Stepper, the content remains mounted to preserve local state while it is hidden with the expanded step details. |
| `status` | `'accent' \| 'success' \| 'warning' \| 'error'` | - | Semantic color for the step. Controls color only and maps to the global Astryx semantic tokens. Leave unset for the progress-derived default coloring. |
| `indicator` | `'auto' \| 'number' \| 'none' \| ReactNode` | `'auto'` | What to show as the step indicator. 'auto' shows a number until completed then a check, 'number' always shows a numbered badge, 'none' hides it, or pass any ReactNode (e.g. an Icon) for a fully custom indicator. |
| `isDisabled` | `boolean` | `false` | Disables interaction and dims the step indicator and label. |
| `isOptional` | `boolean` | `false` | Marks the step as optional, appending an "Optional" affordance after the label. |
| `endContent` | `ReactNode` | - | Trailing content rendered at the end of the label row. |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | - | Controls vertical padding of the step. Falls back to the stepper-level density when unset. |
