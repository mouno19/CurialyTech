package: @astryxdesign/core

# FormLayout

A layout container that arranges form fields with consistent spacing and direction. FormLayout handles where fields go, not state or submission. Wrap it in a native <form> for that; <form> has no Astryx replacement, so it stays a plain element. Supports vertical (default), horizontal, and horizontal-labels directions, and can be nested to mix them.

**Import:** `import {FormLayout} from '@astryxdesign/core/FormLayout';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Layout container | Yes | Owns field arrangement, spacing, direction, and form-level optionality. |
| Form title | No | Heading that describes the purpose of the form. |
| Fields | Yes | Input components with labels for collecting user data. |
| Footer | No | Contains confirmation buttons such as Submit or Cancel. |

## Best Practices

- **Do:** Stack fields vertically for most forms. It's the easiest to scan top to bottom.
- **Do:** Nest a horizontal FormLayout inside a vertical one when fields naturally pair up, like First Name + Last Name or City + State + ZIP.
- **Do:** Use horizontal-labels for settings pages where labels sit beside their inputs.
- **Don't:** Use FormLayout for form state or submission. It's just layout. Wrap it in a native <form> for that.
- **Don't:** Put unrelated fields side by side in a horizontal layout. Save it for fields that belong together.
- **Don't:** Nest horizontal-labels inside another FormLayout. It uses CSS Grid and needs to be the outermost container.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'vertical' \| 'horizontal' \| 'horizontal-labels'` | `'vertical'` | Field arrangement. Vertical stacks top-to-bottom; horizontal uses one fractional grid track per field in logical inline order; horizontal-labels places labels on the inline-start side and collapses when the viewport is <=480px. |
| `defaultOptionality` | `'optional' \| 'required'` | - | State the form treats as default, so only the exception is marked. "optional" → only isRequired fields show an indicator; "required" → only isOptional fields do. Under "required" unmarked fields also expose aria-required (aria only, not native required), except CheckboxInput, Switch and CheckboxList, which take no required state from it (CheckboxInput and Switch are required only through their own isRequired). Unset = per-field behavior. |
| `defaultEntryErrorBehavior` | `'complete' \| 'blur-or-enter'` | - | 'complete'\|'blur-or-enter': when DateInput/DateTimeInput/TimeInput/NumberInput fields show their own rejections (not when validation runs; not React Aria validationBehavior; never changes status). blur-or-enter: message, aria-invalid, styling, announcement, onEntryErrorChange report wait for Enter/blur; valid or empty entry clears at once. NumberInput waits under both. Field prop wins; nested FormLayout replaces it (unset = complete); layers start without it. Unset = complete. |
| `children` | `ReactNode` | - | Form fields to arrange. Accepts Astryx inputs + Field-wrapped custom controls. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-form-layout` | `data-direction` | direction | - |

Override in defineTheme:
```ts
components: {
  'form-layout': {
    base: { /* CSS properties */ },
    'direction:value': { /* variant-specific */ },
  },
}
```
