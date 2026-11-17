package: @curialy/ui

# Scaffold

Pick the shell, budget each region, and choose navigation, before any content exists.

## Scaffold

Pick the shell, budget each region, and choose navigation, before any content exists. Shell and Navigation cover each step; these rules hold for both.

+ Decide the frame, region width budgets, and fill or capped before any content exists
+ State the reason for the navigation choice, or inherit the template pairing
+ Reserve raw px for structural widths; interior spacing uses tokens

x Build content-first and wrap each section in a Card, producing a padded scroll column
x Stretch prose, forms, or lists across a wide region instead of capping with contentWidth
x SideNav when the nav is really filters or controls, or must hold wide elements like breadcrumbs
x TopNav when top-slot ownership is unclear, or the hierarchy is deep or still growing
x Both bars when the ecosystem layer is thin, so the second only wastes space
x Deviate from the template navigation pairing without a stated reason

## Shell

Pick the shell and budget its regions before any content exists. Structural widths are the one place raw px belongs; everything inside them uses the spacing scale.

1. Pick the frame: AppShell for nav apps, Layout with LayoutPanel in a start or end slot for multi-pane tools, or a plain content column for documents and forms
2. Give every fixed region a width budget, so no region has to negotiate for space at render time
3. Read the content to set fill or capped: tables, charts, and boards fill their region; prose, forms, and lists cap with Layout contentWidth so lines never over-stretch
4. Set each region container policy, rows or card grid, before writing content

A three-region tool frame:
```tsx
// Recommended budgets: SideNav 240–280, icon rail 64–72,
// side panel 340–420, filter rail 220–260.
<AppShell sideNav={<SideNav>{/* nav items */}</SideNav>}>
  <Layout
    content={<LayoutContent>{/* table fills its region */}</LayoutContent>}
    end={<LayoutPanel width={380} hasDivider>{/* detail */}</LayoutPanel>}
  />
</AppShell>

// Capped instead: 640 suits text and forms, 960 mixed content.
// Dividers stay full-bleed.
<Layout
  contentWidth={640}
  content={<LayoutContent>{/* settings form */}</LayoutContent>}
/>
```

Verify: every region has a width budget, a fill-or-capped decision, and a container policy written down before any content exists.

## Navigation

When the frame leaves navigation open, default to SideNav: it absorbs destinations you have not planned yet. App type and destination count are guiding indicators, not determining rules.

- SideNav, the default: grouping needed, customizable nav, items with secondary actions, or nav that collapses. Trackers, consoles, and settings usually start here
- TopNav: a shallow nav you expect to stay shallow, context that must stay visible, or a control- and filter-heavy page; add a TabList for a second level. Media libraries often sit here, over grid content
- Both: a genuine suite, where TopNav carries ecosystem-wide concerns (context switcher, global search) and SideNav carries product nav
- Neither: messaging and feeds use a column frame of rail, nav, stream, and panel

Navigation passed to AppShell:
```tsx
// Default: product nav on the side.
<AppShell sideNav={<SideNav>{/* items */}</SideNav>} />

// Shallow, stable nav on a control-heavy page.
<AppShell topNav={<TopNav>{/* items */}</TopNav>} />

// Suite: ecosystem concerns on top, product nav on the side.
<AppShell topNav={<TopNav />} sideNav={<SideNav />} />
```

Verify: you can state the reason in one sentence, and the choice still holds if the nav doubles in size. `design_system build "<idea>"` names the template to start from; scaffold it and the pairing is already wired up.

Up: design_system docs layout
Next: design_system docs layout/structure
