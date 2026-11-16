package: @astryxdesign/cli

# Illustrations

Illustration guidelines for empty states, onboarding flows, and feature highlights.

## When to Use

Consistent illustration usage reinforces brand identity and helps users understand context at a glance. Use illustrations in these contexts:

Context            | Examples
------------------ | ------------------------------------------------------
Empty states       | No data, first-time experience, search with no results
Onboarding         | Welcome screens, feature introduction, setup wizards
Feature highlights | New feature announcements, upgrade prompts
Error states       | Permission denied, not found, service unavailable

## Guidelines

+ Keep illustrations consistent in style across the product.
+ Use simple, flat illustrations that work in both light and dark mode.
+ Size illustrations proportionally to the container, typically 120–240px.
+ Place illustrations centered with supporting text below.

x Mix illustration styles from different sources.
x Use illustrations as decoration without purpose.

## Placement

For an empty state, pass the illustration to the `icon` slot of `EmptyState`, which centers it above the title and description. Typical illustration sizes range from 120px for inline empty states to 240px for full-page onboarding screens. Always pair the illustration with a title and a description that says what to do next.

Empty state with illustration:
```tsx
<EmptyState
  icon={<img src="/illustrations/empty-search.svg" alt="" width={200} height={200} />}
  title="No results found"
  description="Try adjusting your search or filters."
/>
```

Up: astryx docs foundations
Previous: astryx docs icons
Next: astryx docs motion
