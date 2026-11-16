package: @astryxdesign/core

# Item

Flexible item primitive unifying the "start content + label + description + end content" pattern. Use for structured rows in menus, lists, contacts, notifications, file browsers.

**Import:** `import {Item} from '@astryxdesign/core/Item';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Marker | No | Optional list bullet/counter rendered before start content. |
| Start content | No | Leading visual: avatar, icon, image, or checkbox. |
| Label | Yes | Primary text identifying the item. |
| Description | No | Secondary supporting text below the label. |
| End content | No | End-aligned content: badges, timestamps, or action buttons. |

## Best Practices

- **Do:** Named slots (startContent, label, description, endContent) for the 80% case.
- **Do:** density="compact" for menus/dense lists, "balanced" for standard rows, "spacious" for roomier layouts.
- **Do:** labelLines/descriptionLines for truncation control.
- **Do:** align="first-line" for a small mark beside a wrapping label; align="start" to top-align a tall slot with the text.
- **Don't:** Don't nest interactive elements inside interactive Item.
- **Don't:** Don't use for view navigation; use nav components.
- **Don't:** Don't add inbox-specific behavior; compose a wrapper.

## Components

### Item

universal item primitive w/ startContent+label+description+endContent layout

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | - | Primary text. String auto-truncates; ReactNode for rich content. **(required)** |
| `marker` | `ReactNode` | - | List bullet/counter before startContent as direct flex child. |
| `startContent` | `ReactNode` | - | Content before label/description: avatar, icon, checkbox, ReactNode. |
| `description` | `ReactNode` | - | Secondary text below label. |
| `endContent` | `ReactNode` | - | Content after label/description: badges, timestamps, actions. |
| `as` | `'div' \| 'li' \| 'span' \| ElementType` | `'div'` | Root HTML element. |
| `align` | `'center' \| 'start' \| 'first-line'` | `'center'` | Start/end slot alignment: 'center' (default), 'start' (tops), or 'first-line' (centered on the label's first line). |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | Spacing: "compact" (4px), "balanced" (8px), or "spacious" (12px). |
| `labelLines` | `number` | - | Max label lines before truncation. |
| `descriptionLines` | `number` | - | Max description lines before truncation. |
| `layout` | `'stacked' \| 'inline'` | `'stacked'` | How the label and description sit together. stacked puts the description on its own line below the label; inline keeps both on one line, description ellipsizing first, so the row fits a fixed-height host. |
| `onClick` | `(event: MouseEvent) => void` | - | Click handler; enables button semantics. |
| `interactiveRef` | `RefObject<HTMLElement \| null>` | - | Ref to a nested control that owns the item's keyboard access/action; row delegates surface clicks to it (useClickableContainer), no invisible button/anchor, no second tab stop (WCAG 4.1.2). Mutually exclusive with onClick/href. |
| `href` | `string` | - | Link URL; enables anchor semantics. Follows the shared navigation rule (see Link href). |
| `target` | `'_blank' \| '_self'` | - | Link target, only with href. target="_blank" auto-adds noopener noreferrer. |
| `rel` | `string` | - | Link relationship tokens. noopener noreferrer are merged for target="_blank". |
| `isHighlighted` | `boolean` | `false` | Highlighted state. |
| `isSelected` | `boolean` | `false` | Selected state. |
| `isDisabled` | `boolean` | `false` | Disabled state. |
| `swipeActions` | `{leading?: ItemSwipeAction[]; trailing?: ItemSwipeAction[]}` | - | Swipe actions for touch: the verbs a sideways drag uncovers on each side, outermost last, each `{id?, label, icon?, onActivate, isDisabled?, variant?: 'neutral' \| 'accent' \| 'destructive', hasRemoval?}`. `leading` is uncovered by a drag toward the inline end, `trailing` toward the inline start. A mouse never starts the drag and a mostly vertical drag stays the scroller's. The gesture is a touch accelerator and never a row's only path to a verb: a verb reachable only by swipe is unreachable by keyboard and by mouse, so every entry must also be reachable through the row's own content. Served on a row whose role permits interactive descendants (a listitem, a row with no role) and not on an option, a menu item, or a row that is the enlarged target of a native radio. The element containing the rows clips in the inline axis with overflow-inline: clip — List does; any other host does it once. `hasRemoval` only says the row holds out after the action fires instead of springing back. The gesture and its panels are loaded on demand the first time a row has swipe actions, so a row without them ships none of it. |
| `swipeBehavior` | `'reveal' \| 'commit'` | `'reveal'` | What a swipe does. `reveal` rests the row open with every entry a real button after a fling or a drag past half the panel. A long drag fires the outermost; on a side with two or more entries, only a drag that starts on the open row fires it. `commit` slides the row out and fires the one entry of a side on a release past the commit point. Nothing rests, and the panel is presentational. On a side with two or more entries, `commit` fires none. A fling never fires an entry. |
| `ref` | `React.Ref<HTMLElement>` | - | Ref forwarded to the root element, whose type follows `as`. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles; must be stylex.create() value. |
| `className` | `string` | - | CSS class name(s) for the root element. |
| `style` | `React.CSSProperties` | - | Inline styles for the root element. |
| `data-testid` | `string` | - | Test selector. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-item` | `data-density`, `data-align`, `data-highlighted`, `data-selected`, `data-disabled` | density, align | highlighted, selected, disabled |
| `astryx-item-swipe-panel` | `data-side` | side | - |
| `astryx-item-swipe-action` | `data-variant` | variant | - |

Override in defineTheme:
```ts
components: {
  'item': {
    base: { /* CSS properties */ },
    'density:value': { /* variant-specific */ },
    'highlighted': { /* state-specific */ },
  },
  'item-swipe-panel': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  item: {
    base: {
      paddingInline: '...',
    },
  },
}
```
