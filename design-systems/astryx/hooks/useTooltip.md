package: @astryxdesign/core

# useTooltip

Headless hook for hover/focus-triggered tooltips. Builds on useLayer with hover intent, keyboard focus handling, and accessible aria-describedby linking. Use for custom trigger elements that need tooltip behavior without the wrapper component.

## Best Practices

- **Do:** Use for brief text labels that describe icon buttons, truncated text, abbreviations, or compact controls.
- **Do:** Prefer the Tooltip component for standard wrapping; use the hook when the trigger is not a simple child.
- **Do:** For a toggle-style trigger, have your own button call show() and hide() on each press. Give it aria-describedby and aria-controls set to describedBy, and aria-expanded (true while show() holds the tooltip, false after hide() or onHide), and keep its own accessible name. For an info icon, use InfoTip instead.
- **Don't:** Put interactive content inside tooltips: use Popover or HoverCard instead.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'above'` | Position relative to the trigger. Logical: start/end resolve against the popover's own inherited direction (RTL mirrors in pure CSS). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'center'` | Alignment along the placement axis. Logical: start/end resolve against the popover's own inherited direction (RTL mirrors in pure CSS). |
| `delay` | `number` | `200` | Delay before showing on hover, in milliseconds. |
| `hideDelay` | `number` | `0` | Delay before hiding after mouse or focus leaves, in milliseconds. |
| `focusTrigger` | `'auto' \| 'always' \| 'never'` | `'auto'` | When focus should open the tooltip. auto opens when the trigger itself takes focus, or focus lands inside a trigger that is focusable at that moment, so a roving-tabindex member opens when the arrow keys reach it. |
| `touchTrigger` | `'auto' \| 'tap' \| 'none'` | `'auto'` | What a tap does where there is no hover. auto opens on tap unless the trigger performs an action of its own (an aria-disabled control performs none); tap always opens (a button whose only job is revealing the tooltip); none never opens on touch. |
| `isEnabled` | `boolean` | `true` | Whether hover and focus triggers are enabled. |
| `isOpen` | `boolean` | - | Controlled open state. true force-shows; false force-hides, and focus that would show it calls onShow; undefined lets hover/focus manage visibility. |
| `isDefaultOpen` | `boolean` | `false` | Whether the tooltip should be shown on mount. |
| `onShow` | `() => void` | - | Callback fired when the tooltip becomes visible. Under isOpen={false}, it reports focus that would show the tooltip. |
| `onHide` | `() => void` | - | Callback fired when the tooltip is hidden. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `RefCallback<HTMLElement>` | Combined ref that sets both position and interaction on the same trigger element. |
| `positionRef` | `RefCallback<HTMLElement>` | Ref for the positioning anchor element. |
| `interactionRef` | `RefCallback<HTMLElement>` | Ref for the hover/focus interaction element. |
| `anchorId` | `string` | CSS anchor name for advanced positioning cases. |
| `describedBy` | `string` | ID to compose into aria-describedby on the trigger. |
| `renderTooltip` | `(children: ReactNode, props?: Omit<ContextRenderProps, 'positioning'>) => ReactNode` | Render function for the anchor-positioned tooltip content. The positioning opt-out is excluded: the tooltip always derives its position from placement/alignment. |
| `show` | `() => void` | Opens the tooltip now and keeps it open until hide(), Escape, a press outside, or focus leaving its trigger. Its text is announced once, and onShow fires. Under a controlled isOpen it only calls onShow. Does nothing while isEnabled is false. |
| `hide` | `() => void` | Closes the tooltip now, and onHide fires. Under a controlled isOpen it only calls onHide. |


Block templates: astryx component <name> --blocks for Tooltip, HoverCard, Popover
