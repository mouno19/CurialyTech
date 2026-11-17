package: @curialy/ui

# useLinkComponent

Resolves which component renders a link, so a custom component's links follow the app's router the same way Curialy UI's own links do. The order is the as argument, then the nearest LinkProvider's component, then a native anchor. Render the returned component with href (and to, for a router that reads it). Before rendering it checks both destinations under the Link href rule: a rejected destination renders an anchor with no destination, and a custom router is never invoked with it. A custom component receives to={href} unless to is passed explicitly.

## Best Practices

- **Do:** Use it for links inside a custom component, so a LinkProvider wired to the router reaches them without a prop on every link.
- **Do:** Pass as='a' for a destination the router cannot handle, such as a file download or a page outside the app.
- **Don't:** Import the router's link directly in a shared component; the component then ignores LinkProvider and the destination check.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `as` | `LinkComponentType` | - | Component to render the link with, such as a router's link or 'a'. When set it wins over any LinkProvider. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `LinkComponent` | `LinkComponentType` | The resolved component: as, else the nearest LinkProvider's component, else a native 'a'. It is stable while the resolved component is the same. It checks href and to under the Link href rule before rendering; when either is rejected it renders an anchor with no destination and never invokes the router. A custom component receives to={href} unless an explicit to is passed. |


Block templates: design_system component <name> --blocks for Link, LinkProvider
