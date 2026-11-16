package: @astryxdesign/cli

# Usage in StyleX

How to import and use token variables in StyleX styles.

## Usage in StyleX

Using token imports:
```tsx
import * as stylex from '@stylexjs/stylex';
import {colorVars, spacingVars, sizeVars, radiusVars} from '@astryxdesign/core/theme/tokens.stylex';
import {dataVars} from '@astryxdesign/core/theme/dataTokens.stylex';

const styles = stylex.create({
  card: {
    padding: spacingVars['--spacing-4'],
    backgroundColor: colorVars['--color-background-surface'],
    borderRadius: radiusVars['--radius-container'],
  },
  series: {
    color: dataVars['--color-data-categorical-blue'],
  },
  button: {
    height: sizeVars['--size-element-md'],
  },
});
```

Use `dataVars` for StyleX, DOM styles, and SVG presentation attributes. Canvas and other APIs that require concrete mode-resolved values use `resolveThemeToken()` or `useTheme().token()` instead. Raw CSS may use the stable custom-property names only when compiled dataVars output is guaranteed or the declaration carries an explicit fallback. See `astryx docs styling` for xstyle, className, and compound component patterns, and `astryx docs author-a-theme` for overriding tokens with defineTheme.

Up: astryx docs tokens
Previous: astryx docs tokens/tokens-type-scale
