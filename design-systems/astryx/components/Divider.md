package: @astryxdesign/core

# Divider

A visual separator that divides content into distinct sections. Use to create clear boundaries between groups of related content, or to demarcate interactive regions within a layout.

**Import:** `import {Divider} from '@astryxdesign/core/Divider';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Divider group | Yes | Separator group that arranges one or two rules around an optional label. |
| Rule | Yes | Painted line segment; a second segment renders when a label is present. |
| Label | No | Optional content displayed between two rule segments. |

## Best Practices

- **Do:** Use subtle dividers between related content sections and strong dividers for high-contrast boundaries.
- **Do:** Add a label to the divider when sections need a visible category heading.
- **Don't:** Overuse dividers; rely on spacing and layout to separate content when possible.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | divider orientation |
| `label` | `ReactNode` | - | optional centered label; preserves 0; null/boolean/"" omit it |
| `variant` | `'subtle' \| 'strong'` | `'subtle'` | visual weight of divider line |
| `isFullBleed` | `boolean` | `false` | extend to container edges w/ negative margins |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout; must be stylex.create() value |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-divider` | `data-orientation`, `data-variant` | subtle, strong | - |

Override in defineTheme:
```ts
components: {
  'divider': {
    base: { /* CSS properties */ },
    'orientation:value': { /* variant-specific */ },
  },
}
```
