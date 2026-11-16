package: @astryxdesign/cli

# Calendar systems

Choosing a calendar, which calendars need Temporal, server rendering, the lunisolar calendars, and week numbers.

## Choose a calendar

`Calendar` shows the Gregorian calendar unless you choose another one. Pass `calendar` to `<InternationalizationProvider>` to set it for a subtree. A locale on its own never changes the calendar: `fa-IR` shows Gregorian dates in Persian until you pass `calendar="persian"`. A locale with a `-u-ca-` keyword, such as `th-TH-u-ca-buddhist`, keeps Gregorian dates too; set `calendar` to choose one.

Persian dates in a Persian interface:
```tsx
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import {Calendar} from '@astryxdesign/core/Calendar';

<InternationalizationProvider locale="fa-IR" calendar="persian">
  {/* shows Aban 1405; value and onChange stay '2026-10-30' */}
  <Calendar value={date} onChange={setDate} />
</InternationalizationProvider>;
```

Calendar and language are independent: `locale="en" calendar="hebrew"` shows Hebrew dates in English. `Calendar` also takes its own `calendar`, which wins over the provider. Use it when one screen shows two calendars side by side.

Values never change with the calendar. `value`, `defaultValue`, `onChange`, `min`, and `max` stay Gregorian ISO dates (`YYYY-MM-DD`) in every calendar, so your data, server code, and existing handlers keep working.

## Supported calendars

Calendar        | Identifiers                                         | Needs Temporal
--------------- | --------------------------------------------------- | --------------
Gregorian       | `gregory`, `iso8601`                                | No
Buddhist        | `buddhist`                                          | No
Minguo          | `roc`                                               | No
Japanese        | `japanese`                                          | No
Persian         | `persian`                                           | Yes
Indian National | `indian`                                            | Yes
Hebrew          | `hebrew`                                            | Yes
Hijri           | `islamic-umalqura`, `islamic-civil`, `islamic-tbla` | Yes
Chinese         | `chinese`                                           | Yes
Dangi           | `dangi`                                             | Yes
Coptic          | `coptic`                                            | Yes
Ethiopic        | `ethiopic`, `ethioaa`                               | Yes

Any other identifier, such as `islamic`, shows Gregorian dates and warns once in development.

## Load Temporal where the runtime lacks it

Calendars whose months are not Gregorian use the runtime's `Temporal` for their month lengths, leap months, and years. Chrome and Edge 144 and later, Firefox 139 and later, and Node.js 26 and later ship it. Safari and older runtimes do not. Astryx bundles no polyfill, so Gregorian applications pay nothing.

Where `Temporal` is missing, load the full build of `temporal-polyfill` before your app renders. The default build has only the Gregorian calendar (`gregory` and `iso8601`). Load it only where `Temporal` is missing: a native implementation is more accurate for the lunisolar calendars.

Load the polyfill only where Temporal is missing:
```ts
// temporal-setup.ts: import before your app renders, on the server and in the browser
if (!('Temporal' in globalThis)) {
  await import('temporal-polyfill/full/global');
}
```

If you render on the server, load it there too. `Calendar` resolves its calendar during render, so a server without `Temporal` renders Gregorian dates, and a browser with it renders Persian ones: hydration then fails. When both have `Temporal`, or both lack it, they render the same markup.

Without a `Temporal` that supports it, a calendar that needs one shows Gregorian dates and warns once in development, on the server and in the browser. The Gregorian-aligned calendars (Buddhist, Minguo, and Japanese) work everywhere without it.

## Lunisolar calendars

In the lunisolar calendars, months start on new moons computed from astronomy, and runtimes do not all agree on a few of them. Astryx follows the runtime's `Temporal` and does not correct it.

- Native `Temporal` in Chrome, Edge, Firefox, and Node.js 26 agrees with official observatory data from 1900 through 2100.
- A polyfill reads the platform's `Intl` data instead. Under a polyfill, Node.js 24 starts nine Chinese calendar months and four Dangi calendar months in that range one day apart from the native result: the first month of the 2027 Chinese calendar year starts on February 6 with native `Temporal` and on February 7 under the polyfill. Safari uses the same kind of `Intl` data, so expect the same differences there.
- Within one browser, the day numbers a person sees, the dates a screen reader announces, and the value they pick agree. Only two different runtimes can disagree.

If you render on the server, a server and a browser that use different implementations can disagree on one of these month starts. The browser then renders that month differently from the server markup, and React renders that part again on the client during hydration. The `temporal-polyfill/full/global` import keeps a native `Temporal` where one exists, so on its own it leaves Chrome, Edge, and Firefox on native `Temporal` and a Node.js 24 server on the polyfill. When identical server and browser markup for these calendars matters more than matching official data, call `installImplementation()` from `temporal-polyfill/full/shim` on the server and in the browser before rendering: it installs the polyfill even over a native `Temporal`. A server runtime with native `Temporal`, such as Node.js 26, also matches native browsers. Otherwise, do not replace a native `Temporal`: that makes native environments less accurate.

## Week numbers

`Calendar`'s `hasWeekNumbers` shows ISO 8601 week numbers in every calendar. Temporal defines week numbering only for `iso8601`, the Gregorian calendar with ISO 8601 weeks.

Up: astryx docs calendars
