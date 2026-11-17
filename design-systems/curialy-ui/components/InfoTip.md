package: @curialy/ui

# InfoTip

A small "i" button: hover and keyboard focus preview the help; a click, tap, Enter, or Space pins it open. Use next to labels, values, and metrics for permission notes, metric definitions, and field help. Pre-wired accessible trigger: real button, aria-label, Tab-reachable, tooltip on hover AND focus AND tap, Escape dismissal. Toggletip pattern: aria-expanded="true" while pinned; the help is announced once when it pins. Host data-* attrs reach the button; name and disclosure attrs stay owned.

**Import:** `import {InfoTip} from '@curialy/ui/InfoTip';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Trigger button | Yes | Small round native button, named by `label`, that previews and pins the help. |
| Info icon | Yes | The icon registry's `info` artwork at `size`; a theme may replace it. |
| Help surface | Yes | Tooltip surface that shows `content` while the help is shown. |

## Best Practices

- **Do:** Keep tooltip content concise, plain, and non-interactive; use Popover or HoverCard for links and buttons.
- **Do:** Override label when "More information" is too generic, e.g. "About this metric".
- **Do:** Rely on InfoTip rather than a hand-rolled info button on touch: it pins its help on a press, so a tap, a click, Enter, or Space pins the tooltip even though the trigger is a button, and a tap outside dismisses it.
- **Don't:** Hand-compose Icon inside Tooltip for info affordances; the bare Icon is aria-hidden and unfocusable.
- **Don't:** Use InfoTip for essential information users must see to complete a task; put that text inline instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `ReactNode` | - | Tooltip content. Short, non-interactive text. Mirrors Tooltip content prop. **(required)** |
| `label` | `string` | `'More information'` | Accessible name for the trigger button. Default: the translated 'More information'. |
| `size` | `'xsm' \| 'sm' \| 'md' \| 'lg'` | `'sm'` | Info icon size (12/16/20/24px). Maps 1:1 to Icon sizes. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |
