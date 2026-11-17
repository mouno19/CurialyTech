package: @curialy/ui

# Principles

core design principles + rules for the design system

## Philosophy

consistency, adaptability, DX. core ideas:

- components over primitives
- semantic tokens over hardcoded values
- theme-agnostic code
- open internals

## Rules

8 rules for on-system app code.

1. use components
2. frame-first layout: shell + region budgets before content (`design_system docs layout`)
3. dense data = rows (Table, List/Item) not Cards; Card = widgets/galleries/settings groups
4. StyleX or Tailwind for styling (`design_system docs styling`)
5. semantic tokens only (`design_system docs tokens`)
6. CSS vars for colors
7. controlled form inputs
8. useLinkComponent() for navigation

## Styling

xstyle prop for component overrides. StyleX or Tailwind for layout.

full guide: `design_system docs styling`

## Anti-Patterns

what breaks theming, routing, or layout, and the fix.

x no inline styles on raw elements
x no hardcoded colors — use tokens or Tailwind semantic classes
x no hardcoded spacing
x no hardcoded <a> — use useLinkComponent()
x no Card-wrapped list items — frame first, rows for dense data (`design_system docs layout`)
x no decorative Badge — StatusDot/Token for status
x read docs before inventing props

## Tokens

full token reference: `design_system docs tokens`

Up: design_system docs guides
Previous: design_system docs is-my-code-good
Next: design_system docs styling-overview
