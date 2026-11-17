package: @curialy/ui

# Spacing

Spacing scale tokens for padding, gap, and margin: the rhythmic foundation of design system layouts.

## Overview

The design system uses a 4px base-unit spacing scale, written in rem so gaps and padding grow with the reader's browser font size the way text does: each step is 0.25rem, which is 4px at the default 16px root. Component gap props accept step values that map to these tokens. The scale provides fine-grained control at the small end (2px, 4px, 6px) and consistent rhythm at larger sizes (multiples of 4px).

## Scale

Fifteen spacing tokens, from 0 to 3rem (0px to 48px at the default 16px root).

Spacing scale used for padding, gap, and margin. Component gap props map spacing steps to these tokens.

Token         | Core default
------------- | ------------
--spacing-0   | 0rem
--spacing-0-5 | 0.125rem
--spacing-1   | 0.25rem
--spacing-1-5 | 0.375rem
--spacing-2   | 0.5rem
--spacing-3   | 0.75rem
--spacing-4   | 1rem
--spacing-5   | 1.25rem
--spacing-6   | 1.5rem
--spacing-7   | 1.75rem
--spacing-8   | 2rem
--spacing-9   | 2.25rem
--spacing-10  | 2.5rem
--spacing-11  | 2.75rem
--spacing-12  | 3rem

## Usage

Stack, HStack, VStack, Grid, Toolbar, OverflowList, and ChatMessageList take a `gap` step: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, or 10 (×4px). Carousel takes the steps from 0 to 4. For custom layouts, use the spacing tokens in StyleX.

Spacing via component props vs StyleX:
```tsx
// Via component props (preferred)
<Stack gap={4}>{/* 16px gap */}</Stack>

// Via StyleX tokens (custom layouts)
import {spacingVars} from '@curialy/ui/theme/tokens.stylex';

const styles = stylex.create({
  custom: {
    padding: spacingVars['--spacing-4'],
    gap: spacingVars['--spacing-3'],
  },
});
```

## Best Practices

+ Use component gap props when available; they handle automatic spacing compensation.
+ Stick to the scale for consistency. If a value isn't on the scale, reconsider the design.
+ Use smaller steps (0.5–2) for tight internal spacing and larger steps (4–8) for section gaps.

x Use arbitrary pixel values outside the scale.
x Mix spacing tokens with raw px/rem values in the same component.

Up: design_system docs foundations
Previous: design_system docs shape
