package: @astryxdesign/cli

# Tokens & Setup

Using design tokens in custom styles, configuring a StyleX compiler for swizzled components, and keeping Next.js webpack builds small.

## Design Tokens

When writing custom styles, use design tokens instead of hardcoded values. Tokens are CSS custom properties that adapt to the active theme and color mode. The system provides tokens for spacing, color, radius, shadow, typography, and size.

Using tokens in stylex.create:
```tsx
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  surface: {
    padding: 'var(--spacing-4)',
    borderRadius: 'var(--radius-container)',
    backgroundColor: 'var(--color-background-surface)',
  },
});

<Card xstyle={styles.surface} />
```

Using typed token imports in stylex.create:
```tsx
import {colorVars, spacingVars, radiusVars} from '@astryxdesign/core/theme/tokens.stylex';

const styles = stylex.create({
  highlight: {
    backgroundColor: colorVars['--color-accent-muted'],
    padding: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-element'],
  },
});
```

Both approaches work: var() strings or typed imports from tokens.stylex. The typed imports give autocomplete and catch typos at build time.

See `astryx docs tokens` for the full token reference (all spacing, color, radius, shadow, and typography tokens with values). See `astryx docs author-a-theme` for how to override tokens via defineTheme.

## StyleX Build Setup (required for swizzled components)

Astryx components ship pre-compiled: `astryx.css` and each package's own stylesheet hold all of their styles, so consuming the published packages needs no StyleX setup. But `astryx swizzle <Component>` copies the raw StyleX *source* into your app, and StyleX source requires a build-time StyleX compiler to produce atomic CSS. Without one, importing the component throws an error that starts `Unexpected 'stylex.create' call at runtime`, and the page does not render. If a swizzled component throws that error, the app is missing a StyleX compiler. The same applies if you author your own StyleX with `stylex.create()`.

Bundler                   | StyleX plugin
------------------------- | ----------------------------------------------------
Webpack                   | @stylexjs/webpack-plugin
Vite / Rollup             | @stylexjs/rollup-plugin (or a community Vite plugin)
Babel (any bundler)       | @stylexjs/babel-plugin + @stylexjs/postcss-plugin
Next.js (App Router, SWC) | An SWC-based transform; see the Next.js note below

Next.js (App Router) is the sharp edge. StyleX's canonical compiler is a Babel plugin, but introducing a Babel config in Next.js disables the SWC compiler, and with it SWC-dependent features like `next/font`.

The repo's `apps/example-nextjs-stylex` takes the Babel path (`next/babel`, `@stylexjs/babel-plugin`, `@stylexjs/postcss-plugin`). Babel turns off SWC, so that app does not use `next/font`. To keep `next/font`, use an SWC transform such as `@stylexswc/nextjs-plugin`.

next.config.mjs: SWC-based StyleX transform (keeps next/font working):
```js
import stylexPlugin from '@stylexswc/nextjs-plugin';

export default stylexPlugin({
  rsOptions: {
    // Resolve the Astryx token modules that swizzled source imports.
    aliases: {'@/*': ['./src/*']},
    unstable_moduleResolution: {type: 'commonJS'},
  },
})({
  // your existing Next.js config
});
```

- Symptom of a missing compiler: importing a swizzled component throws an error that starts `Unexpected 'stylex.create' call at runtime`, and the page does not render.
- A Babel config turns off SWC in Next.js; skip it if you need `next/font`.
- Pure theming (defineTheme + astryx theme build) needs NO StyleX compiler; only swizzled/authored StyleX source does.
- Keep loading `astryx.css` with a StyleX compiler in place. The compiler builds your own and swizzled source only; never add `node_modules/@astryxdesign` to its inputs.

## Next.js with webpack

If your Next.js app builds with webpack (`next build --webpack`), add `@astryxdesign/core` to `experimental.optimizePackageImports`. With webpack, a Server Component that imports from the package root would otherwise ship every client component; this keeps first load to what the page uses. Turbopack, the default bundler in Next.js 16, needs no change, and the setting is safe to keep there.

next.config.mjs:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['@astryxdesign/core'],
  },
};

export default nextConfig;
```

In Server Components, also import each component from its own entry, for example `import {Button} from '@astryxdesign/core/Button'`. `astryx component <Name>` prints that entry. Files that start with `'use client'` are not affected.

Up: astryx docs styling
Previous: astryx docs styling/styling-advanced
