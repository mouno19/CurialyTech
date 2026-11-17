package: @curialy/ui

# List

A vertical collection of items with consistent spacing, dividers, and optional markers. Supports headers, icons, avatars, badges, and interactive items with click or link behavior. Use it to display ordered or unordered groups of related content.

**Import:** `import {List} from '@curialy/ui/List';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Header | No | Optional content above the rows, from the header prop. It labels the list, and screen readers announce it as the list name. |
| List items | Yes | Individual entries, which may include icons or images. |
| Item description | No | Additional detail for an individual list item. |
| Reorder handle | No | With reorderable: the button at the end of each row that can move. It drags the row, and toggles its reorder mode. |
| Reorder hint | No | While a row is in reorder mode: the hint below its handle, like Core's keyboard hint, whose moves and Done are buttons. |

## Best Practices

- **Do:** Provide a header to label the list and give context to screen readers.
- **Do:** Use start and end content slots to add icons, avatars, or badges to each item.
- **Do:** Set edge to line row text up with a heading above the list: flush for static rows, outset or bleed for rows in a Card, Section, or Dialog.
- **Do:** To line text up with a heading and keep room around the highlight where there is no Card, such as a sidebar, put the heading and the list in a Section with variant="transparent" and set edge="outset".
- **Don't:** Place interactive elements inside an interactive list item; it creates nested click targets and confusing focus behavior.
- **Don't:** Use a list for a single item or for laying out unrelated content; lists imply a meaningful collection.
- **Don't:** Mix clickable and non-clickable items in the same list without clear visual distinction.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | List items (ListItem components). |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | Spacing density for items. Under a finger, an interactive row's hit target reaches 44px where its neighbors leave room, with no change to how rows look or lay out. |
| `hasDividers` | `boolean` | `false` | Show dividers between items. |
| `animatedLayout` | `AnimatedLayout` | - | The handle from useAnimatedLayout({containerRef}). With it, when rows are inserted, removed or reordered, an inserted row enters, a removed row collapses in place, a row that crosses rows moving the other way rides above them with the surface color behind it, and the rows after a change and the content after the list, up to that container, glide to their new places, all on one shared motion, under every pointer. Under Reduce Motion nothing travels. A row is identified by its itemKey: a row without one changes at once. Without a handle the list changes at once. |
| `reorderable` | `Reorderable` | - | Makes the rows reorderable, with the object createReorderable({onReorder, isReorderable}) makes: each ListItem with an itemKey gets a reorder handle at its end, and each committed move calls onReorder once with the row's key and its index after the move ({key, to}); render the rows in the new order to apply it. A row the object's isReorderable rejects has no handle and keeps its place; one at either end of the list also bounds the others. The object may be made on every render. On a touch screen, a finger held still on a handle for a moment picks up its row (a flick on it still scrolls): the row stays in its place, dimmed, while a copy of it follows the finger and an accent line marks where it would land; the other rows stay still, the page scrolls near the edges, and on release the rows rearrange, gliding to their new places. A mouse drags a handle at once with the same copy and line, and the rows take their places without motion; a drag reports once, at the drop, and a cancelled drag puts everything back at once. In reorder mode the line marks the row's new place after each move. Without a drag, the handle is a toggle: a click, Space or Enter turns on reorder mode for its row (aria-pressed), in which each Up or Down arrow moves the row a place at once and reports it, and Escape or another activation ends the mode, keeping the moves. Each move is announced once it renders, with the row's place and its neighbours ('Milk, position 3 of 5, after Eggs, before Bread'), and a move into a row that keeps its place is refused and announced. While the mode is on, a hint anchored to the handle shows the moves and Done as buttons that do what the keys do, so a row can also be reordered by taps alone. The object's start(key) enters the same mode from your own UI, such as a row's context menu. A disabled row's handle stays focusable but moves nothing. |
| `edge` | `'padded' \| 'flush' \| 'outset' \| 'bleed'` | `'padded'` | Where each row's text, dividers, and hover and selection backgrounds sit, relative to the list's edges and the container around it. 'padded' keeps text inside each row's padding, so it starts a little in from a heading above the list and backgrounds have room around it. 'flush' drops the rows' side padding: text starts on the heading's line, and dividers and backgrounds stop at the row's content, with no room beyond it on either side. It works anywhere and suits static rows. 'outset' puts text on the heading's line and reaches dividers and backgrounds a little past it into the container's padding; it suits interactive rows in a container. 'bleed' puts text on the heading's line and reaches dividers and backgrounds to the container's edges, like Table rows in a Card. Rows are square, except that when the list is the first or last child of a rounded Card or Dialog that holds no other Table or bleeding List deeper inside, its first row (when it has no header) or last row takes the container's corner, less the container padding above or below it. A row's first content is what lines up with the heading: its marker, icon, or avatar when it has one, otherwise its label. 'outset' and 'bleed' reach into the padding of the nearest container that shares its padding: a Card, Section, Dialog, or BottomSheet, or a transparent container such as a Layout region with explicit padding or a padded ScrollableArea. Place the List directly in that container's padding: padding that Stack, Center, or your own styles add in between is not counted. Drawers and the automatic padding of LayoutContent and LayoutPanel aren't supported yet. With no such container, including in a Popover, they look like 'padded'. In a container with less padding than the rows' own, text starts a little after the heading's line. A theme's inline padding on `item` replaces the row padding of every value, including the zero padding of flush. |
| `edgeCompensation` | `'inline'` | - | Deprecated: use edge="outset", which this sets. Still works; edge wins when both are set. `design_system upgrade` rewrites existing usage. |
| `header` | `ReactNode` | - | Header content, associated with the list via aria-labelledby. |
| `listStyle` | `'none' \| 'disc' \| 'decimal' \| 'circle'` | `'none'` | List marker style. 'decimal' renders an <ol> element instead of <ul>. |
| `start` | `number` | `1` | Starting number for ordered lists (listStyle='decimal'). Sets the CSS counter to begin at this value. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization (margins, positioning, sizing). Must be a stylex.create() value: not an inline style object like style={{}}. |

## Components

### ListItem

See `design_system component ListItem` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-list` | `data-density`, `data-list-style` | density, listStyle | - |
| `cui-list-item` | - | - | - |

Override in defineTheme:
```ts
components: {
  'list': {
    base: { /* CSS properties */ },
    'density:value': { /* variant-specific */ },
  },
  'list-item': {
    base: { /* CSS properties */ },
  },
}
```
