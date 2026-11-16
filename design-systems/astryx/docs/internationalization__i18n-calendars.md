package: @astryxdesign/cli

# Other calendars

Show dates in the Persian, Hebrew, Hijri, Buddhist, Japanese, and other calendars while values stay Gregorian ISO dates.

## Show dates in another calendar

Set `calendar` on `<InternationalizationProvider>` for a subtree, or on `Calendar` itself; without it, `Calendar` is Gregorian. Values stay Gregorian ISO dates (`YYYY-MM-DD`) in every calendar.

Persian dates in a Persian interface:
```tsx
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import {Calendar} from '@astryxdesign/core/Calendar';

<InternationalizationProvider locale="fa-IR" calendar="persian">
  {/* shows Aban 1405; value and onChange stay '2026-10-30' */}
  <Calendar value={date} onChange={setDate} />
</InternationalizationProvider>;
```

Most calendars need the runtime's `Temporal`. Safari and older runtimes lack it: load `temporal-polyfill/full/global` there, on the server and in the browser. Without it, those calendars show Gregorian dates. See `astryx docs calendars` for the supported calendars, server rendering, and the lunisolar calendars.

Up: astryx docs internationalization
Previous: astryx docs internationalization/i18n-library-integration
Next: astryx docs internationalization/i18n-rtl-and-testing
