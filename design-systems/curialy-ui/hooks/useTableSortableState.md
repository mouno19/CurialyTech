package: @curialy/ui

# useTableSortableState

Owns a Table's sort state and sorts the rows locally, as a convenience layer over useTableSortable. Pass the rows in, render sortedData, and hand sortConfig to useTableSortable. The hook keeps the state (or reads it from sort and onSortChange when controlled), so header clicks re-sort the rows with no sort code in the component. With isMultiSortEnabled, Shift+click adds tiebreaker columns. For data sorted on a server, use useTableSortable directly and sort where the data lives.

## Best Practices

- **Do:** Use it when the full data set is in memory, and pass sortedData to Table.
- **Do:** Add a comparator for values whose order is not their string or number value, such as a status rank.
- **Don't:** Use it for server-side or paginated-on-server data; the hook only sorts the rows it is given.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `config` | `UseTableSortableStateConfig<T, TSortKey>` | - | The rows to sort and how the sort state is owned. **(required)** |
| `config.data` | `T[]` | - | Rows to sort. The hook returns a sorted copy and never mutates the array. **(required)** |
| `config.defaultSort` | `Array<{sortKey: TSortKey, direction: 'ascending' \| 'descending'}>` | `[]` | Initial sort state when the hook owns it. Ignored when sort is passed. |
| `config.sort` | `Array<{sortKey: TSortKey, direction: 'ascending' \| 'descending'}>` | - | Controlled sort state. Pass it with onSortChange to own the state yourself. |
| `config.onSortChange` | `(sort: Array<{sortKey: TSortKey, direction: 'ascending' \| 'descending'}>) => void` | - | Called with the next sort state. Required when sort is passed. |
| `config.comparators` | `Partial<Record<TSortKey, (a: T, b: T) => number>>` | - | Ascending comparators per sort key; the hook flips the result for descending. Keys without one compare numbers numerically, compare other values as strings with a numeric collator in the active InternationalizationProvider locale, and put null, undefined and NaN last in ascending order and first in descending. |
| `config.allowUnsortedState` | `boolean` | `true` | Passed to useTableSortable: a third click on a header returns the column to unsorted instead of 'ascending'. |
| `config.isMultiSortEnabled` | `boolean` | `false` | Passed to useTableSortable: Shift+click on a header adds that column as the next sort key, or steps its direction if it is already sorted, instead of replacing the sort. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `sortedData` | `T[]` | A sorted copy of data, memoized on data and the sort state. Ties keep their order in data. |
| `sort` | `Array<{sortKey: TSortKey, direction: 'ascending' \| 'descending'}>` | The current sort state, first entry first. |
| `sortConfig` | `UseTableSortableConfig<TSortKey>` | Pass to useTableSortable(sortConfig) and give the resulting plugin to Table. |
| `applySort` | `(data: T[]) => T[]` | Sorts another array with the current sort state and comparators, for a second data source or a subset. |


Block templates: design_system component <name> --blocks for Table
