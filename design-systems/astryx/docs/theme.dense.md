package: @astryxdesign/cli

# Theming

make/change a theme (experimental theme editor): astryx experimental theme editor new <name> --like neutral; editor set|how; theme add <name>; after each change look: experimental theme editor show <name> --png (pictures, changes nothing in the app); not done until you have looked. use + create themes: see use-a-theme and author-a-theme.

## Quick start

Install a theme, wrap in `<Theme>` (`import {Theme} from '@astryxdesign/core/theme'`). `astryx docs use-a-theme` for full guide.

Wire the generated module once:
```tsx
import {Theme} from '@astryxdesign/core/theme';
import {themes, defaultThemeSlug} from './astryx-themes';

function App() {
  return (
    <Theme theme={themes[defaultThemeSlug]}>
      <YourApp />
    </Theme>
  );
}
```

## Custom themes

`defineTheme` + token overrides + component overrides. `astryx docs author-a-theme` for full guide.

Quick start:
```bash
astryx theme add stone   # use an existing theme
astryx theme eject stone # fork its source to customize
astryx theme build src/themes/stone/stoneTheme.ts
```

new palette: `astryx theme palette generate palette.config.json --out palette.generated.ts` → review + commit module and receipt → `import {palette} from './palette.generated';` → map semantic tokens to stable stops such as `palette.neutral.light[100]` / `palette.neutral.dark[15]`. regeneration updates mapped roles; generation does not rewrite the theme.

Map semantic tokens to generated palette stops:
```tsx
import {defineTheme} from '@astryxdesign/core/theme';
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

theme sets each Icon size's glyph dimension: `width` + `height` on `components.icon['size:sm']` (or xsm/md/lg); semantic names + SVG components alike. px or rem only: a semantic icon takes its font size from the dimension, so em also grows its box. unstyled: xsm/sm/md/lg = 12/16/20/24px at 16px root, scale w/ root font size (rem keeps it). size names are fixed.

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

[light, dark] tuples, mode='system'. `astryx docs use-a-theme` for full guide.

Light/dark tuple:
```tsx
'--color-accent': ['#0064E0', '#2694FE'],
//                   ^light     ^dark
```

## Integration themes

Install integration. `astryx theme add` imports, and `theme eject` forks source. `astryx docs use-a-theme` for full guide.

Up: astryx docs guides
Previous: astryx docs styling-overview
Next: astryx docs use-a-theme
