package: @curialy/ui

# Author a theme

Start here: the experimental theme editor makes and changes themes for you (`design_system experimental theme editor new <name> --like neutral`; see the theme doc), checked against what components read. By hand: create, customize, and build a theme: defineTheme, palette generation, token overrides, component style overrides, custom variants, responsive adaptations, and production builds.

## Custom themes

Use an installed built theme as the base for ordinary customization. Import it into your source and pass it as `extends` to `defineTheme({extends: importedTheme, ...})`. Build the result, then add the local slug. Only eject when you need to own and maintain a full source fork.

A local theme is a folder in `src/themes/<slug>/` holding a `<name>Theme.ts` source that exports `<name>Theme`, and a same-stem `<name>Theme.doc.mjs` descriptor that `theme add` reads. The stem must be a valid export name, so a hyphenated slug drops the hyphen: `brand-dark` lives in `src/themes/brand-dark/brandDarkTheme.ts` exporting `brandDarkTheme`, beside `brandDarkTheme.doc.mjs`. The descriptor's `name` is the folder's slug, and it must declare its type or `theme add` and `theme list` refuse it. `design_system docs authoring theme-doc` lists every field.

src/themes/brand-dark/brandDarkTheme.doc.mjs:
```js
/** @type {import('@curialy/ui-cli/authoring').ThemeDoc} */
export default {
  type: 'theme',
  name: 'brand-dark',
  displayName: 'Brand Dark',
  description: 'The brand accent, tuned for dark mode.',
  maintained: false,
};
```

Add to use, eject to fork:
```bash
design_system theme list
design_system theme add stone
design_system theme eject stone
design_system theme build src/themes/stone/stoneTheme.ts
design_system theme add stone
```

For an annotated map of the whole surface (every defineTheme field, the token families, and the component override syntax, each with the CLI command that prints its reference), run `design_system theme template`. It writes `theme.template.ts` into your project to read and copy from (`design_system init --features theme` writes it as part of project setup).

To apply a theme you created, see `design_system docs use-a-theme`. To generate colors from seed values, see the Palette section below. Before you eject a package theme instead, see when that fits in `design_system docs use-a-theme`.

## Generate a palette

Name a few seed colors and generate every shade a theme needs, light and dark; `design_system docs authoring/building-blocks/themes/generate-a-palette` explains what a palette holds.

Minimal palette config (palette.config.json):
```json
{"families": [{"id": "ocean", "seed": "#0074e2"}]}
```

Generate and preview:
```bash
# Print the palette without writing files
design_system theme palette generate palette.config.json

# Write palette + receipt, and open a visual preview
design_system theme palette generate palette.config.json \
  --out src/themes/ocean/tokens/ocean.palette.ts \
  --preview preview.html
```

The command writes a `.ts` file exporting 21 shades (stops 0–100) for both light and dark, plus a `.receipt.json` to regenerate later. Point your theme's tokens at the palette, then run defineTheme (see below).

For the full palette config fields and CLI flags, run `design_system docs cli/commands/theme-palette-generate`. For the integration-authoring walkthrough of connecting a palette to theme tokens, run `design_system docs authoring/building-blocks/themes/generate-a-palette`.

## defineTheme

defineTheme creates a theme from explicit token overrides and optional scale configs. Existing themes may use `color` to expand an accent seed into neutral, surface, text, border, and related values; it is not an accent-only edit. Keep that configuration when preserving existing output. For new complete palettes, generate and review a committed palette module, then import its `palette` export and reference stable stops from semantic tokens. This keeps mapped roles coherent when the accepted palette is regenerated; generation itself does not rewrite the theme. Other scale configs generate typography, radius, and motion values from parameters. Explicit token overrides always take precedence over scale-generated values, token by token. When an existing `color` config is in use, overriding `--color-accent` in `tokens` re-points `--color-accent-muted`, `--color-text-accent`, and `--color-icon-accent`, but `--color-on-accent` stays baked from the `color.accent` seed. Prefer a `[light, dark]` tuple for `color.accent` over overriding `--color-accent` alone. localTokens accepts any valid CSS custom-property name; prefixes do not establish ownership.

defineTheme with generated palette references and non-color scale configs:
```tsx
import {defineTheme} from '@curialy/ui/theme';
import {palette} from './palette.generated';

const myTheme = defineTheme({
  name: 'my-theme',
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'Inter', fallbacks: '-apple-system, sans-serif' },
  },
  radius: { base: 4, multiplier: 1 },
  motion: { fast: 175, medium: 410, ratio: 0.75 },
  tokens: {
    '--color-background-surface': [
      palette.neutral.light[100],
      palette.neutral.dark[15],
    ],
  },
});
```

Config                       | Generates                                                                                      | Parameters
---------------------------- | ---------------------------------------------------------------------------------------------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
color (existing themes)      | --color-accent, --color-background-*, --color-text-*, --color-border, etc.                     | Supported broad scale: accent? (hex or [light, dark] tuple), neutralStyle? (warm\|cool\|neutral), contrast? (standard\|high). Use theme palette generate for new complete palettes.
typography.scale             | --text-heading-*-size/weight/leading, --text-body-size/weight/leading                          | base (px), ratio
typography.body/heading/code | --font-family-body, --font-family-heading, --font-family-code                                  | family, fallbacks?, url?, weight?
radius                       | --radius-inner, --radius-element, --radius-container, --radius-page, --radius-chat             | base (px), multiplier (0–2)
motion                       | Every --duration-* token, --ease-entrance and --ease-move (tempo also times the touch springs) | tempo? (0.75–1.5), character? (crisp\|standard\|expressive); and/or a duration scale: fast (ms), medium (ms), ratio, slow?, easing?. The scale wins over tempo for the durations it sets, and explicit tokens win over both. Fixed whatever the knobs say: drags and momentum, rubber band, keyboard, press onset/cancel/flash, hover intent, gesture thresholds, Spinner/Skeleton loops, the 200 ms Reduce Motion cap. See `design_system docs motion`.

For dark mode tuples in token values, see the Dark mode section of `design_system docs use-a-theme`.

## Extending a Theme

`extends` lets you derive a new theme from an existing one, inheriting its tokens, component overrides, icons, and fonts. Only specify what you want to change; everything else carries over from the base theme.

Extending the neutral theme:
```tsx
import {defineTheme} from '@curialy/ui/theme';
import {neutralTheme} from '@curialy/ui-theme-neutral';
import {myIcons} from './icons';

const brandTheme = defineTheme({
  name: 'brand',
  extends: neutralTheme,
  icons: myIcons,
  tokens: {
    '--color-accent': ['#7B61FF', '#9B85FF'],
  },
});
```

Field                     | Merge behavior
------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
tokens                    | Base tokens are copied first, then child tokens override on top.
components                | Deep-merged: child component rules override matching keys from the base.
icons                     | Shallow-merged: child icons override matching names from the base.
iconVariants              | Replaced, never merged: a child that sets iconVariants replaces the base list; a child that omits it inherits the list.
componentIcons            | Merged by slot: a child entry replaces the base entry for that slot whole; an omitted or undefined entry keeps the inherited one.
indicators                | Shallow-merged: child indicators override matching names from the base.
onDark, onLight           | Deep-merged per surface: the base's resolved surface first, then the child's overrides.
motion                    | Field by field: the child's `fast`, `medium` and `ratio` regenerate the fast and medium duration tokens; `slow` and `easing` left unset keep the base theme's tokens, so an inherited slow band stays at the base's ratio. Each knob (`tempo`, `character`) the child leaves unset keeps the base's.
typography, radius, color | Child config replaces base entirely (these are scale inputs, not additive).
adaptations               | Width-breakpoint overrides merge by fixed name. Inherited ordered rules keep their relative order; child rules append and re-resolve against the child root axes.

Inheritance is resolved when the theme is defined, so an extended theme is flat: `design_system theme build` emits one self-contained stylesheet holding everything the child inherited, and the base theme's CSS does not need to be loaded next to it. A base that is not a theme (most often an import that missed) throws when `defineTheme` runs, rather than producing a theme that silently inherits nothing.

For the integration-specific guidance on mapping a palette to tokens when extending, see `design_system docs authoring/building-blocks/themes/define-the-theme`.

## Component Style Overrides

The `components` field in defineTheme uses semantic component keys and style keys, not raw CSS selectors. Use `base` for all instances, `variant:value` or `stateName` for specific props/states, and let the theme pipeline choose the underlying selector. For raw external CSS escape hatches, prefer the data-attribute selector surface documented in `design_system docs styling/styling-advanced`.

Component overrides with standard CSS:
```tsx
components: {
  card: {
    base: { borderRadius: '20px', padding: '24px' },
  },
  button: {
    base: {
      borderRadius: '9999px',
      textTransform: 'uppercase',
      '--button-focus-offset': '3px',
    },
    'variant:ghost': { borderWidth: '2px', borderStyle: 'solid' },
  },
}
```

Run `design_system theme targets` for every themeable key in the system (`design_system theme targets <Name>` to scope it, `--json` to lint a theme against it), and `design_system component <Name>` for one component's theming targets, public CSS variables, and which standard CSS properties are supported.

+ Write standard CSS properties (borderRadius, padding); the pipeline expands them into internal vars.
+ Set public CSS vars directly when no standard property equivalent exists.

x Set private CSS vars (prefixed --_) directly. Use standard CSS properties instead. `design_system theme build` will error.
x Set a public CSS var the component does not define. It compiles to CSS that never applies, and the build does not warn. Take the names from `design_system component <Name>`.

## Custom Variants

Themes can add new prop values to any component. Any `prop:value` key where the value isn't a built-in gets treated as a new variant. Use `design_system theme build` to generate TypeScript augmentations for type safety.

Adding custom variants:
```tsx
components: {
  button: {
    'variant:secondary': { backgroundColor: 'rgba(0,0,0,0.06)' },
    'variant:primary-muted': {
      backgroundColor: 'light-dark(#F2F4F6, #28292C)',
      color: 'var(--color-text-primary)',
    },
  },
  banner: {
    'status:neutral': {
      backgroundColor: 'var(--color-background-muted)',
      color: 'var(--color-text-secondary)',
    },
  },
}
```

Using custom variants:
```tsx
// TypeScript knows about 'primary-muted' after design_system theme build
<Button variant="primary-muted" label="Save draft" />
<Banner status="neutral" title="Note" />
```

Custom variants only work when the theme that defines them is active. The component's variant map is extended via module augmentation, with no changes to the component source needed.

## Theme Adaptations

Use `adaptations` for opt-in token, theme-local token, and component changes under viewport width, primary-pointer precision, contrast preference, or motion preference. Conditions in one `when` are ANDed. Rules are ordinary ordered objects, and later matching writes win.

Width and pointer adaptations:
```tsx
const acmeTheme = defineTheme({
  name: 'acme',
  adaptations: {
    widthBreakpoints: {
      sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536,
    },
    rules: [
      {
        when: {width: {below: 'md'}},
        value: {tokens: {'--spacing-4': '12px'}},
      },
      {
        when: {pointer: 'coarse'},
        value: {tokens: {'--size-element-sm': '36px', '--size-element-md': '40px', '--size-element-lg': '44px'}},
      },
    ],
  },
});
```

Condition                | Values
------------------------ | -----------------------------
width.from / width.below | sm \| md \| lg \| xl \| 2xl
pointer                  | coarse \| fine
contrast                 | more \| less \| no-preference
motion                   | reduce \| no-preference

`widthBreakpoints` are fixed named start points. Defaults are 640 / 768 / 1024 / 1280 / 1536 CSS pixels. `from` includes its point; `below` excludes it. Breakpoint configuration alone emits no CSS.

## Adaptation order and validation

Precedence follows rule order. Root theme values apply first, then every matching rule in declaration order. A later rule may deliberately restore a root value. `onDark` and `onLight` media-surface overrides apply after adaptations and win on the same leaf.

`extends` preserves the base rule order and appends child rules. Inherited conditions use the child's effective breakpoint map. An empty child rule is a no-op, not a removal operator.

A rule may replace a theme-local token only when the exact name is already enrolled by root `localTokens` or an enrolled base. Component writes in a rule are validated exactly like root `components`: same targets, axes, and value domains. The one addition is that a rule may not be the only place a custom value is enrolled: a value that is valid only because a theme enrolls it generates unconditional type augmentation, so declare it on the root theme first and let rules restyle it. Built-in values need no root declaration. When rules can match together, their ordered portable and local token writes are validated as one effective graph; any reachable cycle fails before CSS is emitted.

Adaptations compile to CSS media queries with no resize listener or styling rerender. Runtime and `design_system theme build` use the same compiler, but only a built theme is present at first paint in an SSR app.

## Build a theme

`design_system theme build` compiles a defineTheme file into production-ready artifacts. Recommended for SSR apps (Next.js, Remix) where styles must be present on first paint.

Build a theme:
```bash
design_system theme build ./src/themes/ocean.ts
```

File                | Description
------------------- | ----------------------------------------------------------------------------------------------------
ocean.css           | Pre-compiled CSS with token overrides, component overrides, and prose element styles in @scope rules
ocean.js            | ES module exporting the theme object with `__built: true` and pre-resolved token values.
ocean.d.ts          | TypeScript declarations for the theme and icon registry exports
ocean.variants.d.ts | (Optional) Module augmentations for custom component prop values

The `__built: true` flag tells Theme to skip runtime `<style>` injection; the CSS file handles it. Load the generated CSS wherever you load the module.

Using a custom built theme:
```tsx
import {Theme} from '@curialy/ui/theme';
import {oceanTheme} from './themes/ocean';
import './themes/ocean.css';

<Theme theme={oceanTheme}>
  <App />
</Theme>
```

After upgrading Curialy UI, rerun `design_system theme build` for every custom prebuilt theme. Deploy the regenerated files together. The runtime intentionally trusts `__built: true` and will not repair stale CSS from an older build. The build also warns when the theme names font families it does not load. See `design_system docs typography/font-setup` for the full recipe.

For the runtime vs built tradeoff, see the Runtime vs Built section of `design_system docs use-a-theme`.

## Built themes with an icon registry

`theme build` emits an icon import when it detects a named import used by the theme's `icons:` field. It does not compile that registry module. Move the registry to a separate module and use a named import.

Compiling the icon registry sidecar:
```bash
# Emit the built theme
design_system theme build ./src/themes/ocean.ts -o dist/theme.css --icons-specifier ./icons.mjs

# Compile the icon registry alongside it
esbuild src/themes/icons.tsx --bundle --format=esm --outfile=dist/icons.mjs \
  --external:react --external:lucide-react --jsx=automatic
```

In the example above, the generated theme imports `./icons.mjs` from `dist`. If the second command is skipped, `theme build` can still succeed, but loading or bundling the generated module fails because `dist/icons.mjs` is missing. `--icons-specifier` changes the emitted import; it does not create or verify the target file. Match the specifier to a module that resolves from the generated JS file.

Without `--icons-specifier`, the detected source import specifier is emitted unchanged. In the default flow without `--out`, a bundler can resolve an extensionless `./icons` to the neighboring `icons.tsx` source, but Node ESM does not perform that lookup and reports `ERR_MODULE_NOT_FOUND`. Moving the output with `--out` also changes where relative imports resolve from.

Keep `react` and the icon library external so the registry does not bundle its own copies of those dependencies.

A registry entry can be a function of `{size, variant}`. The built theme keeps the function, so `Icon` asks it for the size and variant it renders, as the runtime theme does, including for entries inherited from a built or package theme. The built theme's `icons` field and the registry its module re-exports are React nodes, with each function read at size `md`. A function written in the theme file itself cannot be carried, so the build fails; move it into the registry module.

A theme that lists `iconVariants` also writes an `IconVariantMap` augmentation into `<theme>.variants.d.ts`, so `Icon`'s `variant` accepts those names wherever the theme's types load. Its declaration carries the list too, so a theme that extends the built theme types `variant` in its icon entries by that list.

A built theme keeps its `componentIcons`. Names, `null` values, and static requests are written into the module. A slot function stays a function: the module imports it from the module the theme source imports it from, so component slots resolve the same for the built theme as for the runtime theme. The built theme's `componentIcons` field leaves out slot functions, as the runtime theme's does. A slot function defined in the theme file fails the build: move it to its own module and import it. In `--family` output, a member supplies its own slot functions through a named import of its whole `componentIcons` map. The module keeps each slot import as the theme source spells it, and `--icons-specifier` does not change it, so with `--out` in another directory, make a module answer to that specifier from the output directory, as for the icon registry.

## Building a Theme Family

Use family mode when an app switches among one base theme and its selected descendants. The build writes one keyed CSS file containing every member, plus one keyed JavaScript module and one declaration file, beside the root source.

Build one family:
```bash
design_system theme build --family \
  ./src/themes/ocean.mjs \
  ./src/themes/ocean-calm.mjs \
  ./src/themes/ocean-calm-deep.mjs \
  --family-key ocean-family
```

The family stylesheet eagerly downloads every selected member so first paint is complete. Switching members changes only the theme identity; it does not add, remove, or reorder stylesheets.

## Token Utilities

Use `tokenVar()` when a non-StyleX styling library wants a CSS variable reference, and `resolveThemeTokens()` when JavaScript needs token values for a specific theme and mode without React context. Themes are registered by name when created with `defineTheme()`; call `registerTheme(theme)` for prebuilt or object-literal themes that need name-based SSR lookup.

CSS var references for styling-library configs:
```ts
import {tokenVar, tokenVars} from '@curialy/ui/theme/tokens';

const pandaOrEmotionTheme = {
  colors: {
    text: tokenVar('--color-text-primary'),
    surface: tokenVars['--color-background-surface'],
  },
};
```

Resolve token values without a hook:
```ts
import {resolveThemeTokens} from '@curialy/ui/theme/tokens';
import {neutralTheme} from '@curialy/ui-theme-neutral';

const lightTokens = resolveThemeTokens(neutralTheme, {mode: 'light'});
const chartTheme = {
  textColor: lightTokens['--color-text-primary'],
  seriesColor: lightTokens['--color-data-categorical-blue'],
};
```

The `@curialy/ui/theme/tokens` subpath is server-safe and does not require React. The main `@curialy/ui/theme` barrel also re-exports these helpers for client code that already imports theme APIs.

For styling library interop patterns, see `design_system docs styling-libraries`.

## useTheme Hook

`useTheme()` reads the nearest Theme and effective color mode from React context. Prefer `dataVars` for CSS-capable SVG and DOM values. Use this hook for canvas, charts, maps, third-party configuration objects, or an SVG API that requires a concrete JavaScript color instead of a `var(...)` reference.

Access resolved token values in React:
```tsx
import {useMemo} from 'react';
import {useTheme} from '@curialy/ui/theme';

function ChartConfig() {
  const {mode, tokens} = useTheme();
  const options = useMemo(() => ({
    mode,
    textColor: tokens['--color-text-primary'],
    gridColor: tokens['--color-border'],
    seriesColor: tokens['--color-data-categorical-blue'],
  }), [mode, tokens]);
  return <Chart options={options} />;
}
```

Prefer CSS variables for ordinary styling. See `design_system docs use-a-theme` for the provider setup, and `design_system docs tokens` for the full token reference.

Up: design_system docs guides
Next: design_system docs browser-support
