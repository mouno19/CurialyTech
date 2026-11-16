package: @astryxdesign/cli

# Layout spacing

Hold one content line per region, then tune gaps and density.

## Spacing

Hold one content line per region, then tune gaps and density. Alignment, Rhythm, and Density and size each build on these rules.

+ Let the container own padding; children zero their own margins
+ Hold one content line per region: text on the line, hover backgrounds bleed to the edge
+ Hold one padding token across a region header, body, and footer
+ Contrast tight and generous gaps so grouping reads without borders
+ One control size per row; match density to use frequency

x Double padding: a component indented past its Section heading (keep one inset owner)
x Raw px for interior spacing; tokens only, px is for structural widths
x One repeated gap everywhere, which flattens grouping
x Mixed control sizes in a single row

## Alignment

The container owns padding and child gaps; children zero their margins, and interior spacing is always a token. Pick one content line per region and hold it constant, not the padding: `container_inset = content_line - component_intrinsic_inset`.

- Text and Heading carry no inset, so the container takes the full padding
- List, Tab, Menu, and nav items carry a small inset, so the container gives up its padding and the component owns the line
- Table cells carry a larger inset, so the container gives up its padding and the cell owns the line

One content line, two inset owners:
```tsx
// Target content line = 16px.
// Heading has 0 inset, so the Section takes the full padding.
<Section padding={4}><Heading level={3}>Members</Heading></Section>

// List has ~8px built in, Table cells 12–16px, so the Section
// gives up its padding and the component owns the inset.
<Section padding={0}><List>{/* items */}</List></Section>
```

Verify: draw one vertical line down the left of the region. Every label touches it; only hover and selected backgrounds cross it.

## Rhythm

Grouping comes from contrast between tight and generous gaps, not one repeated value. If every gap is the same step, proximity does no work.

- Tight gaps bind: the smallest steps, used inside an item or field
- Generous gaps separate: several steps up, used between sections
- Reach for the in-between steps to tune cadence, rather than rounding everything to the same two values

Tight inside, generous between:
```tsx
// Tight binds at gap={1}–{2}, generous separates at gap={4}–{6}.
// In-between steps tune cadence: gap={3} = 12px, gap={5} = 20px.
<VStack gap={6}>
  <VStack gap={1}>
    <Text weight="semibold">Retention</Text>
    <Text color="secondary">Logs are kept for 30 days</Text>
  </VStack>
  <VStack gap={1}>{/* next label and value */}</VStack>
</VStack>
```

Verify: with every border removed, you can still name the groups from spacing alone. If you cannot, the intervals are too uniform. Form fields are the exception: FormLayout owns their spacing.

## Density and size

Match density to how often a region is used, and give every control in a row the same size so heights share a baseline.

- Compact: high-volume regions scanned fast, like logs, monitors, and large datasets
- Balanced: most Table and List surfaces
- Spacious: low-frequency or high-stakes rows, like settings or a short selection list

Density paired with control size:
```tsx
// Pair density with one control size: compact with sm,
// balanced with sm or md, spacious with md or lg.
<Table data={rows} columns={columns} density="compact" hasHover />
<Button label="Retry" size="sm" variant="ghost" />
```

Verify: every interactive element in a row shares one size, and that size is paired with the density of the region it sits in.

Up: astryx docs layout
Previous: astryx docs layout/side-panels
Next: astryx docs layout/responsive
