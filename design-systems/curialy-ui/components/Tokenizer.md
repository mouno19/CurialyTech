package: @curialy/ui

# Tokenizer

Multi-select input for searching and selecting multiple items as removable chips. Use for team members, tags, filters, or any set built from a searchable source.

**Import:** `import {Tokenizer} from '@curialy/ui/Tokenizer';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | The visible text above the input describing what the user is selecting. Also used as the accessible name. |
| Token chips | No | Removable chips representing each selected item. Each chip shows a label and a remove button. |
| Search input | Yes | The text input where users type to search the data source. Hides when maxEntries is reached. |
| Dropdown menu | No | The search results list that appears below the input as the user types. |
| Spinner | No | Loading indicator shown at the end of the field while a search is in flight. |
| End content | No | A trailing slot after the input for action buttons, counts, or other controls. |
| Clear button | No | A button that removes all selected tokens at once. Shown when hasClear is true and tokens are present. |

## Best Practices

- **Do:** Placeholder that communicates what to search, such as "Search people..." rather than blank.
- **Do:** maxEntries when selections are bounded (e.g. 5 approvers max).
- **Do:** hasCreate for free-form tagging with values not in the source.
- **Do:** status prop for immediate validation feedback.
- **Do:** Use inside InputGroup only for a short prefix or suffix addon; the grouped row stays single-line, so keep selections few (maxEntries) or use tokenOverflowBehavior.
- **Don't:** Don't use for single-item selection; use Typeahead instead.
- **Don't:** Avoid custom token colors; default style for consistency.
- **Don't:** Don't hide the label unless context makes purpose obvious.
- **Don't:** Wrap a disabled Tokenizer in Tooltip to explain why it is disabled; disabled controls swallow the hover events the wrapper needs. Use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Accessible label for input. **(required)** |
| `searchSource` | `SearchSource<T>` | - | Data source w/ search+bootstrap methods for populating dropdown. **(required)** |
| `value` | `T[]` | - | Array of currently selected items. **(required)** |
| `onChange` | `(items: T[], change: TokenizerChange<T>) => void` | - | Fired on selection change. Change arg includes affected item+type ('add'\|'create'\|'remove'\|'reorder'). **(required)** |
| `placeholder` | `string` | - | Input placeholder. Only shown when no tokens selected. |
| `maxEntries` | `number` | - | Max selections allowed. Input hidden at limit. |
| `hasClear` | `boolean` | `false` | Clear-all button for bulk removal. |
| `renderToken` | `(item: T, onRemove: () => void) => ReactNode` | - | Custom token render. Default renders Token w/ label+onRemove. |
| `renderItem` | `(item: T) => ReactNode` | - | Custom dropdown item render. Default renders TypeaheadItem. |
| `isDisabled` | `boolean` | `false` | Disables input+all token interactions. |
| `htmlName` | `string` | - | HTML name attr; one hidden input per selected item id. |
| `disabledMessage` | `string` | - | Explains why the tokenizer is disabled. With isDisabled, shows a tooltip on hover/keyboard focus and keeps the input focusable via aria-disabled (input stays blocked). Use this instead of wrapping a disabled Tokenizer in Tooltip, so the reason is attached to the field itself. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Validation status w/ type+message for error/warning/success. |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip shows on status icon. |
| `isLabelHidden` | `boolean` | `false` | Visually hides label; keeps a11y. |
| `description` | `string` | - | Helper text below label. |
| `isRequired` | `boolean` | `false` | Marks field required. |
| `isOptional` | `boolean` | `false` | Shows optional indicator on label. |
| `labelTooltip` | `string` | - | Tooltip on label. |
| `hasEntriesOnFocus` | `boolean` | `false` | Show bootstrap results on focus before typing; a pick keeps the list open with the next choice active while choices remain. |
| `maxMenuItems` | `number` | `10` | Max search results shown; the hasCreate entry sits on top of them. |
| `menuWidth` | `number` | - | Fixed dropdown width in pixels. |
| `minQueryLength` | `number` | `1` | Min query length before searching. Menu stays closed below it, except the hasCreate entry. |
| `emptySearchText` | `ReactNode` | `'No results found'` | Content when the query matched nothing. ReactNode. |
| `hasAutoFocus` | `boolean` | `false` | Auto-focus input on mount. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Input+token size; the group size applies inside InputGroup. |
| `debounceMs` | `number` | `150` | Search debounce delay ms. 0 for sync sources. |
| `hasCreate` | `boolean` | `false` | Enable free-text token creation. Shows "Create" dropdown option for unmatched typed text. |
| `onChangeQuery` | `(query: string) => void` | - | Fired on search query text change. |
| `startIcon` | `ReactNode \| IconType` | - | Icon at input start, before tokens. Icon name, SVG component, or ReactNode. |
| `endContent` | `ReactNode` | - | Content at input row end. For buttons, counts, controls. |
| `handleRef` | `React.Ref<TokenizerHandle>` | - | Handle: focus(), blur(), open(), close() (open/close inline only). |
| `menu` | `BaseTypeaheadMenu` | - | Menu content: {role:'listbox', render?({listbox,query,isBusy,isEmptySearch,close})} (info around the list; actions stay results) \| {role:'dialog', label, render({query,close})} (takes focus; close returns focus to opener, else input). Curialy UI owns the layer. open() from onChange keeps it open across a role switch. Sheet ignores it (dev warning). |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Inline menu open/close report. Not called by the sheet. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `tokenOverflowBehavior` | `'none' \| 'unfocusedInline' \| 'unfocusedLayer'` | `'none'` | Controls how tokens overflow when the container is too narrow. |
| `onFocus` | `(e: FocusEvent<HTMLInputElement>) => void` | - | Fires when focus enters the tokenizer input. |
| `onBlur` | `(e: FocusEvent<HTMLInputElement>) => void` | - | Fires when focus leaves the tokenizer input. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | `'adaptive'` | 'adaptive' (default: sheet on compact touch, else popover; SSR/hydration render popover) \| 'popover' (inline combobox, every device) \| 'bottom-sheet' (field box with trigger + one searchable modal sheet of checkbox rows editing a draft that Save commits; onChange fires once, on Save). Sheet: field box keeps the inline box, theming target and focus ring; ref reaches the trigger button; endContent (field end) and renderToken (field tokens) work as inline; renderItem/hasClear/hasEntriesOnFocus/menuWidth/menu/onOpenChange/tokenOverflowBehavior/hasAutoFocus inert (dev warning). presentation="popover" keeps them on every device. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-tokenizer` | `data-size`, `data-status`, `data-disabled` | size, status | disabled |

Override in defineTheme:
```ts
components: {
  'tokenizer': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
}
```
