package: @curialy/ui

# Basics

Overview of styling approaches, xstyle prop, Tailwind integration, className/style props, and rest props.

## Overview

Style components with `xstyle` (StyleX), `className` (Tailwind or your own CSS), or a styling library aliased to Curialy UI tokens. All of them resolve to the same tokens.

Approach                      | Use for                                                                                                      | Example
----------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------
StyleX                        | Component-specific overrides, reusable styles, pseudo-classes, and typed tokens                              | `const styles = stylex.create(...); <Button xstyle={styles.save} />`
Tailwind utilities            | Page layout, wrappers, and utility styling                                                                   | `className="flex gap-3 p-4"`
className                     | Integrating with external CSS or Tailwind on components                                                      | `className="my-card shadow-lg"`
Styling-library token aliases | Keeping Panda, Chakra, MUI, Emotion, styled-components, UnoCSS, CSS Modules, or Sass in sync with the system | `colors.surface = 'var(--color-background-surface)'`

Theming and dark mode work whichever you choose. For external styling libraries, see `design_system docs styling-libraries`; it covers Tailwind, StyleX, Panda, Chakra, MUI, CSS-in-JS, CSS Modules, Sass, and `useTheme()` for non-CSS processing.

## xstyle Prop

Every component accepts an `xstyle` prop for style customization. It accepts StyleX styles created via `stylex.create()`, not inline objects or class name strings. StyleX styles are compiled at build time for optimal deduplication and dead-code elimination.

Simple overrides:
```tsx
import * as stylex from '@stylexjs/stylex';

const overrides = stylex.create({
  card: { maxWidth: 400, marginBlock: 16 },
  saveButton: { alignSelf: 'flex-end' },
});

<Card xstyle={overrides.card} />
<Button label="Save" xstyle={overrides.saveButton} />
```

Pseudo-classes and conditional styles:
```tsx
import * as stylex from '@stylexjs/stylex';

const overrides = stylex.create({
  card: {
    boxShadow: {
      default: 'none',
      ':hover': { '@media (hover: hover)': '0 4px 12px rgba(0,0,0,0.1)' },
    },
  },
});

<Card xstyle={overrides.card}>...</Card>
```

- All xstyle values must come from stylex.create()
- Pseudo-classes (:hover, :focus-visible) are supported inside stylex.create
- All :hover styles MUST use @media (hover: hover) guard
- For non-StyleX styling (Tailwind, external CSS), use className instead

## Tailwind Integration

The package ships a Tailwind v4 theme bridge that maps all design tokens to Tailwind utility classes. Import it once and use Tailwind classes backed by design tokens: colors, spacing, radius, shadows, and typography all resolve to the active theme.

For the imports and the cascade-layer order to put in your global CSS, see `design_system docs styling-libraries/tailwind`.

Tailwind utilities alongside components:
```tsx
<div className="text-primary bg-surface rounded-lg p-4 flex gap-3">
  <Button label="Save" variant="primary" />
  <Button label="Cancel" variant="secondary" />
</div>
```

The bridge is pure CSS with zero JS. Theme changes (dark mode, custom themes) apply automatically because the utilities reference the same CSS custom properties that components use. This is the paved Tailwind path; for other styling libraries that follow the same aliasing pattern, see `design_system docs styling-libraries`.

## className and style Props

Every component also accepts standard `className` and `style` props. `className` is appended after the component's own classes. `style` is merged after StyleX inline styles, so consumer values win on conflict.

className with Tailwind utilities:
```tsx
<Card className="shadow-lg hover:shadow-xl transition-shadow">
  ...
</Card>
<Button label="Save" className="my-app-save-btn" />
```

For layout and wrapper styling, Tailwind utilities on className work well. For component-specific overrides (padding, colors, borders), prefer xstyle; it integrates with StyleX deduplication and the component's internal style pipeline.

## Rest Props (Prop Drilling)

Components extend HTML attributes and spread rest props onto their root DOM element. This means data-* attributes, aria-* attributes, event handlers, and other HTML props pass through automatically.

Data attributes, event handlers, and ARIA:
```tsx
<Card
  data-testid="user-card"
  data-user-id={user.id}
  onMouseEnter={handleHover}
  aria-label="User profile card"
>
  ...
</Card>
```

Ref forwarding:
```tsx
const cardRef = useRef<HTMLDivElement>(null);
<Card ref={cardRef}>...</Card>
```

A few HTML attributes are intentionally omitted from the base type (contentEditable, dangerouslySetInnerHTML). children is not in the base type either; components that accept children declare it explicitly, so slot-based components don't silently drop JSX children.

Up: design_system docs styling
Next: design_system docs styling/styling-advanced
