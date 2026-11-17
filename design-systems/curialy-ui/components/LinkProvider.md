package: @curialy/ui

# LinkProvider

Wraps app to replace default <a> tag w/ framework-specific link component (e.g. Next.js Link) for client-side routing across all Curialy UI components.

**Import:** `import {LinkProvider} from '@curialy/ui/Link';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `component` | `LinkComponentType` | - | link component for all link elements in subtree (e.g. Next.js Link). Accepted href/to follow the Link href rule; structured fields including protocol are checked, preserving identity. Either rejected => inert content, no router invocation or fallback. **(required)** |
| `children` | `ReactNode` | - | Subtree; links rendered through useLinkComponent (Link, Button w/ href) use component unless they set `as` or a nearer provider applies; a disabled Link does not. **(required)** |
