package: @astryxdesign/core

# Typeahead

A searchable input for selecting a single item from a large or dynamic dataset. Results appear as the user types, with support for async data sources, debounced search, and custom item rendering. Use it when the option list is too large for a Selector dropdown.

**Import:** `import {Typeahead} from '@astryxdesign/core/Typeahead';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Field | No | Standalone Field shell that provides the label and optional supporting content; omitted inside InputGroup. |
| Input surface | Yes | Painted control surface containing the editable input or the selected token. |
| Icon-rendered start icon | No | Optional leading semantic icon or icon component rendered through Icon. |
| Caller-rendered start content | No | Optional arbitrary React content rendered directly at the start of the input surface. |
| Selected token | No | Token that presents the selected item while the control is not in edit mode. |
| Spinner | No | Loading indicator shown at the end of the input surface while a search is in flight. |
| Clear button | No | Shared clear action that removes the selected item when hasClear is enabled. |
| Dropdown | No | Anchored listbox surface containing the current search results. |
| Empty state | No | Message shown after a completed search returns no results. |
| Result row | No | Stable option wrapper that owns highlight, selection, pointer, and keyboard behavior. |
| Default item content | No | Standard TypeaheadItem label and supporting content rendered inside a result row when renderItem and item.element are absent. |
| Caller-rendered item content | No | Caller-owned result content supplied through renderItem or item.element inside the stable result row. |
| Result group heading | No | Visible heading for a labeled group of result rows. |
| Selected result state | No | Selected styling and trailing check presented on the current result row. |

## Best Practices

- **Do:** Provide descriptive placeholder text that hints at what users can search for.
- **Do:** Show suggestions on focus when users benefit from seeing popular or recent options before typing.
- **Do:** Add a search delay for remote data sources to avoid excessive network requests.
- **Do:** For a remote source, show the matches the page already has at once: call `context.update(local)` in `search`, pass `debounceMs={0}`, delay the server request in the source, and return the server answer with the shown rows first.
- **Do:** Use inside InputGroup when the typeahead needs a single-line prefix or suffix addon.
- **Don't:** Use for short, static option lists; use Selector for better discoverability.
- **Don't:** Use for multi-selection; use Tokenizer instead.
- **Don't:** Place multiple Typeaheads adjacent to each other without clear labels differentiating them.
- **Don't:** Wrap a disabled Typeahead in Tooltip to explain why it is disabled; disabled triggers swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Accessible label for the input. **(required)** |
| `searchSource` | `SearchSource<T>` | - | Data source providing search and bootstrap methods. `search(query, context)` may call `context.update(items)` to show matches it already has before it returns; the value it returns is the final list, and every list after the first for a query keeps the shown rows first and adds new rows after them. **(required)** |
| `value` | `T \| null` | - | Currently selected item, or null if nothing is selected. **(required)** |
| `onChange` | `(item: T \| null) => void` | - | Called when the selection changes. **(required)** |
| `placeholder` | `string` | - | Input placeholder text. |
| `hasEntriesOnFocus` | `boolean` | `false` | Show bootstrap results on focus before typing. |
| `hasClear` | `boolean` | `true` | Show clear button to deselect the current value. |
| `isDisabled` | `boolean` | `false` | Disables the input. The field keeps its tab stop: it is announced as disabled (aria-disabled), is read-only, and opens and picks nothing. |
| `disabledMessage` | `string` | - | Explains why the input is disabled. With isDisabled, shows a tooltip on hover/keyboard focus, and the reason describes the field (activation stays blocked). Use this instead of wrapping a disabled Typeahead in Tooltip, so the reason is attached to the field itself. |
| `maxMenuItems` | `number` | `10` | Maximum number of dropdown items to display. |
| `minQueryLength` | `number` | `1` | Minimum query length before the search source is queried. Below it no search runs and the menu stays closed. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Validation status object with type and message for error/warning/success states. |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How the status message is placed relative to the input. attached overlaps directly below the input (bordered treatment); detached floats below as a separate element with spacing; tooltip reveals the message in an info-tip button. |
| `renderItem` | `(item: T) => ReactNode` | - | Custom render function for dropdown items. Default renders TypeaheadItem. |
| `isLabelHidden` | `boolean` | `false` | Visually hides the label while keeping it accessible. |
| `description` | `string` | - | Helper text displayed below the label. |
| `isRequired` | `boolean` | `false` | Marks the field as required. |
| `isOptional` | `boolean` | `false` | Shows an optional indicator on the label. |
| `labelTooltip` | `string` | - | Tooltip text shown on the label. |
| `emptySearchText` | `ReactNode` | `'No results found'` | Content shown when the query matched nothing. Takes a ReactNode, so the dead end can carry a link or a create row. Announced in a polite live region as the text it renders, read from the DOM; aria-hidden parts stay out of both, and content that renders no text announces nothing. null counts as not given, like undefined, and falls through to the default; pass an empty string to render nothing. |
| `hasAutoFocus` | `boolean` | `false` | Auto-focus the input on mount. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Input and token size. |
| `debounceMs` | `number` | `150` | Debounce delay in ms before triggering search. Set to 0 for synchronous sources, and for a source that shows local matches through `context.update` and delays its own server request. |
| `onChangeQuery` | `(query: string) => void` | - | Callback fired when the search query text changes. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback when the dropdown opens or closes. |
| `menu` | `BaseTypeaheadMenu` | - | What the menu shows. role 'listbox' (default) is the result list; its optional render({listbox, query, isBusy, isEmptySearch, close}) places information such as a header or a hint around it, and anything a person acts on stays a result so the arrow keys reach it. role 'dialog' shows render({query, close}) in a dialog named by label that takes focus; Escape, an outside press or close() returns focus to where it was when the menu opened. Astryx owns the layer either way. Switching from listbox to dialog keeps the menu open: call handleRef.open() from onChange. |
| `handleRef` | `React.Ref<BaseTypeaheadHandle>` | - | Imperative handle: open() opens the menu (a dialog at once; a listbox shows or loads its results) and close() closes it. There is no controlled open state; onOpenChange reports changes. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `startIcon` | `IconType \| ReactNode` | - | SVG icon component displayed at the start of the input. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| `containerClassName` | `string` | - | Class name for the field container. Same targeting as `containerXstyle`. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. Same targeting as `containerXstyle`. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box: the element that paints the border and background and holds icons and end controls. Never the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Components

### BaseTypeahead

See `astryx component BaseTypeahead` for props and usage.

### TypeaheadItem

See `astryx component TypeaheadItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-typeahead` | `data-status`, `data-size` | status, size | - |
| `astryx-typeahead-dropdown` | - | - | - |
| `astryx-typeahead-empty-state` | - | - | - |
| `astryx-typeahead-item` | - | - | - |

Override in defineTheme:
```ts
components: {
  'typeahead': {
    base: { /* CSS properties */ },
    'status:value': { /* variant-specific */ },
  },
  'typeahead-dropdown': {
    base: { /* CSS properties */ },
  },
}
```
