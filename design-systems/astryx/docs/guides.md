Guides
Guides that stand on their own: getting started, principles, theming, and working with AI. Each topic keeps its own
name; open one by it.

package: @astryxdesign/cli

Topics

author-a-theme    Start here: the experimental theme editor makes and changes themes for you (`astryx experimental
                  theme editor new <name> --like neutral`; see the theme doc), checked against what components read. By
                  hand: create, customize, and build a theme: defineTheme, palette generation, token overrides,
                  component style overrides, custom variants, responsive adaptations, and production builds.
browser-support   What browsers Astryx targets, which modern platform features it depends on, and how to support older
                  browsers for your own audience.
getting-started   Add the design system to your project and start building.
is-my-code-good   Check whether a product surface fits its app and uses Astryx well, require evidence for every claim,
                  and improve it with a repeatable agent review.
principles        Core design principles and rules for building with the design system.
styling-overview  How to set up CSS - exact imports for three paths: plain, Tailwind, and StyleX for your own code -
                  plus the stylesheet each Astryx package ships.
theme             To create or change a theme, use the experimental theme editor: `astryx experimental theme editor
                  new <name> --like neutral`, then `editor set` / `editor how "<what you want>"`, wire it with `astryx theme add <name>`, and after each change look at it with `astryx experimental theme editor
                  show <name> --png` (pictures of real components; nothing changes in the app): a theme change is not
                  done until you have looked. How to use and create themes: see Use a theme for applying themes, and
                  Author a theme for creating and customizing them.
use-a-theme       Apply a theme to your app: install, import with the CLI, wire the generated module, switch dark mode,
                  nest themes, and choose runtime or built for production.
use-integrations  Install, discover, and use integration packages that add components, templates, themes, and docs to
                  your app.
working-with-ai   How to set up AI coding tools to generate correct component code.

Open one: astryx docs <name>
Up: astryx docs
