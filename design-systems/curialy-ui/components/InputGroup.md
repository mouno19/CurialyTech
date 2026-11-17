package: @curialy/ui

# InputGroup

InputGroup connects an input with addons. Use for URL fields, currency inputs, search with actions.

**Import:** `import {InputGroup} from '@curialy/ui/InputGroup';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text above the group. |
| Prefix addon | No | Content before the input (text, icon, or button). |
| Input | Yes | The main input element (TextInput, NumberInput, TimeInput, DateInput, Typeahead, Tokenizer, Selector, or MultiSelector). |
| Suffix addon | No | Content after the input (text, icon, or button). |
| Status message | No | An error, warning, or success message below the group. |

## Best Practices

- **Do:** Use text addons to show units, prefixes, or suffixes that clarify input format (e.g. "$", "kg", "https://").
- **Do:** Use InputGroupText for static prefixes/suffixes like "$", "kg", or "https://".
- **Do:** Use Button for an action attached to the input; InputGroup connects its corners automatically.
- **Do:** Use InputGroup with compatible single-line inputs: TextInput, NumberInput, TimeInput, DateInput, Typeahead, Tokenizer, Selector, and MultiSelector.
- **Do:** Keep each inner input's label specific; grouped inputs combine the group label with their own label and inherit group description/status.
- **Do:** Keep multi-value controls (Tokenizer, MultiSelector) short inside a group; the group row is fixed-height and single-line.
- **Don't:** Don't put multiple text inputs in one group; use separate fields instead.
- **Don't:** Don't use InputGroup for unrelated inputs; it's for a single input with decorations.
- **Don't:** Don't use InputGroup with TextArea, Slider, Switch, CheckboxInput, or RadioList.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | InputGroupText, Button addons, and compatible input children: TextInput, NumberInput, TimeInput, DateInput, Typeahead, Tokenizer, Selector, or MultiSelector. **(required)** |
| `label` | `string` | - | Accessible label for the group. **(required)** |
| `isLabelHidden` | `boolean` | `false` | Visually hide the label. |
| `description` | `string` | - | Helper text between label and input group. |
| `isDisabled` | `boolean` | `false` | Disable the entire group. |
| `isOptional` | `boolean` | `false` | Show the "Optional" indicator after the label. |
| `isRequired` | `boolean` | `false` | Mark the field as required. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Default size for inputs in the group. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Validation status. Its message shows below the group. The group border does not change; a theme can style the row from `data-status`. |
| `labelTooltip` | `string` | - | Tooltip text at the end of the label. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. |
| `data-testid` | `string` | - | Test selector. |

## Components

### InputGroupText

See `design_system component InputGroupText` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-input-group` | `data-size`, `data-status` | size, status | - |
| `cui-input-group-text` | - | - | - |

Override in defineTheme:
```ts
components: {
  'input-group': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'input-group-text': {
    base: { /* CSS properties */ },
  },
}
```
