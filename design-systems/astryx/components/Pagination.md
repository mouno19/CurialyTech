package: @astryxdesign/core

# Pagination

Pagination lets users step through pages of content. Place it below a table, list, or card grid so users can move forward and backward through results. Pick a variant to match the context: numbered pages for data tables, a count for large lists, compact for tight spaces, or dots for carousels.

**Import:** `import {Pagination} from '@astryxdesign/core/Pagination';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Pagination | Yes | Navigation landmark containing the current paging controls and optional page-size selector. |
| Page-size selector | No | Optional Selector for choosing how many items appear per page. |
| First/last buttons | No | Optional Button controls that jump to the first or last known page. |
| Previous/next buttons | Yes | Button controls that move backward or forward through the pages. |
| Page number button | No | Button for one directly selectable page in the numbered presentation. |
| Ellipsis | No | Visual omission marker between non-adjacent page-number buttons. |
| Count readout | No | Text showing the current item range and total item count. |
| Compact readout | No | Text showing the current page and total page count. |
| Dot | No | Page indicator control that reflects and changes the active page. |
| Page input label | No | Leading visible label for the editable page-number field. |
| Page input | No | NumberInput used to enter a page directly. |
| Page input total | No | Trailing text showing the known total page count. |

## Best Practices

- **Do:** Place pagination below the content it controls so users see results before navigating.
- **Do:** Use the pages variant for data tables where users need to jump to a specific page.
- **Do:** Use the count variant with a page size selector when users need to control how many items they see at once.
- **Do:** Use the dots variant for carousels and walkthroughs where the total is small and position matters more than a number.
- **Do:** Pass totalItems when the total is known so users can see how much content remains.
- **Don't:** Show pagination when all items fit on a single page; there is nothing to paginate.
- **Don't:** Use the dots variant for more than about 10 pages; the dots become too small to be useful.
- **Don't:** Place pagination above the content; users expect it at the bottom.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `page` | `number` | - | Current page number (1-based). **(required)** |
| `onChange` | `(page: number) => void` | - | Called on page change. **(required)** |
| `changeAction` | `(page: number) => void \| Promise<void>` | - | Async action on page change. Fires after onChange; uses React transitions for loading. |
| `totalItems` | `number` | - | Total items. Calculates page count. Precedence over totalPages. |
| `totalPages` | `number` | - | Total pages. Use when page count known but not item count. |
| `hasMore` | `boolean` | - | More pages exist after current. For cursor-based pagination. |
| `pageSize` | `number` | `10` | Items per page; coerced to positive integer, non-finite falls back to default |
| `pageSizeOptions` | `number[]` | - | Page size options. Shows selector dropdown when provided. |
| `onPageSizeChange` | `(pageSize: number) => void` | - | Called on page size change. Auto resets to page 1. |
| `variant` | `'pages' \| 'count' \| 'compact' \| 'dots' \| 'input' \| 'none'` | `'pages'` | Display between prev/next. 'input' = 'Page [n] / N' + first/last. |
| `pageLabel` | `string` | - | Noun before the 'input' box (e.g. 'Page' or 'Row'). Navigation stays page-based. Default localized 'Page'. |
| `hasFirstLast` | `boolean` | `true for 'input'; false for 'compact'` | Show first/last («/») buttons. 'input' default true; 'compact' default false (opt in). Other variants ignore. Omitted when total unknown. |
| `step` | `number` | `1` | Pages the prev/next buttons advance per click. Clamped to range; < 1 or non-integer falls back to 1. |
| `siblingCount` | `number` | `1` | Page buttons each side of current; only variant='pages'. |
| `size` | `'sm' \| 'md'` | `'md'` | Control size. |
| `isDisabled` | `boolean` | `false` | Component disabled. |
| `label` | `string` | `'Pagination'` | Accessible label for nav landmark. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-pagination` | `data-size`, `data-variant` | pages, count, compact, dots, input, none | - |
| `astryx-pagination-dot` | `data-size`, `data-active` | size | active |
| `astryx-pagination-input-label` | `data-size` | size | - |
| `astryx-pagination-input-total` | `data-size` | size | - |

Override in defineTheme:
```ts
components: {
  'pagination': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'pagination-dot': {
    base: { /* CSS properties */ },
    'active': { /* state-specific */ },
  },
}
```
