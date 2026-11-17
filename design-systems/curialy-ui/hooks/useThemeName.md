package: @curialy/ui

# useThemeName

Reads only the active theme name. Use it when code needs to know which theme is on, and does not need tokens or the color mode. It reads ThemeContext when a Theme is above the caller, and otherwise the root theme name on the document element.

## Best Practices

- **Do:** Use this hook for theme identity, such as picking a semantic icon for the active theme.
- **Do:** Use useTheme when the caller also needs token values or the resolved light or dark mode.
- **Don't:** Treat null as the name default. Null means no theme name is available.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string \| null` | The nearest Theme name. Null when no Theme context is present and the root has not set a theme name. |


Block templates: design_system component <name> --blocks for Theme
