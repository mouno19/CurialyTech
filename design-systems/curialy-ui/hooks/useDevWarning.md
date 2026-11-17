package: @curialy/ui

# useDevWarning

Fires a dev-only "Component: message" console warning once per mount while the condition holds. It is the render-safe way for a component to flag misuse: warning straight from the render body repeats on every render, and gating it with state adds a re-render, so this uses a ref and an effect instead. For a warning outside a component, use the imperative devWarn utility.

## Best Practices

- **Do:** Say what is wrong and what the builder should do instead; the message is the whole value of the warning.
- **Do:** Warn about combinations the types cannot express, such as two mutually exclusive props being set together.
- **Don't:** Use it for anything a user could see or for runtime error handling; it is stripped from production builds.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `component` | `string` | - | Component or hook name, used as the message prefix. **(required)** |
| `message` | `string` | - | What went wrong and how to fix it. **(required)** |
| `condition` | `boolean` | `true` | Whether to warn. |
