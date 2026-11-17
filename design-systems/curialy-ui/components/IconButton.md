package: @curialy/ui

# IconButton

Button showing only an icon, no visible text. Use in toolbars, table rows, compact UI where space is tight + icon universally understood.

**Import:** `import {IconButton} from '@curialy/ui/IconButton';`

## Best Practices

- **Do:** Make aria-label specific: trash icon labeled "Delete conversation" > just "Delete" for screen readers.
- **Do:** Add tooltip: even gear icon can mean Settings/Preferences/Configure.
- **Do:** Use ghost in toolbars + dense areas to reduce visual clutter.
- **Don't:** Use IconButton if action isn't obvious from icon alone; use Button w/ text instead.
- **Don't:** Skip tooltip: label only reaches screen readers; sighted users need hover hint.

## Accessibility

- **Essential icon or spinner arc:** IconButton has no visible label. Its icon must have at least 3:1 contrast with the button background in Rest, Hover, and Pointer down. The moving spinner arc must also meet 3:1 while loading.
- **Visible control boundary:** The button edge needs 3:1 contrast only when users need it to see the control.
- **Keyboard focus indicator:** The focus outline must have at least 3:1 contrast with the area around the button. Check the red outline on destructive buttons too.
- **Disabled appearance:** Disabled controls do not need to meet these contrast ratios.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | accessible label; used as aria-label, not rendered as visible text **(required)** |
| `icon` | `ReactNode` | - | icon element rendered inside button; unsized Curialy UI Icon defaults to sm for sm/md buttons and md for lg **(required)** |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'destructive'` | `'secondary'` | visual style variant |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | size variant |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth: none\|low\|med\|high; raise for a floating action button (FAB) |
| `isLoading` | `boolean` | `false` | shows loading spinner, blocks re-activation but stays focusable (aria-disabled, not native disabled) |
| `isDisabled` | `boolean` | `false` | disables button; uses aria-disabled instead of native disabled |
| `tooltip` | `string` | - | tooltip on hover + keyboard focus; also describes the button unless it repeats the accessible name |
| `onClick` | `(e: MouseEvent) => void` | - | standard click handler |
| `clickAction` | `(e: MouseEvent) => void \| Promise<void>` | - | async click handler w/ automatic loading state |
| `isInterruptible` | `boolean` | `false` | keeps button clickable while clickAction pending; a re-click interrupts it. Not for fire-once actions (submit/save/pay) |
| `width` | `SizeValue` | - | button width; numbers=pixels, strings=as-is; without it keeps the icon-only aspect (square by default) |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | HTML button type; defaults to "button" |
| `name` | `string` | - | HTML name for form submission |
| `value` | `string \| number \| readonly string[]` | - | HTML value for form submission |
| `form` | `string` | - | associates button with form element by ID |
| `href` | `string` | - | renders as a link; a disabled IconButton stays a <button> |
| `as` | `ComponentType` | - | custom link component used with href |
| `target` | `string` | - | HTML target when rendered as a link |
| `rel` | `string` | - | HTML rel when rendered as a link |
