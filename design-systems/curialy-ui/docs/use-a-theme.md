package: @curialy/ui

# Use a theme

Apply a theme to your app: install, import with the CLI, wire the generated module, switch dark mode, nest themes, and choose runtime or built for production.

## Wrap your app in a theme

Install and add a theme:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
design_system theme add neutral
```

Wire the generated module once:
```tsx
import {Theme} from '@curialy/ui/theme';
import {themes, defaultThemeSlug} from './ui-themes';

function App() {
  return (
    <Theme theme={themes[defaultThemeSlug]}>
      <YourApp />
    </Theme>
  );
}
```

Switch among added themes:
```tsx
import {useState} from 'react';
import {Theme} from '@curialy/ui/theme';
import {themes, type ThemeSlug} from './ui-themes';

const [slug, setSlug] = useState<ThemeSlug>('neutral');
const app = <Theme theme={themes[slug]}><YourApp /></Theme>;
```

`theme add` records an installed package theme and regenerates `src/ui-themes.ts` or `.js` with its built module, production CSS, and optional font CSS. In a project without `src`, the module is at the project root. The first imported theme becomes the default. `theme use <slug>` changes that default, and `theme remove <slug>` removes a non-default theme.

Customize a package theme with `defineTheme({extends: importedTheme, ...})`, then build and add that local theme. Use `theme eject` only when you want an independent source fork that no longer receives the package owner's updates. For the full authoring guide, see `design_system docs author-a-theme`.

## Migrating Earlier Theme Copies

A theme copied by the released `theme add` stays app source. The upgrade does not move, delete, or rewrite it. It only writes the missing same-stem descriptor with `maintained: false`, so the copy becomes a local theme.

Add descriptors to earlier copies:
```bash
design_system upgrade --from 0.6.4 --path . --apply
```

Before the upgrade runs, theme commands skip a descriptor-less copy in `src/themes`. `theme list` and doctor name it as unmigrated and show the upgrade command. A script that meant to copy source now runs `theme eject` with the same arguments. A script that meant to make the app use a theme runs `theme add`.

`CUI_THEME` is no longer read. Run `theme add <slug>` and `theme use <slug>` to choose the default in a generated app theme module. When that module exists, component metadata reads its recorded default theme. Without the module, the released `package.json#cui.theme` lookup keeps its meaning.

## Available Themes

Install the theme package you want with `design_system setup` (the exact install command, from the site), then import its slug with `theme add <slug>`. The CLI imports the package's built outputs for you.

Theme     | Add command                    | Description
--------- | ------------------------------ | ------------------------------------------------------------------------------
Neutral   | `design_system theme add neutral` | Muted, minimal aesthetic with Figtree typography. A good starting point.
Butter    | design_system theme add butter    | Golden, buttery surfaces with blue accents; Sarina + Outfit type.
Chocolate | design_system theme add chocolate | Warm brown tones and cozy beige; Fraunces + Albert Sans type.
Gothic    | design_system theme add gothic    | Dark-only atmospheric theme; deep blue-gray surfaces, distressed display type.
Matcha    | design_system theme add matcha    | Earthy greens; DM Sans + Playwrite US Trad type.
Stone     | design_system theme add stone     | Warm stone and slate tones; Montserrat + Figtree type.
Y2K       | design_system theme add y2k       | Playful Y2K pop; periwinkle body, holographic accents, Poppins + Crimson Text.

Every first-party package exports its built theme at `@curialy/ui-theme-{name}/built`, production CSS at `/theme.css`, and font loading CSS at `/fonts.css`. `theme add` writes those imports into the generated app module.

## Theme Props

`<Theme>` takes `theme` (required), `mode` (`'system'` by default, or `'light'`/`'dark'`), and `children`. For every prop, run `design_system component Theme`.

## Using a Theme from an Integration

Install the integration as a direct dependency. Curialy UI discovers its themes and guides without an `cui.config` entry. A theme can be added only when the installed package exports its built module and production stylesheet.

Install, inspect, and add:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
design_system theme list --package @acme/brand-integration
design_system docs brand-theme
design_system theme add ocean --package @acme/brand-integration
```

`theme add` keeps the owner package in the app record and imports its built module, stylesheet, and optional font stylesheet. Package updates continue to reach the app. Run `theme eject ocean --package @acme/brand-integration` only to copy the source and descriptor into `src/themes/ocean` as an independent local fork.

## Dark mode

Use [light, dark] tuples in token values for automatic mode switching. Use mode='system' (default) on Theme to follow OS preference.

Light/dark tuple:
```tsx
'--color-accent': ['#0064E0', '#2694FE'],
//                   ^light     ^dark
```

Toggle with a button:
```tsx
const [mode, setMode] = useState<'light' | 'dark'>('light');

<Theme theme={myTheme} mode={mode}>
  <Button
    label={mode === 'light' ? 'Switch to Dark' : 'Switch to Light'}
    onClick={() => setMode(m => (m === 'light' ? 'dark' : 'light'))}
  />
</Theme>;
```

To create a theme with custom dark mode colors, see `design_system docs author-a-theme`.

## Nested themes

Wrap different sections in separate `<Theme>` providers.

Dark sidebar with light content:
```tsx
<Theme theme={lightTheme} mode="light">
  <Layout
    header={<LayoutHeader>...</LayoutHeader>}
    start={
      <Theme theme={darkTheme} mode="dark">
        <LayoutPanel>{/* Dark sidebar */}</LayoutPanel>
      </Theme>
    }
    content={<LayoutContent>{/* Light content */}</LayoutContent>}
  />
</Theme>
```

## Runtime vs Built Themes

Themes work in two modes:

                         | Runtime (source)                                   | Built
------------------------ | -------------------------------------------------- | ----------------------------------------------
Import (published theme) | @curialy/ui-theme-{name}                         | @curialy/ui-theme-{name}/built + theme.css
Import (custom theme)    | defineTheme() directly                             | Built .js + .css from `design_system theme build`
How it works             | useInsertionEffect injects <style> at hydration    | Pre-compiled .css file loaded with the page
Component overrides      | Injected client-only                               | In static CSS: present during SSR
SSR safe                 | Tokens yes, component overrides flash on hydration | Fully SSR safe: no flash
Best for                 | Authoring input for `design_system theme build`       | App wiring, in development and production

+ Use `theme add` for production apps; it wires the built module and CSS.
+ Import `themes` and `defaultThemeSlug` from the generated module once, and keep that wiring in development too.
+ While you edit a local theme, run `design_system theme build --watch` so its built files stay current.
+ Run `design_system theme build` for custom themes to get the built artifacts.

x Use runtime themes in production SSR apps; component overrides will flash on hydration.
x Import /built without the CSS file; component overrides won't apply.
x Import package theme source into app runtime code.
x Hand-edit the generated theme module; `theme add`, `theme remove`, and `theme use` regenerate it.

To build a custom theme for production, see the Build section of `design_system docs author-a-theme`.

Up: design_system docs guides
Previous: design_system docs theme
Next: design_system docs use-integrations
