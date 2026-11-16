package: @astryxdesign/core

# AvatarGroupOverflow

Use at end of AvatarGroup to summarize hidden people after slicing visible avatars.

**Import:** `import {AvatarGroupOverflow} from '@astryxdesign/core/AvatarGroup';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Count label | Yes | The compact `+N` or custom count text displayed inside the circular indicator. |
| Button behavior | No | When `onClick` is provided, the indicator becomes an interactive button with focus and hover states. |

## Best Practices

- **Do:** Pass real hidden count to `count` for a11y.
- **Do:** Keep custom text short: `+12`, `99+`.
- **Do:** Use `onClick` to open member list/popover/details.
- **Don't:** Don't let custom text disagree with `count`; `count` still labels the indicator for accessibility.
- **Don't:** Don't use long labels inside avatar-sized circle.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `count` | `number` | - | hidden avatar count; drives default +N + aria label **(required)** |
| `children` | `ReactNode` | - | optional custom short count text, e.g. +12 or 99+ |
| `onClick` | `() => void` | - | click handler; renders focusable button when set |
| `ref` | `React.Ref<HTMLElement>` | - | forwarded ref |
| `xstyle` | `StyleXStyles` | - | stylex.create() value — not an inline style object |

## Examples

### Default overflow count

```tsx

<AvatarGroup size="lg">
  {users.slice(0, 3).map(user => (
    <Avatar key={user.id} src={user.src} name={user.name} />
  ))}
  <AvatarGroupOverflow count={users.length - 3} />
</AvatarGroup>

```

### Custom count text

```tsx

<AvatarGroup size="lg">
  {users.slice(0, 3).map(user => (
    <Avatar key={user.id} src={user.src} name={user.name} />
  ))}
  <AvatarGroupOverflow count={12}>12+</AvatarGroupOverflow>
</AvatarGroup>

```
