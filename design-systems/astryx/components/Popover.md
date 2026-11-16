package: @astryxdesign/core

# Popover

A click-triggered overlay anchored to a button or trigger element. Use it for secondary actions, inline confirmations, or supplementary information that does not warrant a full dialog. For hover previews use HoverCard, for brief helper text use Tooltip. Under a finger (a coarse primary pointer), it is presented like a native popover: it grows out of its trigger and shrinks back into it on the theme’s motion tokens; with reduced motion it cross-fades, opacity only, in 200 ms or less.

**Import:** `import {Popover} from '@astryxdesign/core/Popover';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trigger element | Yes | Caller-supplied or externally referenced control that anchors and toggles the popover. |
| Popover surface | Yes | Painted surface owned and themed by Popover through the canonical popover target. |
| Touch sheet | No | BottomSheet surface that holds the same content in place of the popover surface for presentation="bottom-sheet", or "adaptive" on a compact touch screen; themed through the bottom-sheet target. |
| Popover content | Yes | Caller-supplied content rendered inside the surface. |
| Fallback close control | No | Keyboard-reachable close affordance appended by usePopover when enabled. |

## Best Practices

- **Do:** Keep popover content focused on a single task or piece of information.
- **Do:** Provide a clear way to close: either by clicking outside or with an explicit close button.
- **Do:** Theme the painted surface through the canonical popover target.
- **Don't:** Nest popovers inside other popovers; it creates confusing focus and navigation.
- **Don't:** Assume input complexity alone determines the presentation; evaluate the task's focus, space, and interaction requirements.
- **Don't:** Assume scrolling alone means Popover is the wrong component; a bounded Popover may scroll while a focused anchored interaction remains appropriate.

## Components

### Popover

Click-triggered popover for interactive content anchored to trigger element.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Trigger element. Must contain <button> or [role="button"] element. |
| `anchorRef` | `React.RefObject<HTMLElement>` | - | External ref for popover anchor in sibling mode. |
| `content` | `ReactNode` | - | Content displayed inside popover. **(required)** |
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'below'` | Position relative to trigger. Logical: start/end resolve against the popover's inherited direction (RTL mirrors). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'start'` | Alignment along placement axis. Logical: start/end follow the popover's inherited direction (RTL mirrors). |
| `isOpen` | `boolean` | - | Whether popover shown in controlled mode. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Callback fired when popover visibility changes. |
| `isEnabled` | `boolean` | `true` | When false, trigger interactions ignored. |
| `width` | `number \| string` | `'auto'` | Popover container width; capped to alignment-aware viewport/safe-area gutters before long content scrolls. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `3` | Inner padding of the popover surface on the spacing scale (0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10), matching the padding prop on Card and Stack. Pass 0 for a flush surface when the content owns its own edges, such as a list of rows or a header with a rule, and pad the content itself. The padding sits on the painted popover target, so a theme padding on that target replaces it. |
| `label` | `string` | - | Accessible label for popover dialog. |
| `role` | `'dialog' \| 'none'` | `'dialog'` | ARIA role for the popover wrapper. Use dialog for dialog-style popovers; use none when content provides its own role, like menu or listbox. |
| `isModal` | `boolean` | `true` | Whether a dialog-style popover sets aria-modal. Only applies when role is dialog. |
| `hasCloseButton` | `boolean` | `true` | Whether to include hidden close button for accessibility. |
| `closeButtonLabel` | `string` | `'Close popover'` | Label for hidden close button. |
| `hasAutoFocus` | `boolean` | `true` | Move focus into genuine popover content on open, with a labeled-surface fallback; the generated close control stays hidden until reached by keyboard. |
| `hasLightDismiss` | `boolean` | `true` | Outside click dismisses; false for explicit-dismiss surfaces (coachmarks). |
| `hasEscapeDismiss` | `boolean` | `true` | Escape dismisses; full effect only with hasLightDismiss=false. |
| `presentation` | `'popover' \| 'bottom-sheet' \| 'adaptive'` | `'popover'` | Surface: 'popover' (anchored), 'bottom-sheet' (modal BottomSheet), or 'adaptive' (BottomSheet on a coarse pointer on a compact screen, popover elsewhere); chosen on open, kept until close. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |

## Examples

### Flush surface for a list of rows

```tsx
<Popover
  label="Recent files"
  padding={0}
  content={
    <List>
      <ListItem label="Quarterly report.pdf" />
      <ListItem label="Roadmap.key" />
    </List>
  }>
  <Button label="Recent" variant="secondary" />
</Popover>
```

### Roomier surface for a form

```tsx
<Popover
  label="Save search"
  padding={4}
  content={<SaveSearchForm />}>
  <Button label="Save search" variant="secondary" />
</Popover>
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-popover` | - | - | - |

Override in defineTheme:
```ts
components: {
  'popover': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  popover: {
    base: {
      borderRadius: '...',
    },
  },
}
```
