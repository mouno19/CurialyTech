package: @curialy/ui

# TabList

TabList provides tab-style navigation for organizing content into categorized sections. Use it to let users switch between related views without leaving the page. A strip narrower than its tabs scrolls horizontally and keeps the selected tab in view.

**Import:** `import {TabList} from '@curialy/ui/TabList';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Left Content | No | Most important area; hugs content width. |
| Center-Fill Content | No | Stretches to fill available space. |
| Right Content | No | Hugs content width. |

## Best Practices

- **Do:** Keep tab labels short and descriptive so users can quickly scan available sections.
- **Do:** Leave overflow handling on: a strip narrower than its tabs scrolls, and the selected tab is kept in view. Use TabMenu when you want a curated group of extra options rather than a scrolling strip.
- **Do:** When using hasDivider with action buttons alongside tabs, match the Button size to the TabList size (both md, both sm); the divided tab strip reserves space so tabs and same-size buttons align to a shared baseline above the rail.
- **Do:** Reach for role="tablist" when the strip switches panels in place, and give each tab a panelId pointing at the panel it opens: that link is how a screen reader gets from a tab to its content. Leave it off for navigation between views.
- **Do:** Set isFullBleed to stretch a tab bar inside a padded LayoutHeader, Card, or Section to the container's inline content edges, instead of reaching for negative-margin CSS.
- **Don't:** Use tabs for sequential steps or workflows; use a stepper or wizard pattern instead.
- **Don't:** Place more than 6–8 visible tabs before the overflow menu; prioritize the most important categories.
- **Don't:** Confuse TabList with SegmentedControl or ToggleButton. TabList is for navigation between views. SegmentedControl and ToggleButton are input controls: SegmentedControl always has exactly one selected option, while ToggleButton can be toggled on or off.

## Accessibility

- **Tab label:** Each label must have at least 4.5:1 contrast with the tab surface behind it. For Hover and Pointer down, measure the final background after the overlay layer is applied.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | The currently selected tab value. **(required)** |
| `onChange` | `(value: string) => void` | - | Callback fired when a tab is selected. **(required)** |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size variant applied to all child tabs. |
| `layout` | `'hug' \| 'fill'` | `'hug'` | Layout mode for tab sizing. 'hug': each tab hugs its content width. 'fill': tabs stretch equally to fill the container width. |
| `hasDivider` | `boolean` | `false` | Whether to show a bottom border divider under the tab list. |
| `isFullBleed` | `boolean` | `false` | Makes the tab strip escape its parent's container padding, extending to the container's content edges (cancels the nearest padded Layout container's --container-padding-* custom properties with negative margins). The inner strip pads back by the portion of the container inset that is not already supplied by the first or last tab stop, keeping edge labels aligned while a hasDivider underline spans the full content width. Matches Divider's isFullBleed: inline (start/end) edges only; block-edge docking stays with the surrounding layout. |
| `role` | `AriaRole` | - | ARIA role for the strip. 'tablist' asks for the WAI-ARIA tabs pattern: role="tablist" / role="tab" and aria-selected, with each tab pointing at the panel it controls via its panelId; only tabs may live in a tablist strip, and an href on a tab is ignored there. Left unset, the strip is a nav landmark marking the current tab with aria-current. Any other value is passed through to the element unchanged. |
| `overflow` | `'auto' \| 'scroll' \| 'visible'` | `'auto'` | What happens when the tabs are wider than the strip. 'auto' lets the component choose, which today always scrolls. 'scroll' scrolls the tabs horizontally, with edge fades and arrow affordances for pointers that can hover. 'visible' turns overflow handling off and lets the tabs spill out of the strip. The selected tab is always scrolled back into view. |
| `children` | `ReactNode` | - | Tab and TabMenu items to render inside the strip. **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Components

### Tab

See `design_system component Tab` for props and usage.

### TabMenu

See `design_system component TabMenu` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-tab-list` | `data-size` | size | - |
| `cui-tab-strip` | - | - | - |
| `cui-tab-scroll-button` | - | - | - |
| `cui-tab` | `data-selected` | - | selected |
| `cui-tab-indicator` | `data-selected` | - | selected |
| `cui-tab-menu` | - | - | - |
| `cui-tab-menu-dropdown` | - | - | - |
| `cui-tab-menu-item` | - | - | - |

Override in defineTheme:
```ts
components: {
  'tab-list': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'tab-strip': {
    base: { /* CSS properties */ },
  },
}
```
