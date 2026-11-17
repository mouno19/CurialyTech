package: @curialy/ui

# Calendar

Calendar lets the user pick a date or date range from a month grid. Use in booking, scheduling, date filters.

**Import:** `import {Calendar} from '@curialy/ui/Calendar';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Calendar root | Yes | The container that holds the month header and the day grid. |
| Month header | Yes | The month name and year with navigation arrows to move between months. The arrows mirror automatically under dir="rtl". |
| Day grid | Yes | A 7-column grid of days with column headers for the day names. |
| Day button | Yes | One day in the grid; the control a date is picked with. |
| Selected day | No | The currently selected date, highlighted. In range mode, the start and end dates plus the days between them. |
| Today marker | No | A subtle indicator on the current date for orientation. |

## Best Practices

- **Do:** Set min/max to limit selection to a valid window: only future dates for booking, current quarter for a report.
- **Do:** Use range mode when user picks start + end dates: trip, time-off request.
- **Do:** Use dateConstraints to disable specific dates (weekends/holidays); explain why unavailable.
- **Do:** Show two months side by side when user frequently selects dates spanning a month boundary.
- **Do:** Custom month view: useCalendarNavigation + useCalendarDays; pass the same calendar to both, feed visibleCalendarMonths into useCalendarDays. Default gregory; never read the provider calendar.
- **Don't:** Use for dates far in the past/future; text input is faster.
- **Don't:** Disable dates without explaining why.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `mode` | `'single' \| 'range'` | `'single'` | selection mode |
| `value` | `ISODateString \| DateRange \| null` | - | controlled selected value |
| `defaultValue` | `ISODateString \| DateRange` | - | uncontrolled default value |
| `onChange` | `Function` | - | selection callback |
| `numberOfMonths` | `1 \| 2` | `1` | months to display |
| `min` | `ISODateString` | - | minimum selectable date |
| `max` | `ISODateString` | - | maximum selectable date |
| `dateConstraints` | `Array<(date: Date) => boolean>` | - | custom constraint fns |
| `maxRangeSpan` | `number` | - | range mode: max days a range may span, both ends counted (7 = 7-day window) |
| `minRangeSpan` | `number` | - | range mode: min days a range must span, both ends counted; repeated start click commits one day when allowed, otherwise cancels (default 1) |
| `focusDate` | `ISODateString` | - | controlled visible month (default: selected date, else today clamped into min/max) |
| `onFocusDateChange` | `(focusDate: ISODateString) => void` | - | navigation callback |
| `handleRef` | `React.Ref<CalendarHandle>` | - | imperative navigation handle |
| `hasOutsideDays` | `boolean` | `true` | show days from adjacent months |
| `hasWeekNumbers` | `boolean` | `false` | show ISO 8601 week numbers, in every calendar system |
| `hasVariableRowCount` | `boolean` | `false` | only the rows each month needs; trades the fixed 6-row height for a compact grid |
| `weekStartsOn` | `0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 'sun' \| 'mon' \| 'tue' \| 'wed' \| 'thu' \| 'fri' \| 'sat'` | `0` | first day of week (0=Sunday, or name e.g. "mon") |
| `calendar` | `'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura'` | `the InternationalizationProvider calendar, else gregory` | calendar system shown (default: provider calendar, else gregory); values stay Gregorian ISO; non-Gregorian-aligned calendars need Temporal |

## Examples

### A custom month view in the Persian calendar

```tsx
import {Button} from '@curialy/ui/Button';
import {
  useCalendarDays,
  useCalendarNavigation,
} from '@curialy/ui/Calendar';

function PersianMonth() {
  const {monthYearLabel, visibleCalendarMonths, navigateMonth} =
    useCalendarNavigation({initialValue: '2026-10-30', calendar: 'persian'});
  // visibleCalendarMonths[0] is {year: 1405, month: 8}: Aban 1405.
  const {weeks} = useCalendarDays({
    ...visibleCalendarMonths[0],
    calendar: 'persian',
  });
  return (
    <section aria-label={monthYearLabel}>
      <Button label="Previous month" onClick={() => navigateMonth(-1)} />
      <Button label="Next month" onClick={() => navigateMonth(1)} />
      {weeks.map(week => (
        <div key={week[0].iso}>
          {week.map(day => (
            <span key={day.iso} data-date={day.iso}>
              {day.isOutside ? '' : day.dayNumber}
            </span>
          ))}
        </div>
      ))}
    </section>
  );
}
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-calendar` | `data-mode` | mode | - |
| `cui-calendar-nav` | `data-nav`, `data-disabled` | nav | disabled |
| `cui-calendar-day` | `data-selected`, `data-today`, `data-disabled`, `data-in-range`, `data-marker` | - | selected, today, disabled, in-range, marker |

Override in defineTheme:
```ts
components: {
  'calendar': {
    base: { /* CSS properties */ },
    'mode:value': { /* variant-specific */ },
  },
  'calendar-nav': {
    base: { /* CSS properties */ },
    'disabled': { /* state-specific */ },
  },
}
```
