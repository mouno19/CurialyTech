package: @astryxdesign/core

# SegmentedControl

A segmented button group that allows users to make a single selection from a small set of mutually exclusive options. Use SegmentedControl when all options should be visible at once and the selection controls a value or mode, not page navigation. Under a finger, on a touch device (a coarse primary pointer), the selection slides to the new segment, whether a tap, an arrow key or a new value moved it; with Reduce Motion nothing travels: the old selection fades out as the new one fades in. There, pressing the selected segment lifts it, and dragging it carries the selection along with the selected label’s colour following it, and the segment under the finger is chosen when it lets go; a tap selects through the browser’s click; a pressed unselected segment shows the shared pressed overlay, and nothing dims. A drag that drifts off the control still chooses by its position along it. Going back to the selected segment, or Escape, changes nothing. With a mouse or a pen every change, a click included, slides on the theme’s duration and easing, and dragging the selected segment carries it as a finger does.

**Import:** `import {SegmentedControl} from '@astryxdesign/core/SegmentedControl';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Control | Yes | Container for the mutually exclusive segment choices. |
| Segment | Yes | Individual choice within the control. |
| Label | No | Visible text identifying a segment when its label is not hidden. |
| Icon | No | Optional caller-supplied icon shown inside a segment. |

## Best Practices

- **Do:** Use for switching between 2–5 mutually exclusive views or modes where all options should be visible.
- **Do:** Provide a descriptive label for the control to ensure the group is accessible to screen readers.
- **Don't:** Use for page-level navigation; use TabList instead. TabList is a navigation component, while SegmentedControl is an input that always has exactly one selected option.
- **Don't:** Use for simple on/off states; use ToggleButton instead. ToggleButton can be toggled on or off independently, while SegmentedControl enforces a single selection from a group.
- **Don't:** Wrap a disabled SegmentedControl in Tooltip to explain why it is disabled; the reason is then not attached to the control or its segments. Use the disabledMessage prop instead.

## Accessibility

- **Text label:** Each label must have at least 4.5:1 contrast with its segment background. Check unselected, Hover, Pointer down, and selected colors as they appear on screen. For Hover and Pointer down, measure the final background after the overlay is applied. The track is translucent, so label contrast depends on the background behind the control. Check the labels on every background the control sits on, including a custom page color.
- **Essential icon:** When a segment has no visible label, its icon must have at least 3:1 contrast with the segment background. An icon beside a visible label does not need its own check.
- **Selected state indicator:** The selected background must reach 3:1 only when users need it to tell selected from unselected. Label color and weight also show selection.
- **Visible control boundary:** The control edge or segment borders need at least 3:1 contrast when users need them to see the choices.
- **Keyboard focus indicator:** The focus outline must have at least 3:1 contrast with the area around the segment. Check it on the track and selected background.
- **Disabled appearance:** Disabled controls do not need to meet these contrast ratios.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | currently selected value (controlled) **(required)** |
| `onChange` | `(value: string) => void` | - | callback on segment selection **(required)** |
| `label` | `string` | - | aria-label for radio group (never rendered) **(required)** |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | size variant |
| `layout` | `'hug' \| 'fill'` | `'hug'` | hug (default) sizes to content, capped at container; fill stretches equally |
| `isDisabled` | `boolean` | `false` | disables entire control |
| `disabledMessage` | `string` | - | Explains why the control is disabled. Applies to the whole-group disabled state (isDisabled), not per segment. With isDisabled, shows a tooltip on hover/keyboard focus, and the reason describes each segment (selection stays blocked). Use this instead of wrapping a disabled SegmentedControl in Tooltip, so the reason is attached to the control itself. |
| `children` | `ReactNode` | - | SegmentedControlItem children **(required)** |
| `xstyle` | `StyleXStyles` | - | additional StyleX styles for container |

## Components

### SegmentedControlItem

See `astryx component SegmentedControlItem` for props and usage.

## Examples

### In a narrow card

```tsx

import {useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';

const SUMMARY = {
  overview: '4 projects, 2 due this week.',
  activity: '18 updates since Monday.',
  members: '12 members, 3 pending invites.',
  billing: 'Next invoice on October 1.',
};

// Inside a VStack the default hug layout keeps its content width; it does not
// stretch to the card. When the card is narrower than the control (a 320px
// phone column), the control caps at the card width and each label truncates
// with an ellipsis instead of running past the card edge. The full label stays
// each segment's accessible name. Keep labels short for phone widths.
function WorkspaceCard() {
  const [view, setView] = useState('overview');
  return (
    <Card maxWidth={480}>
      <VStack gap={3}>
        <Heading level={3}>Team workspace</Heading>
        <SegmentedControl label="Workspace view" value={view} onChange={setView}>
          <SegmentedControlItem value="overview" label="Overview" />
          <SegmentedControlItem value="activity" label="Activity" />
          <SegmentedControlItem value="members" label="Members" />
          <SegmentedControlItem value="billing" label="Billing" />
        </SegmentedControl>
        <Text color="secondary">{SUMMARY[view]}</Text>
      </VStack>
    </Card>
  );
}

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-segmented-control` | `data-size` | size | - |
| `astryx-segmented-control-item` | `data-size`, `data-selected`, `data-disabled` | size | selected, disabled |

Override in defineTheme:
```ts
components: {
  'segmented-control': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'segmented-control-item': {
    base: { /* CSS properties */ },
    'selected': { /* state-specific */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  segmented-control: {
    base: {
      borderRadius: '...',
      padding: '...',
    },
  },
}
```
