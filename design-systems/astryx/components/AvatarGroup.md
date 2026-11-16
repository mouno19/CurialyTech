package: @astryxdesign/core

# AvatarGroup

Stacked avatar display with overlapping layout. Compositional API: Avatar children with per-avatar props (status dots, clicks). Optional AvatarGroupOverflow slot for custom overflow.

**Import:** `import {AvatarGroup} from '@astryxdesign/core/AvatarGroup';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Avatar children | Yes | Avatar elements that form the overlapping row. Each can have its own props. |
| Overflow indicator | No | A "+N" circle at the end showing hidden count, or a custom AvatarGroupOverflow slot. |

## Best Practices

- **Do:** Slice the list yourself; pass only visible avatars (3-5 typical). No auto-slicing.
- **Do:** Use AvatarGroupOverflow for custom overflow (popover, add button).
- **Do:** Pass status dots / click handlers directly on each Avatar.
- **Do:** Avatars may be wrapped in HoverCard/Tooltip; overlap kept. Set tooltip={false} on the wrapped Avatar.
- **Do:** Interactive avatars (href/onClick) share one Tab stop; arrows rove between them + the overflow button (APG roving tabindex).
- **Don't:** Don't nest AvatarGroups.
- **Don't:** Don't set size on children; the group's size always wins, default included.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Avatar children, optionally followed by one AvatarGroupOverflow. Consumers handle slicing to the desired visible count. **(required)** |
| `size` | `'xsm' \| 'sm' \| 'md' \| 'lg' \| 'xl' \| 16 \| 20 \| 24 \| 32 \| 36 \| 40 \| 48 \| 60 \| 64 \| 72 \| 96 \| 128 \| 144 \| 180` | `'md'` | Size applied to all avatars: named sizes are 'xsm' (20px), 'sm' (24px), 'md' (36px), 'lg' (48px), and 'xl' (128px); numeric sizes must be one of the pixel values listed in the type. The group's size always overrides each child Avatar's size, including when the group uses its default size. |
| `shape` | `'circle' \| 'rounded' \| 'square'` | `'circle'` | Shape applied to all avatars via context, overriding each avatar's own shape prop. Also applied to AvatarGroupOverflow's "+N" indicator. |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the root element. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. |
| `data-testid` | `string` | - | Test selector for automated testing frameworks. |

## Components

### AvatarGroupOverflow

See `astryx component AvatarGroupOverflow` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-avatar-group` | `data-size`, `data-shape` | size, shape | - |
| `astryx-avatar-group-overflow` | `data-size`, `data-shape` | size, shape | - |

Override in defineTheme:
```ts
components: {
  'avatar-group': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'avatar-group-overflow': {
    base: { /* CSS properties */ },
  },
}
```
