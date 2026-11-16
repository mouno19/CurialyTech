package: @astryxdesign/cli

# Side panels

Add a master-detail side panel that opens on row select instead of navigating away.

## Side panels

Master-detail: selecting a row opens a fixed-width side panel instead of navigating away.

- LayoutPanel in the start or end slot of Layout, holding a fixed width budget
- hasDivider to fence it from the content region; isScrollable so long detail scrolls on its own
- For user-adjustable width, pair useResizable() with a ResizeHandle on the panel inner edge: after the panel in a start slot, before it in an end slot with isReversed
- The handle then owns the divider, so the panel sets hasDivider={false}
- Render an EmptyState when nothing is selected, so the region never collapses

Fixed panel, then the resizable form:
```tsx
// Recommended panel width: 340–420.
<Layout
  content={<LayoutContent>{/* rows */}</LayoutContent>}
  end={
    <LayoutPanel width={380} hasDivider isScrollable label="Details">
      {/* detail fields, or EmptyState when nothing is selected */}
    </LayoutPanel>
  }
/>

// Resizable: handle first in an end slot, and isReversed so
// dragging left widens the panel.
end={
  <>
    <ResizeHandle isReversed hasDivider resizable={panel.props}
      label="Resize details" />
    <LayoutPanel width={panel.size} hasDivider={false} />
  </>
}
```

Verify: at narrow widths the panel yields width instead of squeezing content (see the Responsive guide), and only one element between the regions draws a border.

Up: astryx docs layout
Previous: astryx docs layout/headers-and-footers
Next: astryx docs layout/layout-spacing
