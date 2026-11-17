package: @curialy/ui

# ChatComposerDrawer

collapsible drawer above chat input; pass to composer `drawer` slot for attachments, context chips, previews. `count` enables collapse toggle

**Import:** `import {ChatComposerDrawer} from '@curialy/ui/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Root surface | Yes | The drawer surface that composes above the ChatComposer body. |
| Disclosure toggle | No | The keyboard- and pointer-operable collapse control rendered when count is provided. |
| Collapsed summary | No | The default count Badge and label, or caller-provided visual content, presented while the drawer is collapsed. |
| Content area | Yes | The caller-provided supplementary content; collapsed descendants are unavailable to keyboard and assistive technology. |

## Best Practices

- **Do:** Give label a concrete plural noun such as "Attachments" so the expand and collapse actions have a useful accessible name.
- **Do:** Use controlled isCollapsed with onCollapsedChange when another part of the page owns drawer state; otherwise use defaultIsCollapsed.
- **Don't:** Put primary composer actions in the drawer; use ChatComposer footer or send-action slots so those controls remain available when the drawer is collapsed.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | drawer content: tokens, chips, previews, any React elements **(required)** |
| `count` | `number` | - | total count for collapsed summary; enables collapse/expand toggle |
| `label` | `string` | `'Items'` | collapsed label next to the default count badge; names the disclosure action |
| `collapsedSummary` | `ReactNode` | - | custom visual content replacing the complete Collapsed summary anatomy; requires count; presentation-only; default keeps Badge + label |
| `isCollapsed` | `boolean` | - | controlled collapsed state |
| `defaultIsCollapsed` | `boolean` | `false` | initial collapsed state (uncontrolled) |
| `onCollapsedChange` | `(isCollapsed: boolean) => void` | - | callback on collapse toggle |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-chat-composer-drawer` | `data-collapsed` | collapsed | - |

Override in defineTheme:
```ts
components: {
  'chat-composer-drawer': {
    base: { /* CSS properties */ },
    'collapsed:value': { /* variant-specific */ },
  },
}
```
