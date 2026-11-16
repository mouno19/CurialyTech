package: @astryxdesign/core

# useCalendarConstraints

Provides date constraint validation for calendar views and custom range pickers. It combines boundary dates, span limits measured from an in-progress range start, and custom rules (such as weekly closures or blackout dates) into an isDateDisabled predicate. Calendar uses it internally to disable day buttons; use it directly when building bespoke scheduling interfaces or range pickers.

## Best Practices

- **Do:** Pass rangeAnchor only after the user selects an initial range start, so all eligible start dates remain selectable before the first click.
- **Do:** Use dateConstraints for recurring or dynamic rules, such as disabling closed weekdays, past holidays, or sold-out dates.
- **Don't:** Perform slow network calls or heavy calculations inside dateConstraints predicates, because isDateDisabled is evaluated synchronously for each day rendered in the grid.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseCalendarConstraintsOptions` | - | Configuration for date bounds, range-span limits, and custom rules. **(required)** |
| `options.min` | `ISODateString` | - | Earliest selectable date in ISO format (YYYY-MM-DD). Dates strictly before this are disabled. |
| `options.max` | `ISODateString` | - | Latest selectable date in ISO format (YYYY-MM-DD). Dates strictly after this are disabled. |
| `options.dateConstraints` | `ReadonlyArray<(date: Date) => boolean>` | - | Custom date constraint predicates. Receives a native Date; if any returns false, the date is disabled. |
| `options.maxRangeSpan` | `number` | - | Maximum days a range may span, counting both endpoints (a value of 7 allows a 7-day window). Inactive until rangeAnchor is set. |
| `options.minRangeSpan` | `number` | - | Minimum days a range must span, counting both endpoints. Disables dates that would make the range shorter than minRangeSpan days (except rangeAnchor itself, which remains enabled so pickers forbidding single-day selections must refuse a second click on the anchor). |
| `options.rangeAnchor` | `PlainDate \| null` | - | The in-progress range start date. Span constraints are measured from this date. Null when no selection is underway. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `isDateDisabled` | `(date: PlainDate) => boolean` | Predicate returning true when a PlainDate falls outside min/max bounds, is closer to rangeAnchor than minRangeSpan allows (except rangeAnchor itself), exceeds maxRangeSpan relative to rangeAnchor, or fails any dateConstraints predicate. |
| `minDate` | `PlainDate \| null` | Parsed minimum date as a PlainDate object, or null if min was not provided. |
| `maxDate` | `PlainDate \| null` | Parsed maximum date as a PlainDate object, or null if max was not provided. |


Block templates: astryx component <name> --blocks for Calendar
