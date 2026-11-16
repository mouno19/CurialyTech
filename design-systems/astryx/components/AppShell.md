package: @astryxdesign/core

# AppShell

AppShell is the page shell for an application. It provides slots for top navigation, side navigation, banners, and main content. Use it as the root wrapper for every page. It handles responsive mobile navigation and skip-to-content automatically. Configure side nav collapse on SideNav with its collapsible prop.

**Import:** `import {AppShell} from '@astryxdesign/core/AppShell';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Page shell | Yes | Outermost application frame that owns page-level navigation, responsive shell behavior, and the main content landmark. |
| Skip link | Yes | First focusable element on the page. Visually hidden until focused, then moves focus to the main content area. |
| Banner | No | The banner slot, for system-wide announcements. Renders above the top nav, inside the banner landmark. |
| Top navigation | No | The topNav slot, typically TopNav. Below the mobile breakpoint it becomes a compact bar carrying the nav toggle. |
| Side navigation | No | The sideNav slot, typically SideNav. Inline above the breakpoint, moved into the mobile drawer below it. |
| Main content | Yes | children, rendered in the main landmark. Scrolls internally when height is fill, and with the page when it is auto. While it scrolls content that overflows, it is a stop in the tab order; Tab entry moves on when its first focusable element is a plain link or button, and otherwise main is one stop before it. |
| Mobile nav drawer | No | Generated below the breakpoint from the nav slots unless mobileNav disables or replaces it. A modal dialog: it traps focus and returns focus to the toggle on close. |

## Best Practices

- **Do:** Choose the right height: use "fill" for dashboards with internal scrolling and "auto" for pages that grow with content.
- **Do:** Set `contentPadding` based on content type: 4 for forms and settings, 0 for tables and dashboards.
- **Do:** Give every nav slot an accessible name: TopNav and SideNav are separate navigation landmarks. Pass `label` to TopNav; SideNav has a translated default name, and `aria-label` renames it.
- **Do:** Phones: add `viewport-fit=cover` to the viewport meta; the header then reaches under the status bar while its items and the content end stay in the safe area. Landscape: only the header is inset (not an inline SideNav or the content sides). No header region or phone top bar: no top inset, so keep top padding. Installed web apps: `apple-mobile-web-app-status-bar-style` `black-translucent`.
- **Do:** Start the page heading inside `children`: AppShell owns the skip link, banner, and main landmarks but renders no heading, so the first content heading is the page h1.
- **Don't:** Nest one AppShell inside another; it's the outermost layout frame.
- **Don't:** Use for sub-page layouts; use Layout for content areas within AppShell.
- **Don't:** Add your own skip link or <main>; AppShell renders both, and a second main landmark makes the first ambiguous.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | main content area, rendered inside <main> |
| `contentPadding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `0` | main content area padding. 4 (16px) for forms/settings/text, 0 for dashboards/maps/tables. Override per-section via Section. |
| `topNav` | `ReactNode` | - | top nav slot, typically TopNav |
| `sideNav` | `ReactNode` | - | side nav slot, typically SideNav |
| `mobileNav` | `ReactNode` | - | mobile nav config: false \| ReactNode \| config with theme-resolved sm\|md\|lg\|xl\|2xl\|none breakpoint (exclusive upper edge); none is always non-mobile and ignores defaultIsMobile |
| `banner` | `ReactNode` | - | slot for system-wide announcements above topNav |
| `height` | `'fill' \| 'auto'` | `'fill'` | fill=viewport 100dvh w/ independent scroll; auto=content-driven w/ sticky nav |
| `variant` | `'wash' \| 'surface' \| 'section' \| 'elevated'` | `'elevated'` | nav bg style: wash=wash bg, surface=surface bg, section=dividers, elevated=wash nav w/ elevated surface content+radius |
| `xstyle` | `StyleXStyles` | - | StyleX layout customization via stylex.create() |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-app-shell` | `data-variant` | wash, surface, section, elevated | - |
| `astryx-app-shell-header` | `data-variant` | wash, surface, section, elevated | - |
| `astryx-app-shell-sidenav` | `data-variant` | wash, surface, section, elevated | - |

Override in defineTheme:
```ts
components: {
  'app-shell': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
  'app-shell-header': {
    base: { /* CSS properties */ },
  },
}
```
