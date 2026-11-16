package: @astryxdesign/core

# OverflowList

A horizontal list that automatically hides items when they exceed the available width. Use OverflowList for breadcrumbs, toolbars, tag lists, or any row that needs to collapse gracefully at smaller sizes.

**Import:** `import {OverflowList} from '@astryxdesign/core/OverflowList';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| List | Yes | Visible horizontal list container for the currently shown content. |
| Items | Yes | Caller-supplied items selected for visible display by the current width and count limits. |
| Overflow indicator | No | Optional caller-rendered indicator for items collapsed by width or count limits. |

## Best Practices

- **Do:** Provide a meaningful overflowRenderer: a "+N more" badge, a dropdown, or a count indicator.
- **Do:** When the row already has its own menu, use onOverflowChange to feed the collapsed items into it instead of adding a second anchor with overflowRenderer.
- **Do:** Set minVisibleItems to keep key items visible, and maxVisibleItems to cap the row at a fixed count regardless of available width.
- **Do:** Use maxRows to let items wrap onto a bounded number of rows (e.g. a two-row tag cloud) before collapsing the rest into the indicator.
- **Don't:** Use OverflowList for a vertical stack; horizontal multi-row wrap is supported via maxRows, but items still flow left-to-right, not top-to-bottom.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | items to render, each child should be a single element **(required)** |
| `overflowRenderer` | `(overflowItems: OverflowItem[]) => ReactNode` | - | renders overflow indicator, receives hidden items w/ index |
| `onOverflowChange` | `(overflowItems: OverflowItem[]) => void` | - | fires w/ collapsed items when membership/order changes (empty once the row fits again); ignores unrelated renders/callback identity; stable React keys required for dynamic items |
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `2` | item gap as spacing step |
| `minVisibleItems` | `number` | `0` | min items always shown even when overflowing |
| `maxVisibleItems` | `number` | `undefined (no cap)` | max items ever shown (cap); extra items collapse to indicator; min wins if smaller |
| `maxRows` | `number` | `undefined (single line)` | wrap items across up to N rows then collapse rest (number, not boolean); undefined = single line |
| `collapseFrom` | `'start' \| 'end'` | `'end'` | which end to collapse from |
| `behavior` | `'observeSelf' \| 'observeParent'` | `'observeSelf'` | observeSelf (default) or observeParent for content-sized containers |
| `xstyle` | `StyleXStyles` | - | StyleX styles, use stylex.create() values only |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-overflow-list` | - | - | - |

Override in defineTheme:
```ts
components: {
  'overflow-list': {
    base: { /* CSS properties */ },
  },
}
```
