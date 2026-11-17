package: @curialy/ui

# Headers and footers

Pin a header or footer while the body scrolls, so the title and commit actions stay reachable.

## Headers and footers

A region can pin a header or footer while its body scrolls. Both are Layout slots, and padding set once on Layout reaches all three, so header, body, and footer share one content line.

- LayoutHeader in the header slot: the region title and its primary action
- Toolbar instead of LayoutHeader when the header carries interactive controls
- LayoutFooter in the footer slot: actions that commit the work and must stay reachable
- defaultHasDividers on Layout fences both at once, rather than hasDivider per slot

Pinned header and footer around a scrolling body:
```tsx
// padding on Layout reaches every slot, so all three align.
<Layout
  padding={4}
  defaultHasDividers
  header={<LayoutHeader>{/* title + primary action */}</LayoutHeader>}
  content={<LayoutContent>{/* rows */}</LayoutContent>}
  footer={<LayoutFooter>{/* Save and Cancel */}</LayoutFooter>}
/>
```

Verify: scroll the body. The header and footer stay put, their dividers run full-bleed, and all three still share one left content line.

Up: design_system docs layout
Previous: design_system docs layout/structure
Next: design_system docs layout/side-panels
