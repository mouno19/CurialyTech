package: @astryxdesign/core

# TableSelectionToolbar

Selection-aware Toolbar wrapper. Consumes selectionState from useTableSelectionState, or an app-built state for a selection across server pages; owns count, clear, visibility, and Toolbar semantics. Caller owns actions and fixed/floating placement.

**Import:** `import {TableSelectionToolbar} from '@astryxdesign/core/Table';`

## Best Practices

- **Do:** Pass selectionState directly from useTableSelectionState so the count and clear action stay synchronized with row selection, unless the app keeps its own selection across server pages.
- **Do:** Provide product actions as startContent instead of encoding them as configuration objects.
- **Don't:** Inject the toolbar through the Table plugin or its horizontal scroll wrapper.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `selection` | `TableSelectionState` | - | selectionState from useTableSelectionState, or app-built: selectedKeys/count/presence + complete clear command **(required)** |
| `startContent` | `ReactNode` | - | product-owned bulk action controls |
| `label` | `string` | `Bulk actions` | accessible toolbar name; defaults to Bulk actions |
| `renderSelectionLabel` | `(selectedCount: number) => ReactNode` | `count => `${count} selected`` | override visible count copy; receives selectedCount |
| `clearLabel` | `string` | `Unselect All` | complete-clear button label; defaults to Unselect All |
| `size` | `'sm' \| 'md' \| 'lg'` | `sm` | Toolbar size; defaults to sm and cascades to child controls |
| `variant` | `SectionVariant` | `muted` | Toolbar surface; defaults to muted |
| `xstyle` | `StyleXStyles` | - | caller-owned layout/positioning styles |

## Examples

### Select every matching row across server pages

```tsx

// The rows load one server page at a time. The app keeps the selection as
// "every matching row, minus the ones the person unticked", so rows on pages
// that never loaded are selected too. Table and the toolbar only show it.
const [isAllMatching, setIsAllMatching] = useState(false);
const [picked, setPicked] = useState(new Set()); // chosen one by one
const [excluded, setExcluded] = useState(new Set()); // unticked in all mode

const isSelected = row =>
  isAllMatching ? !excluded.has(row.id) : picked.has(row.id);
const isPageSelected = pageRows.every(isSelected);
const selectedCount = isAllMatching ? total - excluded.size : picked.size;

const selectionPlugin = useTableSelection({
  getIsItemSelected: isSelected,
  // setRows adds to or removes from excluded in all mode, picked otherwise.
  onSelectItem: ({item, isSelected}) => setRows([item], isSelected),
  onSelectAll: ({isAllSelected}) => setRows(pageRows, isAllSelected),
  getIsAllSelected: () => isPageSelected,
});

<TableSelectionToolbar
  selection={{
    // Only the loaded rows: the full set is not on the client.
    selectedKeys: new Set(pageRows.filter(isSelected).map(row => row.id)),
    selectedCount, // the app's own count
    hasSelection: selectedCount > 0,
    clearSelection: () => {
      setIsAllMatching(false);
      setPicked(new Set());
      setExcluded(new Set());
    },
  }}
  renderSelectionLabel={count =>
    !isAllMatching
      ? count + ' selected'
      : excluded.size === 0
        ? 'All ' + total + ' matching selected'
        : count + ' of ' + total + ' matching selected'
  }
  startContent={
    <>
      <Button label="Archive" variant="ghost" onClick={archive} />
      {/* Beside the action, not in its place. Once used, the offer stays as
          the command that undoes it, so focus stays on it and a second
          press can never run Archive. */}
      {isAllMatching || isPageSelected ? (
        <Button
          label={
            isAllMatching
              ? 'Select only this page'
              : 'Select all ' + total + ' matching'
          }
          variant="ghost"
          onClick={() => {
            if (isAllMatching) {
              // Every row on this page, so the label stays true and the
              // focused button stays mounted.
              setPicked(new Set(pageRows.map(row => row.id)));
              setExcluded(new Set());
            }
            setIsAllMatching(!isAllMatching);
          }}
        />
      ) : null}
    </>
  }
/>;
// In this mode the toolbar's selectedKeys holds only the loaded rows, and
// the count comes from the app. For a bulk action, send the server the
// query and the excluded ids, not a list of selected ids.

```
