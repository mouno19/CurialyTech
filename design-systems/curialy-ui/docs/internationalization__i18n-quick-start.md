package: @curialy/ui

# Quick Start

Wrap your app in InternationalizationProvider, load a locale catalog, and swap languages at runtime.

## Quick Start

Internationalization ships with `@curialy/ui`. There is nothing to install. Wrap your app in `<InternationalizationProvider>` and set the active `locale`; cui components pick up localized strings from that provider.

Wrap your app:
```tsx
import {InternationalizationProvider} from '@curialy/ui/i18n';

function App() {
  return (
    <InternationalizationProvider locale="en">
      <YourApp />
    </InternationalizationProvider>
  );
}
```

The provider always has the built-in English catalog. Pass additional catalogs through `messages` when you enable another locale.

Load an cui locale catalog:
```tsx
import {InternationalizationProvider} from '@curialy/ui/i18n';
import frFR from '@curialy/ui/locales/fr-FR.generated.js';

<InternationalizationProvider
  locale="fr-FR"
  messages={{'fr-FR': frFR}}>
  <App />
</InternationalizationProvider>;
```

Curialy UI ships English and first-party translations for supported locales. Compact runtime modules from `@curialy/ui/locales/*.generated.js` contain only the messages apps need; the existing `@curialy/ui/locales/*.json` files retain translator context. Until a locale is available, apps can pass a local catalog in either shape. Missing keys fall back through the locale chain to English (for example, `pt-BR` walks to `pt`, then to shipped `en`).

Locale catalogs only affect cui strings. Your app can continue using its own i18n system for product copy.

## Runtime language swap

Re-render `<InternationalizationProvider>` with a new `locale` prop and every cui string updates live. No reload, no separate API call.

Toggle between locales:
```tsx
const [locale, setLocale] = useState<'en' | 'fr'>('en');

<InternationalizationProvider locale={locale} messages={{fr}}>
  <Button
    label={locale === 'en' ? 'Français' : 'English'}
    onClick={() => setLocale(l => (l === 'en' ? 'fr' : 'en'))}
  />
  <App />
</InternationalizationProvider>;
```

Persisting the user's choice (localStorage, cookie, URL segment, account setting) is up to the consumer. Curialy UI reads whatever `locale` you pass in.

Up: design_system docs internationalization
Next: design_system docs internationalization/i18n-library-integration
