package: @astryxdesign/core

# InternationalizationProvider

Wraps app to set active locale and (optionally) merge translation catalogs + per-locale overrides. Astryx components resolve strings against this context; missing keys fall back to shipped English.

**Import:** `import {InternationalizationProvider} from '@astryxdesign/core/i18n';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Provider boundary | Yes | A nonvisual context boundary that supplies locale, message catalogs, overrides, and direction to descendant Astryx components, and a calendar system to `Calendar`. It renders no DOM element. |

## Best Practices

- **Do:** Use compact shipped Astryx catalogs from `@astryxdesign/core/locales/*.generated.js` when one exists for the target locale.
- **Do:** Use a rich `Catalog` or compact `RuntimeCatalog` when Astryx has not shipped the target locale or when testing in-progress translations.
- **Do:** Use real BCP 47 tags like `fr-FR`, `pt-BR`, or `ar-SA`; regional locales fall back to base language before English.
- **Do:** Set `dir` on `<html>` (or a wrapper) yourself; the provider does not. Astryx mirrors layout and directional icons from the DOM `dir`, so an RTL locale will not mirror without it. Use `getLocaleDirection(locale)` for both the provider and the DOM.
- **Don't:** Cast custom catalog maps to `any`; the i18n package exports `ProviderMessagesByLocale`, `MessagesByLocale`, `Catalog`, and `RuntimeCatalog` for local catalog typing.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `locale` | `string` | - | BCP 47 language tag (e.g. "en", "pt-BR"); regional tags fall back to base language then "en" **(required)** |
| `messages` | `ProviderMessagesByLocale` | - | map of BCP 47 tag to a rich Catalog or generated RuntimeCatalog; "en" is always available |
| `overrides` | `Overrides` | - | sparse per-locale key overrides applied on top of shipped defaults |
| `dir` | `'ltr' \| 'rtl'` | - | Explicit text-direction override for the context. When omitted, direction is derived from `locale` via `Intl.Locale.getTextInfo()`. This sets the direction Astryx reads, but it does NOT set the DOM `dir` attribute; you must set `dir` on `<html>` (or a wrapping element) yourself, since Astryx components mirror layout and directional icons from the DOM `dir`, not from this prop. Set both to the same value and keep them in sync. |
| `calendar` | `'gregory' \| 'iso8601' \| 'buddhist' \| 'roc' \| 'japanese' \| 'persian' \| 'indian' \| 'hebrew' \| 'chinese' \| 'dangi' \| 'coptic' \| 'ethiopic' \| 'ethioaa' \| 'islamic-civil' \| 'islamic-tbla' \| 'islamic-umalqura'` | - | calendar system for Calendar, DateInput, DateRangeInput, DateTimeInput, Timestamp, PowerSearch, and Schedule dates (default: gregory; a -u-ca- keyword in locale does not select it); values stay Gregorian ISO; non-Gregorian-aligned calendars need Temporal |
| `children` | `ReactNode` | - | Content to render with the internationalization provider. **(required)** |

## Examples

### Load a shipped Astryx locale catalog

```tsx
import type {ReactNode} from 'react';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import frFR from '@astryxdesign/core/locales/fr-FR.generated.js';

export function AppI18n({children}: {children: ReactNode}) {
  return (
    <InternationalizationProvider locale="fr-FR" messages={{'fr-FR': frFR}}>
      {children}
    </InternationalizationProvider>
  );
}
```

### Mirror the layout for right-to-left text

```tsx
import type {ReactNode} from 'react';
import {
  InternationalizationProvider,
  getLocaleDirection,
} from '@astryxdesign/core/i18n';

// Pass the same direction to the provider and to the element that holds the
// content, so Astryx components and the page mirror together.
export function AppI18n({children}: {children: ReactNode}) {
  const locale = 'ar-SA';
  const dir = getLocaleDirection(locale);
  return (
    <InternationalizationProvider locale={locale} dir={dir}>
      <div dir={dir}>{children}</div>
    </InternationalizationProvider>
  );
}
```

### Override one Astryx string

```tsx
import type {ReactNode} from 'react';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';

export function AppI18n({children}: {children: ReactNode}) {
  return (
    <InternationalizationProvider
      locale="en"
      overrides={{
        en: {'@astryx.selector.placeholder': 'Choose...'},
      }}
    >
      {children}
    </InternationalizationProvider>
  );
}
```

### Provide a local fallback catalog

```tsx
import type {ReactNode} from 'react';
import {
  InternationalizationProvider,
  type MessagesByLocale,
} from '@astryxdesign/core/i18n';
import ptBR from './locales/pt-BR.json';

const messages: MessagesByLocale = {'pt-BR': ptBR};

export function AppI18n({children}: {children: ReactNode}) {
  return (
    <InternationalizationProvider locale="pt-BR" messages={messages}>
      {children}
    </InternationalizationProvider>
  );
}
```

### Show Calendar in the Persian calendar

```tsx
import type {ReactNode} from 'react';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';

// Values stay Gregorian ISO dates, for example '2026-10-30'.
export function AppI18n({children}: {children: ReactNode}) {
  return (
    <InternationalizationProvider locale="fa-IR" calendar="persian">
      {children}
    </InternationalizationProvider>
  );
}
```

### Show Calendar and DateInput in another calendar

```tsx
import {useState} from 'react';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import {Calendar, type ISODateString} from '@astryxdesign/core/Calendar';
import {DateInput} from '@astryxdesign/core/DateInput';
import {VStack} from '@astryxdesign/core/Layout';

// Japanese, Buddhist, and Minguo calendar dates need no Temporal, so they work
// in every browser. The value stays a Gregorian ISO date.
export function StartDate() {
  const [value, setValue] = useState<ISODateString | undefined>('2026-10-30');
  return (
    <InternationalizationProvider locale="en" calendar="japanese">
      <VStack gap={4}>
        <DateInput label="Start date" value={value} onChange={setValue} />
        <Calendar value={value ?? null} onChange={next => setValue(next)} />
      </VStack>
    </InternationalizationProvider>
  );
}
```
