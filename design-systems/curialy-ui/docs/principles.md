package: @curialy/ui

# Principles

Core design principles and rules for building with the design system.

## Design Philosophy

A design system that prioritizes consistency, adaptability, and developer experience. Every decision flows from a few core ideas:

- Components over primitives: use components for everything they cover before reaching for raw HTML
- Semantic tokens over hardcoded values: colors, spacing, and radii are named by purpose, not appearance
- Theme-agnostic code: your app code never references specific colors or measurements, so themes and dark mode work automatically
- Open internals: every primitive is exported and composable, so you can build on top of it without fighting it

## Rules

Eight rules that keep app code on-system.

1. Use components for everything they cover
2. Page layout is frame-first: pick the shell and budget regions before writing content (see `design_system docs layout`)
3. Dense data renders as rows (Table, List/Item), edge-to-edge with dividers; Card is for widgets, galleries, and settings groups
4. StyleX or Tailwind for custom styling; both are first-class (see `design_system docs styling`)
5. Semantic tokens, not hardcoded values (see `design_system docs tokens`)
6. CSS custom properties for colors, not hex values
7. Form inputs are controlled (value + onChange)
8. Use useLinkComponent() for navigation so consumers can plug in their framework router via LinkProvider

## Styling Approach

The design system supports multiple styling approaches. Every component accepts an `xstyle` prop for StyleX style overrides via `stylex.create()`. For layout and wrapper styling outside of components, use StyleX or Tailwind utilities; both resolve to the same design tokens.

See `design_system docs styling` for the complete guide with examples.

## Anti-Patterns

Patterns that break theming, routing, or layout, and what to use instead.

x Inline styles on raw elements. Use xstyle on components
x Hardcoded colors (#fff). Use var(--color-*) or Tailwind semantic classes (text-primary, bg-surface)
x Hardcoded spacing (16px). Use spacing tokens or Tailwind spacing utilities
x Hardcoded <a> elements. Use useLinkComponent() so consumers can swap in their framework router via LinkProvider
x Wrapping every list item or page section in a Card. Decide the frame first; dense data renders as rows (see `design_system docs layout`)
x Badge as decoration. Reserve Badge for counts and enumerated states; use StatusDot or Token for status
x Inventing props. Read component docs first

## Design Tokens

The design system provides semantic design tokens for spacing, color, radius, shadow, typography, and size. Tokens adapt to the active theme and color mode. Run `design_system docs tokens` for the full reference with all values.

Up: design_system docs guides
Previous: design_system docs is-my-code-good
Next: design_system docs styling-overview
