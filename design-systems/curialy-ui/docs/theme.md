package: @curialy/ui

# Theming

To create or change a theme, use the experimental theme editor: `design_system experimental theme editor new <name> --like neutral`, then `editor set` / `editor how "<what you want>"`, wire it with `design_system theme add <name>`, and after each change look at it with `design_system experimental theme editor show <name> --png` (pictures of real components; nothing changes in the app): a theme change is not done until you have looked. How to use and create themes: see Use a theme for applying themes, and Author a theme for creating and customizing them.

## Wrap your app in a theme

Install a theme, import it with the CLI, and wire the generated module once. For the full guide — available themes, integration themes, dark mode, nested themes, and production builds — see `design_system docs use-a-theme`.

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

## Create a custom theme

Use `defineTheme` with token overrides, scale configs, and component style overrides. For the full guide — palette generation, extending themes, adaptations, custom variants, and production builds — see `design_system docs author-a-theme`.

Quick start:
```bash
design_system theme add stone   # use an existing theme
design_system theme eject stone # fork its source to customize
design_system theme build src/themes/stone/stoneTheme.ts
```

For a new coordinated color system, run `design_system theme palette generate palette.config.json --out palette.generated.ts`. Review and commit the generated palette module and receipt, import its `palette` export, then reference stable stops from semantic tokens. Regenerating an accepted palette updates every mapped token that keeps those references; generation does not rewrite the theme.

Map semantic tokens to generated palette stops:
```tsx
import {defineTheme} from '@curialy/ui/theme';
import {palette} from './palette.generated';

const myTheme = defineTheme({
  name: 'my-theme',
  tokens: {
    '--color-background-surface': [
      palette.neutral.light[100],
      palette.neutral.dark[15],
    ],
  },
});
```

## Icon sizes

A theme sets the dimension of each Icon size in its stylesheet: `width` and `height` on `components.icon['size:sm']` (or `xsm`, `md`, `lg`) resize that size's glyph, for semantic icon names and SVG components passed to `Icon` alike. Give the dimension in `px` or `rem`: a semantic icon takes its font size from it, so an `em` value would also grow its box. A size the theme leaves alone stays 12, 16, 20, or 24px at a 16px root (`xsm`, `sm`, `md`, `lg`) and scales with the root font size; `rem` keeps that scaling. The four size names are fixed.

Set Icon size dimensions:
```tsx
const brandTheme = defineTheme({
  name: 'brand',
  components: {
    icon: {
      'size:sm': {width: '1.125rem', height: '1.125rem'},
      'size:lg': {width: '1.75rem', height: '1.75rem'},
    },
  },
});
```

## Dark mode

Light, dark, and system modes: `design_system docs use-a-theme`.

Light/dark tuple:
```tsx
'--color-accent': ['#0064E0', '#2694FE'],
//                   ^light     ^dark
```

## Integration themes

Install an integration and Curialy UI discovers its themes automatically. Import one with `design_system theme add <name> --package <integration>`. Use `theme eject` only for an independent source fork. For the full walkthrough, see `design_system docs use-a-theme`.

Up: design_system docs guides
Previous: design_system docs styling-overview
Next: design_system docs use-a-theme
