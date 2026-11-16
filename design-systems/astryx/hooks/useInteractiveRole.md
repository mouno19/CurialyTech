package: @astryxdesign/core

# useInteractiveRole

Resolves what a polymorphic component should render as, in one place: href wins, then onClick, then an interactive trigger context supplied by a parent (Popover, DropdownMenu and friends), then inert. Use it in any component that is sometimes a link, sometimes a button, and sometimes plain content; Token, Thumbnail, Item and ClickableCard all do. Because context is part of the resolution, a component built on it becomes a valid trigger for new surfaces without changing.

## Best Practices

- **Do:** Switch on the returned role to pick the element, and render an anchor only for "link" so keyboard and middle-click behavior come from the platform.
- **Do:** Pass isDisabled through rather than dropping the href yourself; the hook already keeps disabled links out of the tab order.
- **Don't:** Add another ad-hoc href/onClick precedence check in a component; new trigger contexts are added here so every consumer inherits them.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseInteractiveRoleOptions` | - | The interactivity inputs the component received. **(required)** |
| `options.href` | `string` | - | URL for navigation. Highest priority: with an href the component is a link. |
| `options.onClick` | `((...args: never[]) => unknown) \| null` | - | Click handler. Resolves to a button, ahead of any context-provided role. |
| `options.isDisabled` | `boolean` | `false` | When true, href is ignored for role resolution (a disabled link is an anti-pattern), so the role comes from onClick, then context, then inert. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `role` | `'link' \| 'button' \| 'inert'` | The element the component should render: an anchor, a button, or a non-interactive span/div. |


Block templates: astryx component <name> --blocks for Token, Thumbnail, Item, ClickableCard
