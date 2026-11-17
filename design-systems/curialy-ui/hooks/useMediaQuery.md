package: @curialy/ui

# useMediaQuery

SSR-safe media query hook that subscribes to window.matchMedia changes. Returns whether the given media query matches. Always returns false on first render for SSR compatibility. Where `window.matchMedia` is missing, it returns its server default and never throws.

## Best Practices

- **Do:** Use for responsive layout switching based on viewport width, color scheme, or motion preferences.
- **Do:** Prefer Curialy UI responsive tokens and component props over manual breakpoint logic when possible.
- **Don't:** Use for server-rendered content that must match on first paint; the hook always returns false initially.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` | - | CSS media query string to evaluate. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `matches` | `boolean` | Whether the media query currently matches. Always false on first render (SSR-safe). |
