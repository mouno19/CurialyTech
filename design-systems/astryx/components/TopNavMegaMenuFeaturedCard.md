package: @astryxdesign/core

# TopNavMegaMenuFeaturedCard

Standard featured card for mega menu featured slot. Optional image, title, description, CTA link.

**Import:** `import {TopNavMegaMenuFeaturedCard} from '@astryxdesign/core/TopNav';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | - | Card title. **(required)** |
| `description` | `string` | - | Description below title. |
| `image` | `string` | - | Image URL above body. |
| `imageAlt` | `string` | - | Image alt text. Omitted → explicitly decorative (hidden from screen readers); usually correct since card has visible title. |
| `linkLabel` | `string` | - | CTA link text. |
| `linkHref` | `string` | - | CTA link URL. |
| `children` | `ReactNode` | - | Custom content below standard body. |
