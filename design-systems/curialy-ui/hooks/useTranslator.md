package: @curialy/ui

# useTranslator

Returns a translator function that resolves keys against the current locale, provider overrides, and the shipped English fallback catalog. Call inside a component; the returned function can be used anywhere within that component's scope.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `value` | `(key: string, values?: Record<string, string \| number \| Date>) => string` | A stable translator function bound to the current InternationalizationProvider context. Call it with a message key and optional ICU MessageFormat values to get the formatted string in the active locale. Safe to use in render, event handlers, effects, or any code that runs during the parent component's lifecycle. |


Block templates: design_system component <name> --blocks for InternationalizationProvider
