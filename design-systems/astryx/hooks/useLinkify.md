package: @astryxdesign/core

# useLinkify

Finds URLs, email addresses and custom patterns in plain text and returns React nodes with a Link for each match; the links respect LinkProvider for client-side routing. Use it wherever user- or tool-authored plain text should grow safe, styled links without pre-parsing it into markup: activity feeds, comment threads, description fields. Custom patterns turn project-specific references (issue numbers like #123, ticket IDs) into links by supplying a regex plus an href builder — e.g. an issue tracker pattern that maps captures onto its URL scheme. When matches overlap, the earliest one wins, and at the same start a custom pattern wins over the built-in ones, so a custom #123 pattern coexists with URL detection in the same string.

## Best Practices

- **Do:** Render the returned nodes directly inside a text container (<p>{nodes}</p>); the hook already interleaves the unmatched plain text.
- **Do:** Wrap the app (or the region) in LinkProvider so detected links route client-side instead of full-page navigating.
- **Do:** Give a custom pattern the global flag (g). Without it the scan never advances, and when the text contains a match the render never finishes.
- **Don't:** Pre-parse the text into your own markup before linkifying — the hook exists so the plain string can be rendered as-is with links composed in.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | `string` | - | The plain text to scan. Empty text returns a single-element array of itself. **(required)** |
| `options` | `UseLinkifyOptions` | - | Configuration object. |
| `options.patterns` | `LinkifyPattern[]` | - | Custom patterns to detect, in addition to (or, with hasBuiltins false, replacing) the built-in URL and email detection. Each pattern is a global-flag regex plus an href builder (capture groups available) and an optional label builder and isExternal flag. When matches overlap, the earliest one wins; at the same start, custom patterns win over the built-in ones. |
| `options.hasBuiltins` | `boolean` | `true` | Include the built-in http(s) URL and email detection. Default true; set false when patterns should fully define what links. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `(return value)` | `ReactNode[]` | The text as a mix of plain strings and Link elements, one per match, ready to render inside a text container. Matched URLs open externally (isExternal), emails link as mailto:, and every link renders through Link — so a LinkProvider routes clicks client-side the same as a hand-written Link. |


Block templates: astryx component <name> --blocks for Link, LinkProvider
