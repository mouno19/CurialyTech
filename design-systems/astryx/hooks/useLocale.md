package: @astryxdesign/core

# useLocale

Reads the authoritative Astryx locale. Use it to thread the provider locale into pure formatting helpers and sibling-package APIs; do not derive a second locale from navigator.language or a hardcoded literal.

## Best Practices

- **Do:** Pass the returned locale to pure Astryx helpers or package APIs that require an explicit locale.
- **Don't:** Use navigator.language or a hardcoded display locale as a fallback; InternationalizationProvider is the locale source.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `locale` | `Locale` | The active InternationalizationProvider BCP 47 locale. Falls back to 'en' when no provider is present. |


Block templates: astryx component <name> --blocks for InternationalizationProvider
