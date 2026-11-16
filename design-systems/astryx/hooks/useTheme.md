package: @astryxdesign/core

# useTheme

Programmatic access to theme tokens for non-CSS consumers like SVG, canvas, Vega, D3, maps, or chart libraries that need values in JavaScript instead of CSS custom property references.

## Best Practices

- **Do:** Use tokens or token(name) when integrating theme colors into SVG attributes, canvas drawing, chart options, or other non-CSS configuration objects inside React components.
- **Do:** Use resolveThemeTokens(theme, {mode}) for the same token resolution outside React hooks.
- **Do:** Prefer CSS variables or StyleX tokens for ordinary component styling; use this hook only when JavaScript needs token values.
- **Do:** Use data visualization tokens such as --color-data-categorical-blue for chart series instead of arbitrary UI colors.
- **Don't:** Hardcode light/dark colors in data visualizations: resolve them through the current theme instead.
- **Don't:** Assume the hook reflects every CSS cascade override. It resolves tokens for the current Theme mode; local media-surface overrides and arbitrary external CSS may not be represented.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Name of the nearest theme, or default when no provider is present. |
| `mode` | `'light' \| 'dark'` | Resolved effective color mode. system mode is resolved to light or dark. |
| `token` | `(name: string) => string` | Resolve a single design token to its current CSS value for the effective mode. |
| `tokens` | `Record<string, string>` | All tokens resolved for the current mode, including defaults and theme overrides. Stable until the active theme or mode changes; uses the same resolution logic as resolveThemeTokens(theme, {mode}). |


Block templates: astryx component <name> --blocks for Theme
