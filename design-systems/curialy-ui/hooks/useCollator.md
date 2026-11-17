package: @curialy/ui

# useCollator

Returns the sanctioned locale-aware comparator for custom sorting. The collator is recreated when the provider locale or an option changes.

## Best Practices

- **Do:** Reuse collator.compare in custom Table comparators and other user-visible string ordering.
- **Don't:** Construct Intl.Collator directly or call localeCompare; those bypass the provider-backed locale contract.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `Intl.CollatorOptions` | - | Optional collation behavior such as numeric ordering, sensitivity, punctuation handling, and case order. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `collator` | `Intl.Collator` | A memoized collator bound to the active InternationalizationProvider locale. |


Block templates: design_system component <name> --blocks for InternationalizationProvider, Table
