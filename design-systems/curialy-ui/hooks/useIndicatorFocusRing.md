package: @curialy/ui

# useIndicatorFocusRing

Draws the standard focus ring on the indicator of a control whose real input is visually hidden; a checkbox or radio focuses an opacity-0 input, so the ring has to appear on the picture beside it. The ring is painted imperatively on the indicator's own element, which is the only element whose border-radius can shape it, and only on :focus-visible, so pointer clicks stay quiet. Owning it here means a theme-supplied indicator cannot ship a control with no visible focus (WCAG 2.4.7) by ignoring a prop.

## Best Practices

- **Do:** Wrap only the indicator in the ref'd element; a wrapper holding label text would ring the whole row.
- **Do:** Spread focusProps on the element that contains the hidden input, not on the input itself.
- **Don't:** Ask a themeable indicator to draw its own focus ring; a replacement that ignores the prop leaves the control with no visible focus.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `containerRef` | `RefObject<HTMLElement \| null>` | - | Ref to an element wrapping only the indicator, so its single element child is unambiguously the thing to ring. **(required)** |
| `isDisabled` | `boolean` | `false` | Skip the ring; a disabled control is not focusable. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `focusProps` | `{onFocus: (event: FocusEvent<HTMLElement>) => void; onBlur: () => void}` | Spread onto the element that owns the focusable input. |


Block templates: design_system component <name> --blocks for CheckboxInput, RadioList, Selector
