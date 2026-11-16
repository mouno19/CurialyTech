package: @astryxdesign/core

# TreeList

An expandable tree structure for displaying hierarchical data with branch connector lines. Use it for file explorers, nested category browsers, or any interface that visualizes parent-child relationships.

**Import:** `import {TreeList} from '@astryxdesign/core/TreeList';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Tree list | Yes | Container that presents the hierarchical tree. |
| Header | No | Caller-provided content that visibly names the tree. |
| Item | Yes | Painted row for one node in the hierarchy. |
| Chevron | No | Expand and collapse control rendered for an Item with children. |
| Chevron glyph | No | Directional symbol rendered by Icon inside a Chevron. |
| Item label | Yes | Primary content that identifies an Item. |
| Item description | No | Secondary text rendered below an Item label. |
| Start content | No | Caller-provided content rendered before an Item label. |
| End content | No | Caller-provided content rendered after an Item label. |
| Guide | No | Connector line that shows parent-child relationships. |

## Best Practices

- **Do:** Provide meaningful labels and icons for each node to make the hierarchy easy to scan.
- **Do:** Pre-expand important branches so users see key content immediately.
- **Do:** Leaf rows reserve space for a chevron column whenever the tree has any expandable item to line up under; only a fully flat tree (no expandable items at all) renders its rows flush. Rely on this rather than nudging indentation with custom CSS.
- **Don't:** Nest more than 4–5 levels deep; flatten the structure or use a different pattern.
- **Don't:** Use a tree for flat, non-hierarchical data; use a List instead.

## Components

### TreeList

Tree list container. Accepts items data + rendering config. Expansion managed internally.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `TreeListItemData[]` | - | Recursive tree item data w/ id, label, optional children + isExpanded, plus optional xstyle/className/style on its row. **(required)** |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | Spacing density for items. |
| `variant` | `'lineGuides' \| 'noGuides'` | `'lineGuides'` | Guide-line treatment: lineGuides shows connectors, noGuides hides them (indent kept). Orthogonal to density. |
| `animatedLayout` | `AnimatedLayout` | - | The handle from useAnimatedLayout({containerRef}). With it, expanding or collapsing a row glides the rows and content after it, up to that container, on one shared motion role instead of jumping, and the shown rows and the chevron move on the same motion. Without it, the content after the row takes its place at once. |
| `header` | `ReactNode` | - | Header content, linked to tree via aria-labelledby. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout. Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-tree-list` | `data-density`, `data-variant` | lineGuides, noGuides | - |
| `astryx-tree-list-item` | `data-density`, `data-selected`, `data-disabled` | density | selected, disabled |
| `astryx-tree-list-chevron` | `data-state` | - | state |
| `astryx-tree-list-item-label` | `data-selected` | - | selected |
| `astryx-tree-list-guide` | - | - | - |

Override in defineTheme:
```ts
components: {
  'tree-list': {
    base: { /* CSS properties */ },
    'density:value': { /* variant-specific */ },
  },
  'tree-list-item': {
    base: { /* CSS properties */ },
    'selected': { /* state-specific */ },
  },
}
```

**Themeable CSS variables** - additional properties that can be overridden in `defineTheme` component overrides.

| CSS Variable | Default | Description |
|-------------|---------|-------------|
| `--tree-list-indent` | `var(--spacing-4)` | Per-level indentation step. Each nesting level indents its rows by this distance, and the guide lines follow it so they stay aligned. Set it on the `tree-list` target to retune the metric (e.g. `var(--spacing-5)` for a wider indent). |
| `--tree-list-row-gap` | `var(--spacing-0-5)` | Vertical gap between adjacent rows. Default `2px` (var(--spacing-0-5)) gives a subtle separation; set it on the `tree-list` target to widen or close the gap. The connector guides span the gap automatically (the line stays continuous) and do not overhang the last row, so no guide-height tuning is needed. |
