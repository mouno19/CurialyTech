package: @curialy/ui

# Badge

Badge is for status (Active, Failed) and category tags (Engineering, Design). It is NOT for metadata like dates, durations, counts, or descriptions; use description text (Text type="supporting") for those.

**Import:** `import {Badge} from '@curialy/ui/Badge';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Icon | No | An optional leading icon that helps identify the badge type at a glance. |
| Label | Yes | The text or number shown inside the badge. |

## Best Practices

- **Do:** Every badge steals attention. Only badge states where the user needs to act. If no follow-up is needed, use plain text.
- **Do:** Use success/warning/error ONLY for system status requiring attention (Failed, Degraded, Action Required). These are visually loud: solid colored backgrounds.
- **Do:** Use color variants (blue, purple, teal) for category tags that classify items: team names, content types, priority levels.
- **Do:** Keep labels to one or two words. If more detail is needed, put it in surrounding text instead of the badge.
- **Do:** Add an icon when it helps identify the badge type quickly, but always include a text label alongside it.
- **Do:** A string or number label keeps its character order under right-to-left, so `+3` and `@alice` read as written. When a rich label mixes directions, mark the direction on your own content, for example with `dir` or `<bdi>`.
- **Don't:** Apply "success" badges to every healthy/normal item. If most rows are green "Active", none stand out. Skip the badge for the default state; only highlight exceptions that need attention.
- **Don't:** Use badges for metadata. Durations, counts, dates, descriptions → use Text with type="supporting" instead.
- **Don't:** Use status variants for non-status info. "6h window", "12 types", category names are NOT statuses.
- **Don't:** Repeat loud badges in every row. Common/default states should be plain text; reserve badges for the exceptional.
- **Don't:** Make badges clickable; they are read-only. Use a button or link for actions.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'neutral' \| 'info' \| 'success' \| 'warning' \| 'error' \| 'blue' \| 'cyan' \| 'green' \| 'orange' \| 'pink' \| 'purple' \| 'red' \| 'teal' \| 'yellow'` | `'neutral'` | visual style variant |
| `label` | `ReactNode` | - | badge text content; over-wide labels clip with an ellipsis, full text in title **(required)** |
| `icon` | `ReactNode` | - | optional leading icon |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-badge` | `data-variant` | neutral, info, success, warning, error, blue, cyan, green, orange, pink, purple, red, teal, yellow | - |

Override in defineTheme:
```ts
components: {
  'badge': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
}
```
