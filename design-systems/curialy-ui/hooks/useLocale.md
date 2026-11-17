package: @curialy/ui

# useLocale

Reads the authoritative Curialy UI locale. Use it to thread the provider locale into pure formatting helpers and sibling-package APIs; do not derive a second locale from navigator.language or a hardcoded literal.

## Best Practices

- **Do:** Pass the returned locale to pure Curialy UI helpers or package APIs that require an explicit locale.
- **Don't:** Use navigator.language or a hardcoded display locale as a fallback; InternationalizationProvider is the locale source.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `locale` | `Locale` | The active InternationalizationProvider BCP 47 locale. Falls back to 'en' when no provider is present. |


Block templates: design_system component <name> --blocks for InternationalizationProvider
