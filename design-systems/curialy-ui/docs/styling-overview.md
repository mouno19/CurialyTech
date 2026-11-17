package: @curialy/ui

# Styling overview

How to set up CSS — exact imports for three paths: plain, Tailwind, and StyleX for your own code — plus the stylesheet each Curialy UI package ships.

## Pick a path

Path                     | Good for                                                                                           | Build step?
------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------
Plain CSS                | Most apps. Style with className, xstyle, or any CSS library.                                       | None.
Tailwind                 | Apps on Tailwind v4. A CSS bridge maps utility classes to design tokens.                           | None beyond Tailwind's own.
StyleX for your own code | Your own `stylex.create()` styles and swizzled (ejected) components. Curialy UI itself stays prebuilt. | Yes — a StyleX plugin for your own code.

All three load the same prebuilt Curialy UI stylesheets, resolve to the same design tokens, and support theming and dark mode. None of them compiles Curialy UI package source. You can mix them in one app.

## Plain CSS

Install:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
```

globals.css:
```css
@import "@curialy/ui/reset.css";
@import "@curialy/ui/styles.css";
@import "@curialy/ui-theme-neutral/theme.css";
```

Done. Components work out of the box — style them with `className`, `xstyle`, or `style`. Swap `theme-neutral` for any theme package (`design_system theme list` shows what's available).

## Tailwind

Install:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
```

globals.css:
```css
@layer reset, theme, base, cui-base, cui-theme, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "@curialy/ui/reset.css";
@import "@curialy/ui/styles.css";
@import "@curialy/ui-theme-neutral/theme.css";
@import "@curialy/ui/tailwind-theme.css";
@import "tailwindcss/utilities.css" layer(utilities);
```

The `@layer` declaration is critical — without it, component styles outrank Tailwind utilities and `className` overrides stop working. The bridge (`tailwind-theme.css`) maps classes like `text-primary`, `bg-surface`, and `rounded-lg` to design tokens with no JS.

A project with Tailwind already set up needs a smaller change, which `design_system docs styling-libraries/tailwind` shows. For Tailwind v3, see the layer workaround in `design_system docs migration/migration-setup`.

## StyleX for your own code

Only needed when you write your own StyleX (`stylex.create()`) or swizzle a component (`design_system swizzle <Component>`), which copies its StyleX source into your app. The plain path already supports `xstyle` overrides — this path is for your own StyleX code. Some built-in page templates also use StyleX for layout; if you scaffold one and see "Unexpected stylex.create call at runtime", add the compiler plugin for your bundler below.

Install:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
```

globals.css:
```css
@import "@curialy/ui/reset.css";
@import "@curialy/ui/styles.css";
@import "@curialy/ui-theme-neutral/theme.css";
```

Keep `styles.css`: Curialy UI component styles always come from the prebuilt stylesheets. Point the StyleX compiler at your own source only, never at `node_modules/@cuidesign`. Add the plugin for your bundler:

Bundler                  | Plugin
------------------------ | -------------------------------------------------
Webpack                  | @stylexjs/webpack-plugin
Vite / Rollup            | @stylexjs/rollup-plugin
Babel (any)              | @stylexjs/babel-plugin + @stylexjs/postcss-plugin
Next.js (keep next/font) | @stylexswc/nextjs-plugin

If a swizzled component fails at runtime with a `stylex.create` error, the app is missing a StyleX compiler: see the StyleX Build Setup section of `design_system docs styling/tokens-and-setup`.

`design_system swizzle <Component>` writes an `cui-swizzle.json` marker into an output folder it owns (one the copy creates, an empty one, or one it marked before); every module under that folder then compiles as Curialy UI source, so keep copies in a folder of their own, such as the default `components/cui`. For a folder that already holds other files it writes no marker and says how to add one by hand. With `@curialy/ui-build`'s Babel, PostCSS and Vite integrations, or `withCui()` under webpack, a copy under that folder compiles into `cui-base`, below `cui-theme`, so theme component overrides reach it as they reach the package component. Under Turbopack, and with the stock StyleX plugins above, a copy's rules land in your own styles, above `cui-theme`, and theme component overrides do not reach it.

## Other Curialy UI packages

Every Curialy UI package whose components carry styles ships its own prebuilt stylesheet. Import it after `styles.css` for each package you use. All of them place their rules in the same `cui-base` layer, so your theme overrides win over every package.

globals.css:
```css
@import "@curialy/ui/reset.css";
@import "@curialy/ui/styles.css";
@import "@curialy/ui-richtext/richtext.css"; /* Rich Text */
@import "@curialy/ui-lab/lab.css"; /* Lab */
@import "@curialy/ui-charts/charts.css"; /* Charts */
@import "@curialy/ui-theme-neutral/theme.css";
```

Package                | Stylesheet
---------------------- | -----------------------------------
@curialy/ui     | @curialy/ui/styles.css
@curialy/ui-richtext | @curialy/ui-richtext/richtext.css
@curialy/ui-lab      | @curialy/ui-lab/lab.css
@curialy/ui-charts   | @curialy/ui-charts/charts.css

## What each import does

Import                            | Layer        | Purpose
--------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------
reset.css                         | reset        | Cross-browser reset (box-sizing, margins, color-scheme). Zero specificity via :where().
styles.css                        | cui-base  | Prebuilt component styles. Required on every path.
richtext.css, lab.css, charts.css | cui-base  | Prebuilt styles for each other Curialy UI package you use. Load after styles.css.
theme.css                         | cui-theme | Design tokens (colors, spacing, radius, typography) as CSS custom properties. Swap the package for a different theme.
tailwind-theme.css                | —            | Tailwind v4 bridge. Maps utility classes to design tokens. Pure CSS, no JS. Tailwind path only.

## Further reading

- `design_system docs styling` — xstyle, className, data-attribute selectors, design tokens in code.
- `design_system docs styling-libraries` — Tailwind bridge details, Panda, Chakra, MUI, CSS Modules, and non-CSS token resolution.
- `design_system docs use-a-theme` — applying themes, dark mode, nested themes. `design_system docs author-a-theme` — defineTheme, overrides, production builds.
- `design_system docs migration` — cascade layer audit, Tailwind v3 coexistence, and foundation smoke test.

Up: design_system docs guides
Previous: design_system docs principles
Next: design_system docs theme
