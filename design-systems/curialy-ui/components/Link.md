package: @curialy/ui

# Link

A styled anchor for inline and standalone text navigation. Supports external links, underline variants, tooltips, and custom link components for router integration. Use it for navigating between pages or to external URLs.

**Import:** `import {Link} from '@curialy/ui/Link';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | The visible text of the link. |
| External icon | No | Extra-small icon after the label when `isExternalLink` is set. It takes the link color. Screen readers hear the new-tab text instead of the icon. |

## Best Practices

- **Do:** Write descriptive, concise link text that clearly communicates the destination.
- **Do:** Set `isStandalone` when the link appears outside of inline text, so it receives proper base font sizing.
- **Do:** Put a Link inside a <Text maxLines> to truncate it with the surrounding text; inside a clamped Text the link flows in the text's lines.
- **Do:** Only set `label` when the link content is not descriptive text (e.g. an icon-only link). For text links, the visible text is already the accessible name; adding `label` overrides it for screen readers, which is harmful.
- **Don't:** Use Link for actions that do not navigate; use a Button instead.
- **Don't:** Use generic text like "click here" or "read more"; describe the destination.
- **Don't:** Set `label` on text links; `aria-label` prevents assistive technology from reading the actual link content.
- **Don't:** Give a Link inside a clamped Text its own `display` or `maxLines`, or render it as a button (`onClick` with no `href`), and expect the outer clamp to cut it; that Link keeps its own box.
- **Don't:** Put a Link with block-level content, such as an HStack with an icon, inside a clamped Text; block content breaks the clamp. Clamp a text-only Link, or place the composed Link outside the clamp.

## Accessibility

- **Link text:** Link text must have at least 4.5:1 contrast with the background behind it. For Pointer down, measure against the pressed overlay the link paints behind its text.

## Components

### Link

Styled anchor link w/ variants, external link support, polymorphic rendering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `as` | `LinkComponentType` | - | Custom component to render instead of <a> |
| `label` | `string` | - | Accessible label (aria-label). Only for non-text content like icon-only links. |
| `href` | `string` | - | Link destination URL. Shared rule blocks javascript:, vbscript:, data:text/html after scheme normalization on every Curialy UI-owned navigation path. Ordinary URLs, fragments, safe custom schemes, and accepted downloads are preserved. Rejected => inert, no custom router. No bypass prop; exceptional caller-owned rendering is outside the guarantee. Image/resource policy is separate. |
| `hasUnderline` | `boolean` | `false` | Always show underline |
| `isDisabled` | `boolean` | `false` | Disables link: no navigation or onClick; keeps Tab stop; announced as disabled |
| `isExternalLink` | `boolean` | `false` | Opens new tab w/ external icon and safe rel tokens |
| `newTabLabel` | `string` | `'(opens in new tab)'` | SR text announcing an external link opens in a new tab |
| `target` | `string` | - | Where to open linked document. target="_blank" auto-adds noopener noreferrer. |
| `rel` | `string` | - | Link relationship tokens. noopener noreferrer are merged for target="_blank". |
| `download` | `string \| boolean` | - | Causes the browser to download the linked URL. A string specifies the suggested filename. |
| `referrerPolicy` | `HTMLAttributeReferrerPolicy` | - | Referrer policy for the link. |
| `onClick` | `MouseEventHandler` | - | Click event handler |
| `tooltip` | `string` | - | Tooltip text on hover |
| `isStandalone` | `boolean` | `false` | Applies base font sizing |
| `type` | `'body' \| 'large' \| 'label' \| 'supporting' \| 'code' \| 'display-1' \| 'display-2' \| 'display-3' \| 'inherit'` | `'body'` | Text type forwarded to Text; `inherit` takes the surrounding text size |
| `size` | `'4xs' \| '3xs' \| '2xs' \| 'xsm' \| 'sm' \| 'base' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl'` | - | Explicit font size override forwarded to Text. |
| `weight` | `'normal' \| 'medium' \| 'semibold' \| 'bold'` | - | Font weight override forwarded to Text. |
| `color` | `'primary' \| 'secondary' \| 'disabled' \| 'placeholder' \| 'accent' \| 'inherit'` | `'accent'` | Text color forwarded to Text. |
| `display` | `'inline' \| 'block'` | `'inline'` | Display type for Text. |
| `maxLines` | `number` | `0` | Maximum lines before truncation. |
| `children` | `ReactNode` | - | Link content **(required)** |
| `ref` | `Ref<HTMLAnchorElement \| HTMLButtonElement>` | - | Ref to the root anchor or button |

### LinkProvider

Provider setting default link component for all Curialy UI links in subtree.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `component` | `LinkComponentType` | - | Component for all link elements. Accepted href/to follow the Link href rule; structured fields including protocol are checked, preserving identity. Either rejected => inert content, no router invocation or fallback. **(required)** |
| `children` | `ReactNode` | - | Subtree **(required)** |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-link` | `data-color` | color | - |

Override in defineTheme:
```ts
components: {
  'link': {
    base: { /* CSS properties */ },
    'color:value': { /* variant-specific */ },
  },
}
```
