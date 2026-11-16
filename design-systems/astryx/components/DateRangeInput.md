package: @astryxdesign/core

# DateRangeInput

DateRangeInput lets users select start+end dates from a dual-month calendar. Use for filtering, reports, analytics, and booking.

**Import:** `import {DateRangeInput} from '@astryxdesign/core/DateRangeInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text above the trigger describing what date range is expected. |
| Field surface | Yes | Bordered control containing the calendar toggle, range trigger, and end affordances. |
| Trigger button | Yes | A button showing the formatted range or placeholder. Clicking opens the popover. |
| Calendar icon | Yes | A trailing icon that also opens the popover. |
| Calendar popover | Yes | A dual-month calendar grid with range selection and hover preview. |
| Preset sidebar | No | A list of preset range options beside the calendar, or above it when the two do not fit side by side. |
| Preset button | No | A quick-select action for one preset range, reflecting current and disabled states. |
| Clear button | No | A × button that resets the range to null. |
| Status message | No | An error, warning, or success message below the trigger. |

## Best Practices

- **Do:** Base props such as ref, id, data-*, aria-*, and DOM event handlers go to the range trigger, the element that is focused and announced. A DOM handler runs after DateRangeInput's own handler for the same event and still receives events it handled (including ones it called preventDefault on), so it cannot cancel built-in behavior.
- **Do:** Use presets for common ranges like "Last 7 days" to speed up selection.
- **Do:** Use min/max to constrain selectable dates to valid ranges.
- **Do:** Keep hasClear enabled (default) so users can reset the filter.
- **Do:** Provide clear labels + descriptions so users understand what the range controls.
- **Don't:** Use DateRangeInput when only a single date is needed; use DateInput instead.
- **Don't:** Hide the label without surrounding context that makes the purpose obvious.
- **Don't:** Wrap a disabled DateRangeInput in Tooltip to explain why it is disabled. Use the disabledMessage prop instead, which ties the reason to the field.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | label text **(required)** |
| `isLabelHidden` | `boolean` | `false` | visually hide label |
| `description` | `string` | - | helper text below label |
| `isOptional` | `boolean` | `false` | show "(optional)" indicator |
| `isRequired` | `boolean` | `false` | mark field required |
| `isDisabled` | `boolean` | `false` | disable trigger+picker |
| `disabledMessage` | `string` | - | reason shown in a tooltip on hover/focus when disabled; describes the trigger |
| `value` | `DateRange \| null` | - | selected range {start, end} or null; import DateRange type from @astryxdesign/core/DateRangeInput (do not redeclare) **(required)** |
| `onChange` | `(value: DateRange \| null) => void` | - | callback on range change; null on clear **(required)** |
| `changeAction` | `(value: DateRange \| null) => void \| Promise<void>` | - | async action fired after onChange; drives optimistic UI updates via useTransition |
| `isLoading` | `boolean` | `false` | loading state; disables interaction + shows a spinner |
| `min` | `ISODateString` | - | min selectable date: ISODateString template literal type (YYYY-MM-DD); use string literal or cast `as ISODateString` |
| `max` | `ISODateString` | - | max selectable date: ISODateString template literal type (YYYY-MM-DD); use string literal or cast `as ISODateString` |
| `dateConstraints` | `Array<(date: Date) => boolean>` | - | custom constraint fns to disable dates |
| `maxRangeSpan` | `number` | - | max days a range may span, both endpoints counted (7 = a 7-day window); caps the window from the picked start. Selection-only; does not rewrite an over-wide value |
| `minRangeSpan` | `number` | - | min days a range must span, both endpoints counted (2 forbids a single-day range); repeated start click commits one day when allowed, otherwise cancels; default 1 |
| `presets` | `Array<DateRangePreset>` | - | preset ranges as quick-select options; disabled when an endpoint or span violates the corresponding constraints |
| `hasClear` | `boolean` | `true` | clear button when range is set (default true) |
| `placeholder` | `string` | `'Select date range'` | placeholder when empty |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | trigger size |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | error/warning/success status |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| `labelTooltip` | `string` | - | tooltip via info icon at label end |
| `numberOfMonths` | `1 \| 2` | `2` | months in calendar (default 2) |
| `weekStartsOn` | `0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 'sun' \| 'mon' \| 'tue' \| 'wed' \| 'thu' \| 'fri' \| 'sat'` | `0` | first day of week in calendar (0=Sunday, or name e.g. "mon") |
| `calendar` | `'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura'` | `the InternationalizationProvider's calendar, else 'gregory'` | calendar for the trigger text + popover calendar (default: provider's, else 'gregory'); values and presets stay Gregorian ISO; no typed entry; non-Gregorian-aligned calendars need Temporal (native or app-loaded polyfill), else Gregorian |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | Field box (label+control+status); also containerClassName/containerStyle. no effect in InputGroup or horizontal-labels FormLayout |
| `controlXstyle` | `StyleXStyles` | - | visual control box (border/bg/icons), never the native input; also controlClassName/controlStyle. no root xstyle/className/style |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-date-range-input` | `data-size`, `data-status`, `data-disabled` | size, status | disabled |
| `astryx-date-range-input-toggle-icon` | `data-state` | - | state |
| `astryx-date-range-input-presets` | - | - | - |
| `astryx-date-range-input-preset` | `data-selected`, `data-disabled` | - | selected, disabled |

Override in defineTheme:
```ts
components: {
  'date-range-input': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
  'date-range-input-toggle-icon': {
    base: { /* CSS properties */ },
    'state': { /* state-specific */ },
  },
}
```
