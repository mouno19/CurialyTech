package: @astryxdesign/core

# BaseTypeahead

Composable combobox engine providing a bare input and a styled result dropdown. Callers own input chrome and selected-value presentation.

**Import:** `import {BaseTypeahead} from '@astryxdesign/core/Typeahead';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Input | Yes | Bare combobox input. The caller supplies its visible field chrome and accessible name. |
| Loading status | No | Named Spinner shown beside the input while an asynchronous source is pending, unless a composed owner takes over the busy indicator lane. |
| Dropdown | No | Anchored listbox surface containing current search or bootstrap results. |
| Empty state | No | Disabled listbox option shown after a completed search returns no results. |
| Result group heading | No | Visible label for a group of result options. |
| Result row | No | Option wrapper that owns highlight, selection, pointer, and keyboard behavior. |
| Default item content | No | TypeaheadItem label and optional supporting content rendered inside a result row. |
| Caller-rendered item content | No | Caller content supplied through renderItem or item.element inside the stable result row. |
| Menu content | No | Caller content from menu.render: information around the result list in the listbox role, or the content of the dialog role. |
| Menu dialog | No | The named dialog a dialog-role menu shows in the anchored layer; it takes focus and returns it on close. |
| Selected result state | No | Selected row weight and trailing check shown when a result matches value. |

## Best Practices

- **Do:** Use Typeahead or Tokenizer for standard fields; they add the input chrome and selected-value rendering BaseTypeahead omits.
- **Do:** Provide a visible label or aria-label plus a custom wrapper with focus treatment, border, and layout.
- **Do:** Pass anchorRef to your wrapper so the dropdown positions against your input chrome, not the bare input.
- **Don't:** Expect input chrome or selected-value rendering. The caller owns those visible parts.
- **Don't:** Use BaseTypeahead when Typeahead or Tokenizer suffice; extra work only pays off for custom compositions.
- **Don't:** Treat Escape as pending-work cancellation. It hides the popup, but a late response can reopen it.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `searchSource` | `SearchSource<T>` | - | Data source w/ search+bootstrap methods. **(required)** |
| `value` | `T \| null` | - | Currently selected item. **(required)** |
| `onChange` | `(item: T \| null) => void` | - | Fired on selection change. **(required)** |
| `renderItem` | `(item: T) => ReactNode` | - | Custom dropdown item render. |
| `placeholder` | `string` | `'Search…'` | Input placeholder. |
| `hasEntriesOnFocus` | `boolean` | `false` | Bootstrap results on focus. |
| `maxMenuItems` | `number` | `10` | Max dropdown items. |
| `menuWidth` | `number` | - | Requested px width before viewport clamping. |
| `minQueryLength` | `number` | `1` | Min query length before searching. Menu stays closed below it. |
| `emptySearchText` | `ReactNode` | `'No results found'` | Content when the query matched nothing. ReactNode. |
| `isDisabled` | `boolean` | `false` | Whether input disabled. |
| `isFocusableDisabled` | `boolean` | `false` | Keeps disabled input focusable; blocks text entry, opening and picking, also from an already-open list (Escape/Tab close it). |
| `hasAutoFocus` | `boolean` | `false` | Auto-focus on mount. |
| `debounceMs` | `number` | `150` | Search debounce ms. 0 for sync. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Dropdown option padding size. |
| `anchorRef` | `RefObject<HTMLElement \| null>` | - | Anchor for dropdown positioning. Defaults to input. |
| `inputXStyle` | `StyleXStyles` | - | Additional StyleX styles for input. |
| `xstyle` | `StyleXStyles` | - | Standard BaseProps StyleX styles for input. |
| `inputTabIndex` | `number` | - | Legacy tabIndex alias; defined alias wins, otherwise native tabIndex passes through. |
| `onKeyDown` | `(e: React.KeyboardEvent<HTMLInputElement>) => void` | - | Keydown before internal nav. preventDefault() skips internal handling. |
| `onChangeQuery` | `(query: string) => void` | - | Fired on query text change. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Fired on dropdown open/close. |
| `menu` | `BaseTypeaheadMenu` | - | Menu content: {role:'listbox', render?({listbox,query,isBusy,isEmptySearch,close})} (info around the list; actions stay results) \| {role:'dialog', label, render({query,close})} (takes focus; close returns focus to opener, else input). Astryx owns the layer. open() from onChange keeps it open across a role switch. |
| `handleRef` | `React.Ref<BaseTypeaheadHandle>` | - | Handle: open(), close(). No controlled isOpen; onOpenChange reports. |
| `inputId` | `string` | - | Legacy id alias; defined alias wins, otherwise native id passes through. |
| `ariaDescribedBy` | `string` | - | Legacy aria-describedby alias; defined alias wins, otherwise native attribute passes through. |
| `ariaLabelledBy` | `string` | - | Legacy aria-labelledby alias; defined alias wins, otherwise native attribute passes through. |
