package: @astryxdesign/core

# SelectableCard

Card toggling between selected/unselected states w/ accent border. For navigation use ClickableCard instead.

**Import:** `import {SelectableCard} from '@astryxdesign/core/SelectableCard';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | Interactive div with accent border on selection. |
| Content | Yes | Children rendered inside the card. |

## Best Practices

- **Do:** Use for multi-select choices: filter chips, add-ons, option grids.
- **Do:** Use for multi-select groups; track selected IDs in a Set.
- **Do:** When focused, toggle selection with Space or Enter.
- **Don't:** Use for navigation; use ClickableCard instead.
- **Don't:** Use for single-select: each card is a checkbox, so screen readers announce multi-select.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | accessibility label **(required)** |
| `isSelected` | `boolean` | - | controlled selection state **(required)** |
| `onChange` | `(isSelected: boolean) => void` | - | called when toggled **(required)** |
| `isDisabled` | `boolean` | `false` | disables card |
| `children` | `ReactNode` | - | Card content. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `4` | inner padding |
| `variant` | `'default' \| 'transparent' \| 'muted' \| 'blue' \| 'cyan' \| 'gray' \| 'green' \| 'orange' \| 'pink' \| 'purple' \| 'red' \| 'teal' \| 'yellow'` | `'default'` | background color variant |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth: none\|low\|med\|high; selection ring composes on top |
| `width` | `SizeValue` | - | card width |
| `height` | `SizeValue` | - | card height |
| `maxWidth` | `SizeValue` | - | max card width |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-selectable-card` | `data-selected`, `data-variant` | default, transparent, muted, blue, cyan, gray, green, orange, pink, purple, red, teal, yellow | - |

Override in defineTheme:
```ts
components: {
  'selectable-card': {
    base: { /* CSS properties */ },
    'selected:value': { /* variant-specific */ },
  },
}
```

**Themeable CSS variables** - additional properties that can be overridden in `defineTheme` component overrides.

| CSS Variable | Default | Description |
|-------------|---------|-------------|
| `--selectable-card-ring-color` | `var(--color-accent)` | Colour of the selection ring drawn for a variant a theme added. The built-in variants each ring in their own border token and ignore this; a theme that adds a variant sets it in the same rule as that variant's `backgroundColor`, because no token the component could pick is guaranteed to contrast with a fill it cannot know. |
