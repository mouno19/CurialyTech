package: @curialy/ui

# useOutlineFromDOM

Builds outline items from the headings already in the page. Use it when the article is not a Markdown string, and pass the items to Outline. The list updates when headings are added, removed, renamed, or given a new id. A null ref returns an empty list.

## Best Practices

- **Do:** Put an id on every heading the outline should list. A heading with no id, or with no text, is omitted.
- **Do:** Point the ref at the article, not the page, so headings outside the article stay out of the outline.
- **Don't:** Expect the hook to invent ids. It only reads the ids the headings already have.
- **Don't:** Use it for a Markdown string. useOutlineFromMarkdown follows the same parser and slugs as Markdown.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `containerRef` | `React.RefObject<HTMLElement \| null>` | - | The element that holds the headings. The hook reads h1 through h6 inside it. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `items` | `OutlineItem[]` | One item per heading that has both an id and text, in document order, ready for Outline's items prop. id is the heading's id, label is its trimmed text, and level is its depth from 1 to 6. |


Block templates: design_system component <name> --blocks for Outline
