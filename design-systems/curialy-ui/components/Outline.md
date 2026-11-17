package: @curialy/ui

# Outline

A table-of-contents sidebar for documentation pages, help centers, wikis, and long settings pages. Use it for navigation within a single page, not for app routes.

**Import:** `import {Outline} from '@curialy/ui/Outline';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Outline | Yes | Navigation container for the same-page heading links and indicator. |
| Heading link | Yes | Anchor for one heading, indented by level and marked when active. |
| Label | Yes | Heading text displayed inside its heading link. |
| Indicator track | Yes | Painted vertical rule behind the active indicator. |
| Active indicator | Yes | Sliding bar positioned beside the currently active heading link. |

## Best Practices

- **Do:** Pass a flat ordered list of headings and let level control indentation.
- **Do:** Use activeId when custom scroll logic owns the active section.
- **Do:** Use density="compact" in dense sidebars where vertical space is tight.
- **Do:** Use useOutlineFromMarkdown or useOutlineFromDOM when headings are generated from content. For linkable Markdown headings, pass the same createMarkdownHeadingLinks() entry to Markdown and Outline; configure headingIdPrefix on that plugin for multiple roots.
- **Do:** Pass scrollContainerRef when the content scrolls in a split pane, modal, or panel instead of the viewport.
- **Do:** Set offset to the height of a fixed header that overlays the content, so headings land below it instead of underneath it.
- **Don't:** Use Outline for application navigation - use SideNav or TopNav for routes.
- **Don't:** Use Outline for expandable hierarchy - use TreeList when nodes need expand and collapse.
- **Don't:** Rely on onNavigateEnd to mean "arrived" - it also fires when the user interrupts the scroll.

## Components

### Outline

Document outline nav with sliding indicator. Renders heading anchors with a density variant, links in the normal Tab order, navigate callbacks, and scroll-spy active state when uncontrolled.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `OutlineItem[]` | - | Ordered OutlineItem[]: {id,label,level}. id should match target heading DOM id. **(required)** |
| `activeId` | `string` | - | Controlled active heading id. Disables built-in scroll-spy. |
| `onActiveIdChange` | `(id: string) => void` | - | Called when active id changes from scroll-spy or click. |
| `label` | `string` | `'Table of contents'` | Accessible nav label. Default: 'Table of contents'. |
| `density` | `'default' \| 'compact'` | `'default'` | Density variant: 'default' \| 'compact'. Default: 'default'. |
| `onNavigateStart` | `(id: string) => void` | - | Called with the id when navigation begins, before the scroll. |
| `onNavigateEnd` | `(id: string) => void` | - | Called with the id once the scroll settles. Fires exactly once per onNavigateStart, including on user interruption. |
| `offset` | `number` | `0` | Height in px of a fixed header overlaying the scroll root. Shifts both the activation line and the scroll landing. Composes with scroll-margin-top. Default: 0. |
| `scrollContainerRef` | `React.RefObject<HTMLElement \| null>` | - | RefObject of the scroll container to track, instead of the nearest scrollable ancestor. |
| `hasScrollOnClick` | `boolean` | `true` | Whether activating an item smooth-scrolls to it. Default: true. |
| `xstyle` | `StyleXStyles` | - | StyleX styles for layout. Must be stylex.create() value. |

#### Basic

```tsx

import {Outline} from '@curialy/ui/Outline';

const items = [
  {id: 'overview', label: 'Overview', level: 2},
  {id: 'installation', label: 'Installation', level: 2},
  {id: 'theming', label: 'Theming', level: 2},
  {id: 'tokens', label: 'Tokens', level: 3},
  {id: 'accessibility', label: 'Accessibility', level: 2},
];

// Uncontrolled: built-in scroll-spy tracks the topmost visible heading.
<Outline items={items} />;

```

#### Compact (density="compact")

```tsx

import {Outline} from '@curialy/ui/Outline';

// Dense sidebars use the compact variant; the sliding indicator
// automatically matches the shorter item height.
<Outline items={items} density="compact" />;

```

#### Controlled active section

```tsx

import {useState} from 'react';
import {Outline} from '@curialy/ui/Outline';

function ControlledOutline() {
  const [activeId, setActiveId] = useState('overview');

  // Providing activeId disables built-in scroll-spy; you own the active state.
  return (
    <Outline
      items={items}
      activeId={activeId}
      onActiveIdChange={setActiveId}
    />
  );
}

```

#### Generate items from markdown

```tsx

import {Markdown} from '@curialy/ui/Markdown';
import {createMarkdownHeadingLinks} from '@curialy/ui/Markdown/plugins';
import {Outline, useOutlineFromMarkdown} from '@curialy/ui/Outline';

const markdownRootId = 'guide';
const plugins = [
  createMarkdownHeadingLinks({headingIdPrefix: markdownRootId}),
];

function MarkdownOutline({markdown, isStreaming}) {
  // Pass the same plugin entry and finality to Markdown and Outline. Nested
  // headings consume the shared depth-first sequence, while Outline continues
  // to return root headings only.
  const items = useOutlineFromMarkdown(markdown, {
    plugins,
    isFinal: !isStreaming,
  });
  return (
    <>
      <Markdown id={markdownRootId} plugins={plugins}>{markdown}</Markdown>
      <Outline items={items} />
    </>
  );
}

```

#### Scoped scroll container (split pane, modal, panel)

```tsx

import {useRef} from 'react';
import {Outline} from '@curialy/ui/Outline';

function PanelDocs() {
  const scrollContainerRef = useRef(null);

  // Without scrollContainerRef the outline auto-detects the nearest scrollable
  // ancestor, which is the viewport here - so the highlight would never move.
  return (
    <div style={{display: 'flex'}}>
      <div ref={scrollContainerRef} style={{overflowY: 'auto', height: 480}}>
        <h2 id="overview">Overview</h2>
        {/* ...content... */}
      </div>
      <Outline items={items} scrollContainerRef={scrollContainerRef} offset={64} />
    </div>
  );
}

```

#### Navigate callbacks (flash the heading on arrival)

```tsx

import {useState} from 'react';
import {Outline} from '@curialy/ui/Outline';

function FlashOnArrival() {
  const [flashId, setFlashId] = useState(null);

  // onNavigateEnd fires once the smooth scroll settles - and once per
  // onNavigateStart even if the user scrolls away mid-jump, so this never
  // gets stuck.
  return (
    <Outline
      items={items}
      onNavigateStart={() => setFlashId(null)}
      onNavigateEnd={id => setFlashId(id)}
    />
  );
}

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-outline` | `data-density` | density | - |
| `cui-outline-indicator` | - | - | - |
| `cui-outline-item` | `data-level`, `data-active` | level | active |

Override in defineTheme:
```ts
components: {
  'outline': {
    base: { /* CSS properties */ },
    'density:value': { /* variant-specific */ },
  },
  'outline-indicator': {
    base: { /* CSS properties */ },
  },
}
```
