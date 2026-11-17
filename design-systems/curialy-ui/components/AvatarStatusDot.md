package: @curialy/ui

# AvatarStatusDot

size-aware status dot, reads avatar size from context + scales proportionally; variants pair colour with shape (filled/ring/minus) per WCAG 1.4.1

**Import:** `import {AvatarStatusDot} from '@curialy/ui/Avatar';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'success' \| 'neutral' \| 'error'` | `'success'` | colour + shape variant: success filled, neutral ring, error minus |
| `label` | `string` | - | accessible status label; composed into the Avatar accessible name ("Jane Doe, Online"); standalone dots expose role="img" with it directly |
| `icon` | `ReactNode` | - | icon centered in dot (hidden at tiny sizes); replaces the built-in shape glyph, so differ it per status |
