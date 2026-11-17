package: @curialy/ui

# useHoverCard

Headless hook for hover-triggered floating cards. Builds on useLayer with hover/focus intent detection, configurable delays, safe hover behavior, and accessible aria-describedby linking. Use for rich previews on hover when you need full control over the trigger or rendered content.

## Best Practices

- **Do:** Use for rich content previews such as user profiles, entity summaries, and link previews.
- **Do:** Prefer the HoverCard component for standard trigger-content pairs; use the hook for custom trigger patterns.
- **Don't:** Use for simple text hints: use Tooltip or useTooltip instead.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'above'` | Position relative to the trigger. Logical: start/end resolve against the popover's own inherited direction (RTL mirrors in pure CSS). |
| `alignment` | `'start' \| 'center' \| 'end'` | `'center'` | Alignment along the placement axis. Logical: start/end resolve against the popover's own inherited direction (RTL mirrors in pure CSS). |
| `delay` | `number` | `300` | Delay before showing the hover card on hover, in milliseconds. |
| `hideDelay` | `number` | `200` | Delay before hiding after mouse or focus leaves, in milliseconds. |
| `focusTrigger` | `'auto' \| 'always' \| 'never'` | `'auto'` | When focus should open the hover card. auto opens when the trigger itself takes focus, or focus lands inside a trigger that is focusable at that moment, so a roving-tabindex member opens when the arrow keys reach it. |
| `touchTrigger` | `'auto' \| 'tap' \| 'none'` | `'auto'` | What a tap does where there is no hover. auto opens on tap unless the trigger performs an action of its own (an aria-disabled control performs none); tap always opens; none never opens on touch. |
| `isEnabled` | `boolean` | `true` | Whether hover and focus triggers are enabled. |
| `label` | `string` | - | Accessible name for the hover card popup. When provided, the popup is exposed as a named role="dialog"; when omitted, it falls back to role="group" (a group may validly be unnamed). |
| `isOpen` | `boolean` | - | Controlled open state. true force-shows, false force-hides, undefined lets hover/focus manage visibility. |
| `isDefaultOpen` | `boolean` | `false` | Whether the hover card should be shown on mount. |
| `onShow` | `() => void` | - | Callback fired when the hover card becomes visible. |
| `onHide` | `() => void` | - | Callback fired when the hover card is hidden. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `RefCallback<HTMLElement>` | Combined ref that sets both position and interaction on the same trigger element. |
| `positionRef` | `RefCallback<HTMLElement>` | Ref for the positioning anchor element. Use when position and interaction live on different elements. |
| `interactionRef` | `RefCallback<HTMLElement>` | Ref for the hover/focus interaction element. Use with positionRef for split trigger patterns. |
| `anchorId` | `string` | CSS anchor name for advanced positioning cases. |
| `describedBy` | `string` | ID to compose into aria-describedby on the trigger. |
| `renderHoverCard` | `(children: ReactNode, props?: Omit<ContextRenderProps, 'positioning'>) => ReactNode` | Render function for the anchor-positioned hover card content. The positioning opt-out is excluded: the hover card always derives its position from placement/alignment. |
| `show` | `() => void` | Imperatively show the hover card immediately. |
| `hide` | `() => void` | Imperatively hide the hover card immediately. |


Block templates: design_system component <name> --blocks for HoverCard, Tooltip, Popover
