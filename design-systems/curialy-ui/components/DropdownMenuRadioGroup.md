package: @curialy/ui

# DropdownMenuRadioGroup

controlled named menuitemradio group; owns value propagation, close policy, root inputs, and item gap

**Import:** `import {DropdownMenuRadioGroup} from '@curialy/ui/DropdownMenu';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Group | Yes | The role="group" root that owns the accessible name, controlled-selection context, close policy, root inputs, and inter-item gap. |
| Radio items | Yes | DropdownMenuRadioItem children; each child owns its menuitemradio role, checked state, content, and indicator paint. |

## Best Practices

- **Do:** Keep value controlled and update it from onChange so checked state follows caller data.
- **Do:** Provide a concise label even when aria-labelledby points to visible text; label remains required and supplies the aria-label fallback.
- **Do:** Set hasCloseOnSelect=false only when the menu must stay open to show another selection or an in-place result.
- **Don't:** Place buttons, links, checkboxes, or arbitrary menu rows inside the radio group.
- **Don't:** Add a second key handler or roving-focus model; DropdownMenu owns keyboard navigation.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| undefined` | - | selected value (undefined = none) **(required)** |
| `onChange` | `(value: string) => void` | - | fired when selected value changes **(required)** |
| `label` | `string` | - | accessible group name (applied as aria-label); required **(required)** |
| `hasCloseOnSelect` | `boolean` | `true` | close menu on select (default true) |
| `ref` | `React.Ref<HTMLDivElement>` | - | forwarded to the role="group" root |
| `children` | `ReactNode` | - | the DropdownMenuRadioItems **(required)** |
