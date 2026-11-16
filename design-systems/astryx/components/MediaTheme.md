package: @astryxdesign/core

# MediaTheme

Token overrides for content on inverted surfaces: media overlays, scrims, toasts, tooltips. Base behavior flips color-scheme so all light-dark() tokens resolve to correct side; only a small set of tokens need explicit overrides beyond that. Themes can further customize component appearance on media surfaces via onDark/onLight in defineTheme(), w/ token overrides (e.g. "--color-accent": "#90CAF9") + component overrides (e.g. ghost buttons get border on dark surfaces).

**Import:** `import {MediaTheme} from '@astryxdesign/core/theme';`

## Best Practices

- **Do:** Use for any content over dark background (image overlays, video scrims, dark cards) or other inverted surfaces like toasts/tooltips.
- **Do:** Prefer mode="auto" when surface color comes from a theme token; a token named "inverted" is not guaranteed to be; auto measures what was painted.
- **Do:** Pair w/ background color: MediaTheme flips token context but does NOT add background. Set backgroundColor on parent element.
- **Do:** Themes can customize components on media surfaces via onDark.components + onLight.components in defineTheme(). E.g. add border to ghost buttons on dark surfaces.
- **Don't:** Use MediaTheme for app-level dark mode: use Theme w/ mode="dark"/mode="system" instead. MediaTheme is for local surface inversions, not page-wide color scheme.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `mode` | `'dark' \| 'light' \| 'auto' \| 'off'` | - | surface luminance context: dark for content over dark backgrounds (light text, white-tinted interactions), light for content over light backgrounds (dark text, black-tinted interactions), auto to decide from painted surface (none if ambient text already reads at 3:1, else better-reading side), off to turn off explicitly (element still renders, so children never remount) **(required)** |
| `fallback` | `'dark' \| 'light'` | `'dark'` | side auto uses when surface is unmeasurable (SSR, first frame, background-image, which needs useImageMode sampling); ignored unless mode is auto |
| `children` | `ReactNode` | - | Content to render with inverted token context. Components inherit the correct colors automatically. **(required)** |
