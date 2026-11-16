package: @astryxdesign/core

# Card

Card is for discrete items with clear interaction boundaries (one profile, one notification, one product). Cards are NOT the default. Spacing and alignment create visual grouping without borders. Ask: "could I reorder or remove this independently?" If no, don't use a card.

**Import:** `import {Card} from '@astryxdesign/core/Card';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | The outer box with border, background, border-radius, and padding. |
| Content | Yes | Any children rendered inside the card. Often a stack of heading, text, and actions. |

## Best Practices

- **Do:** Ask "could I reorder/remove this independently?" If yes, it's a card. If no, it's just a page section: use heading + Stack or Section.
- **Do:** Use cards for discrete items: one profile, one notification, one metric, one product in a grid. Each card = one "thing" w/ clear interaction boundaries.
- **Do:** Spacing + alignment alone create visual grouping. Not everything needs a container; try removing the card; if grouping still reads from whitespace + typography, skip it.
- **Do:** Keep padding consistent across sibling cards so they align visually in a grid or list.
- **Do:** Pair a card w/ Layout when you need a structured header, scrollable content, and footer with actions.
- **Do:** Card shrinks to its row/grid track, clips unwrappable content at its edge. Long IDs/hashes/URLs → Text maxLines={1} (tooltip shows full value). Wide content → own scroll region (Table scrolls itself; ScrollableArea otherwise).
- **Don't:** Default to cards for grouping. Heading + Stack w/ proper spacing creates hierarchy w/o borders everywhere. Cards are the exception, not the default.
- **Don't:** Wrap page sections in cards. "General Settings", "Notification Preferences", form groups are page regions; use Section or heading + stack.
- **Don't:** Create identical card grids (icon + heading + text, repeated). Vary the layout or question whether cards are needed at all.
- **Don't:** Nest cards inside other cards; flatten the hierarchy or use spacing + dividers instead.
- **Don't:** Use color variants for status; use Banner or Badge for that instead. Color cards are for categorization.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | `SizeValue` | - | card width (number=px, string=as-is) |
| `height` | `SizeValue` | - | card height (number=px, string=as-is) |
| `maxWidth` | `SizeValue` | - | max card width |
| `minHeight` | `SizeValue` | - | min card height |
| `children` | `ReactNode` | - | content inside card |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `the theme's card padding (spacing step 4 with no theme)` | internal padding via spacing scale; omitted = the theme's card padding, NOT a fixed step. Passing a step overrides the theme. |
| `variant` | `'default' \| 'transparent' \| 'muted' \| 'blue' \| 'cyan' \| 'gray' \| 'green' \| 'orange' \| 'pink' \| 'purple' \| 'red' \| 'teal' \| 'yellow'` | `'default'` | background color variant; `default` = standard card bg, `transparent` = no background at all, `muted` = muted bg for de-emphasised cards; non-semantic variants use the corresponding `--color-background-<name>` token |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth: none (flat) \| low \| med \| high (shadow token scale). Raise only to float above content. |

## Examples

### Cards sharing a row on a phone, with long IDs

```tsx

import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {VStack} from '@astryxdesign/core/VStack';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';

const payouts = [
  {label: 'Payout', amount: '$1,240.00', id: 'po_1Q8ZK4X7M2N5P3R6T9V1W4YB'},
  {label: 'Refund', amount: '-$86.50', id: 're_3NfK9Lm2Qx7Vb4Tz8Rw1Hy6C'},
  {label: 'Adjustment', amount: '$12.00', id: 'adj_7Hq2Wm9Kx4Lz8Vn3Rb6Tf1PD'},
];

// Each card takes one grid track and shrinks with it, so three cards fit a
// 390px phone without widening the page. The ID cannot wrap, so it truncates
// with maxLines={1} (the full value shows in a tooltip) instead of running
// past the card edge.
function PayoutCards() {
  return (
    <Grid columns={3} gap={3}>
      {payouts.map(payout => (
        <Card key={payout.id}>
          <VStack gap={1}>
            <Heading level={3}>{payout.label}</Heading>
            <Text hasTabularNumbers>{payout.amount}</Text>
            <Text type="supporting" maxLines={1}>
              {payout.id}
            </Text>
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-card` | `data-variant`, `data-elevation` | default, transparent, muted, blue, cyan, gray, green, orange, pink, purple, red, teal, yellow | - |

Override in defineTheme:
```ts
components: {
  'card': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  card: {
    base: {
      borderRadius: '...',
      padding: '...',  // expands to container layout tokens
    },
  },
}
```
