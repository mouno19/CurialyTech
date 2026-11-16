package: @astryxdesign/core

# ButtonGroup

ButtonGroup joins related actions into a single connected control. Use for related operations on the same object.

**Import:** `import {ButtonGroup} from '@astryxdesign/core/ButtonGroup';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Button | Yes | One or more Button or IconButton children that form the connected group. |
| Divider | No | A thin border between buttons, rendered automatically by the group. |

## Best Practices

- **Do:** Group related actions on the same object: copy/cut/paste, undo/redo.
- **Do:** Same variant for all buttons to look like one unit.
- **Do:** Keep groups small (2–4 buttons). Use Toolbar or DropdownMenu for more.
- **Don't:** Don't mix unrelated actions in one group.
- **Don't:** Don't use for navigation. Use SegmentedControl or TabList.
- **Don't:** Don't nest ButtonGroups.
- **Do:** Label the group for what its buttons act on; it is the accessible name.
- **Do:** Single Tab stop; arrows move between members, Home/End to ends (APG roving tabindex).
- **Do:** Under the touch presentation a press tracks like a menu: slide across, the lifted button runs, a lift outside runs nothing. A mouse press acts as a native button's. Finger targets grow toward 44 px, up to half the gap to a neighbour; a menu trigger keeps its own opening.
- **Don't:** Don't disable the group for an in-flight action; show progress on the active button instead.

## Accessibility

- **Text label:** Text in each button must have at least 4.5:1 contrast with its background in every state. For Hover and Pointer down, measure the final background after the overlay is applied.
- **Essential icon or spinner arc:** An icon used instead of text must have at least 3:1 contrast with the button background. The moving spinner arc must also meet 3:1. An icon beside a visible label does not need its own check.
- **Visible control boundary:** Some groups need a divider or edge to show each button. That divider or edge must have at least 3:1 contrast.
- **Keyboard focus indicator:** The focus outline must have at least 3:1 contrast with the area around it.
- **Disabled appearance:** Disabled controls do not need to meet these contrast ratios.

## Components

### ButtonGroup

connected button group w/ shared borders, outer-only radius

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Button or IconButton children **(required)** |
| `label` | `string` | - | a11y label (aria-label) **(required)** |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | layout direction |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | default btn size; individual btns override |
| `isDisabled` | `boolean` | `false` | all btns disabled |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth for whole group: none\|low\|med\|high |
| `ref` | `React.Ref<HTMLDivElement>` | - | Ref forwarded to the root element. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value |
| `data-testid` | `string` | - | test selector |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-button-group` | `data-size`, `data-orientation`, `data-elevation` | size, orientation, elevation | - |

Override in defineTheme:
```ts
components: {
  'button-group': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
}
```
