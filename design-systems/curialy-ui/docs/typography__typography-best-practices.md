package: @curialy/ui

# Best Practices

Do/don't rules for using the type scale, headings, display text, and semantic tokens.

## Best Practices

+ Use Heading for document headings and Text for everything else; they apply the full type scale automatically.
+ Adjust typography holistically: change base and ratio in defineTheme to shift the entire ramp (e.g. { base: 16, ratio: 1.25 } for editorial, { base: 12, ratio: 1.125 } for dense UI).
+ Use display types with as="h1" (or h2/h3) when display text is a page heading; this preserves accessibility while giving you display-level sizing. Or better, use `<Heading level={1} type="display-1">` which handles both semantics and styling.
+ Let line-height snap to the 4px grid via the type scale; expandTypeScale computes leading automatically from base and ratio.
+ Use the supporting type for secondary information: timestamps, helper text, metadata, captions.
+ Use accessibilityLevel on Heading when the visual hierarchy doesn't match the document outline (e.g. sidebar or card headings).

x Set font-size or line-height manually; use the semantic type scale tokens so the full ramp stays consistent and 4px-grid-aligned.
x Skip heading levels (e.g. h1 to h3); screen readers rely on an unbroken hierarchy. Use accessibilityLevel to decouple visual from semantic level.
x Use display types for body content or in-page sections; they're designed for hero/marketing/data-callout contexts only.
x Override individual size tokens (--font-size-lg) to "tweak" a heading; adjust base/ratio instead so proportions remain coherent across the entire scale.
x Use raw numeric font-weight values (400, 600); reference the semantic weight tokens so themes can remap them.

Up: design_system docs typography
Previous: design_system docs typography/type-scale
