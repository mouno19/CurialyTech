package: @curialy/ui

# Stack

Stack arranges items in a row or column with consistent spacing. Use the gap prop to control the space between items.

**Import:** `import {Stack} from '@curialy/ui/Stack';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Stack container | Yes | Layout container that arranges content along one flex axis. |
| Item | No | Optional StackItem wrapper that controls one item in the stack. |
| Content | No | Caller-supplied content rendered by a Stack or StackItem. |

## Best Practices

- **Do:** Use the gap prop for spacing between items; don't add margins manually.
- **Do:** Use StackItem with size="fill" to make one item stretch and fill the leftover space.
- **Don't:** Nest stacks inside stacks; try wrap="wrap" first to let items flow to the next line.

## Components

### Stack

Horizontal stack; inline direction (left to right in LTR, right to left in RTL), polymorphic rendering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'horizontal' \| 'vertical'` | `'vertical'` | Direction of the stack layout. 'horizontal' flows items along the inline axis, left to right in LTR and right to left in RTL (like HStack), 'vertical' flows top-to-bottom (like VStack). Note: the value is 'horizontal', NOT 'row'. |
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Number literal spacing step: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10. Use gap={4} not gap="4". |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inner padding on all sides, using the spacing scale. Pass as a JSX number expression e.g. padding={3}. |
| `paddingInline` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline (horizontal) padding. Overrides padding on the inline axis when both are set. |
| `paddingInlineStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-start padding, using the spacing scale (left in LTR, right in RTL). Overrides paddingInline and padding on that edge only. |
| `paddingInlineEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-end padding, using the spacing scale (right in LTR, left in RTL). Overrides paddingInline and padding on that edge only. |
| `paddingBlock` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block (vertical) padding. Overrides padding on the block axis when both are set. |
| `paddingBlockStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-start (top) padding, using the spacing scale. Overrides paddingBlock and padding on that edge only. |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-end (bottom) padding, using the spacing scale. Overrides paddingBlock and padding on that edge only. |
| `isScrollable` | `boolean` | `false` | Enables scrollable overflow (overflow: auto). |
| `width` | `SizeValue` | - | Width of container. Numbers=pixels, strings=as-is (e.g. '100%'). |
| `height` | `SizeValue` | - | Height of container. Numbers=pixels, strings=as-is (e.g. '100%'). |
| `maxWidth` | `SizeValue` | - | Maximum width of the stack container. |
| `minHeight` | `SizeValue` | - | Minimum height of the stack container. |
| `hAlign` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly' \| 'stretch'` | - | Horizontal (main-axis) alignment. |
| `vAlign` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly' \| 'stretch'` | - | Vertical (cross-axis) alignment. |
| `justify` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly'` | - | Main-axis alignment alias for hAlign. Mirrors CSS justify-content. An explicit hAlign wins. |
| `align` | `'start' \| 'center' \| 'end' \| 'stretch'` | - | Cross-axis alignment alias for vAlign. Mirrors CSS align-items. An explicit vAlign wins. |
| `wrap` | `'nowrap' \| 'wrap' \| 'wrap-reverse'` | `'nowrap'` | Flex wrap behavior. |
| `as` | `ElementType` | `'div'` | HTML element to render as container. |
| `children` | `ReactNode` | - | Stack content. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value. |
| `className` | `string` | - | Class name added to the stack element, after the component styles. |
| `style` | `CSSProperties` | - | Inline styles for the stack element. width, height, maxWidth, and minHeight win over the same properties here. |
| `ref` | `Ref<HTMLElement>` | - | Ref to the rendered stack element. |

### HStack

Horizontal stack; inline direction (left to right in LTR, right to left in RTL), polymorphic rendering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Number literal spacing step: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10. Use gap={4} not gap="4". |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inner padding on all sides, using the spacing scale (0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10). Matches the padding prop on Card, LayoutContent, and LayoutPanel. Pass as a JSX number expression e.g. padding={3}. |
| `paddingInline` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline (horizontal) padding, using the spacing scale. Overrides padding on the inline axis when both are set. |
| `paddingInlineStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-start padding, using the spacing scale (left in LTR, right in RTL). Overrides paddingInline and padding on that edge only. |
| `paddingInlineEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-end padding, using the spacing scale (right in LTR, left in RTL). Overrides paddingInline and padding on that edge only. |
| `paddingBlock` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block (vertical) padding, using the spacing scale. Overrides padding on the block axis when both are set. |
| `paddingBlockStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-start (top) padding, using the spacing scale. Overrides paddingBlock and padding on that edge only. |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-end (bottom) padding, using the spacing scale. Overrides paddingBlock and padding on that edge only. |
| `isScrollable` | `boolean` | `false` | Enables scrollable overflow (overflow: auto). Matches isScrollable on LayoutContent and LayoutPanel. |
| `width` | `SizeValue` | - | Width of container. Numbers=pixels, strings=as-is (e.g. '100%'). |
| `height` | `SizeValue` | - | Height of container. Numbers=pixels, strings=as-is (e.g. '100%'). |
| `maxWidth` | `SizeValue` | - | Maximum width of the stack container. Numbers are treated as pixels, strings are used as-is (e.g., '100%'). |
| `minHeight` | `SizeValue` | - | Minimum height of the stack container. Numbers are treated as pixels, strings are used as-is (e.g., '100%'). |
| `hAlign` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly'` | - | Horizontal (main-axis) alignment. |
| `vAlign` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'stretch'` | Vertical (cross-axis) alignment. |
| `justify` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly'` | - | Main-axis alignment alias for hAlign. Mirrors CSS justify-content. An explicit hAlign wins. |
| `align` | `'start' \| 'center' \| 'end' \| 'stretch'` | - | Cross-axis alignment alias for vAlign. Mirrors CSS align-items. An explicit vAlign wins. |
| `wrap` | `'nowrap' \| 'wrap' \| 'wrap-reverse'` | `'nowrap'` | Flex wrap behavior. |
| `as` | `ElementType` | `'div'` | HTML element to render as container. |
| `children` | `ReactNode` | - | Stack content. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value. |
| `className` | `string` | - | Class name added to the stack element, after the component styles. |
| `style` | `CSSProperties` | - | Inline styles for the stack element. width, height, maxWidth, and minHeight win over the same properties here. |
| `ref` | `Ref<HTMLElement>` | - | Ref to the rendered stack element. |

### VStack

Vertical stack; top-to-bottom, polymorphic rendering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Number literal spacing step: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10. Use gap={4} not gap="4". |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inner padding on all sides, using the spacing scale (0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10). Matches the padding prop on Card, LayoutContent, and LayoutPanel. Pass as a JSX number expression e.g. padding={3}. |
| `paddingInline` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline (horizontal) padding, using the spacing scale. Overrides padding on the inline axis when both are set. |
| `paddingInlineStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-start padding, using the spacing scale (left in LTR, right in RTL). Overrides paddingInline and padding on that edge only. |
| `paddingInlineEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Inline-end padding, using the spacing scale (right in LTR, left in RTL). Overrides paddingInline and padding on that edge only. |
| `paddingBlock` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block (vertical) padding, using the spacing scale. Overrides padding on the block axis when both are set. |
| `paddingBlockStart` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-start (top) padding, using the spacing scale. Overrides paddingBlock and padding on that edge only. |
| `paddingBlockEnd` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Block-end (bottom) padding, using the spacing scale. Overrides paddingBlock and padding on that edge only. |
| `isScrollable` | `boolean` | `false` | Enables scrollable overflow (overflow: auto). Matches isScrollable on LayoutContent and LayoutPanel. |
| `width` | `SizeValue` | - | Width of container. Numbers=pixels, strings=as-is (e.g. '100%'). |
| `height` | `SizeValue` | - | Height of container. Numbers=pixels, strings=as-is (e.g. '100%'). |
| `maxWidth` | `SizeValue` | - | Maximum width of the stack container. Numbers are treated as pixels, strings are used as-is (e.g., '100%'). |
| `minHeight` | `SizeValue` | - | Minimum height of the stack container. Numbers are treated as pixels, strings are used as-is (e.g., '100%'). |
| `hAlign` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'stretch'` | Horizontal (cross-axis) alignment. |
| `vAlign` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly'` | - | Vertical (main-axis) alignment. |
| `justify` | `'start' \| 'center' \| 'end' \| 'between' \| 'around' \| 'evenly'` | - | Main-axis alignment alias for vAlign. Mirrors CSS justify-content. |
| `align` | `'start' \| 'center' \| 'end' \| 'stretch'` | - | Cross-axis alignment alias for hAlign. Mirrors CSS align-items. |
| `wrap` | `'nowrap' \| 'wrap' \| 'wrap-reverse'` | `'nowrap'` | Flex wrap behavior. |
| `as` | `ElementType` | `'div'` | HTML element to render as container. |
| `children` | `ReactNode` | - | Stack content. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |
| `className` | `string` | - | Class name added to the stack element, after the component styles. |
| `style` | `CSSProperties` | - | Inline styles for the stack element. width, height, maxWidth, and minHeight win over the same properties here. |
| `ref` | `Ref<HTMLElement>` | - | Ref to the rendered stack element. |

### StackItem

Controls individual item behavior in stack; polymorphic rendering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'static' \| 'fill'` | `'static'` | Flex grow: static=natural size, fill=expand to remaining space. |
| `isScrollable` | `boolean` | `false` | Enables scrollable overflow (overflow: auto). StackItem already applies the flex min-height/min-width reset, so <StackItem size="fill" isScrollable> is a complete scroll region. Matches isScrollable on LayoutContent and LayoutPanel. While its content overflows, a div or span item is a group named by aria-label, or by a translated "Content"; another element keeps its own role. |
| `crossAlignSelf` | `'start' \| 'center' \| 'end' \| 'stretch'` | - | Override cross-axis alignment for this item, ignoring parent. |
| `as` | `ElementType` | `'div'` | HTML element to render as wrapper. |
| `children` | `ReactNode` | - | Item content. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value, not an inline style object like style={{}}. |
| `className` | `string` | - | Class name added to the item element, after the component styles. |
| `style` | `CSSProperties` | - | Inline styles for the item element. |
| `ref` | `Ref<HTMLElement>` | - | Ref to the rendered item element. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-stack` | `data-direction`, `data-gap`, `data-wrap` | direction, gap, wrap | - |
| `cui-stack-item` | `data-size` | size | - |

Override in defineTheme:
```ts
components: {
  'stack': {
    base: { /* CSS properties */ },
    'direction:value': { /* variant-specific */ },
  },
  'stack-item': {
    base: { /* CSS properties */ },
  },
}
```
