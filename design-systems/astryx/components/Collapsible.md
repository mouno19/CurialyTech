package: @astryxdesign/core

# Collapsible

Collapsible hides and reveals content behind a trigger button. Use in settings, FAQs, or detail views. Wrap in CollapsibleGroup for accordion behavior.

**Import:** `import {Collapsible} from '@astryxdesign/core/Collapsible';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | The root that contains one trigger and its controlled content and, in a divided group, paints the item divider. |
| Trigger | Yes | The always-visible button that toggles the content. Shows a label and a chevron indicator. |
| Chevron | No | Animated disclosure arrow. It follows the label by default; chevronPosition="start" moves it ahead of the label, points inward when collapsed (mirrored under RTL), and turns down when expanded. |
| Content | No | The area that hides or reveals when the trigger is clicked. |
| Group container | No | The CollapsibleGroup wrapper rendered when dividers are enabled. It contains the coordinated items and carries their density. |

## Best Practices

- **Do:** Give every trigger a meaningful accessible name; add VisuallyHidden text when custom visuals do not.
- **Do:** Use hasDividers on CollapsibleGroup for FAQ-style lists: built-in row hairlines, no hand-rolled borders.
- **Do:** Wrap each Collapsible in an Card for visual separation, or use CollapsibleGroup's hasDividers for flat lists; not both.
- **Do:** Use CollapsibleGroup with type="single" for settings or FAQ pages where only one section should be open at a time.
- **Do:** Use type="multiple" when users need to compare across sections.
- **Do:** Start sections open (defaultIsOpen) when content is needed on first view.
- **Don't:** Hide critical content behind a collapsible; users may not discover it.
- **Don't:** Nest collapsibles more than two levels deep; makes content hard to find and navigate.
- **Don't:** Use a collapsible for a single short paragraph; just show the text directly instead.

## Accessibility

- **Trigger label:** The trigger text must have at least 4.5:1 contrast with the surface behind it. For Pointer down, measure against the pressed overlay the trigger row paints while it is pressed.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `ReactNode` | - | Content shown in the trigger area (always visible). **(required)** |
| `children` | `ReactNode` | - | Content that collapses and expands. |
| `defaultIsOpen` | `boolean` | `true` | Default open state for standalone uncontrolled usage. Ignored when value binds the item to a surrounding CollapsibleGroup. |
| `isOpen` | `boolean` | - | Controlled open state for standalone usage. Ignored when value binds the item to a surrounding CollapsibleGroup. |
| `isDisabled` | `boolean` | `false` | Disable the item so its trigger can't be toggled (dimmed, aria-disabled, and out of the tab order). Doesn't collapse an already-open item. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback invoked when standalone open state changes. A surrounding CollapsibleGroup owns grouped state and calls its onChange instead. |
| `chevronPosition` | `'start' \| 'end'` | `'end'` | Logical position of Collapsible's disclosure chevron. `end` (default) follows the label, pointing down when collapsed and up when expanded. `start` precedes the label, pointing inward toward content when collapsed (mirrored under RTL) and down when expanded. Inside a CollapsibleGroup this defaults to the group's chevronPosition. |
| `value` | `string` | - | Identifier used for group coordination. When set inside a CollapsibleGroup, the group owns open state and its onChange is the notification callback. |
| `animatedLayout` | `AnimatedLayout` | - | The handle from useAnimatedLayout({containerRef}). With it, opening and closing glides the content after this Collapsible, up to that container, on one shared motion role instead of jumping, and the revealed content and the chevron move on the same motion. Without it, the content after it takes its place at once. |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the root collapsible element. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be a stylex.create() value. |
| `className` | `string` | - | CSS class name for the root element. Prefer xstyle for styling. |
| `style` | `CSSProperties` | - | Inline styles. Prefer xstyle for StyleX-optimized styling. |
| `data-testid` | `string` | - | Test selector for automated testing frameworks. |

## Components

### CollapsibleGroup

See `astryx component CollapsibleGroup` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-collapsible` | `data-density`, `data-divided` | density | divided |
| `astryx-collapsible-trigger` | `data-density`, `data-chevron-position`, `data-open`, `data-disabled` | density, chevronPosition | open, disabled |
| `astryx-collapsible-content` | `data-density`, `data-open` | density | open |
| `astryx-collapsible-group` | `data-density` | density | - |

Override in defineTheme:
```ts
components: {
  'collapsible': {
    base: { /* CSS properties */ },
    'density:value': { /* variant-specific */ },
    'divided': { /* state-specific */ },
  },
  'collapsible-trigger': {
    base: { /* CSS properties */ },
    'open': { /* state-specific */ },
  },
}
```
