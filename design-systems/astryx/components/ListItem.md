package: @astryxdesign/core

# ListItem

List item w/ label, description, start/end content slots, interactive patterns.

**Import:** `import {ListItem} from '@astryxdesign/core/List';`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | - | Primary content. String auto-truncates; ReactNode renders as given. **(required)** |
| `description` | `ReactNode` | - | Secondary text below label. |
| `startContent` | `ReactNode` | - | Content before label area (e.g. icon, avatar). |
| `endContent` | `ReactNode` | - | Content after label area (e.g. badge, chevron). |
| `onClick` | `(e: MouseEvent) => void` | - | Click handler; enables invisible button pattern. |
| `interactiveRef` | `RefObject<HTMLElement \| null>` | - | Ref to a nested control that owns the item's keyboard access/action; row delegates surface clicks to it (useClickableContainer), no invisible button/anchor, no second tab stop (WCAG 4.1.2). Mutually exclusive with onClick/href. |
| `href` | `string` | - | Link URL; enables invisible anchor pattern. Follows the shared navigation rule (see Link href). |
| `target` | `string` | - | Link target attribute, only when href provided. target="_blank" auto-adds noopener noreferrer. |
| `rel` | `string` | - | Link relationship tokens. noopener noreferrer are merged for target="_blank". |
| `align` | `'center' \| 'start' \| 'first-line'` | `'center'` | Start/end content alignment, passed to Item: 'center' (default), 'start', or 'first-line' (centered on the label's first line). |
| `isDisabled` | `boolean` | `false` | Disabled state; interactive rows stay keyboard-reachable and cannot activate. |
| `isSelected` | `boolean` | `false` | Selected state; sets aria-current="true". |
| `itemKey` | `string \| number` | - | The row's identity for List animatedLayout and the key a reorderable List's onReorder reports; a row without one changes at once and has no reorder handle. |
| `swipeActions` | `{leading?: ItemSwipeAction[]; trailing?: ItemSwipeAction[]}` | - | Swipe actions for touch, passed through to Item unchanged: the verbs a sideways drag uncovers on each side, each `{id?, label, icon?, onActivate, isDisabled?, variant?: 'neutral' \| 'accent' \| 'destructive', hasRemoval?}`. See Item.swipeActions; List clips its rows in the inline axis for them. |
| `swipeBehavior` | `'reveal' \| 'commit'` | `'reveal'` | What a swipe does, passed through to Item unchanged. See Item.swipeBehavior. |
