package: @curialy/ui

# Theme

Wraps subtree w/ specific Curialy UI theme. For static production themes, use `design_system theme build` + generated CSS + built theme object for first-paint/SSR performance. Use runtime `defineTheme()` for dynamic themes or prototyping. Token names always start with `--` (e.g. `--color-accent`, `--color-background-surface`).

**Import:** `import {Theme} from '@curialy/ui/theme';`

## Best Practices

- **Do:** Build app themes known ahead of time w/ `design_system theme build`; import generated CSS + built theme object.
- **Do:** Use runtime themes when theme is created/edited in browser, e.g. theme editor, user branding, prototype.
- **Do:** Token names always start with `--` (e.g. `--color-accent`, `--color-background-surface`). Do not omit the prefix.
- **Don't:** Default to runtime themes in SSR production apps. Component overrides inject after hydration instead of static CSS.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `theme` | `DefinedTheme` | - | theme object to apply. Prefer built theme objects for static production themes; use runtime `defineTheme()` for dynamic themes. **(required)** |
| `mode` | `'light' \| 'dark' \| 'system'` | `'system'` | color mode. System follows OS preference. defaults to "system" |
| `children` | `ReactNode` | - | Content to render with the theme. **(required)** |
