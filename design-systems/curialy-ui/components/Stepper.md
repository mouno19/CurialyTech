package: @curialy/ui

# Stepper

Steppers show progress through numbered steps. Use for forms, onboarding, checkout.

**Import:** `import {Stepper} from '@curialy/ui/Stepper';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Stepper | Yes | The ordered list holding the steps. Owns the orientation and the indicator placement the whole flow is laid out on. |
| Frame | Yes | The layout frame that groups the ordered steps with the optional compact summary shown at narrow widths. |
| Compact summary | No | The optional row a horizontal Stepper adds directly beneath the track once it is too narrow to label every step. horizontalOptions.collapsedVariant chooses a label with Previous/Next controls, the label alone, or no row for a bare progress track. The on-track layout keeps its indicators on the rail instead of repeating the active indicator beside the label. Every step keeps its name in the accessible sequence at any width. |
| Step | Yes | One step in the flow, and the element carrying its status. Wraps the indicator, label, description, and the track segments belonging to it. |
| Progress bar | Yes | A 4px segmented bar per step. Filled for completed and active steps. Advancing one step grows the fill along the track it just covered, so the movement reads as progress rather than a bar changing color. Every other change applies at once: going back, jumping forward by more than one step, mounting mid-flow, and any change at all under prefers-reduced-motion. Where a span is drawn by more than one segment (the on-track layouts split it between two steps, three when a content slot sits between them), the segments run in track order at one constant speed, so the fill reads as a single line growing rather than pieces lighting in turn. |
| Connector | No | The track drawn between indicators in the on-track layouts. Each connector paints an unfilled line and, over it, the accent fill covering the progress made. How many pieces a connector is drawn from is an implementation detail of the layout, not a themeable part; use --step-connector-gap to hold the track off the indicator. |
| Indicator | No | A numbered badge, a check, or any custom icon. Controlled via the indicator prop. |
| Label | Yes | Text identifying the step. |
| Description | No | Supporting text below the label with additional context. |

## Best Practices

- **Do:** Keep step labels short. Horizontal collapses under horizontalOptions.minimumStepWidth per step (112px by default); vertical is for long descriptions.
- **Do:** Choose horizontalOptions.collapsedVariant when the page owns its own Back/Continue, or both its step heading and navigation.
- **Do:** Provide onStepClick for non-linear workflows.
- **Don't:** Use for fewer than 3 or more than 7 steps.

## Components

### Stepper

container managing step state w/ horizontal/vertical layout

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `activeStep` | `number` | - | zero-based active step index **(required)** |
| `children` | `ReactNode` | - | Step elements **(required)** |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | horizontal or vertical layout |
| `onStepClick` | `(index: number) => void` | - | enables non-linear navigation; summary controls own compact navigation and skip disabled steps |
| `label` | `string` | `'Progress' (localized)` | ordered-list aria-label |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | padding of all steps |
| `indicatorPosition` | `'separated' \| 'on-track'` | `'separated'` | indicators separated from or on the track |
| `horizontalOptions` | `{ minimumStepWidth: number; collapsedVariant: 'withLabelAndControls' \| 'withLabel' \| 'hiddenLabel' }` | `{ minimumStepWidth: 112, collapsedVariant: 'withLabelAndControls' }` | horizontal collapse threshold and label/control presentation |
| `xstyle` | `StyleXStyles` | - | StyleX layout customization |

### Step

individual step w/ progress bar, indicator, label

See `design_system component Step` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-stepper` | `data-orientation`, `data-indicator-position` | orientation, indicatorPosition | - |
| `cui-stepper-frame` | - | - | - |
| `cui-stepper-summary` | - | - | - |
| `cui-step` | `data-progress`, `data-status` | progress, status | - |
| `cui-step-indicator` | `data-progress`, `data-status`, `data-disabled` | progress, status, disabled | - |
| `cui-step-label` | `data-progress`, `data-status`, `data-disabled` | progress, status, disabled | - |
| `cui-step-description` | `data-progress`, `data-status` | progress, status | - |
| `cui-step-bar` | - | - | - |
| `cui-step-connector` | - | - | - |

Override in defineTheme:
```ts
components: {
  'stepper': {
    base: { /* CSS properties */ },
    'orientation:value': { /* variant-specific */ },
  },
  'stepper-frame': {
    base: { /* CSS properties */ },
  },
}
```

**Themeable CSS variables** - additional properties that can be overridden in `defineTheme` component overrides.

| CSS Variable | Default | Description |
|-------------|---------|-------------|
| `--step-connector-gap` | `0px` | Gap a connector leaves where it meets the indicator, spent on the side facing it. Applies to the on-track layouts, whose connector is drawn as one segment either side of the node; 0 leaves the track running unbroken through it. |
