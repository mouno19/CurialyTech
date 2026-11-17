package: @curialy/ui

# Avatar

Avatar represents a person or team with a profile photo, initials, or a default icon. Falls back automatically. Use in comment headers, contact lists, chat, user cards.

**Import:** `import {Avatar} from '@curialy/ui/Avatar';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Photo | No | The profile image, loaded from the src URL. Shown when available. |
| Initials | No | The first letter, digit or emoji of the first and last words of the name; punctuation is skipped. Shown when no photo is available. A name with no letters, digits or emoji shows the default icon instead. Like the photo, the initials are part of the picture: assistive technology reads the name, not the letters. |
| Default icon | No | A generic person silhouette. Shown when there is no photo or name. |
| Status dot | No | A small indicator in the bottom-right corner showing availability (online, away, busy). Each variant pairs colour with a distinct shape so status does not rely on colour alone. |

## Best Practices

- **Do:** Always pass a name for initials fallback and screen reader alt text.
- **Do:** Match size to context: xsm/sm inline, md/lg in lists, xl for profiles.
- **Do:** Add a status dot in chat or team views where availability matters.
- **Do:** When wrapping Avatar in your own Tooltip or HoverCard, set tooltip={false} so the built-in name tooltip does not overlap yours.
- **Do:** Interactive avatars (href/onClick) need name or alt; without one they warn in development.
- **Don't:** Rely on a status label to name an interactive avatar. "Online" says nothing about where the link goes.
- **Don't:** Use for logos or product images. Use an image or icon instead.
- **Don't:** Force a square or custom shape. Avatars are always circular.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | primary image source URL |
| `fallbackSrc` | `string` | - | fallback image when primary fails |
| `name` | `string` | - | user name for initials and alt text |
| `alt` | `string` | - | alt text; falls back to name |
| `size` | `'xsm' \| 'sm' \| 'md' \| 'lg' \| 'xl' \| 16 \| 20 \| 24 \| 32 \| 36 \| 40 \| 48 \| 60 \| 64 \| 72 \| 96 \| 128 \| 144 \| 180` | `'md'` | named sizes: 'xsm' 20px, 'sm' 24px, 'md' 36px, 'lg' 48px, 'xl' 128px; numeric px restricted to values listed in the type. AvatarGroup's size always wins, default included. |
| `shape` | `'circle' \| 'rounded' \| 'square'` | `'circle'` | Shape variant of the avatar. 'circle' (default) stays fully round. 'rounded' uses the element radius token so it matches UI corner rounding and can be set globally via theme. 'square' has no radius. Status dot positioning adapts automatically: 4-o'clock on circle, bottom-right corner on rounded/square. |
| `status` | `ReactNode` | - | corner content for status indicators; AvatarStatusDot reports its `label`, composed into the avatar accessible name ("Jane Doe, Online"), at any nesting depth |
| `tooltip` | `string \| boolean` | `true` | hover/focus tooltip. true/omitted → name; string → that text; false → none. Owns its tooltip; set false when wrapping in your own Tooltip/HoverCard. Default true. |
| `href` | `string` | - | renders avatar as a link (<a>/custom). Needs alt/name for an accessible name; warns in development without one. Button-style element swap. |
| `as` | `ElementType` | - | custom link component for href (e.g. Next Link). Only with href. |
| `target` | `string` | - | link target. Only with href. |
| `rel` | `string` | - | link rel. Only with href. |
| `onClick` | `(e: MouseEvent) => void` | - | click handler → renders <button> when no href. Needs alt/name; warns in development without one. |

## Components

### AvatarStatusDot

size-aware status indicator rendered in the Avatar corner

See `design_system component AvatarStatusDot` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-avatar` | `data-size`, `data-shape` | size, shape | - |
| `cui-avatar-fallback` | `data-size` | size | - |
| `cui-avatar-status-dot` | `data-variant` | variant | - |
| `cui-avatar-status-dot-glyph` | `data-shape` | shape | - |

Override in defineTheme:
```ts
components: {
  'avatar': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'avatar-fallback': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  avatar: {
    base: {
      borderRadius: '...',
    },
  },
}
```
