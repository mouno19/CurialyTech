package: @curialy/ui

# Toolbar

Horizontal bar w/ left, optional center, right. For contextual actions within content (tables, cards, panels), not page-level headers. Size cascades to children.

**Import:** `import {Toolbar} from '@curialy/ui/Toolbar';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Outer chrome | Yes | Section-owned container that supplies the toolbar surface, padding, and selected divider edges. |
| Toolbar | Yes | Named toolbar row that owns toolbar semantics and the start, optional center, and end layout. |

## Best Practices

- **Do:** Secondary actions (Back) left, primary actions (Save) right.
- **Do:** Make temporary toolbars (bulk selection) visually distinct, e.g. background color or border.
- **Do:** Separate toolbar from content: divider, background variant, or both.
- **Do:** Use Toolbar as card header when it has actions (filter, add). Just a title? Use LayoutHeader/Section.
- **Don't:** Overload with actions; use MoreMenu for overflow.
- **Don't:** Set size on child buttons; set once on toolbar, it cascades.
- **Don't:** Use for app-wide nav (menu links, sign out); use TopNav/LayoutHeader.

## Components

### Toolbar

Toolbar container w/ 3 content slots + roving tabindex.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | A11y label, aria-label on toolbar. **(required)** |
| `startContent` | `ReactNode` | - | Start-aligned content. |
| `centerContent` | `ReactNode` | - | Centered content; three lanes, wraps when they do not fit. |
| `endContent` | `ReactNode` | - | End-aligned content. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Toolbar size; controls min-height + cascades to children via SizeContext. |
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `1` | Gap between slot items. |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Keyboard nav direction. |
| `variant` | `SectionVariant` | `'transparent'` | Visual variant for Section. |
| `dividers` | `Array<'top' \| 'bottom' \| 'start' \| 'end'>` | - | Borders/dividers rendered around the toolbar. |
| `xstyle` | `StyleXStyles` | - | StyleX layout styles. Must be stylex.create() value. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-toolbar` | `data-size` | - | size |

Override in defineTheme:
```ts
components: {
  'toolbar': {
    base: { /* CSS properties */ },
    'size': { /* state-specific */ },
  },
}
```
