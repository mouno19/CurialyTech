Layout
Build an app layout outside-in: scaffold the regions, structure the content, tune the spacing, then adapt across widths.

package: @curialy/ui

Build a layout outside-in. Settle the shell and its region budgets before any content exists, then work inward.
Content-first layouts drift into a padded column of cards, because every section ends up inventing its own container.

1. Scaffold: pick the shell, budget each region, and choose navigation
2. Structure: rank each region's content and choose its container
3. Spacing: align each region to one content line, then set gaps and density
4. Breakpoints: decide what each region does as width changes

This guide decides layout, not component APIs. Run `design_system build "<idea>"` to start from the closest template for
your app type, and `design_system component <Name>` for a component's props.

Guides

scaffold             Pick the shell, budget each region, and choose navigation, before any content exists.
structure            Rank the content in each region, then pick the weakest container that groups it.
headers-and-footers  Pin a header or footer while the body scrolls, so the title and commit actions stay reachable.
side-panels          Add a master-detail side panel that opens on row select instead of navigating away.
layout-spacing       Hold one content line per region, then tune gaps and density.
responsive           Decide what each region does as width changes: divide, reveal, resize, or swap.

Open one: design_system docs layout/<name>
Up: design_system docs
