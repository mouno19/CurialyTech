package: @astryxdesign/cli

# Getting Started

Add the design system to your project and start building.

## Quick Start with AI

Paste this into your AI coding tool and let it handle the setup:

Set up the design system:
```text
Install @astryxdesign/core, @stylexjs/stylex, @astryxdesign/theme-neutral, and @astryxdesign/cli in this project, then run `astryx init` to set up agent docs. Read the generated files to learn the conventions.
```

Then give it a look. Every app gets a theme whether or not anyone picks one, so it is worth one question at setup rather than revisiting screens later that were built around the wrong look:

Give it a look:
```text
Ask me what look and feel this app should have. Run `astryx theme list`, install the closest theme package, and run `theme add <slug>`; use `--package` when owners share a slug. Import `themes` and `defaultThemeSlug` from the generated module once and pass `themes[defaultThemeSlug]` to `<Theme>`. Customize with `defineTheme({extends: importedTheme, ...})`. Use `theme eject` only when I ask for an independent source fork. Default to neutral if I have no preference, and show me the result before moving on.
```

## Install

Astryx requires React 19 or later: `react` and `react-dom` >= 19.0.0 are peer dependencies of `@astryxdesign/core`.

Add the core package and its `@stylexjs/stylex` peer dependency, plus a theme and the CLI.

Terminal:
```bash
npm install @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral @astryxdesign/cli
```

Then run `astryx init` to install the AI agent cheat sheet (AGENTS.md/CLAUDE.md). It's non-interactive; no prompts; so it's safe for AI agents, CI, and scripts. Add `--all` for pointers to the theme and page-building workflows.

Terminal:
```bash
astryx init
```

## Upgrade

Upgrade every Astryx package your app lists in one command, to the same release. Each theme names the exact Core release it works with, so a theme left on an older release no longer matches the new Core.

Terminal:
```bash
npm install @astryxdesign/core@latest @astryxdesign/theme-neutral@latest @astryxdesign/cli@latest
astryx upgrade --from <old Core version> --apply
```

Add every other Astryx package your app lists to the same command, and pass the Core version you had before to `--from`. If your package manager holds new releases back, exempt the whole `@astryxdesign/*` scope; in pnpm, `minimumReleaseAgeExclude: ['@astryxdesign/*']`. Exempting only some of its packages installs packages from different releases side by side.

## Install once, use everywhere

Install the CLI once for your computer too, and the astryx command works in any folder, for you and for any coding agent, even before a project exists. Inside a project, the project's own version still answers, so a global install never changes what your team and CI get. Keep it in the project as well; that is the recommended setup.

Terminal:
```bash
npm install -g @astryxdesign/cli
```

Project, global, or both: `astryx docs global/project-global-or-both`. Everything else about global mode: `astryx docs global`.

## Add base CSS and a theme

Import the reset and base styles in your global CSS. Then run `astryx theme add neutral`; the generated app module imports the theme’s production CSS and font CSS.

globals.css:
```css
@import '@astryxdesign/core/reset.css';
@import '@astryxdesign/core/astryx.css';
```

Run `astryx theme list` to see every theme.

App root:
```tsx
import {Theme} from '@astryxdesign/core/theme';
import {themes, defaultThemeSlug} from './astryx-themes';

<Theme theme={themes[defaultThemeSlug]}><App /></Theme>
```

- `@astryxdesign/theme-neutral`: muted and minimal; a good starting point
- `@astryxdesign/theme-butter`: warm, golden tones with blue accents
- `@astryxdesign/theme-chocolate`: rich chocolate and caramel tones
- `@astryxdesign/theme-gothic`: dark-only theme with ink and noir influences
- `@astryxdesign/theme-matcha`: earthy greens and botanical tones
- `@astryxdesign/theme-stone`: warm neutrals inspired by sandstone
- `@astryxdesign/theme-y2k`: playful early-2000s pop aesthetic

These stylesheets are cascade-layered: the reset loads in @layer reset and component styles in @layer astryx-base. If your project has existing global CSS, a legacy reset, or Tailwind, declare the layer order explicitly and assign every stylesheet to a layer deliberately: unlayered styles and later layers both override astryx-base regardless of specificity. Before building screens, read the two cascade layer sections of `astryx docs migration/migration-setup`.

Run `astryx docs use-a-theme` for the full theming guide.

## Add your first component

Import each component from its own entry, the path `astryx component <Name>` prints. This keeps bundles small and makes intent clear.

app/page.tsx:
```tsx
import {Button} from '@astryxdesign/core/Button';
import {VStack} from '@astryxdesign/core/VStack';

export default function Page() {
  return (
    <VStack gap={2}>
      <Button label="Hello Astryx" onClick={() => alert('Hi!')} />
    </VStack>
  );
}
```

## Customize with StyleX

Astryx components support various styling solutions, from plain CSS and `className` to Tailwind and CSS-in-JS. See `astryx docs styling` for the full guide. Astryx also has a deep integration with [StyleX](https://stylexjs.com/), an atomic CSS-in-JS library: create styles with `stylex.create()` and pass them to components with the `xstyle` prop.

Style overrides:
```tsx
import * as stylex from '@stylexjs/stylex';

const overrides = stylex.create({
  save: { alignSelf: 'flex-end', marginTop: 16 },
});

<Button label="Save" xstyle={overrides.save} />
```

## Example Apps

For a full working project, clone one of the example apps from the repo. These are complete setups with routing, theming, and components wired together.

Example            | Stack                              | Path
------------------ | ---------------------------------- | -----------------------------------------------------------------------------------------------------
Next.js            | Next.js + theme CSS                | [apps/example-nextjs](https://github.com/meta/astryx/tree/main/apps/example-nextjs)
Next.js + StyleX   | Next.js + StyleX for custom styles | [apps/example-nextjs-stylex](https://github.com/meta/astryx/tree/main/apps/example-nextjs-stylex)
Next.js + Tailwind | Next.js + Tailwind bridge          | [apps/example-nextjs-tailwind](https://github.com/meta/astryx/tree/main/apps/example-nextjs-tailwind)
Vite + Tailwind    | Vite + Tailwind bridge             | [apps/example-vite-tailwind](https://github.com/meta/astryx/tree/main/apps/example-vite-tailwind)

Clone and run an example:
```bash
git clone https://github.com/meta/astryx.git
cd astryx/apps/example-nextjs
npm install
npm run dev
```

## Explore the CLI

The CLI is your reference for components, tokens, templates, and docs. For reliable invocation (especially with AI assistants), add this script to your package.json:

package.json:
```json
"scripts": {
  "astryx": "node node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs"
}
```

Then discover what's available:

Terminal:
```bash
astryx component          # list all components
astryx component Button   # props, usage, theming for Button
astryx docs               # list all doc topics
astryx template --list    # available page templates
astryx docs tokens        # spacing, color, radius reference
```

Up: astryx docs guides
Previous: astryx docs browser-support
Next: astryx docs is-my-code-good
