package: @astryxdesign/core

# Layout

Layout is a general five-slot primitive for arranging header, start, content, end, and footer regions within a page or bounded container. AppShell owns the page shell and app-wide navigation behavior; use HStack or VStack for simple directional stacking.

**Import:** `import {Layout} from '@astryxdesign/core/Layout';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Layout container | Yes | General layout primitive that places the header, start, content, end, and footer slots. |
| Header | No | Optional LayoutHeader region supplied by the caller, typically in the header slot. |
| Panel | No | Optional LayoutPanel region supplied by the caller in the start or end slot. |
| Content area | No | Optional LayoutContent region supplied by the caller in the content slot. |
| Footer | No | Optional LayoutFooter region supplied by the caller, typically in the footer slot. |

## Best Practices

- **Do:** Use Layout when content needs named header, start, content, end, or footer regions.
- **Do:** Use HStack and VStack for simple directional stacking within a content area.
- **Do:** Hide a region by passing `false`, `null`, or `undefined` to its slot, for example `isOpen && <LayoutPanel />`. The slot counts as empty, so the neighbouring regions move out to the layout edge.
- **Do:** Give a region a landmark role and label on the region component when it is a page landmark, for example `<LayoutPanel role="navigation" label="Sections">`. Layout adds no role or name.
- **Don't:** Use Layout for simple stacking layouts; use HStack or VStack instead.
- **Don't:** Use Layout as the page shell or for app-wide navigation; use AppShell for that responsibility.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `ReactNode` | - | Content slot (center). Accepts any ReactNode; use LayoutContent when a content region is needed. Children passed to `<Layout>` render here too: `<Layout>{main}</Layout>` is shorthand for `<Layout content={main} />`. |
| `header` | `ReactNode` | - | Header slot. Accepts any ReactNode; use LayoutHeader when a header region is needed. |
| `footer` | `ReactNode` | - | Footer slot. Accepts any ReactNode; use LayoutFooter when a footer region is needed. |
| `start` | `ReactNode` | - | Logical-start slot (left in LTR). Accepts any ReactNode; use LayoutPanel when a panel region is needed. |
| `end` | `ReactNode` | - | Logical-end slot (right in LTR). Accepts any ReactNode; use LayoutPanel when a panel region is needed. |
| `height` | `'fill' \| 'auto'` | `'fill'` | Height behavior: fill the container's height or grow with content. Fill needs a container with a set height, such as AppShell's content area; under an app root with no height, the layout grows with its content. |
| `contentWidth` | `SizeValue` | - | Maximum width of the aligned content within each slot (header, content, footer, panels), centered when narrower than the available space. Without panels, LayoutContent spans the available width so its scrollbar stays at the outer edge while its children align internally to contentWidth. With exactly one panel, the panel stays aligned to the contentWidth frame while LayoutContent extends to the opposite open edge. With both panels, contentWidth includes the complete middle composition. Percentage widths—including percentage-bearing calc(), min(), max(), and clamp() values—and intrinsic widths, plus bare var(...) values, retain the constrained composition; use calc(var(...)) for a variable guaranteed to resolve to a length. Dividers stay full-bleed. Numbers are treated as pixels, strings are used as-is (e.g. `60ch`). Common page widths: 640 for forms, settings, and text-focused pages; 960 for content pages and wider layouts. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Padding at the layout's outer edges using the spacing scale. Applies to this Layout's own header, footer, panels, and content. A nested Layout does not inherit it: without `padding`, its regions use the enclosing Card, Section, or Dialog padding, or the default inset (spacing 4). That keeps a page Layout inside AppShell inset even though AppShell's own regions are full bleed. |
| `children` | `ReactNode` | - | Shorthand for the content slot: `<Layout>{main}</Layout>` is the same as `<Layout content={main} />`. When both are given, `content` wins. |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the root layout element. |
| `defaultHasDividers` | `boolean` | - | Default divider visibility for LayoutHeader and LayoutFooter children. Headers and footers that don't pass `hasDivider` use this value; when unset, nested layouts inherit from their parent context. |

## Components

### LayoutHeader

See `astryx component LayoutHeader` for props and usage.

### LayoutContent

See `astryx component LayoutContent` for props and usage.

### LayoutFooter

See `astryx component LayoutFooter` for props and usage.

### LayoutPanel

See `astryx component LayoutPanel` for props and usage.

### Card

See `astryx component Card` for props and usage.

### Section

See `astryx component Section` for props and usage.

## Examples

### Page with a details panel inside AppShell

```tsx

function OrdersPage() {
  return (
    <AppShell
      sideNav={
        <SideNav>
          <SideNavItem label="Orders" isSelected />
          <SideNavItem label="Customers" />
          <SideNavItem label="Settings" />
        </SideNav>
      }>
      {/* No padding props needed: the page Layout's regions keep their
          default inset inside AppShell's full-bleed content area. */}
      <Layout
        header={
          <LayoutHeader hasDivider>
            <Heading level={1}>Orders</Heading>
          </LayoutHeader>
        }
        end={
          <LayoutPanel
            hasDivider
            width={320}
            role="complementary"
            label="Order details">
            <VStack gap={2}>
              <Heading level={2}>Order #1042</Heading>
              <Text type="body" color="secondary">
                Shipped · 3 items · $184.00
              </Text>
            </VStack>
          </LayoutPanel>
        }
        content={
          <LayoutContent>
            <Text type="body">
              Select an order to see its shipping and payment details.
            </Text>
          </LayoutContent>
        }
      />
    </AppShell>
  );
}

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-layout` | `data-height` | height | - |
| `astryx-layout-content` | - | - | - |
| `astryx-layout-footer` | - | - | - |
| `astryx-layout-header` | - | - | - |
| `astryx-layout-panel` | - | - | - |

Override in defineTheme:
```ts
components: {
  'layout': {
    base: { /* CSS properties */ },
    'height:value': { /* variant-specific */ },
  },
  'layout-content': {
    base: { /* CSS properties */ },
  },
}
```
