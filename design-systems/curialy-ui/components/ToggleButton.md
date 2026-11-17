package: @curialy/ui

# ToggleButton

ToggleButton switches between selected/unselected for persistent on/off choices. Standalone for binary actions or in ToggleButtonGroup for single/multi-select toolbar controls.

**Import:** `import {ToggleButton} from '@curialy/ui/ToggleButton';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Icon | No | A leading icon that represents the toggle action, like a star for favorite or bold "B" for formatting. |
| Pressed icon | No | An alternate icon shown when pressed: typically a filled version of the default icon to reinforce the active state. |
| Label | Yes | The visible text or accessible name. For icon-only toggles, used as the aria-label and auto-tooltip. |
| Spinner | No | Replaces the icon during async operations triggered by pressedChangeAction. |

## Best Practices

- **Do:** Filled/colored icon for pressed state so users see current state at a glance.
- **Do:** Keep label identical between states. Let visual treatment communicate the change.
- **Do:** Wrap related toggles in ToggleButtonGroup with accessible label.
- **Don't:** Don't use ToggleButton for one-time actions; use regular Button for submit/delete.
- **Don't:** Don't mix ToggleButtons with regular Buttons in the same group.
- **Don't:** Don't use ToggleButton for persistent settings; use Switch instead.

## Accessibility

- **Text label:** The label must have at least 4.5:1 contrast with the button background when selected and unselected. For Hover and Pointer down, measure the final background after the overlay is applied.
- **Essential icon or spinner arc:** An icon-only ToggleButton must have at least 3:1 contrast between its icon and button background. The moving spinner arc must also meet 3:1. An icon beside a visible label does not need its own check.
- **Selected state indicator:** The selected background must reach 3:1 only when users need it to tell selected from unselected. Label weight or a changed icon can also show selection.
- **Visible control boundary:** The button edge needs 3:1 contrast only when users need it to see the control. A visible label or icon can show the control instead.
- **Keyboard focus indicator:** The focus outline must have at least 3:1 contrast with the area around the button. Check both selected and unselected states.
- **Disabled appearance:** Disabled controls do not need to meet these contrast ratios.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Accessible label for the button. Used as visible text, or as aria-label for icon-only buttons. **(required)** |
| `isPressed` | `boolean` | - | Whether the button is currently pressed. Ignored for a ToggleButtonGroup member with a value. |
| `onPressedChange` | `(isPressed: boolean, event: MouseEvent) => void` | - | Called synchronously when pressed state should change. Receives the next state and the click event; call event.preventDefault() to skip pressedChangeAction. Without an Action, the callback produces no Action-pending feedback. Ignored for a ToggleButtonGroup member with a value. |
| `pressedChangeAction` | `(isPressed: boolean) => void \| Promise<void>` | - | Action handler for API- or navigation-backed toggles, run in a transition after the synchronous onPressedChange callback unless that callback calls event.preventDefault(). Works without onPressedChange. Shows an optimistic pressed state and a spinner while pending, and remains interruptible by re-clicks. Omit it for callback-only toggles with no Action-pending feedback. Ignored for a ToggleButtonGroup member with a value. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size. Defaults to group size when inside a group. |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | Resting shadow depth for floating (FAB-style) toggle buttons, mirroring Button. `none` is the default flat button; `low`/`med`/`high` map to the shadow token scale. Applies inside a ToggleButtonGroup as well — grouped children retain their own elevation. |
| `isDisabled` | `boolean` | `false` | Whether the button is disabled. |
| `isLoading` | `boolean` | `false` | Whether the button shows a loading spinner. |
| `icon` | `ReactNode` | - | Icon element. When provided without children, button becomes icon-only with tooltip from label. |
| `isIconOnly` | `boolean` | `false` | When true, renders as a square icon-only button with `label` as the aria-label and an automatic tooltip from the label. |
| `pressedIcon` | `ReactNode` | - | Icon shown when pressed. Falls back to icon if not provided. |
| `children` | `ReactNode` | - | Visible content. If omitted with icon, button becomes icon-only. |
| `tooltip` | `string` | - | Tooltip text shown on hover. |
| `value` | `string` | - | Value identifier when used inside ToggleButtonGroup. Required in groups. |
| `data-testid` | `string` | - | Test selector for automated testing frameworks. |

## Components

### ToggleButtonGroup

See `design_system component ToggleButtonGroup` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-toggle-button-group` | - | - | - |
| `cui-toggle-button` | `data-elevation`, `data-is-pressed` | elevation | isPressed |

Override in defineTheme:
```ts
components: {
  'toggle-button-group': {
    base: { /* CSS properties */ },
  },
  'toggle-button': {
    base: { /* CSS properties */ },
    'isPressed': { /* state-specific */ },
  },
}
```
