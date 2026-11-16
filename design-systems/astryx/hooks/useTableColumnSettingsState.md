package: @astryxdesign/core

# useTableColumnSettingsState

Headless column visibility and ordering state management for Table. Manages which columns are active, provides toggle and reset operations, and produces a config object that feeds directly into useTableColumnSettings. Renderer-agnostic and pairs with any column picker UI.

## Best Practices

- **Do:** Pass columnSettingsConfig directly to useTableColumnSettings and give the resulting plugin to Table.
- **Do:** Mark essential identifier columns (like name or ID) with isAlwaysVisible: true so users cannot accidentally hide them.
- **Don't:** Mutate activeColumnKeys array directly; use toggleColumn, showAllColumns, or resetToDefault.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `config` | `UseTableColumnSettingsStateConfig<TColumnKey>` | - | The columns to configure and active keys state management. **(required)** |
| `config.columns` | `ReadonlyArray<ColumnSettingsOption<TColumnKey>>` | - | All available columns with metadata (key, label, isAlwaysVisible, group) for the settings UI. **(required)** |
| `config.activeColumnKeys` | `ReadonlyArray<TColumnKey>` | - | Currently active column keys, in display order. Only columns in this list render in the table. **(required)** |
| `config.onChangeActiveColumnKeys` | `(keys: ReadonlyArray<TColumnKey>) => void` | - | Called when active columns change (via toggle, show all, or reset) to update consumer state. **(required)** |
| `config.defaultColumnKeys` | `ReadonlyArray<TColumnKey>` | - | Default column set restored by resetToDefault. When omitted, resetToDefault activates all columns. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `columnSettingsConfig` | `UseTableColumnSettingsStateConfig<TColumnKey>` | Ready-to-use config to pass directly to useTableColumnSettings(columnSettingsConfig). |
| `activeColumnKeys` | `ReadonlyArray<TColumnKey>` | Pass-through of currently active column keys in display order. |
| `toggleColumn` | `(key: TColumnKey) => void` | Toggles column visibility: removes an active column or appends an inactive column. No-op for isAlwaysVisible columns. |
| `isColumnActive` | `(key: TColumnKey) => boolean` | Whether a specific column is currently in the active column keys list. |
| `isColumnToggleable` | `(key: TColumnKey) => boolean` | Whether a specific column can be toggled (returns false if isAlwaysVisible is true). |
| `showAllColumns` | `() => void` | Activates all configured columns in the table. |
| `resetToDefault` | `() => void` | Resets active column keys to defaultColumnKeys (or all columns if defaultColumnKeys is omitted). |
| `setActiveColumnKeys` | `(keys: string[]) => void` | Sets active column keys from a list of key strings, enforcing that isAlwaysVisible columns remain active. |


Block templates: astryx component <name> --blocks for Table
