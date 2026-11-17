package: @curialy/ui

# InputGroupText

prefix/suffix text/icon element

**Import:** `import {InputGroupText} from '@curialy/ui/InputGroup';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Text cell | Yes | A non-interactive cell that holds text or an icon and joins the borders of its neighbours in the row. |

## Best Practices

- **Do:** Keep the text short, such as $, https://, or kg. It stays on one line and does not shrink.
- **Do:** Plain text keeps its character order under right-to-left, so https:// and .com read as written. When rich content mixes directions, mark the direction on your own content, for example with `dir` or `<bdi>`.
- **Do:** Put what a screen reader user needs in the input's own label, such as "Amount in USD" beside a $ prefix. The addon is read as plain text in reading order.
- **Don't:** Put buttons, links, or other controls inside InputGroupText. Use a Button addon for an action.
- **Don't:** Use InputGroupText outside InputGroup. Its borders and corners join an InputGroup row.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | text or icon content **(required)** |
| `xstyle` | `StyleXStyles` | - | StyleX styles (stylex.create() value) |
| `className` | `string` | - | CSS class name(s) |
| `style` | `React.CSSProperties` | - | inline styles |
| `ref` | `React.Ref<HTMLDivElement>` | - | ref to the text cell |
