package: @astryxdesign/core

# Table

Table displays structured data in rows and columns with consistent dimensionality. It supports rich cell content, sorting, selection, pagination, and column management through a composable plugin system. Use Table for data sets with uniform structure; for simpler or inconsistent data, consider a list or card layout instead.

**Import:** `import {Table} from '@astryxdesign/core/Table';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Table | Yes | Semantic table element that groups the table sections, rows, and cells. |
| Scroll region | Yes | Outer region that scrolls horizontally when columns overflow. Fixed-height virtualization also enables block scrolling; the region enters keyboard order while either applicable axis overflows. |
| Header section | No | Column-heading section generated when data-driven columns are present or supplied with TableHeader in children mode. |
| Column header cell | No | Cell that identifies one column and may contain sorting or bulk-selection controls. |
| Sort control | No | Button that wraps a sortable column label and changes that column's sort direction. |
| Sort indicator glyph | No | Directional symbol rendered by Icon inside a Sort control. |
| Sort priority | No | Number shown for a sorted column when multi-column sorting is active. |
| Selection control | No | CheckboxInput rendered in the header and selectable body rows by the selection plugin. |
| Body section | Yes | Section containing data rows or the current empty state; data-driven mode renders it automatically. |
| Row | No | Repeated TableRow that groups cells in a standard header, body, or footer row. |
| Cell | No | TableCell containing one value or caller-provided content in a standard body or footer row. |
| Default empty state | No | Compact EmptyState shown for an empty data array unless it is replaced or disabled. |
| Expansion control | No | Button in a leading cell that expands or collapses one expandable row. |
| Expansion glyph | No | Directional symbol rendered by Icon inside an Expansion control. |
| Expanded detail panel | No | Detail row and spanning cell rendered below an expanded row around caller-provided content. |
| Footer section | No | Optional summary or totals section supplied with TableFooter in children mode. |

## Best Practices

- **Do:** Use density and divider variants to match the information density and scanning needs of your data.
- **Do:** Compose rich cell content with Astryx components like Badge, StatusDot, and Avatar via renderCell.
- **Do:** Children mode: wrap rows in TableHeader/TableBody/TableFooter. <table> cannot hold a <tr> directly; the parser adds an implied <tbody> for SSR markup, React does not on the client, so unwrapped rows mismatch on hydration.
- **Do:** Omitted width = equal flex w/ compact 60px readability floor. Per-column floor: proportional(1, {minWidth}). Weighted: proportional(n). Fixed: pixel(). Table scrolls when combined floors do not fit.
- **Do:** Data-driven API is RSC-safe: proportional(), pixel(), column defs w/o function props work in Server Components. renderCell (any function prop) requires a "use client" wrapper.
- **Don't:** Use a table for data without consistent columns. Use a list or card layout for heterogeneous content.
- **Don't:** Enable every plugin at once. Add only the features your use case requires to keep the interface focused.
- **Don't:** Rely on the 60px omitted-width floor for a text-heavy column that needs more room; set proportional(1, {minWidth}) on it instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `T[]` | - | Array of data items to render as rows. T must extend Record<string, unknown> (use `interface MyRow extends Record<string, unknown>` for custom types). |
| `columns` | `TableColumn<T>[]` | - | Column definitions: each column has {key, header, width?, align?, renderCell?}. The `header` field sets the column heading text. If omitted, columns are auto-generated from data object keys. The `width` field is typed as `ColumnWidth` (not a number); use `proportional(n)` or `pixel(n)` helpers imported from `@astryxdesign/core/Table`. Omitting `width` keeps an equal flexible share with a compact 60px readability floor. To give one column a different floor, set `width: proportional(1, {minWidth: 80})`; its `minWidth` replaces the 60px floor for that column. Example: `width: pixel(120)` for 120px fixed, `width: proportional(1)` for a flexible column with a 120px default minimum. |
| `idKey` | `(keyof T & string) \| ((item: T) => string \| number)` | - | Canonical row identity: a property name projects valid strings and finite numbers to strings; a function retains string/number type. Optional legacy tables fall back to index. Virtualization requires explicit unique valid keys. |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | Row density controlling cell padding and font size. |
| `dividers` | `'rows' \| 'columns' \| 'grid' \| 'none'` | `'rows'` | Divider style rendered between cells. |
| `isStriped` | `boolean` | `false` | Applies a background wash to even-numbered rows. |
| `hasHover` | `boolean` | `false` | Applies a hover highlight background to rows on pointer devices. |
| `verticalAlign` | `'middle' \| 'top' \| 'bottom'` | `'middle'` | Vertical alignment for body row cells. Controls `vertical-align` on the `<td>` elements. |
| `textOverflow` | `'wrap' \| 'truncate'` | `'wrap'` | How body cell text behaves when it exceeds the column width. 'wrap' lets text wrap and the row grow taller; 'truncate' clips with an ellipsis (default-rendered cells show a tooltip on hover when truncated). Header cells always truncate. |
| `virtualization` | `TableVirtualizationCapability \| TableVirtualizationCapability[]` | - | Geometry-only capability from useTableRowsVirtualization or useTableColumnsVirtualization, or a list with at most one of each; any other list renders without windowing. useTableColumnsVirtualization({initialViewportWidth}) mounts only the unpinned columns near the viewport. useTableRowsVirtualization({rowHeight, initialViewportHeight}) takes sizes that are both positive finite CSS pixels; the Table scrolls inside the height its parent gives it, and initialViewportHeight only sizes the first window. Give the Table's parent a height, fixed or relative, or a flex child, so windowing can bound the rows; with no height every row renders. Pass complete flat data and an explicit idKey. Default text truncates; custom renderers, wrapping, structural plugins, incompatible offsets, invalid identity or unrepresentable geometry use full rendering. Logical row positions include the header. |
| `plugins` | `Record<string, TablePlugin<T>>` | - | Named plugins that extend table behavior via the transform pipeline. Converted to an ordered array internally. |
| `rowIndexStart` | `number` | `1` | ARIA row index (1-based) for the first rendered body row. The row ordinal is an accessibility concern independent of any visible index column, so setting this (or rowCount) makes the table emit aria-rowindex on body rows and aria-rowcount on the table. For a paginated/windowed view, pass the offset of the first visible row (e.g. (page - 1) * pageSize + 1) so aria-rowindex reflects position in the full dataset. Data-driven mode only. |
| `rowCount` | `number` | - | Total number of body rows across all pages/windows, used for aria-rowcount so assistive tech can announce "row X of Y" against the full dataset. When omitted but rowIndexStart is set (windowed view with an unknown total), aria-rowcount is set to -1 per the ARIA unknown-count convention. Data-driven mode only. |
| `children` | `ReactNode` | - | Children mode: compose the table yourself from TableHeader / TableBody / TableFooter, each holding TableRow and TableCell, instead of using data-driven rendering. The children are passed straight to the <table>, so the section is yours to supply. A TableRow placed directly in Table emits <table><tr>, which is invalid HTML and mismatches on hydration (the parser inserts an implied <tbody> for server-rendered markup; React does not on the client). Data-driven mode renders the sections for you. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Components

### TableHeader

See `astryx component TableHeader` for props and usage.

### TableBody

See `astryx component TableBody` for props and usage.

### TableFooter

See `astryx component TableFooter` for props and usage.

### TableRow

See `astryx component TableRow` for props and usage.

### TableCell

See `astryx component TableCell` for props and usage.

### TableHeaderCell

See `astryx component TableHeaderCell` for props and usage.

### useTableSelection

See `astryx component useTableSelection` for props and usage.

### useTableSelectionState

See `astryx component useTableSelectionState` for props and usage.

### TableSelectionToolbar

See `astryx component TableSelectionToolbar` for props and usage.

### useTableSortable

See `astryx component useTableSortable` for props and usage.

### useTableTreeData

See `astryx component useTableTreeData` for props and usage.

### useTableTreeState

See `astryx component useTableTreeState` for props and usage.

### useTablePagination

See `astryx component useTablePagination` for props and usage.

### useTableColumnSettings

See `astryx component useTableColumnSettings` for props and usage.

### useTableFiltering

See `astryx component useTableFiltering` for props and usage.

### useTableFilterState

See `astryx component useTableFilterState` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-table` | - | - | - |
| `astryx-table-scroll-wrapper` | - | - | - |
| `astryx-table-header` | - | - | - |
| `astryx-table-body` | - | - | - |
| `astryx-table-footer` | - | - | - |
| `astryx-table-row` | - | - | - |
| `astryx-table-cell` | `data-density` | density | - |
| `astryx-table-header-cell` | `data-density` | density | - |

Override in defineTheme:
```ts
components: {
  'table': {
    base: { /* CSS properties */ },
  },
  'table-scroll-wrapper': {
    base: { /* CSS properties */ },
  },
}
```

**Component icon slots** - set in `defineTheme({componentIcons})` to a shared icon name, `null`, a partial `{icon, variant, size}` request, or a function of the slot state.

| Slot | State | Fallback | Role | `null` |
|------|-------|----------|------|--------|
| `table-sort-indicator` | `direction: 'ascending' \| 'descending' \| 'none'` The column's sort direction; `none` while the column is not sorted. | `arrowUp` ascending; `arrowDown` descending; `arrowsUpDown` unsorted | The sort direction glyph beside a sortable column's label (`useTableSortable`). | Hides the glyph. The Sort control keeps its label and its click and keyboard sorting; the column header keeps `aria-sort`. |
| `table-row-expand` | `expanded: boolean` True while the row's detail panel is open. | `chevronRight`, turned while expanded | The glyph in a row's expansion toggle (`useTableRowExpansion`). The toggle turns the glyph a quarter turn while the row is expanded and mirrors it in right-to-left layouts, so map a glyph that points toward the inline end. | Hides the glyph. The toggle keeps its size, its "Expand row" or "Collapse row" name, `aria-expanded`, and its click and keyboard toggling. |
