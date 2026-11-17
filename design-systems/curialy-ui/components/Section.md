package: @curialy/ui

# Section

Section creates page regions. Use for settings groups, form sections, sidebar areas. If you want to visually separate a part of a page, use Section, not Card. Cards are for discrete items (one profile, one notification).

**Import:** `import {Section} from '@curialy/ui/Section';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Section container | Yes | Painted container that groups a page region. |
| Consumer content | No | Caller-provided content rendered inside the section container. |

## Best Practices

- **Do:** Use Section for page-level grouping: settings panels, form groups, sidebar regions. Page sections, not discrete items.
- **Do:** Start w/ default variant. Use muted only to call attention to a specific region.
- **Do:** Add dividers between same-background sections that need separation.
- **Do:** Combine w/ heading + Stack for typical page section pattern.
- **Don't:** Use Card when you mean Section. Cards = discrete items (one notification, one profile). Sections = page regions.
- **Do:** Center: xstyle marginInlineStart + marginInlineEnd 'auto'. If Curialy UI source goes through your app's StyleX pass, marginInline shorthand loses to Section's inline margins.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'section' \| 'transparent' \| 'muted'` | `'section'` | Background variant applied to section container. |
| `width` | `SizeValue` | - | Section width; number interpreted as pixels, string used as-is. |
| `height` | `SizeValue` | - | Section height; number interpreted as pixels, string used as-is. |
| `maxWidth` | `SizeValue` | - | Maximum width of section. |
| `minHeight` | `SizeValue` | - | Minimum height of section. |
| `children` | `ReactNode` | - | Content rendered inside section. |
| `dividers` | `Array<'top' \| 'bottom' \| 'start' \| 'end'>` | - | Which sides of section have divider borders. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `4` | Internal padding via spacing scale; 0 for edge-to-edge content. |
| `paddingInline` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-axis padding override; preserves block padding from padding/theme. |
| `paddingInlineStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-start (left in LTR) padding override; wins over paddingInline/padding on that edge. |
| `paddingInlineEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-end (right in LTR) padding override; wins over paddingInline/padding on that edge. |
| `paddingBlock` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-axis padding override; preserves inline padding from padding/theme. |
| `paddingBlockStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-start (top) padding override; wins over paddingBlock/padding on that edge. |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-end (bottom) padding override; wins over paddingBlock/padding on that edge. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization; must be stylex.create() value. |

## Examples

### Center a Section with a maximum width

```tsx
import * as stylex from '@stylexjs/stylex';
import {Section} from '@curialy/ui/Section';

const styles = stylex.create({
  centered: {marginInlineStart: 'auto', marginInlineEnd: 'auto'},
});

function Page({children}: {children: React.ReactNode}) {
  return (
    <Section maxWidth={1280} xstyle={styles.centered}>
      {children}
    </Section>
  );
}
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-section` | `data-variant` | section, transparent, muted | - |

Override in defineTheme:
```ts
components: {
  'section': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```
