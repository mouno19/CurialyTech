package: @astryxdesign/core

# Carousel

Carousel scrolls items horizontally when they overflow. Use for card grids, galleries, product lists.

**Import:** `import {Carousel} from '@astryxdesign/core/Carousel';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Scroll container | Yes | The horizontal overflow area that holds all items. |
| Items | Yes | The children rendered in a row inside the scroll container. With hasSnap, each item snaps to the start edge. |
| Fade edges | No | Gradient fades on the left and right edges that indicate more content is available. Enabled by default, disable with hasEdgeFade={false}. |
| Navigation buttons | No | Prev/next buttons that appear when the content can scroll in that direction. Enabled by default, disable with hasButtons={false}. |

## Best Practices

- **Do:** Enable scroll-snap when each item should land precisely at the start edge: gallery, product list.
- **Do:** Reach for hasLoop on small cyclable sets (photo gallery) where wrapping past the last item back to the first feels natural.
- **Do:** Always provide an aria-label describing what the carousel contains: "Featured products", "Team members".
- **Do:** Use consistent gap + item width so the carousel looks intentional, not like content overflowing by accident.
- **Do:** Trust built-in navigation: trackpad users swipe horizontally, mouse users hold Shift + wheel to move through items.
- **Don't:** Use a carousel for content every user must see. Not everyone scrolls horizontally, so put critical content above the fold.
- **Don't:** Auto-advance items. Let the user scroll at their own pace.
- **Don't:** Nest carousels. A carousel inside a carousel is confusing and breaks keyboard navigation.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | carousel items in horizontal scroll **(required)** |
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4` | `1` | item spacing via spacing token scale |
| `hasButtons` | `boolean` | `true` | prev/next buttons when content is scrollable |
| `hasEdgeFade` | `boolean` | `true` | gradient edge-fade mask on overflow |
| `hasLoop` | `boolean` | `false` | wrap-around: next at end -> start, prev at start -> end; buttons stay visible; only when overflowing |
| `hasSnap` | `boolean \| SnapPaging` | `false` | scroll-snap; children snap to start edge. hasSnap={useSnapPaging()}: iOS paging under a finger or trackpad swipe, one view per flick ({pages: 'item'}: one item); only that value loads the pager |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | inline padding; scroll-padding keeps snap points on content edge |
| `aria-label` | `string` | `'Carousel'` | accessible label for carousel region |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the root element. |
| `handleRef` | `React.Ref<CarouselHandle>` | - | imperative handle: scrollNext/scrollPrev/scrollTo(index)/canScrollNext/canScrollPrev |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value. |
| `className` | `string` | - | CSS class name for the root element. Prefer xstyle for styling. |
| `style` | `CSSProperties` | - | Inline styles for the root element. Prefer xstyle. |
| `data-testid` | `string` | - | test selector for automated testing frameworks |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-carousel` | - | - | - |
| `astryx-carousel-scroller` | `data-gap`, `data-padding`, `data-snap`, `data-edge-fade` | gap, padding, snap, edgeFade | - |

Override in defineTheme:
```ts
components: {
  'carousel': {
    base: { /* CSS properties */ },
  },
  'carousel-scroller': {
    base: { /* CSS properties */ },
  },
}
```
