package: @curialy/ui

# Shape

Border radius tokens for consistent component rounding, from sharp corners to full pills.

## Overview

The radius scale uses a semantic naming system: inner → element → container → page. Each level fits a specific context. Themes can multiply the entire scale via a radius multiplier, with --radius-none and --radius-full as fixed anchors.

## Radius Scale

Seven radius tokens, from 0px to 9999px.

Numeric scale based on a 4dp base unit. Tokens scale with the theme's radius multiplier; --radius-none and --radius-full are fixed.

Token              | Core default
------------------ | ------------
--radius-none      | 0px
--radius-inner     | 4px
--radius-element   | 8px
--radius-container | 12px
--radius-page      | 28px
--radius-chat      | 28px
--radius-full      | 9999px

## Concentric Radius

Inside a padded, rounded container, give nested elements a radius of outer radius minus padding so the curves stay concentric. Card does not do this for your content.

Concentric radius formula:
```css
.inner {
  border-radius: max(0px, calc(var(--radius-container) - var(--spacing-4)));
}
```

## Best Practices

+ Use --radius-element for interactive controls (buttons, inputs, selectors).
+ Use --radius-container for content containers (cards, panels, dialogs).
+ Use --radius-full for pill shapes (badges, tags, avatar status dots).

x Use --radius-page for small elements; it's meant for page-level containers.
x Hardcode radius values; they won't scale with theme radius multipliers.

Up: design_system docs foundations
Previous: design_system docs motion
Next: design_system docs spacing
