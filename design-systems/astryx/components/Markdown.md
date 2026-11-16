package: @astryxdesign/core

# Markdown

Renders a markdown string as Astryx-styled components. Use Markdown for user-generated content, AI responses, and documentation; it handles headings, lists, tables, code blocks, and citations with consistent styling.

**Import:** `import {Markdown} from '@astryxdesign/core/Markdown';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Document | Yes | Root container for block or inline Markdown content. |
| Heading | No | Rendered semantic heading block; a custom heading renderer replaces the built-in part. |
| Paragraph | No | Rendered paragraph block; a custom paragraph renderer replaces the default part. |
| List | No | Ordered, unordered, or task-list block rendered from Markdown items. |
| Code block | No | Fenced code block; long lines wrap rather than scroll sideways. A custom code renderer replaces the default part. |
| Blockquote | No | Quoted block; a custom blockquote renderer replaces the default part. |
| Table | No | Table block rendered from Markdown rows and columns; its Table child owns horizontal scrolling. |
| Divider | No | Horizontal rule block; a custom hr renderer replaces the default part. |
| Image | No | Block image or unsafe-URL fallback; a custom image renderer replaces a safe default image. |

## Best Practices

- **Do:** Set headingLevelStart to match the page hierarchy, e.g. start at 3 if the markdown sits inside an h2 section.
- **Do:** Use contentWidth to keep prose at a readable line length in wide layouts.
- **Do:** Emphasis and strong pair as CommonMark specifies, so *see **bold** more* puts the bold inside the emphasis. ***text*** renders as strong around emphasis, the order RichText draws, and is announced as both. Emphasis nested more than 100 levels deep stays as written text.
- **Do:** Use plugins created by createMarkdownPlugin for reusable syntax, immutable AST transforms, and typed extension rendering. Keep the ordered list stable while its syntax configuration is unchanged.
- **Do:** To render a plugin node outside Markdown, as another surface showing the same document does, read what the plugin declares with getMarkdownPluginCapabilities (syntax and transform, nothing else), and render each parsed extension node with MarkdownPluginNodeRenderer from the client-only @astryxdesign/core/Markdown/plugin-renderer subpath. It presents the node exactly as Markdown does, fallbacks and failure reports included, with no element of its own.
- **Do:** Add markdownSoftBreaksPlugin when single line endings are meaningful. It matches remark-breaks for supported Markdown, including multiline link labels, while code and other opaque content stay unchanged.
- **Do:** Add markdownSourceLinesPlugin when a feature maps the rendered document back to Markdown source lines (find, highlights, review comments). Every block Markdown renders, nested blocks included, then carries data-source-line and data-source-line-end (1-based, inclusive); components block renderers receive sourceLines to place on their own element, and plugin renderers read node.position lines. Inline elements, table rows, and cells carry none. Without the plugin no line work runs.
- **Do:** Use createMarkdownTextTransform for prose matching; it preserves code, links, images, citations, math, and accepted extension syntax as protected contexts. Provide requiredSubstrings only when they conservatively cover every possible match.
- **Do:** Use createMarkdownFenceTransform for declared code-fence languages with semantic data. createNode returns an owned block extension node; its standard plugin renderer and toText own presentation. A claimed fence renders through that plugin even when components.code is supplied; components.code renders every unclaimed fence and is the fallback when the plugin renderer declines, throws, or suspends, and without it the accessible, copyable CodeBlock is that fallback.
- **Do:** Use createMarkdownSourceDecoration to attach non-visual metadata — search hits, review annotations — to the blocks a source range touches, and getMarkdownSourceDecorations to read it back in a later plugin. Decorations appear on the settled document rather than on partial streaming chunks, and never change rendering, copyable text, accessible names, ids, focus order, or navigation.
- **Do:** Import parseMarkdownAst or parseInlineAst from @astryxdesign/core/Markdown/parser when server or React Server Component code needs to run plugins against the canonical readonly tree. The parser and plugin subpaths have no use-client boundary. The Markdown component remains client-owned, so function-bearing plugin entries must not be passed across an RSC serialization boundary.
- **Do:** Use createMarkdownFrontmatter for typed document metadata. Its parse() method gives the host metadata directly; its plugin removes a complete leading block before rendering and withholds an unfinished block during streaming.
- **Do:** Import createMarkdownRemarkTransform from '@astryxdesign/core/Markdown/remark' only to reuse a synchronous transform-only Remark plugin; it stays out of every other bundle and unsupported behavior keeps the last valid document with one diagnostic.
- **Do:** Use inlinePlugins for prefixed identifiers, mentions, and other prose-only shorthand instead of preprocessing the markdown string.
- **Do:** Provide components.math only for documents that use dollar-delimited math; the renderer owns typesetting and accessible output.
- **Do:** Direct math parser calls use MathParseOptions and the explicit WithMath node unions; incremental calls also use createIncrementalState<true>() and IncrementalParseState<true>. Default calls keep the legacy unions.
- **Do:** Install createMarkdownHeadingLinks() through plugins to add all-depth stable IDs and inline trailing # copy buttons to built-in headings. useContainerReveal keeps each button hidden at fine-pointer rest and keyboard/touch reachable. Unmodified activation copies the canonical URL without navigation, hash mutation, or scrolling and shows a 1.5-second check; failures stay silent. Pass the same plugin entry to Markdown-derived Outline; use headingIdPrefix for multiple instances.
- **Don't:** Use Markdown for hand-authored layouts; use Text and Heading directly when you control the content.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `string` | - | markdown string **(required)** |
| `display` | `'block' \| 'inline'` | `'block'` | Display type. Markdown defaults to block. Use 'inline' for markdown spans embedded inside text. |
| `density` | `'default' \| 'compact'` | `'default'` | Block spacing. 'default'\|'compact'. Default: 'default'. |
| `headingLevelStart` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | `1` | Maps # to this heading level (1-6). Clamped to h6. Default: 1. |
| `isStreaming` | `boolean` | `false` | Incremental parse + fade-in for streamed chunks. Default: false. |
| `onLinkClick` | `(href: string, event: MouseEvent) => void \| false` | - | (href, event) => void\|false. Return false prevents navigation. Link destinations follow the shared navigation rule (see Link href), and every data: link or image URL is also dropped; rejected ones render as text. |
| `sources` | `Record<string, MarkdownSource>` | - | Record<string, MarkdownSource>. Citation sources by ID. [id]/【id】 markers render as chips. |
| `citationStyle` | `'label' \| 'number'` | `'label'` | 'label'\|'number'. label=chip w/ title+icon, number=compact badge. Default: 'label'. |
| `contentWidth` | `number \| string` | `680` | number\|string. Max width for prose (headings, paragraphs, lists). Tables/code unconstrained. |
| `contentAlign` | `'start' \| 'center'` | `'start'` | 'start'\|'center'. Prose alignment when contentWidth < container. Default: 'start'. |
| `plugins` | `readonly MarkdownPluginEntry[]` | - | readonly MarkdownPluginEntry[]. Ordered syntax, immutable AST transforms, and typed extension renderers from createMarkdownPlugin(), plus first-party helpers such as createMarkdownHeadingLinks(). Default: omitted or empty. |
| `inlinePlugins` | `MarkdownInlinePlugin[]` | - | MarkdownInlinePlugin[]. Regex matches in text nodes -> custom inline React elements. Skips inline/fenced code and math. |
| `autolink` | `'gfm'` | - | 'gfm'. Opt-in GFM autolinking: bare URLs (https?://, www.), <scheme:url>, <email>, user@host. Skips code, code blocks, existing links. Default: off. |
| `codeLanguages` | `ReadonlyArray<CodeLanguage>` | - | CodeBlock language values a fence may name, each imported on its own (e.g. graphql from @astryxdesign/core/CodeBlock/languages/graphql) or made with createCodeLanguage. A fence whose language word is one of a listed value's identifiers renders with it, ahead of a built-in; a diff-<identifier> fence takes the diff layer over it; a later entry wins. Pass the same list to RichTextEditor or RichTextView so read and edit match. |
| `components` | `MarkdownComponents` | - | MarkdownComponents. Custom renderers; math({value, display}) opts into $…$/$$…$$ parsing. Renderer owns output and accessibility. |
| `xstyle` | `StyleXStyles` | - | stylex.create() for layout (margins, sizing). |
| `className` | `string` | - | CSS class. Prefer xstyle. |
| `style` | `CSSProperties` | - | Inline styles. Prefer xstyle. |
| `data-testid` | `string` | - | Test selector. |

## Examples

### Inline display

```tsx

import {Text} from '@astryxdesign/core/Text';

<Text>
  This description includes{' '}
  <Markdown display="inline">{'`inline code` and **bold text**'}</Markdown>
  .
</Text>;

```

### GFM autolinks

```tsx

<Markdown autolink="gfm">
  {'Visit https://example.com or email contact@example.com. ' +
    'You can also bracket links: <https://docs.example.com>.'}
</Markdown>;

```

### Linkable headings

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {createMarkdownHeadingLinks} from '@astryxdesign/core/Markdown/plugins';
import {Outline, useOutlineFromMarkdown} from '@astryxdesign/core/Outline';

const documentId = 'guide';
const headingLinks = createMarkdownHeadingLinks({
  headingIdPrefix: documentId,
});
const plugins = [headingLinks];

function Guide({source}) {
  const items = useOutlineFromMarkdown(source, {plugins});
  return (
    <>
      <Markdown id={documentId} plugins={plugins}>{source}</Markdown>
      <Outline items={items} />
    </>
  );
}

```

### First-party soft breaks

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {markdownSoftBreaksPlugin} from '@astryxdesign/core/Markdown/plugins';

<Markdown plugins={[markdownSoftBreaksPlugin]}>
  {'First line\nSecond line'}
</Markdown>;

```

### Source-line stamps

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {markdownSourceLinesPlugin} from '@astryxdesign/core/Markdown/plugins';

// Each rendered block carries data-source-line / data-source-line-end.
<Markdown plugins={[markdownSourceLinesPlugin]}>
  {'# Title\n\n- one\n- two'}
</Markdown>;

```

### Text transform helper

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {
  createMarkdownPlugin,
  createMarkdownTextTransform,
} from '@astryxdesign/core/Markdown/plugins';

const finalLabels = createMarkdownPlugin({
  name: 'final-labels',
  apiVersion: 1,
  transform: createMarkdownTextTransform({
    pattern: /\bDraft\b/g,
    requiredSubstrings: ['Draft'],
    replace: () => ({type: 'text', value: 'Final'}),
  }),
});

<Markdown plugins={[finalLabels]}># Draft</Markdown>;

```

### Semantic fence helper

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {
  createMarkdownFenceTransform,
  createMarkdownPlugin,
  type MarkdownExtensionNode,
} from '@astryxdesign/core/Markdown/plugins';

type DiagramNode = MarkdownExtensionNode<
  'diagrams',
  'diagram',
  {readonly code: string; readonly label?: string},
  'block'
>;

const diagrams = createMarkdownPlugin<'diagrams', DiagramNode>({
  name: 'diagrams',
  apiVersion: 1,
  transform: createMarkdownFenceTransform({
    languages: ['mermaid'],
    createNode: ({code, meta}) => ({
      type: 'extension',
      plugin: 'diagrams',
      name: 'diagram',
      display: 'block',
      data: {code, ...(meta == null ? {} : {label: meta})},
    }),
  }),
  renderers: {
    diagram: {
      render: ({node}) => (
        <Diagram source={node.data.code} label={node.data.label} />
      ),
      toText: node => node.data.code,
    },
  },
});

<Markdown plugins={[diagrams]}>
  {'```mermaid Checkout flow\ngraph LR; A-->B\n```'}
</Markdown>;

```

### Source decoration helper

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {
  createMarkdownPlugin,
  createMarkdownSourceDecoration,
  getMarkdownSourceDecorations,
} from '@astryxdesign/core/Markdown/plugins';

// Ranges are UTF-16 offsets into the same string Markdown renders. Every
// block a range touches is annotated; rendering, copyable text, and ids
// never change.
const searchHits = createMarkdownPlugin({
  name: 'search-hits',
  apiVersion: 1,
  transform: createMarkdownSourceDecoration({
    name: 'search-hit',
    ranges: [{start: 0, end: 15, data: {query: 'release'}}],
  }),
});

const readDecorations = createMarkdownPlugin({
  name: 'read-decorations',
  apiVersion: 1,
  transform: root => {
    report(root.children.map(getMarkdownSourceDecorations));
    return root;
  },
});

<Markdown plugins={[searchHits, readDecorations]}>{source}</Markdown>;

```

### Native frontmatter

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {createMarkdownFrontmatter} from '@astryxdesign/core/Markdown/plugins';

const frontmatter = createMarkdownFrontmatter({
  name: 'document-metadata',
  parse: fields => ({
    title: fields.title ?? 'Untitled',
    draft: fields.draft === 'true',
  }),
});

const source = '---\ntitle: Release notes\ndraft: true\n---\n# Shipped';
const result = frontmatter.parse(source);

<Markdown plugins={[frontmatter.plugin]}>{source}</Markdown>;

```

### Compatible Remark plugin

```tsx

import {Markdown} from '@astryxdesign/core/Markdown';
import {createMarkdownPlugin} from '@astryxdesign/core/Markdown/plugins';
import {createMarkdownRemarkTransform} from '@astryxdesign/core/Markdown/remark';

// A synchronous transform-only Remark plugin in the usual attacher shape.
const remarkRename =
  ({from, to}) =>
  tree => {
    const rename = node => {
      if (node.type === 'text') {
        node.value = node.value.split(from).join(to);
      }
      node.children?.forEach(rename);
    };
    rename(tree);
  };

const productName = createMarkdownPlugin({
  name: 'product-name',
  apiVersion: 1,
  transform: createMarkdownRemarkTransform(remarkRename, {
    from: 'Astryx',
    to: 'Astryx Design',
  }),
});

<Markdown plugins={[productName]}># Astryx release notes</Markdown>;

```

### Entity links

```tsx

import {Link} from '@astryxdesign/core/Link';

const entityPlugins = [
  {
    pattern: /\b([A-Z][A-Z0-9]+-\d+)\b/g,
    render: (match, key) => (
      <Link key={key} href={`/entities/${match[1]}`}>
        {match[0]}
      </Link>
    ),
  },
];

<Markdown inlinePlugins={entityPlugins}>
  {'See DOC-2048. Inline code stays plain: `DOC-9999`.'}
</Markdown>;

```

### Math renderer

```tsx

import {BlockMath, InlineMath} from 'react-katex';

function MathExpression({value, display}) {
  const Component = display === 'block' ? BlockMath : InlineMath;
  return <Component math={value} />;
}

<Markdown components={{math: MathExpression}}>
  {'Inline $x_1 + y$ and display math:\n\n$$\n\\sum_i x_i\n$$'}
</Markdown>;

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-markdown` | `data-density` | density | - |
| `astryx-markdown-heading` | `data-density`, `data-level` | density, level | - |
| `astryx-markdown-paragraph` | `data-density` | density | - |
| `astryx-markdown-list` | `data-density` | density | - |
| `astryx-markdown-codeblock` | `data-density` | density | - |
| `astryx-markdown-blockquote` | `data-density` | density | - |
| `astryx-markdown-table` | `data-density` | density | - |
| `astryx-markdown-hr` | `data-density` | density | - |
| `astryx-markdown-image` | `data-density` | density | - |

Override in defineTheme:
```ts
components: {
  'markdown': {
    base: { /* CSS properties */ },
    'density:value': { /* variant-specific */ },
  },
  'markdown-heading': {
    base: { /* CSS properties */ },
  },
}
```
