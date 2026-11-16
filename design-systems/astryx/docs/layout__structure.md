package: @astryxdesign/cli

# Structure

Rank the content in each region, then pick the weakest container that groups it.

## Structure

Rank the content in each region, then pick the weakest container that groups it. Type hierarchy and Card or rows cover each step; these rules hold for all of them.

+ One lead per region; rank with weight and color; one primary action
+ Leave body copy at its defaults; demote by weight and color, not size
+ Default to Section; use the weakest container that reads as a group
+ Render collections as rows (Table or List), edge-to-edge with dividers

x Grey and shrink body copy, so a whole region reads as secondary metadata
x The disabled color for content; it fails contrast and is for disabled controls
x Card soup: each record wrapped in its own Card instead of rendered as rows
x Cards inside Cards, or full-width Cards stacked as page structure
x Flexbox soup: nested ad-hoc flexboxes instead of Grid, Layout, Section, or FormLayout
x Two competing primary actions in one region
x Badge as decoration; use StatusDot or Token for status and metadata

## Type hierarchy

Give every region one lead, then rank the rest with weight and color rather than size. Content uses two text colors, primary and secondary, and nothing dimmer: body copy needs no props at all.

- Body, the default: plain Text with no type, color, or size prop
- Lead: Heading at the level matching page depth, or body Text at a heavier weight
- Support: step to the secondary color, not to a smaller size
- Metadata: the supporting type, or a StatusDot or Token instead of prose

Body copy, then one row of four ranks:
```tsx
// Body copy takes no props. Text already defaults to body
// size in the primary color.
<Text>Credentials rotate every 90 days</Text>

<HStack gap={2}>
  <Text weight="semibold">Payments API</Text>
  <StatusDot variant="success" label="Healthy" />
  <Text color="secondary">v2.14</Text>
  <Text type="supporting">edited 3h ago</Text>
</HStack>
```

Squint test: blurred, you read lead, then support, then groups, in that order. If everything reads at once, raise contrast with weight and color, not borders and not smaller text.

## Card or rows

Reach for the weakest container that reads as a group, and escalate only when it fails. Weakest to strongest:

1. spacing and gap: related items inside one group. The default rhythm
2. Divider: peers in a dense list or toolbar, or fencing a header from a scrollable body
3. Section: the default page-structure unit, related content under a heading. No border
4. Card: a self-contained widget (KPI tile, chart, gallery entry), or a hard boundary around critical content

Section as the default unit:
```tsx
// Records are rows in one Section, not one Card each.
// Recommended row height: 32–40px.
<Section padding={0}>
  <List header={<Heading level={3}>Members</Heading>} hasDividers>
    {/* ListItem per member */}
  </List>
</Section>
```

Decision test: records render as rows, Table for columnar and List for single-line; a self-contained widget or hard boundary is a Card; everything else is a Section.

Up: astryx docs layout
Previous: astryx docs layout/scaffold
Next: astryx docs layout/headers-and-footers
