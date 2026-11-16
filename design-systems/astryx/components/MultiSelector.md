package: @astryxdesign/core

# MultiSelector

A checkbox dropdown for selecting multiple values from a list. Selected items can display as a count, labels, or badges. Use it for filtering or when presenting a finite set of options where multiple choices are needed.

**Import:** `import {MultiSelector} from '@astryxdesign/core/MultiSelector';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Field | No | Standalone Field shell that provides the label and optional supporting content; omitted inside InputGroup. |
| Trigger | Yes | Painted control that displays the current selection or placeholder and opens the selection surface when editable. |
| Icon-rendered start icon | No | Optional leading semantic icon or icon component rendered through Icon. |
| Caller-rendered start content | No | Optional arbitrary React content rendered directly at the start of the trigger. |
| Trigger clear button | No | Shared clear action that removes every selected value when hasClear is enabled. |
| Status icon | No | Status glyph shown in place of the disclosure indicator for attached or tooltip status. |
| Indicator icon | No | Trailing chevron shown when status presentation does not replace it; reflects collapsed or expanded state. |
| Search row | No | Panel header with a borderless search input and optional clear action. |
| Search icon | No | Leading magnifier rendered through Icon inside the search row. |
| Search clear button | No | Shared clear action shown in the search row while a query is present. |
| Option row | No | Selectable row for an option or the optional select-all choice. |
| Option checkbox indicator | No | CheckboxInput indicator that presents each row’s selected, unselected, or indeterminate state. |
| Option divider | No | Divider supplied in the public options data to separate adjacent option groups. |
| Section heading | No | Visible heading for a labeled group of option rows. |
| Empty state | No | Message shown when the shared panel content has no options or no search matches. |
| Pointer popup | No | Anchored painted surface that hosts the shared panel content for popover presentation. |
| Touch sheet heading | No | Heading above the shared panel content in bottom-sheet presentation. |
| Touch sheet | No | BottomSheet surface that hosts the same panel content for bottom-sheet presentation. |

## Best Practices

- **Do:** Use for a moderate, finite set of options where multiple choices are needed.
- **Do:** Enable search filtering when the list exceeds ~15 options.
- **Do:** renderOption for custom rows; checkbox affordance stays owned by MultiSelector.
- **Do:** Enable select-all when most users will want all or nearly all options selected.
- **Do:** Use inside InputGroup only for a short prefix or suffix addon; prefer count or labels trigger display so the group stays single-line.
- **Do:** Use variant="secondary" beside secondary buttons or segmented controls and variant="ghost" beside ghost buttons; prefer statusVariant="tooltip" for compact validation status.
- **Don't:** Use for single-value selection; use Selector instead.
- **Don't:** Show more than ~20 options without enabling search.
- **Don't:** Wrap a disabled MultiSelector in Tooltip to explain why it is disabled. Use the disabledMessage prop, which attaches the reason to the trigger itself.

## Components

### MultiSelector

checkbox multi-select dropdown

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | a11y label **(required)** |
| `options` | `MultiSelectorOptionType[]` | - | items: strings, objects w/ value/label/icon/disabled, dividers, sections **(required)** |
| `value` | `string[]` | - | selected values **(required)** |
| `onChange` | `(value: string[], change?: MultiSelectorChange) => void` | - | callback on selection change **(required)** |
| `changeAction` | `(value: string[]) => void \| Promise<void>` | - | async; fires after onChange |
| `placeholder` | `string` | `'Select...'` | text when nothing selected |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | size variant |
| `variant` | `'input' \| 'secondary' \| 'ghost'` | `'input'` | visual trigger style: input bordered control, secondary control matching the theme secondary buttons, or ghost transparent control |
| `triggerDisplay` | `'count' \| 'labels' \| 'badges'` | `'count'` | how to show selected in trigger |
| `formatValue` | `(items: {value: string; label: string}[]) => string` | - | formats count/labels trigger text; receives selected items |
| `maxBadges` | `number` | `3` | max badges before "+N"; badges mode only |
| `hasSelectAll` | `boolean` | - | show select-all checkbox |
| `selectAllLabel` | `string` | `'Select all'` | select-all label |
| `hasSearch` | `boolean` | - | show search input |
| `searchPlaceholder` | `string` | `'Search...'` | search placeholder |
| `emptyText` | `ReactNode` | `'No options'` | panel content when there are no options |
| `emptySearchText` | `ReactNode` | `'No results found'` | panel content when the query matches nothing |
| `hasCreate` | `boolean` | `false` | with hasSearch: first row is Create "<query>" when no option label matches; reported through onChange with a {type: "create", query} descriptor; caller adds the option |
| `isDisabled` | `boolean` | - | disables selector |
| `isReadOnly` | `boolean` | `false` | read-only: preserves values, focus + form submission; removes menu, clear + disclosure |
| `htmlName` | `string` | - | HTML name attr; one hidden input per selected value. |
| `disabledMessage` | `string` | - | why disabled; w/ isDisabled shows tooltip on hover/focus, trigger stays focusable via aria-disabled; use instead of Tooltip wrapper |
| `isLabelHidden` | `boolean` | - | visually hides label |
| `description` | `string` | - | helper text below label |
| `isOptional` | `boolean` | - | marks optional |
| `isRequired` | `boolean` | - | marks required |
| `isLoading` | `boolean` | - | spinner in trigger |
| `status` | `{type: 'error' \| 'warning' \| 'success', message?: string}` | - | validation status w/ optional message |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached' for input selectors; 'detached' for secondary and ghost selectors` | status message placement; secondary and ghost detach attached by default; use tooltip for compact toolbars. |
| `renderOption` | `(option: MultiSelectorOptionData) => ReactNode` | - | custom render fn per selectable option; not dividers/sections/select-all |
| `indicatorPosition` | `'start' \| 'end'` | `'start'` | Which edge of the option row carries the checkbox. end pushes it to the far edge of the row, including on the select-all row. |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | `'popover'` | popover, bottom-sheet, or compact-touch adaptive presentation |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `startIcon` | `IconType \| ReactNode` | - | Icon displayed at the start of the selector trigger. |
| `hasClear` | `boolean` | `false` | Shows a clear button when values are selected. |
| `isDefaultOpen` | `boolean` | `false` | Whether the dropdown starts open on mount. |
| `renderTrigger` | `(props: MultiSelectorRenderTriggerProps) => ReactNode` | - | caller-rendered opener replacing the field+button; spread the given props; listbox anchored to it, named by label |
| `handleRef` | `React.Ref<MultiSelectorHandle>` | - | imperative open()/close()/toggle()/isOpen() |
| `onOpenChange` | `(isOpen: boolean) => void` | - | fires on every open/close, whatever caused it |
| `onClick` | `(event: MouseEvent) => void` | - | trigger click; runs after the built-in toggle, cannot cancel it |
| `onFocus` | `(event: FocusEvent) => void` | - | trigger focus; runs before built-in focus handling |
| `onKeyDown` | `(event: KeyboardEvent) => void` | - | trigger keys; runs after the built-in keyboard model |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the trigger button. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-multi-selector` | `data-variant`, `data-size`, `data-status`, `data-disabled`, `data-readonly` | input, secondary, ghost | disabled, readonly |
| `astryx-multi-selector-empty-state` | - | - | - |
| `astryx-multi-selector-search` | - | - | - |
| `astryx-multi-selector-section-heading` | - | - | - |
| `astryx-multi-selector-indicator-icon` | `data-state` | - | state |
| `astryx-multi-selector-option` | `data-size`, `data-select-all`, `data-selected`, `data-disabled` | size | select-all, selected, disabled |
| `astryx-multi-selector-popup` | - | - | - |

Override in defineTheme:
```ts
components: {
  'multi-selector': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
  'multi-selector-empty-state': {
    base: { /* CSS properties */ },
  },
}
```
