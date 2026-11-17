package: @curialy/ui

# usePressFeedback

The touch press model every Curialy UI pressable uses, for a local component that paints its own press. Under a finger, CSS `:active` paints on the touch itself and can outlive the start of a scroll; the press model instead tracks the touch the way UIKit tracks a control: it highlights as the finger lands (after the content-touch delay inside a scroller, where a flick paints nothing), a quick tap answers at the lift, and a scroll that takes the touch cancels it with no fade. One document-level controller does this for every marked element (installed by the first pressable to mount, removed by the last to unmount), so calling the hook adds no listener or state to your element. On a desktop a mouse press is still your `:active` rule: keep it, and drop it under `@media (pointer: coarse)` the way the built-in components do. That query reads the primary pointer, so on a phone or tablet it also drops `:active` for a connected mouse, trackpad or keyboard; the controller paints those presses there (at once, faded at the release), so nothing goes unanswered.

## Best Practices

- **Do:** Spread the result on the element whose background paints the press and compose one of `interactionOverlayStyles` on it; the composed style is the instant onset, the hold and the fade, and it is themed through `--color-overlay-pressed`.
- **Do:** Let the composed style own the press on every pointer: it keeps `:active` for a desktop mouse and drops it under `@media (pointer: coarse)`, where the controller paints every press (a finger through the press model, a mouse or Space key at once). A rule of your own that paints `:active` would paint under a finger too, on the touch and through a scroll.
- **Don't:** Add a pointer listener or React state to the element to track the press; the controller already writes the attribute, and per-element listeners are what a long list cannot afford.
- **Don't:** Call it for a control rendered by an Curialy UI component; those are marked already, and the innermost marked element takes the press.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `pressableProps` | `{'data-cui-pressable': ''}` | The marker attribute to spread on the element that paints the press. Compose one of `interactionOverlayStyles` (from `@curialy/ui/utils`) on the same element — `backgroundColor` or `backgroundImage` for a surface whose hover and press are the system's overlays, `pressedBackgroundColor` for one whose hover is its own — and it paints the pressed token on the first frame of a press and fades it over the release, keeping `:active` for a mouse on a desktop. On a phone or tablet, where the stylesheet drops `:active`, the controller also paints a mouse, trackpad or Space-key press: at once, held while the button or key is down, faded at the release. A press is themed through `--color-overlay-pressed`. |


Block templates: design_system component <name> --blocks for Button, Item, ClickableCard
