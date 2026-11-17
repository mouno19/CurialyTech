package: @curialy/ui

# Font Setup

Font families, custom font loading, geometric font sizes, and semantic font weights.

## Overview

Typography is built on a geometric type scale: base size × ratio^step, with 14px and 1.2 as defaults. Every text style is a semantic token that composes font size, weight, and line-height, so components express intent (heading, body, label) rather than raw values.

Two layers work together: raw size tokens (--font-size-xs ... --font-size-5xl) form the geometric scale, and semantic type scale tokens (--text-heading-1-size, --text-body-leading, etc.) reference them by var(). Themes override the entire scale by adjusting base and ratio in defineTheme; all semantic tokens recompute automatically.

## Font Families

Three font roles: body (UI text), heading (titles and headings), and code (monospace). By default, body and heading share the same system font stack; code uses a monospace stack. Custom themes can assign different families per role; heading inherits from body when not explicitly set.

Font family stacks for body, code, and heading text.

Token                 | Core default
--------------------- | -----------------------------------------------------------------------------------
--font-family-body    | -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif
--font-family-code    | "SF Mono", Monaco, Consolas, monospace
--font-family-heading | -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif

## Custom fonts

Curialy UI never loads font files. defineTheme and the built CSS only set font-family: naming a webfont (Fraunces, JetBrains Mono, and so on) makes every browser look for it, and quietly fall back when the app has not loaded it. `design_system theme build` warns when a theme names families that are neither CSS generics nor common system fonts and prints the snippet to add; loading the font is always the app's job.

Google Fonts: add to your document <head>:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=JetBrains+Mono&display=swap"
/>
```

Self-hosted: one @font-face per family and weight:
```css
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/fraunces.woff2') format('woff2');
  font-weight: 400 700; /* variable-font range, or one weight per file */
  font-display: swap; /* fallback text stays visible while the font loads */
}
```

Always pair a webfont with a real fallback stack (metric-similar system fonts plus a generic) so text stays readable before the font loads and wherever it never does: defineTheme({typography: {heading: {family: 'Fraunces', fallbacks: 'Georgia, serif'}}}).

## Font Sizes

Geometric scale: round(base × ratio^step), expressed in rem. The default scale is 14px × 1.2, producing 12 steps from 4xs (6px) to 5xl (42px). Adjusting base and ratio in defineTheme regenerates every size token while preserving proportional relationships.

Geometric type scale: round(14 × 1.2^step). Base is 14px (--font-size-base).

Token            | Core default
---------------- | ------------
--font-size-4xs  | 0.375rem
--font-size-3xs  | 0.4375rem
--font-size-2xs  | 0.5rem
--font-size-xs   | 0.625rem
--font-size-sm   | 0.75rem
--font-size-base | 0.875rem
--font-size-lg   | 1.0625rem
--font-size-xl   | 1.25rem
--font-size-2xl  | 1.5rem
--font-size-3xl  | 1.8125rem
--font-size-4xl  | 2.1875rem
--font-size-5xl  | 2.625rem

## Font Weights

Four semantic weights: normal (400, body/code), medium (500, labels/data), semibold (600, headings/titles), bold (700, strong emphasis). Type scale tokens reference these by var() so themes can remap numeric values.

Font weight values for body, emphasis, and headings.

Token                  | Core default
---------------------- | ------------
--font-weight-normal   | 400
--font-weight-medium   | 500
--font-weight-semibold | 600
--font-weight-bold     | 700

Up: design_system docs typography
Next: design_system docs typography/type-scale
