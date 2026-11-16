package: @astryxdesign/core

# useDirection

Reads the current text direction during render. Reach for this hook as a last resort when render-time direction is strictly required (such as canvas drawing that cannot use CSS logical properties). In order of preference, always favor: CSS logical properties (margin-inline, inset-inline); shared mirror styles for directional icons (CSS scaleX); and DOM reads for keyboard or gesture logic.

## Best Practices

- **Do:** Prefer CSS logical properties and directional CSS mirroring before using useDirection.
- **Do:** Use useDirection when drawing on an HTML canvas or calculating non-CSS layout coordinates where the start edge depends on text direction.
- **Don't:** Use useDirection to conditionally swap margins, paddings, or inline alignments that can be solved with CSS logical properties.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `direction` | `'ltr' \| 'rtl'` | The ambient text direction ('ltr' or 'rtl') from the enclosing InternationalizationProvider, falling back to 'ltr' when called outside a provider. |


Block templates: astryx component <name> --blocks for InternationalizationProvider
