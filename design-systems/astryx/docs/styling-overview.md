package: @astryxdesign/cli

# Styling overview

How to set up CSS — exact imports for three paths: plain, Tailwind, and StyleX for your own code — plus the stylesheet each Astryx package ships.

## Pick a path

Path                     | Good for                                                                                           | Build step?
------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------
Plain CSS                | Most apps. Style with className, xstyle, or any CSS library.                                       | None.
Tailwind                 | Apps on Tailwind v4. A CSS bridge maps utility classes to design tokens.                           | None beyond Tailwind's own.
StyleX for your own code | Your own `stylex.create()` styles and swizzled (ejected) components. Astryx itself stays prebuilt. | Yes — a StyleX plugin for your own code.

All three load the same prebuilt Astryx stylesheets, resolve to the same design tokens, and support theming and dark mode. None of them compiles Astryx package source. You can mix them in one app.

## Plain CSS

Install:
```bash
npm install @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral
```

globals.css:
```css
@import "@astryxdesign/core/reset.css";
@import "@astryxdesign/core/astryx.css";
@import "@astryxdesign/theme-neutral/theme.css";
```

Done. Components work out of the box — style them with `className`, `xstyle`, or `style`. Swap `theme-neutral` for any theme package (`astryx theme list` shows what's available).

## Tailwind

Install:
```bash
npm install @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral
```

globals.css:
```css
@layer reset, theme, base, astryx-base, astryx-theme, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "@astryxdesign/core/reset.css";
@import "@astryxdesign/core/astryx.css";
@import "@astryxdesign/theme-neutral/theme.css";
@import "@astryxdesign/core/tailwind-theme.css";
@import "tailwindcss/utilities.css" layer(utilities);
```

The `@layer` declaration is critical — without it, component styles outrank Tailwind utilities and `className` overrides stop working. The bridge (`tailwind-theme.css`) maps classes like `text-primary`, `bg-surface`, and `rounded-lg` to design tokens with no JS.

A project with Tailwind already set up needs a smaller change, which `astryx docs styling-libraries/tailwind` shows. For Tailwind v3, see the layer workaround in `astryx docs migration/migration-setup`.

## StyleX for your own code

Only needed when you write your own StyleX (`stylex.create()`) or swizzle a component (`astryx swizzle <Component>`), which copies its StyleX source into your app. The plain path already supports `xstyle` overrides — this path is for your own StyleX code. Some built-in page templates also use StyleX for layout; if you scaffold one and see "Unexpected stylex.create call at runtime", add the compiler plugin for your bundler below.

Install:
```bash
npm install @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral
```

globals.css:
```css
@import "@astryxdesign/core/reset.css";
@import "@astryxdesign/core/astryx.css";
@import "@astryxdesign/theme-neutral/theme.css";
```

Keep `astryx.css`: Astryx component styles always come from the prebuilt stylesheets. Point the StyleX compiler at your own source only, never at `node_modules/@astryxdesign`. Add the plugin for your bundler:

Bundler                  | Plugin
------------------------ | -------------------------------------------------
Webpack                  | @stylexjs/webpack-plugin
Vite / Rollup            | @stylexjs/rollup-plugin
Babel (any)              | @stylexjs/babel-plugin + @stylexjs/postcss-plugin
Next.js (keep next/font) | @stylexswc/nextjs-plugin

If a swizzled component fails at runtime with a `stylex.create` error, the app is missing a StyleX compiler: see the StyleX Build Setup section of `astryx docs styling/tokens-and-setup`.

`astryx swizzle <Component>` writes an `astryx-swizzle.json` marker into an output folder it owns (one the copy creates, an empty one, or one it marked before); every module under that folder then compiles as Astryx source, so keep copies in a folder of their own, such as the default `components/astryx`. For a folder that already holds other files it writes no marker and says how to add one by hand. With `@astryxdesign/build`'s Babel, PostCSS and Vite integrations, or `withAstryx()` under webpack, a copy under that folder compiles into `astryx-base`, below `astryx-theme`, so theme component overrides reach it as they reach the package component. Under Turbopack, and with the stock StyleX plugins above, a copy's rules land in your own styles, above `astryx-theme`, and theme component overrides do not reach it.

## Other Astryx packages

Every Astryx package whose components carry styles ships its own prebuilt stylesheet. Import it after `astryx.css` for each package you use. All of them place their rules in the same `astryx-base` layer, so your theme overrides win over every package.

globals.css:
```css
@import "@astryxdesign/core/reset.css";
@import "@astryxdesign/core/astryx.css";
@import "@astryxdesign/richtext/richtext.css"; /* Rich Text */
@import "@astryxdesign/lab/lab.css"; /* Lab */
@import "@astryxdesign/charts/charts.css"; /* Charts */
@import "@astryxdesign/theme-neutral/theme.css";
```

Package                | Stylesheet
---------------------- | -----------------------------------
@astryxdesign/core     | @astryxdesign/core/astryx.css
@astryxdesign/richtext | @astryxdesign/richtext/richtext.css
@astryxdesign/lab      | @astryxdesign/lab/lab.css
@astryxdesign/charts   | @astryxdesign/charts/charts.css

## What each import does

Import                            | Layer        | Purpose
--------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------
reset.css                         | reset        | Cross-browser reset (box-sizing, margins, color-scheme). Zero specificity via :where().
astryx.css                        | astryx-base  | Prebuilt component styles. Required on every path.
richtext.css, lab.css, charts.css | astryx-base  | Prebuilt styles for each other Astryx package you use. Load after astryx.css.
theme.css                         | astryx-theme | Design tokens (colors, spacing, radius, typography) as CSS custom properties. Swap the package for a different theme.
tailwind-theme.css                | —            | Tailwind v4 bridge. Maps utility classes to design tokens. Pure CSS, no JS. Tailwind path only.

## Further reading

- `astryx docs styling` — xstyle, className, data-attribute selectors, design tokens in code.
- `astryx docs styling-libraries` — Tailwind bridge details, Panda, Chakra, MUI, CSS Modules, and non-CSS token resolution.
- `astryx docs use-a-theme` — applying themes, dark mode, nested themes. `astryx docs author-a-theme` — defineTheme, overrides, production builds.
- `astryx docs migration` — cascade layer audit, Tailwind v3 coexistence, and foundation smoke test.

Up: astryx docs guides
Previous: astryx docs principles
Next: astryx docs theme
