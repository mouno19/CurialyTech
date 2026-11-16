package: @astryxdesign/core

# Token

Token is a small, inline element for representing discrete pieces of associated data, like tags, categories, or selections. Use for labeling content, showing active filters, or representing removable items.

**Import:** `import {Token} from '@astryxdesign/core/Token';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Icon | No | A leading icon that identifies the token type, like a user avatar or category symbol. |
| Label | Yes | The visible text. Also used as the accessible name when isLabelHidden is true. |
| End content | No | Trailing content after the label, like a count badge or status dot. |
| Remove button | No | An X button that appears when onRemove is provided, letting users dismiss the token. |

## Best Practices

- **Do:** Color-code categories (green for active, red for blocked, blue for review) for fast scanning.
- **Do:** Provide onRemove when tokens represent dismissible user selections like filters or multi-select values.
- **Do:** Add a leading icon when it helps identify the token type: person icon for users, tag icon for labels.
- **Do:** Keep labels to one to three words. Tokens truncate with ellipsis on overflow.
- **Do:** Labels keep their character order under right-to-left, so `@alice`, `C++` and `example.com` read as written; a right-to-left label still reads right to left.
- **Don't:** Don't use tokens for actions or navigation; use Button or Link. Tokens display metadata, not trigger workflows.
- **Don't:** Don't hide the label unless the icon alone is universally clear.
- **Don't:** Don't mix too many colors in one group. Two or three meaningful colors keeps it scannable.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Text label inside token. **(required)** |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Token size; 'sm', 'md', or 'lg'. |
| `color` | `'default' \| 'red' \| 'orange' \| 'yellow' \| 'green' \| 'teal' \| 'cyan' \| 'blue' \| 'purple' \| 'pink' \| 'gray'` | `'default'` | Color variant of token. |
| `icon` | `ReactNode` | - | Optional icon before label. |
| `isDisabled` | `boolean` | `false` | Reduces opacity, blocks interactions. |
| `onRemove` | `(e: React.MouseEvent) => void` | - | Fired on remove button click. Renders X button when provided. |
| `onClick` | `(e: React.MouseEvent) => void` | - | Click handler. Renders <span> w/ invisible <button> inside for a11y. |
| `href` | `string` | - | Link URL. Renders as <a> element. Follows the shared navigation rule (see Link href). |
| `description` | `string` | - | A11y description via aria-description on root. |
| `endContent` | `ReactNode` | - | Content after label, before remove button. |
| `isLabelHidden` | `boolean` | `false` | Visually hides label w/ screen-reader-only clip; stays accessible. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles (margins, positioning). Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-token` | `data-color`, `data-size`, `data-disabled` | color, size | disabled |

Override in defineTheme:
```ts
components: {
  'token': {
    base: { /* CSS properties */ },
    'color:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
}
```
