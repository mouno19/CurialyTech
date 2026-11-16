package: @astryxdesign/core

# useEntryAnimation

Returns a StyleX style for animating an element on mount. Only animates when the element is dynamically inserted after the initial page paint; elements rendered on page load are not animated. Uses Astryx motion tokens (duration, easing) for consistent animation timing. Server-rendered elements hydrate without the entry style and never animate; elements mounted after hydration animate.

## Best Practices

- **Do:** Use for conditionally rendered elements like validation messages, toasts, or expanding sections.
- **Do:** Spread the returned style into stylex.props() alongside other styles.
- **Don't:** Use for elements that should be visible on initial page load; they will not animate.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `preset` | `'slideDown' \| 'slideUp' \| 'fadeIn' \| 'scaleIn'` | `'slideDown'` | Animation preset to apply on mount. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `entryStyle` | `StyleXStyles \| null` | A StyleX style object for the entry animation, or null if the element was rendered on initial page load or hydrated from server HTML (no animation needed). |


Block templates: astryx component <name> --blocks for FieldStatus
