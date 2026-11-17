package: @curialy/ui

# EmptyState

EmptyState shows a placeholder for empty lists, zero search results, first-time setups. Always include a title and next step.

**Import:** `import {EmptyState} from '@curialy/ui/EmptyState';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | The centered root that owns spacing, reading order, and the compact layout variant. |
| Icon | No | A visual cue above the title that reinforces the context, like a search icon for no results. |
| Title | Yes | Primary message explaining what is empty: "No projects yet" not "No data". |
| Description | No | Additional context explaining why it is empty or what the user can do. |
| Actions | No | One or two buttons guiding the user to a next step, like "Create project" or "Clear filters". |

## Best Practices

- **Do:** Include a clear title + call-to-action button so users know how to proceed.
- **Do:** Use an illustration or icon that reinforces the context of the empty state.
- **Do:** Use the compact variant inside cards or sidebars where space is limited.
- **Don't:** Leave an empty state without guidance; always explain what happened and what user can do next.
- **Don't:** Use a generic message like "No data"; be specific about what is empty and why.
- **Don't:** Use an EmptyState for error messages that require immediate action; use a Banner instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | - | Primary msg rendered as heading (h1-h6) inside empty state. **(required)** |
| `description` | `string` | - | Optional secondary text w/ additional context below title. |
| `icon` | `ReactNode` | - | Optional icon/illustration above title; rendered decorative (aria-hidden="true"). |
| `actions` | `ReactNode` | - | Optional action buttons below description; horizontal by default, vertical when isCompact. |
| `headingLevel` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | `3` | Controls only HTML heading tag (h1-h6) for document outline; does not change visual title size. |
| `isCompact` | `boolean` | `false` | Enables compact variant w/ reduced spacing for constrained areas. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-empty-state` | `data-variant` | variant | - |
| `cui-empty-state-title` | `data-variant` | variant | - |
| `cui-empty-state-description` | `data-variant` | variant | - |

Override in defineTheme:
```ts
components: {
  'empty-state': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
  'empty-state-title': {
    base: { /* CSS properties */ },
  },
}
```
