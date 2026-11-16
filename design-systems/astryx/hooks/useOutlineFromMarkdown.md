package: @astryxdesign/core

# useOutlineFromMarkdown

Extracts the headings of a Markdown string for an Outline next to the rendered document. It uses the parser and heading slugs that Markdown uses, so in a complete document each item links to its heading, and fenced code never counts as a heading. The result is memoized on the source and the options. Outside React, use parseOutlineFromMarkdown.

## Best Practices

- **Do:** Pass the same string, plugin list and finality to Markdown and this hook, so items match the rendered headings once the content is complete.
- **Do:** Declare the plugin list outside the component or memoize it. A new array on each render recomputes the outline.
- **Do:** For several documents on one page, install one createMarkdownHeadingLinks per document with headingIdPrefix, so their ids do not collide.
- **Don't:** Write the items by hand or find headings with a regular expression. They drift from the rendered ids.
- **Don't:** Expect every item to have a target while content streams. Markdown reveals text gradually and trims unfinished syntax, so a heading can be absent or have another id until the content is complete.
- **Don't:** Expect an item to link to a heading that cites a Markdown sources entry. The hook does not receive sources, so the ids differ: for '# Intro [ref]', Markdown renders intro and the hook returns intro-ref.
- **Don't:** Expect an item for a nested heading, such as one in a blockquote. Only root headings become items.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `markdown` | `string` | - | The Markdown source. Pass the same string you render with Markdown. **(required)** |
| `options` | `ParseOutlineFromMarkdownOptions` | - | Parse options. Omit them for a document that Markdown renders without plugins. |
| `options.plugins` | `ReadonlyArray<MarkdownPluginEntry>` | - | The ordered Markdown plugin list. Pass the same list to Markdown, so transforms, labels and ids agree. The outline is recomputed when the list reference changes. |
| `options.isFinal` | `boolean` | `true` | Whether the source is complete. Pass false while Markdown's isStreaming is true, so both apply the same transforms. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `items` | `OutlineItem[]` | One item per root heading, in document order, ready for Outline's items prop. id is the id Markdown renders on the heading in a complete document without sources, label is the heading's text, and level is its depth from 1 to 6. |


Block templates: astryx component <name> --blocks for Outline, Markdown
