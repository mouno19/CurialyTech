package: @astryxdesign/cli

# Use integrations

Install, discover, and use integration packages that add components, templates, themes, and docs to your app.

## Discover integrations

Integration packages extend Astryx with extra components, templates, themes, docs, and codemods. They are published as regular npm packages.

Search for what you need:

```bash
astryx search carousel
astryx discover
```

`search` looks across everything the CLI knows (components, docs, templates, themes, and hooks), so a word like "carousel" finds it whether it is a component, a template, or a doc page. `discover` lists every integration the project has, and, with a discover source, packages it could add.

## Install an integration

Install the package with your package manager. Integrations autolink: the CLI finds them among your dependencies, so installing is all it takes:

```bash
npm install @acme/brand-integration
```

Run `astryx doctor` to confirm everything is wired up. If you need to load a package that is not a direct dependency, add it explicitly to `astryx.config.mjs`:

Optional: explicit config entry:
```js
export default {
  integrations: ['@acme/brand-integration'],
};
```

## Use what it adds

Once installed, the integration's contributions appear alongside Core:

- `astryx component --list` shows its components next to Core components.
- `astryx template --list` includes its page and block templates.
- `astryx theme list` lists its themes; add one with `astryx theme add <slug> --package @acme/brand-integration`.
- `astryx docs` shows any guides it provides.
- `astryx search <query>` finds everything, from every installed integration.

Import components at the subpath the integration documents. Run `astryx component <Name>` to see the exact import:

```jsx
import {AcmeCarousel} from '@acme/brand-integration/components/AcmeCarousel';
```

For themes, see `astryx docs use-a-theme`. To build an integration of your own, see `astryx docs authoring`.

## Check for problems

Run `astryx doctor` to see integration issues: missing roots, invalid contributions, or a CLI version mismatch. The doctor check is the one place every issue for every package is listed.

```bash
astryx doctor
```

Up: astryx docs guides
Previous: astryx docs use-a-theme
Next: astryx docs working-with-ai
