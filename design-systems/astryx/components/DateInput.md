package: @astryxdesign/core

# DateInput

DateInput lets the user type or pick a date from a calendar popover. Use for scheduling, deadlines, booking dates, or any form field needing a calendar date.

**Import:** `import {DateInput} from '@astryxdesign/core/DateInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text above the input describing what date is expected. |
| Text input | Yes | A field where the user can type a date directly, written the way the locale writes it in the field's calendar. |
| Calendar icon | Yes | A button that opens the calendar popover for visual date picking. |
| Calendar popover | No | A month grid that appears when the icon or the input is clicked, or when ArrowDown is pressed in the input. |
| Clear button | No | A × button that resets the date value. Shown when hasClear is true and a date is set. |
| Status message | No | An error, warning, or success message below the input. |

## Best Practices

- **Do:** Base props such as ref, id, data-*, aria-*, and DOM event handlers go to the date input, the element that is focused and announced. A DOM handler runs after DateInput's own handler for the same event and still receives events it handled (including ones it called preventDefault on), so it cannot cancel built-in behavior.
- **Do:** Provide clear labels + descriptions so users understand what date is expected.
- **Do:** Use min, max, and dateConstraints to restrict selectable dates to valid ranges.
- **Do:** Set min and max on a Buddhist or Minguo calendar field, so a Gregorian year typed by mistake shows an error instead of a date centuries away.
- **Do:** Use hasClear when the date is optional so the user can reset it.
- **Do:** Show a loading state with changeAction when the date triggers a server-side save.
- **Do:** On a fine pointer the field follows the WAI-ARIA combobox pattern with a dialog popup, as in the APG date picker combobox: ArrowDown or Alt+ArrowDown opens the calendar, and Escape closes it and returns focus to the field.
- **Do:** Use inside InputGroup for a short static prefix or suffix, such as a due-date hint.
- **Don't:** Use a DateInput for free-form text that does not represent a calendar date.
- **Don't:** Hide the label without surrounding context that makes the field purpose obvious.
- **Don't:** Rely on the calendar alone; the text input lets users type dates directly, which is faster for known dates.
- **Don't:** Wrap a disabled DateInput in Tooltip to explain why it is disabled. Use the disabledMessage prop instead, which ties the reason to the field.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | label text **(required)** |
| `isLabelHidden` | `boolean` | `false` | visually hide label |
| `description` | `string` | - | helper text below label |
| `isOptional` | `boolean` | `false` | show "(optional)" indicator |
| `isRequired` | `boolean` | `false` | mark field required |
| `isDisabled` | `boolean` | `false` | disable input+calendar |
| `disabledMessage` | `string` | - | reason shown in a tooltip on hover/focus when disabled; describes the field's focusable controls |
| `value` | `ISODateString` | - | selected date YYYY-MM-DD |
| `onChange` | `(value: ISODateString \| undefined) => void` | - | callback on date change |
| `changeAction` | `(value: ISODateString \| undefined) => void \| Promise<void>` | - | async action after onChange; drives optimistic UI |
| `isLoading` | `boolean` | `false` | loading state; stays focusable w/ aria-busy + spinner; blocks typing, picking, clearing |
| `min` | `ISODateString` | - | min selectable date (YYYY-MM-DD) |
| `max` | `ISODateString` | - | max selectable date (YYYY-MM-DD) |
| `dateConstraints` | `ReadonlyArray<(date: Date) => boolean>` | - | custom constraint fns to disable specific dates |
| `placeholder` | `string` | `'Select a date'` | placeholder text in input |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | input control size |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | error/warning/success status w/ message; a rejected date (typed or native) or kept unreadable/unfinished text shows its own error instead, unless onEntryErrorChange is set and status is an error w/ message |
| `onEntryErrorChange` | `(error: {kind: 'unreadable' \| 'incomplete' \| 'nonexistent' \| 'outOfRange' \| 'unavailable', text: string, date?: ISODateString} \| null) => void` | - | (error\|null) on each typed-rejection change: kind 'unreadable'\|'incomplete'\|'nonexistent'\|'outOfRange' (min/max)\|'unavailable' (dateConstraints), text, date (Gregorian ISO, outOfRange/unavailable); also on new min/max/dateConstraints/value, calendar pick, disable, Enter/blur; never twice for one rejection; null when the typed field leaves mid-rejection (presentation/pointer switch); with it an error status w/ message replaces the field's own message, re-announced once if unchanged when a rejection starts; never a rejection on native/touch pickers |
| `entryErrorBehavior` | `'complete' \| 'blur-or-enter'` | `the nearest FormLayout's defaultEntryErrorBehavior, else 'complete'` | 'complete'\|'blur-or-enter': when the field's own rejection shows (not when validation runs; not React Aria validationBehavior; never changes status). complete: nonexistent/out-of-range date as soon as complete, unreadable/unfinished at Enter/blur. blur-or-enter: message, aria-invalid, styling, announcement and onEntryErrorChange report all wait for Enter/blur. Valid or emptied text clears at once; still-wrong edit keeps a shown error (blur-or-enter). Native refusals wait for Enter/blur under both. Default: nearest FormLayout defaultEntryErrorBehavior, else complete |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| `labelTooltip` | `string` | - | tooltip text via info icon at label end |
| `hasClear` | `boolean` | `false` | Shows clear button when date is set. Clears value on click. |
| `numberOfMonths` | `1 \| 2` | `1` | months shown simultaneously in calendar popover |
| `weekStartsOn` | `0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 'sun' \| 'mon' \| 'tue' \| 'wed' \| 'thu' \| 'fri' \| 'sat'` | `0` | first day of week in calendar (0=Sunday, or name e.g. "mon") |
| `format` | `'date' \| 'date_long' \| 'date_weekday' \| 'system_date' \| ((value: ISODateString) => string)` | `'date_long'` | committed-value display: 'date_long' (default, March 21, 2026), 'date' (Mar 21, 2026), 'date_weekday' (Wed, Mar 21, 2026), 'system_date' (2026-03-21, always Gregorian ISO), or (iso)=>string; reuses Timestamp vocabulary; named formats write the field's calendar. Committed value only, not while typing. |
| `calendar` | `'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura'` | `the InternationalizationProvider's calendar, else 'gregory'` | calendar for typed + committed text, the popover, and the bottom sheet (months, leap months, era years; an era-change year follows the shown month, e.g. 平成31 in Jan 2019, 令和元 in Jul) (default: provider's, else 'gregory'); values stay Gregorian ISO; years are the calendar's, so set min/max on buddhist/roc fields; non-Gregorian-aligned calendars need Temporal (native or app-loaded polyfill), else Gregorian; non-gregory/iso8601 never shows the native control: popover fine / sheet coarse |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'native' \| 'adaptive-bottom-sheet' \| 'adaptive-native'` | `'adaptive-native'` | which surface draws the picker: 'adaptive-native' (default) = Astryx popover on fine, browser/OS on coarse w/ Astryx fallbacks; 'native' = browser/OS always, no fallback; 'adaptive-bottom-sheet' = popover fine / Astryx sheet coarse; 'popover'/'bottom-sheet' force Astryx. every value opens a picker (no text-only value; that is TimeInput's). use non-native for weekStartsOn/numberOfMonths/dateConstraints. non-gregory/iso8601 calendar: native + adaptive-native become popover fine / sheet coarse; explicit 'native' warns in dev. |
| `nativePicker` | `'touch' \| 'always' \| 'never'` | `'touch'` | deprecated, use presentation: 'touch'='adaptive-native', 'always'='native', 'never'='adaptive-bottom-sheet'. still works as released, except that a calendar other than gregory or iso8601 never shows the native control; presentation wins if both set. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | Field box (label+control+status); also containerClassName/containerStyle. no effect in InputGroup or horizontal-labels FormLayout |
| `containerClassName` | `string` | - | class name for the Field box; same target as containerXstyle |
| `containerStyle` | `CSSProperties` | - | inline styles for the Field box; same target as containerXstyle |
| `controlXstyle` | `StyleXStyles` | - | visual control box (border/bg/icons), never the native input; also controlClassName/controlStyle. no root xstyle/className/style |
| `controlClassName` | `string` | - | class name for the visual control box; same target as controlXstyle |
| `controlStyle` | `CSSProperties` | - | inline styles for the visual control box; same target as controlXstyle |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-date-input` | `data-size`, `data-status`, `data-disabled` | size, status | disabled |
| `astryx-date-input-toggle-icon` | `data-state` | - | state |

Override in defineTheme:
```ts
components: {
  'date-input': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
  'date-input-toggle-icon': {
    base: { /* CSS properties */ },
    'state': { /* state-specific */ },
  },
}
```
