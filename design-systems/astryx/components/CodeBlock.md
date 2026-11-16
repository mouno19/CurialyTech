package: @astryxdesign/core

# CodeBlock

CodeBlock renders syntax-highlighted code with line numbers, a copy button, and optional collapsible sections. Use CodeBlock for multi-line snippets like source files, terminal commands, and configuration examples. Use Code for inline references to function names, variables, or CLI flags within body text.

**Import:** `import {CodeBlock} from '@astryxdesign/core/CodeBlock';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Header Bar | No | Shows the title, visible language label, endContent, and copy button when a header is present. A title or visible language label creates the header at every line count. With no title and hasLanguageLabel={false}, endContent and the copy button sit in their own column beside the code, centred on the first line, and never cover it; a one-line block then reads as a single row. |
| Header Title | No | Groups the optional title, visible language label, and collapsible chevron inside the header bar. |
| Line Numbers | No | Numbered gutter along the left edge. Enable with hasLineNumbers. |
| Code Body | Yes | The syntax-highlighted code content. |
| Highlighted Lines | No | Background accent on specific lines to draw attention. |
| Copy Button | No | Copies the code string to the clipboard. Shown by default. |

## Best Practices

- **Do:** Set the language prop to match the code content so syntax highlighting is accurate. Use "plaintext" when the language is unknown.
- **Do:** Add a title when the code represents a file. It gives readers context and appears in the header bar alongside the copy button.
- **Do:** Use Code for short inline references like function names or CLI flags, and CodeBlock for standalone multi-line snippets.
- **Don't:** Enable line numbers on short snippets (under 5 lines) where they add clutter without helping navigation.
- **Don't:** Nest a code block inside a scrollable container. Use the maxHeight prop instead, which handles overflow natively.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `code` | `string` | - | The code string to display. **(required)** |
| `language` | `string \| CodeLanguage` | `'plaintext'` | Language for syntax highlighting. A string selects a built-in: ts, js, tsx, jsx, json, html, xml, svg, css, scss, less, python, bash/sh/zsh/shell, php, hack, yaml, markdown, c, cpp (c++, cc, cxx, hpp, hh), sql, rust, kotlin, swift, go. Any other language is a value you import on its own and pass here: graphql, java, thrift, objectiveC, toml, powershell, ruby, lua, dockerfile from @astryxdesign/core/CodeBlock/languages/<path> (e.g. languages/graphql, languages/objective-c), or your own made with createCodeLanguage({name, identifiers, tokenize}). A value labels with its name and reflects its first identifier as data-language. Use "plaintext" to disable. |
| `title` | `string` | - | Filename or label shown in the header bar. |
| `hasLanguageLabel` | `boolean` | `true` | Show the language name in the header bar. Hidden when language is "plaintext". |
| `hasLineNumbers` | `boolean` | `false` | Show a line number gutter. |
| `startLineNumber` | `number` | `1` | First line number shown in the gutter. The gutter shows file coordinates (startLineNumber + index) so a code excerpt reads with its real line numbers. highlightLines uses the same file coordinates. Values below 1 clamp to 1. |
| `highlightLines` | `number[]` | - | 1-indexed line numbers to highlight, in the same file coordinates as the gutter (see startLineNumber). Out-of-range entries render no highlight. |
| `isDiff` | `boolean` | `false` | Render the code as a unified diff over `language`: lines starting with + are added, - removed, @@ is a hunk header (a `--- `/`+++ ` file-header pair directly before one is a header too), anything else is context. The language label reads `diff` or `<language> diff`. The glyph sits in its own column and the rest of each line keeps syntax highlighting; copy returns the exact source. Markdown ```diff and ```diff-<lang> fences set this. |
| `hasCopyButton` | `boolean` | `true` | Show a copy-to-clipboard button. |
| `onCopy` | `() => void` | - | Callback after the code is copied. |
| `onCopyError` | `(error: unknown) => void` | - | Called once with the rejection when the clipboard write fails. The copy button shows a cross and is named and announced as "Failed to copy value to clipboard."; the error is not shown. |
| `endContent` | `ReactNode` | - | Your own controls, shown just before Copy: in the header when the block has one, otherwise beside the code in the top inline-end corner, never over it. It never creates a header and never collapses the block. Ghost sm IconButtons match Copy’s size and variant. |
| `isWrapped` | `boolean` | `false` | Wrap long lines instead of enabling horizontal scroll. |
| `maxHeight` | `number \| string` | - | Max height before the block scrolls vertically. |
| `size` | `'sm' \| 'md'` | `'md'` | Text size variant. |
| `width` | `string` | `'fit-content'` | Width of the code block. Any CSS width value. 'fit-content' (default) shrinks to longest line. '100%' fills parent width. |
| `container` | `'card' \| 'section'` | `'card'` | Container presentation style. 'card' (default): border and radius with the muted syntax background for a standalone card look. 'section': no border or radius and a transparent background so the block blends into the card or panel it's embedded in. |
| `tokenizer` | `(code: string, language: string) => Array<{type: string; start: number; end: number}>` | - | Deprecated: pass language={createCodeLanguage({name, identifiers, tokenize})} with this same function instead. Still works exactly as released and wins over the language; astryx upgrade rewrites static uses. |
| `syntaxTheme` | `SyntaxThemeDefinition` | - | Per-instance syntax theme override. Shorthand for wrapping the block in <SyntaxTheme theme={...}>. Accepts a preset from @astryxdesign/core/theme/syntax or a theme created with defineSyntaxTheme(). Defaults to the nearest SyntaxTheme ancestor or the theme-level syntax colors. |
| `highlightMode` | `'auto' \| 'ranges' \| 'spans'` | `'auto'` | Syntax highlighting rendering mode. |
| `isCollapsible` | `boolean` | `false` | Allow collapsing the code body into just the header bar. Starts expanded; a visible header becomes clickable when the code exceeds collapsibleThreshold lines. Headerless blocks never collapse, and removing the header expands a previously collapsed block. |
| `collapsibleThreshold` | `number` | `10` | Minimum number of lines before the collapse toggle appears. Below this threshold the code block renders normally even when isCollapsible is true. |
| `ref` | `React.Ref<HTMLPreElement>` | - | Ref forwarded to the root code-block element. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout customization. Must be a stylex.create() value. |
| `className` | `string` | - | CSS class name for the root element. Prefer xstyle for styling. |
| `style` | `CSSProperties` | - | Inline styles. Prefer xstyle for StyleX-optimized styling. |
| `data-testid` | `string` | - | Test selector for automated testing frameworks. |

## Components

### Code

See `astryx component Code` for props and usage.

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-code-block` | `data-size`, `data-language`, `data-container` | size, language, container | - |
| `astryx-code-block-header` | `data-size`, `data-language`, `data-container` | size, language, container | - |
| `astryx-code-block-title` | `data-size`, `data-language` | size, language | - |
| `astryx-code-block-copy-button` | - | - | - |

Override in defineTheme:
```ts
components: {
  'code-block': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
  'code-block-header': {
    base: { /* CSS properties */ },
  },
}
```

**Component icon slots** - set in `defineTheme({componentIcons})` to a shared icon name, `null`, a partial `{icon, variant, size}` request, or a function of the slot state.

| Slot | State | Fallback | Role | `null` |
|------|-------|----------|------|--------|
| `code-block-copy` | `copied: boolean` True while the copied feedback shows after a successful copy. False while a failed copy shows, so a theme that maps the slot draws its rest glyph then; the button is still named and announced as the failure. | `copy`; `check` while copied; `close` while a failed copy shows | The copy button icon. | Hides the glyph. The button keeps its size, name, tooltip, and copy action. |
