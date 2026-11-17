package: @curialy/ui

# Getting Started

Add the design system to your project and start building.

## Quick Start with AI

Paste this into your AI coding tool and let it handle the setup:

Set up the design system:
```text
Install @curialy/ui, @stylexjs/stylex, @curialy/ui-theme-neutral, and @curialy/ui-cli in this project, then run `design_system init` to set up agent docs. Read the generated files to learn the conventions.
```

Then give it a look. Every app gets a theme whether or not anyone picks one, so it is worth one question at setup rather than revisiting screens later that were built around the wrong look:

Give it a look:
```text
Ask me what look and feel this app should have. Run `design_system theme list`, install the closest theme package, and run `theme add <slug>`; use `--package` when owners share a slug. Import `themes` and `defaultThemeSlug` from the generated module once and pass `themes[defaultThemeSlug]` to `<Theme>`. Customize with `defineTheme({extends: importedTheme, ...})`. Use `theme eject` only when I ask for an independent source fork. Default to neutral if I have no preference, and show me the result before moving on.
```

## Install

Curialy UI requires React 19 or later: `react` and `react-dom` >= 19.0.0 are peer dependencies of `@curialy/ui`.

Add the core package and its `@stylexjs/stylex` peer dependency, plus a theme and the CLI.

Terminal:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
```

Then run `design_system init` to install the AI agent cheat sheet (AGENTS.md/CLAUDE.md). It's non-interactive; no prompts; so it's safe for AI agents, CI, and scripts. Add `--all` for pointers to the theme and page-building workflows.

Terminal:
```bash
design_system init
```

## Upgrade

Upgrade every Curialy UI package your app lists in one command, to the same release. Each theme names the exact Core release it works with, so a theme left on an older release no longer matches the new Core.

Terminal:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
design_system upgrade --from <old Core version> --apply
```

Add every other Curialy UI package your app lists to the same command, and pass the Core version you had before to `--from`. If your package manager holds new releases back, exempt the whole `@curialy/ui-*` scope; in pnpm, `minimumReleaseAgeExclude: ['@curialy/ui-*']`. Exempting only some of its packages installs packages from different releases side by side.

## Install once, use everywhere

Install the CLI once for your computer too, and the cui command works in any folder, for you and for any coding agent, even before a project exists. Inside a project, the project's own version still answers, so a global install never changes what your team and CI get. Keep it in the project as well; that is the recommended setup.

Terminal:
```bash
# design_system setup gives the exact install command (the packages come from the site, not the npm registry)
```

Project, global, or both: `design_system docs global/project-global-or-both`. Everything else about global mode: `design_system docs global`.

## Add base CSS and a theme

Import the reset and base styles in your global CSS. Then run `design_system theme add neutral`; the generated app module imports the theme’s production CSS and font CSS.

globals.css:
```css
@import '@curialy/ui/reset.css';
@import '@curialy/ui/styles.css';
```

Run `design_system theme list` to see every theme.

App root:
```tsx
import {Theme} from '@curialy/ui/theme';
import {themes, defaultThemeSlug} from './ui-themes';

<Theme theme={themes[defaultThemeSlug]}><App /></Theme>
```

- `@curialy/ui-theme-neutral`: muted and minimal; a good starting point
- `@curialy/ui-theme-butter`: warm, golden tones with blue accents
- `@curialy/ui-theme-chocolate`: rich chocolate and caramel tones
- `@curialy/ui-theme-gothic`: dark-only theme with ink and noir influences
- `@curialy/ui-theme-matcha`: earthy greens and botanical tones
- `@curialy/ui-theme-stone`: warm neutrals inspired by sandstone
- `@curialy/ui-theme-y2k`: playful early-2000s pop aesthetic

These stylesheets are cascade-layered: the reset loads in @layer reset and component styles in @layer cui-base. If your project has existing global CSS, a legacy reset, or Tailwind, declare the layer order explicitly and assign every stylesheet to a layer deliberately: unlayered styles and later layers both override cui-base regardless of specificity. Before building screens, read the two cascade layer sections of `design_system docs migration/migration-setup`.

Run `design_system docs use-a-theme` for the full theming guide.

## Add your first component

Import each component from its own entry, the path `design_system component <Name>` prints. This keeps bundles small and makes intent clear.

app/page.tsx:
```tsx
import {Button} from '@curialy/ui/Button';
import {VStack} from '@curialy/ui/VStack';

export default function Page() {
  return (
    <VStack gap={2}>
      <Button label="Hello Curialy UI" onClick={() => alert('Hi!')} />
    </VStack>
  );
}
```

## Customize with StyleX

Curialy UI components support various styling solutions, from plain CSS and `className` to Tailwind and CSS-in-JS. See `design_system docs styling` for the full guide. Curialy UI also has a deep integration with [StyleX](https://stylexjs.com/), an atomic CSS-in-JS library: create styles with `stylex.create()` and pass them to components with the `xstyle` prop.

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
Next.js            | Next.js + theme CSS                | apps/example-nextjs
Next.js + StyleX   | Next.js + StyleX for custom styles | apps/example-nextjs-stylex
Next.js + Tailwind | Next.js + Tailwind bridge          | apps/example-nextjs-tailwind
Vite + Tailwind    | Vite + Tailwind bridge             | apps/example-vite-tailwind

Clone and run an example:
```bash
git clone 
cd cui/apps/example-nextjs
npm install
npm run dev
```

## Explore the CLI

The CLI is your reference for components, tokens, templates, and docs. For reliable invocation (especially with AI assistants), add this script to your package.json:

package.json:
```json
"scripts": {
  "cui": "node node_modules/@curialy/ui-cli/clients/cli/bin/cui.mjs"
}
```

Then discover what's available:

Terminal:
```bash
design_system component          # list all components
design_system component Button   # props, usage, theming for Button
design_system docs               # list all doc topics
design_system template --list    # available page templates
design_system docs tokens        # spacing, color, radius reference
```

Up: design_system docs guides
Previous: design_system docs browser-support
Next: design_system docs is-my-code-good
