package: @astryxdesign/core

# usePowerSearchConfig

Memoizes a PowerSearch configuration built from typed field definitions and returns it along with an applyFilters function for client-side filtering. Automatically maps field types (string, number, boolean, date, enum, etc.) to their canonical operators and provides an efficient predicate evaluator to filter datasets.

## Best Practices

- **Do:** Declare field definitions as const outside the component or memoize them so usePowerSearchConfig only recalculates when needed.
- **Do:** Pass the returned config to PowerSearch and use applyFilters to compute the filtered data rows for a Table or List.
- **Don't:** Recreate field definitions inline on every render without as const or memoization.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `definitions` | `ReadonlyArray<FieldDefinition>` | - | Typed field definitions (key, type, label, enumValues) used to build PowerSearch fields and operators. **(required)** |
| `configName` | `string` | - | Optional name for the PowerSearchConfig object (defaults to "PowerSearchConfig"). |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `config` | `PowerSearchConfig` | Memoized PowerSearch configuration object with fields and type-appropriate operators. |
| `applyFilters` | `<T extends InferData<D>>(filters: ReadonlyArray<PowerSearchFilter>, data: ReadonlyArray<T>) => T[]` | Client-side filtering helper that filters a dataset using the active PowerSearch filter rules. |


Block templates: astryx component <name> --blocks for PowerSearch, Table
