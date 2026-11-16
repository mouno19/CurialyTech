package: @astryxdesign/core

# StatusDot

A small colored dot that communicates status like online/offline presence or severity levels. Supports five semantic variants and an optional pulse animation. Always pair with a visible text label, as color alone should not carry meaning.

**Import:** `import {StatusDot} from '@astryxdesign/core/StatusDot';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Dot | Yes | Painted status dot that carries the selected semantic variant. |
| Status icon | No | Optional caller-supplied icon rendered inside the dot. |

## Best Practices

- **Do:** Use StatusDot as a binary present/absent signal; avoid encoding many distinct states in a single dot, since color and size alone cannot reliably distinguish them.
- **Do:** Always pair with a visible text label so status is not conveyed by color alone.
- **Do:** Provide a descriptive `label` prop for screen reader accessibility.
- **Do:** Pair the dot with an icon that carries the status as a distinct shape when it must stand on its own without adjacent text, so meaning survives without color.
- **Do:** If you can't add a label or an icon, make sure the status is conveyed elsewhere accessibly (e.g. adjacent text, a table column, or a live region).
- **Don't:** Rely on color alone to communicate status; StatusDot is not fully accessible in isolation, so the builder must make the status distinguishable in context via a label, an icon, or an accessible alternative.
- **Don't:** Use the pulse animation for purely decorative purposes; reserve it for states that require immediate attention.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'success' \| 'warning' \| 'error' \| 'accent' \| 'neutral'` | - | Semantic color variant. **(required)** |
| `label` | `string` | - | Accessible label via aria-label. **(required)** |
| `isPulsing` | `boolean` | `false` | Pulse animation; respects prefers-reduced-motion: reduce. |
| `tooltip` | `string` | - | Tooltip text on hover to explain status meaning. |
| `icon` | `ReactNode` | - | Optional ReactNode rendered centered in the dot (currentColor ink); a non-color mark for the status, use a different icon per status. Booleans/empty strings ignored (safe for cond && <Icon/>). Same contract as AvatarStatusDot. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-status-dot` | `data-variant` | success, warning, error, accent, neutral | - |

Override in defineTheme:
```ts
components: {
  'status-dot': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```
