package: @astryxdesign/core

# Timestamp

Timestamp formats a date or time into readable text. Use for creation dates, update times, or schedules; relative for recency, absolute for precision, auto to switch automatically.

**Import:** `import {Timestamp} from '@astryxdesign/core/Timestamp';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Formatted text | Yes | The rendered date, time, or relative label like "2 hours ago" or "Mar 21, 2025". |
| Hover card | No | A copyable hover card showing the full absolute date and time when the display is relative, or the rows configured via tooltipEntries. Its default single row carries the full absolute time. |
| Hover card row | No | One row of the card: an optional label beside the instant rendered in one time zone and format. Rows opt into a copy button via isCopyable. |
| Copy button | Yes | Per-row copy-to-clipboard button in the hover card; copies that row's formatted value. |

## Best Practices

- **Do:** Auto format in feeds and lists; recent shows relative, older shows date_time.
- **Do:** Consistent formatting within the same list or table column.
- **Do:** isTimezoneShown for multi-timezone audiences.
- **Do:** tooltipEntries to compare zones when the reader time and event zone both matter.
- **Do:** Label each entry once a tooltip shows more than one zone; a bare abbreviation is not always recognizable (Tokyo renders "GMT+9", not "JST").
- **Do:** isLive for dashboards so relative time stays current.
- **Do:** tooltipEntries when readers must grab an exact value: an incident log or deploy record where someone pastes the UTC time or Unix seconds; entries turn the hover into copy-to-clipboard rows.
- **Don't:** Don't show raw Unix timestamps or ISO strings; always use Timestamp.
- **Don't:** Avoid system_* formats in user-facing UI; those are for dev tools and logs.
- **Don't:** Don't disable the hover card on relative timestamps; users expect the full date on hover.
- **Don't:** Don't stack many zones in one card; it caps at 300px and long labels wrap. Two or three read well.
- **Don't:** Don't use fixed-offset ids like "EST" for timezoneID; they skip DST. Use region ids like "America/New_York".

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number` | - | date/time as unix seconds or ISO string **(required)** |
| `format` | `'relative' \| 'relative_short' \| 'auto' \| 'date' \| 'date_long' \| 'date_weekday' \| 'date_time' \| 'time' \| 'system_date' \| 'system_date_time' \| 'system_time' \| 'unix_seconds'` | `'auto'` | display mode: 'relative' (locale-native long wording), 'relative_short' (locale-native narrow wording), 'auto', 'date', 'date_long', 'date_weekday', 'date_time', 'time', 'system_date', 'system_date_time', 'system_time', 'unix_seconds'; date-bearing formats use the provider calendar, system_* and time do not |
| `timezoneID` | `string` | - | IANA time zone the absolute formats render in, such as 'UTC' or 'America/Los_Angeles'. Omit (or pass 'local') for the viewer's own zone. An explicit zone renders identically on the server and the client, so it is the way to show an absolute time without a hydration mismatch; relative formats' visible text ignores it, while configured tooltipEntries rows still follow it. An unknown identifier warns once in development and falls back to the viewer's zone. |
| `autoThreshold` | `number` | `604800` | seconds threshold for auto relative→date_time switch |
| `hasTooltip` | `boolean` | `true` | show copyable full-time hover card on hover or keyboard focus (relative mode, or any format with tooltipEntries) |
| `tooltipEntries` | `ReadonlyArray<{timezoneID?: string; format?: TimestampTooltipFormat; label?: string; isCopyable?: boolean}>` | - | hover rows across zones/formats: [{timezoneID?, format?, label?}]; an entry without timezoneID follows the Timestamp timezoneID when set, else the viewer zone ('local' always means the viewer zone), format defaults to 'full'; the hover surface is always a copy-to-clipboard card, these customize its rows (default: a single full-time row), and configuring entries enables the card on absolute formats |
| `isTimezoneShown` | `boolean` | `false` | append timezone abbreviation to visible text (date_time and time only) |
| `isLive` | `boolean` | `false` | live-update relative time |
| `type` | `'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit'` | `'supporting'` | Text semantic type |
| `size` | `'4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl'` | - | font size override |
| `color` | `'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit'` | `'secondary'` | text color |
| `weight` | `'normal' \| 'medium' \| 'semibold' \| 'bold'` | - | font weight override |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-timestamp` | `data-type`, `data-color`, `data-format` | type, color, format | - |
| `astryx-timestamp-copy-button` | - | - | - |

Override in defineTheme:
```ts
components: {
  'timestamp': {
    base: { /* CSS properties */ },
    'type:value': { /* variant-specific */ },
  },
  'timestamp-copy-button': {
    base: { /* CSS properties */ },
  },
}
```

**Component icon slots** - set in `defineTheme({componentIcons})` to a shared icon name, `null`, a partial `{icon, variant, size}` request, or a function of the slot state.

| Slot | State | Fallback | Role | `null` |
|------|-------|----------|------|--------|
| `timestamp-copy` | `copied: boolean` True while the copied feedback shows after a successful copy. False while a failed copy shows, so a theme-mapped slot keeps its rest glyph then. | `copy`; `check` while copied; `close` while a failed copy shows | The copy button icon on a hover card row. | Hides the glyph. The button keeps its size, name, tooltip, and copy action. |
