package: @astryxdesign/core

# useAppShellMobile

Hook for reading and controlling AppShell mobile navigation state from descendants of AppShell. Use it for custom mobile nav triggers, closing the drawer after route changes, or coordinating AppShell-adjacent mobile experiences with the same breakpoint used by mobile nav.

## Best Practices

- **Do:** Use inside the AppShell tree when building custom mobile navigation controls, route-aware nav items, or UI that should update at the same breakpoint as AppShell mobile nav.
- **Do:** Prefer MobileNavToggle for the standard hamburger trigger: use this hook when you need custom placement, styling, or extra behavior.
- **Do:** Call closeMobileNav after a custom mobile nav item changes route so the drawer dismisses cleanly.
- **Don't:** Use as a general responsive primitive when the UI is not inside AppShell or does not need to align with AppShell mobile nav: use useMediaQuery instead.
- **Don't:** Assume it throws outside AppShell. The hook returns safe defaults and no-op callbacks when no provider is present.

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `isMobile` | `boolean` | Whether the current viewport is below the AppShell mobile navigation breakpoint. Use this to synchronize AppShell-adjacent mobile UI with the same breakpoint as mobile nav. |
| `isMobileNavOpen` | `boolean` | Whether the AppShell-managed mobile navigation drawer is open. |
| `mobileNavId` | `string \| undefined` | DOM id of the mobile navigation drawer, set by AppShell. Point aria-controls of a custom toggle at this so screen-reader users know which element the toggle expands. Undefined outside an AppShell that manages the drawer. |
| `toggleMobileNav` | `() => void` | Toggle the AppShell-managed mobile navigation drawer. No-ops when mobile nav is disabled. |
| `openMobileNav` | `() => void` | Open the AppShell-managed mobile navigation drawer. No-ops when mobile nav is disabled. |
| `closeMobileNav` | `() => void` | Close the AppShell-managed mobile navigation drawer. |
| `isMobileNavEnabled` | `boolean` | Whether AppShell mobile navigation is enabled and managed by AppShell. False when mobileNav is false, there is no nav content, or a fully custom mobileNav ReactNode owns the drawer. |
| `hasAutoToggle` | `boolean` | Whether AppShell auto-toggle behavior is enabled. False when mobileNav hasToggle is set to false; combine with isMobile and isMobileNavEnabled before rendering custom toggles. |


Block templates: astryx component <name> --blocks for AppShell, MobileNav, MobileNavToggle, TopNav, SideNav
