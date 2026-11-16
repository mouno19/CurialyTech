package: @astryxdesign/core

# Timer

Use for active-operation elapsed time when periodic React renders would add avoidable work.

**Import:** `import {Timer} from '@astryxdesign/core/Timer';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Elapsed time | Yes | Semantic time element containing a standardized elapsed duration. |

## Best Practices

- **Do:** Use elapsed for compact durations and clock for stopwatch UI.
- **Do:** Pass startTime for work that began before mount.
- **Don't:** Use Timestamp for dates and relative calendar language.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `startTime` | `number` | - | operation start as Unix milliseconds; omit to count from Timer's mount |
| `format` | `'elapsed' \| 'clock'` | `'elapsed'` | elapsed compact units or clock stopwatch notation |
| `type` | `'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit'` | `'supporting'` | semantic text type; defaults to supporting like Timestamp |
| `size` | `'4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl'` | - | explicit font size override |
| `color` | `'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit'` | `'secondary'` | text color; defaults to secondary like Timestamp |
| `weight` | `'normal' \| 'medium' \| 'semibold' \| 'bold'` | - | font weight override |
| `xstyle` | `StyleXStyles` | - | StyleX styles for the Text wrapper |
| `className` | `string` | - | CSS class for the Text wrapper |
| `style` | `CSSProperties` | - | inline styles for the Text wrapper |

## Examples

### Elapsed duration

```tsx
<Timer />
```

### Stopwatch clock

```tsx
<Timer format="clock" />
```

### Operation that started before mount

```tsx
<Timer startTime={operationStartedAt} />
```

### Match surrounding text

```tsx
<Text>
  Processing for <Timer type="inherit" color="inherit" />
</Text>
```

### Prominent elapsed time

```tsx
<Timer type="body" size="lg" color="primary" weight="semibold" />
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-timer` | - | - | - |

Override in defineTheme:
```ts
components: {
  'timer': {
    base: { /* CSS properties */ },
  },
}
```
