package: @curialy/ui

# Type Scale

Line height, semantic type scale tokens, display text, Heading and Text components, custom type scales via defineTheme, and following the reader's text size on iOS.

## Line Height

Line heights are computed from a tiered target ratio and snapped to a 4px vertical grid. Small text (<20px) targets 1.5, medium text (20–31px) targets 1.4, and large text (≥32px) targets 1.25. A minimum gap of fontSize + 4px is enforced. The result is a unitless ratio stored in each --text-*-leading token.

The 4px grid matters: every line box aligns to 4px increments, which keeps baselines, spacing, and component heights predictable. The expandTypeScale utility computes these automatically when you provide a base and ratio, so you should never need to set line-height manually.

## Type Scale

Semantic tokens that combine size, weight, and line-height into a single type style. Each token triplet (--text-*-size, --text-*-weight, --text-*-leading) is consumed by Text and Heading. Use the component props rather than composing raw font tokens.

Semantic tokens for headings, body, labels, code, supporting text, and display text. References font size and weight tokens. Override via typography.scale in defineTheme.

Token                     | Core default
------------------------- | ---------------------------
--text-heading-1-size     | var(--font-size-2xl)
--text-heading-1-weight   | var(--font-weight-semibold)
--text-heading-1-leading  | 1.3333
--text-heading-2-size     | var(--font-size-xl)
--text-heading-2-weight   | var(--font-weight-semibold)
--text-heading-2-leading  | 1.4
--text-heading-3-size     | var(--font-size-lg)
--text-heading-3-weight   | var(--font-weight-semibold)
--text-heading-3-leading  | 1.4118
--text-heading-4-size     | var(--font-size-base)
--text-heading-4-weight   | var(--font-weight-semibold)
--text-heading-4-leading  | 1.4286
--text-heading-5-size     | var(--font-size-sm)
--text-heading-5-weight   | var(--font-weight-semibold)
--text-heading-5-leading  | 1.6667
--text-heading-6-size     | var(--font-size-xs)
--text-heading-6-weight   | var(--font-weight-semibold)
--text-heading-6-leading  | 1.6
--text-body-size          | var(--font-size-base)
--text-body-weight        | var(--font-weight-normal)
--text-body-leading       | 1.4286
--text-large-size         | var(--font-size-lg)
--text-large-weight       | var(--font-weight-semibold)
--text-large-leading      | 1.4118
--text-label-size         | var(--font-size-base)
--text-label-weight       | var(--font-weight-medium)
--text-label-leading      | 1.4286
--text-code-size          | var(--font-size-base)
--text-code-weight        | var(--font-weight-normal)
--text-code-leading       | 1.4286
--text-supporting-size    | var(--font-size-sm)
--text-supporting-weight  | var(--font-weight-normal)
--text-supporting-leading | 1.6667
--text-display-1-size     | var(--font-size-5xl)
--text-display-1-weight   | var(--font-weight-normal)
--text-display-1-leading  | 1.2381
--text-display-2-size     | var(--font-size-4xl)
--text-display-2-weight   | var(--font-weight-normal)
--text-display-2-leading  | 1.2571
--text-display-3-size     | var(--font-size-3xl)
--text-display-3-weight   | var(--font-weight-normal)
--text-display-3-leading  | 1.2414

## Display Text

Display variants (display-1, display-2, display-3) continue the geometric progression above heading-1, at steps +6, +5, and +4. They use normal weight (400) instead of semibold, and tighter line-heights (~1.2), since large text reads better with less leading. Use display types for hero banners, marketing headlines, and data callouts, not for document headings.

Display text often needs heading semantics for accessibility. Use the type prop on Heading to apply display styling while preserving the correct HTML element: `<Heading level={1} type="display-1">` gives you display-1 styling with an `<h1>` tag, so screen readers see the correct document outline.

## Headings and text

Use `Heading` for document structure and `Text` for everything else; each maps its props to the type scale tokens.

Heading for document structure:
```tsx
import {Heading} from '@curialy/ui/Heading';

// Heading levels map to semantic tokens: level 1 → --text-heading-1-*
<Heading level={1}>Page Title</Heading>
<Heading level={2}>Section</Heading>
<Heading level={3}>Subsection</Heading>

// Display type for hero/marketing headings — level sets the HTML element
<Heading level={1} type="display-1">Hero Title</Heading>
<Heading level={2} type="display-2">$1.2M Revenue</Heading>

// Override the accessibility level when visual ≠ document hierarchy
<Heading level={2} accessibilityLevel={3}>
  Sidebar Section
</Heading>
```

Text for body, label, and display text:
```tsx
import {Text} from '@curialy/ui/Text';

<Text type="body">Body text at the base scale.</Text>
<Text type="large">Emphasized body text.</Text>
<Text type="label">Form label</Text>
<Text type="supporting">Helper text, timestamps, metadata.</Text>
<Text type="code">{'const x = 1;'}</Text>

// Display without heading semantics (data callouts, decorative)
<Text type="display-2">$1.2M Revenue</Text>
```

## Custom type scale

Change the whole ramp with `base` and `ratio` in `defineTheme`; every font size and line height recomputes from them.

Customizing the type scale via defineTheme:
```tsx
import {defineTheme} from '@curialy/ui/theme';

// Adjust the entire ramp holistically with base and ratio
const editorialTheme = defineTheme({
  name: 'editorial',
  typography: {
    scale: { base: 16, ratio: 1.25 },          // airy / article feel
    body: { family: 'Geist', fallbacks: '-apple-system, sans-serif' },
    heading: { weight: 'bold' },
    code: { family: 'Geist Mono', fallbacks: '"SF Mono", monospace' },
  },
});

const denseTheme = defineTheme({
  name: 'dense',
  typography: {
    scale: { base: 12, ratio: 1.125 },          // compact / data-dense UI
  },
});
```

## Following the reader's text size on iOS

On iPhone, readers pick a text size in Settings (Display & Text Size, then Larger Text), and native apps grow or shrink their text with it. Every theme does the same in Safari on iPhone, which exposes that choice through `font: -apple-system-body`: each font size follows the reader's choice on the curve of the iOS text style it plays, so body text scales like Body, `heading-1` like Title 1 and display text like Large Title, and every role keeps its order. A size the theme fixes at a length, such as a 12px supporting size, scales on the curve of the step it reads by default; a size in `em` or `%` follows its parent, and one that reads a variable follows that variable. At the default size every font size is the theme's own. The family, spacing, radius and the root font size never change, line heights keep their ratios, text inputs keep their 16px floor on iOS, and on Android the system font scale grows every font size through `env(preferred-text-scale)` where the browser reports it; browsers with neither see no change. There is nothing to turn on: no theme option, prop or document attribute.

Fixed-height controls such as the text inputs keep their height, so their text can overflow at the accessibility sizes. A labelled `Button` grows with its label.

Up: design_system docs typography
Previous: design_system docs typography/font-setup
Next: design_system docs typography/typography-best-practices
