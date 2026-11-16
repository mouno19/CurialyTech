package: @astryxdesign/cli

# Verification

Post-migration verification checklist and an AI migration prompt to paste into your coding tool.

## Verification Checklist

- Run the app in light and dark mode and check that surfaces, borders, text, icons, hover states, focus rings, and status colors flow together.
- Open the command palette from the shell, type into it, select items by keyboard, and confirm focus returns to the trigger.
- Check the SideNav at collapsed, expanded, active, hover, nested, and mobile states.
- Verify settings popovers and dialogs in jsdom and in a real browser because the native dialog and [`Popover`](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) APIs may need test shims.
- Search for leftover hardcoded Tailwind colors, arbitrary hex values, and one-off hover colors after each route migration.
- Run component tests, build, and at least one browser screenshot pass for each migrated route.

## AI Migration Prompt

When using an AI coding agent, give it an explicit migration loop instead of asking for a full-app rewrite.

Paste this into your AI:
```text
We are migrating this existing Tailwind/shadcn app to Astryx incrementally.

First run:
- astryx docs migration --dense
- astryx docs theme --dense
- astryx docs styling --dense
- astryx template AppShellTopNavWithSideNav --skeleton

Then migrate one route or shell surface at a time. Keep business logic and routing intact. Replace shadcn/Radix/Tailwind primitives with Astryx components, remove hardcoded colors, verify light and dark mode, and take screenshots before moving to the next surface.
```

Up: astryx docs migration
Previous: astryx docs migration/component-migration
