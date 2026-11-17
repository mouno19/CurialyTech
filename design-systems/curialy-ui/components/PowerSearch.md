package: @curialy/ui

# PowerSearch

PowerSearch is a structured filter bar where each token represents a field, operator, and value. Use it for complex multi-dimensional filtering when users need to combine multiple search criteria. For simple single-field search, use a text input instead. Host data-* attrs (data-testid incl.) reach the primary control: combobox input (popover) or trigger button (sheet); PowerSearchToken/PowerSearchFilterEditor pass them to token/editor root.

**Import:** `import {PowerSearch} from '@curialy/ui/PowerSearch';`

## Best Practices

- **Do:** Define clear, descriptive field names and aliases so users can quickly find the filter they need.
- **Do:** Provide a result count to give users feedback on how their filters affect the data set.
- **Don't:** Use PowerSearch for simple keyword searches; a standard text input is more appropriate for single-field lookups.
- **Don't:** Wrap a disabled PowerSearch in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `config` | `PowerSearchConfig` | - | Configuration defining available fields, operators, value types. **(required)** |
| `filters` | `ReadonlyArray<PowerSearchFilter>` | - | Currently active filters. **(required)** |
| `onChange` | `(filters: ReadonlyArray<PowerSearchFilter>, changeType: 'add' \| 'edit' \| 'remove', index: number) => void` | - | Called on filter change. changeType is 'add', 'edit', or 'remove'. index is affected filter position. **(required)** |
| `label` | `string` | `'Search'` | Accessible label for search input. |
| `isLabelHidden` | `boolean` | `true` | Visually hides label while keeping accessible. |
| `placeholder` | `string` | `'Search...'` | Text shown when no filters selected. |
| `hasAutoFocus` | `boolean` | `false` | Auto-focus input on mount. |
| `hasClear` | `boolean` | `true` | Show clear-all button; removes editable filters, keeps read-only ones. |
| `isReadOnly` | `boolean` | `false` | Prevent adding, editing, or removing filters. |
| `isDisabled` | `boolean` | `false` | Disables entire component. |
| `disabledMessage` | `string` | - | Explains why the search is disabled. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the input focusable via aria-disabled (input stays blocked). Use this instead of wrapping a disabled PowerSearch in Tooltip. Disabled controls swallow the hover events an external Tooltip needs. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Validation status object w/ type + optional message. |
| `startIcon` | `ReactNode \| IconType` | - | Icon at input start, before filter tokens. Forwarded to internal Tokenizer. |
| `statusVariant` | `'attached' \| 'detached'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing. |
| `maxTokenLength` | `number` | `40` | Max char length for filter value display in tokens. |
| `maxOperatorMenuItems` | `number` | `10` | Max suggestions in string/entity value typeaheads; excludes main field search + enum menus. |
| `maxSearchResults` | `number` | `10` | Max ranked results for a non-empty query; excludes value editors. |
| `menuWidth` | `number` | - | Main field/search menu width in pixels. |
| `popoverSaveButtonLabel` | `string` | `'Apply'` | Label for save button in edit popover. |
| `timezoneID` | `string` | - | IANA zone a date-only value reads and writes in; unset, its UTC day. Dates show in the provider calendar. |
| `handleRef` | `Ref<PowerSearchHandle>` | - | Imperative handle w/ focusTypeahead() + blurTypeahead() methods. |
| `endContent` | `ReactNode` | - | Content at end of input row. Useful for action buttons or controls. |
| `resultCount` | `number \| string` | - | Result count matching current filters. Number formatted as "N results"; string displayed as-is. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Search input+token size. |
| `menuWidth` | `number` | - | Main field/search menu width in pixels. |
| `maxOperatorMenuItems` | `number` | - | Max suggestions in string/entity value typeaheads; excludes main field search + enum menus. |
| `tokenOverflowBehavior` | `'none' \| 'unfocusedInline' \| 'unfocusedLayer'` | `'none'` | Controls how tokens overflow when the container is too narrow. Forwarded to Tokenizer. |
| `onFocus` | `(e: React.FocusEvent) => void` | - | Fires when focus enters the search input. |
| `onBlur` | `(e: React.FocusEvent) => void` | - | Fires when focus leaves the search input. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be stylex.create() value. |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | `'adaptive'` | 'adaptive' (default: sheet on compact touch, else popover; SSR/hydration render popover) \| 'popover' (tokenizer field + editor popover, every device) \| 'bottom-sheet' (one trigger with display-only tokens + stacked Filters / Add filter / value sheets; rows remove inline; Clear all confirms, keeps read-only; list values via Tokenizer's sheet). Sheet: menuWidth/tokenOverflowBehavior inert (dev warning). presentation="popover" keeps the popover on every device. |

## Examples

### Keep the popover on every device

```tsx
const [filters, setFilters] = useState([]);
<PowerSearch
  config={config}
  filters={filters}
  onChange={next => setFilters(next)}
  presentation="popover"
/>
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-power-search` | - | - | - |

Override in defineTheme:
```ts
components: {
  'power-search': {
    base: { /* CSS properties */ },
  },
}
```
