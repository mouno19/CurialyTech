package: @astryxdesign/core

# MobileNav

A slide-out drawer for mobile navigation. MobileNav is the mobile counterpart to SideNav and accepts the same children. Use it on narrow viewports where a persistent sidebar is not practical.

**Import:** `import {MobileNav} from '@astryxdesign/core/MobileNav';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Navigation overlay | Yes | Full-viewport dialog overlay that hosts the mobile navigation drawer. |
| Drawer | Yes | Painted panel that slides in from the resolved viewport edge. |
| Header | Yes | Fixed row containing optional header content and the close button. |
| Content | Yes | Scrollable region containing the navigation content. |
| Close button | Yes | Button that closes the navigation drawer. |
| Toggle button | No | AppShell-aware Button that opens or closes the drawer on mobile viewports. |

## Best Practices

- **Do:** Share nav items between MobileNav and SideNav by extracting into a variable.
- **Do:** Provide a header when the drawer purpose is not obvious from content.
- **Do:** Inside AppShell, use MobileNavToggle to open the drawer; it reads state from context. Do not pass isOpen/onOpenChange to the toggle.
- **Don't:** Use MobileNav on desktop; use a persistent SideNav instead.

## Components

### MobileNav

Slide-out drawer for mobile navigation. Accepts SideNav children.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the drawer is open. Inside AppShell, this is managed automatically via context. Outside AppShell, provide this prop to control the drawer yourself. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Called when the drawer visibility changes (backdrop click, Escape key, or close button). Inside AppShell, this is managed automatically via context. On a phone or tablet (a coarse primary pointer), the drawer takes no tap or drag while it slides in; keys and assistive technology still act. After a close, focus returns to the element that opened it once its dialog closes. |
| `children` | `ReactNode` | - | Drawer content: typically SideNavSection/SideNavItem, or any ReactNode. **(required)** |
| `header` | `ReactNode` | - | Header content for the drawer. Rendered next to the close button. Pass a string for a simple text heading, or a ReactNode for custom content (logo, search bar, etc.). |
| `width` | `number` | `320` | Drawer width in pixels. Capped at 85vw to prevent overflow on small screens. |
| `side` | `'start' \| 'end' \| 'auto'` | `'auto'` | Which side the drawer slides from. Start is left in LTR, right in RTL. Auto picks a side based on the trigger position. |

### MobileNavToggle

Hamburger button that opens/closes mobile nav drawer. Reads open state from AppShell context automatically. Renders nothing above mobile breakpoint. Host attributes and handlers reach the button; aria-expanded/aria-controls stay owned.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Custom content to render instead of the default hamburger icon. |
| `label` | `string` | `'Open navigation'` | Accessible label for the toggle button. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-mobile-nav` | `data-side` | side | - |

Override in defineTheme:
```ts
components: {
  'mobile-nav': {
    base: { /* CSS properties */ },
    'side:value': { /* variant-specific */ },
  },
}
```
