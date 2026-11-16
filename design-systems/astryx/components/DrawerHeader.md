package: @astryxdesign/core

# DrawerHeader

header slot of a Layout inside Drawer, like DialogHeader in Dialog; close button only when given onOpenChange (Drawer has none built in); no focus on open (Drawer uses data-autofocus); does not name the drawer (Drawer label does)

**Import:** `import {DrawerHeader} from '@astryxdesign/core/Drawer';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Header row | Yes | Arranges the title block, optional start/end content, and close control. |
| Start content | No | Wraps optional leading content. |
| Title block | Yes | Groups the title and optional subtitle. |
| End content | No | Groups optional trailing content with the optional close control. |
| Close icon | No | Visual close glyph inside the close button. |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `ReactNode` | - | drawer title node, rendered as h2; inline, non-interactive; does not name the drawer **(required)** |
| `subtitle` | `ReactNode` | - | subtitle node below title; inline content ok (e.g. Link), no block elements |
| `onOpenChange` | `(isOpen: boolean) => unknown` | - | close button callback, called with false (omit=no button); pass the Drawer's onOpenChange |
| `startContent` | `ReactNode` | - | content before title (e.g. back button) |
| `endContent` | `ReactNode` | - | content after title, before close button |
| `endContentEdgeCompensation` | `'inline' \| 'block' \| 'all'` | - | end-content slot axes: inline \| block \| all; omit=automatic close-action compensation |
| `hasDivider` | `boolean` | - | bottom border; default = parent Layout defaultHasDividers |

## Examples

### With close button

```tsx

import {useState} from 'react';
import {Drawer, DrawerHeader} from '@astryxdesign/core/Drawer';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';

function Inspector() {
  const [isOpen, setIsOpen] = useState(true);

  // Passing onOpenChange renders a close button that calls it with false.
  return (
    <Drawer isOpen={isOpen} onOpenChange={setIsOpen} label="Details">
      <Layout
        header={<DrawerHeader title="Details" onOpenChange={setIsOpen} />}
        content={<LayoutContent>Content</LayoutContent>}
      />
    </Drawer>
  );
}

```

### With subtitle and end content

```tsx

import {DrawerHeader} from '@astryxdesign/core/Drawer';
import {Badge} from '@astryxdesign/core/Badge';

<DrawerHeader
  title="web-prod-04"
  subtitle="us-east-1"
  endContent={<Badge label="Healthy" />}
/>;

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-drawer-header` | - | - | - |
| `astryx-drawer-header-start-content` | - | - | - |
| `astryx-drawer-header-title-block` | - | - | - |
| `astryx-drawer-header-end-content` | - | - | - |
| `astryx-drawer-header-close-icon` | - | - | - |

Override in defineTheme:
```ts
components: {
  'drawer-header': {
    base: { /* CSS properties */ },
  },
  'drawer-header-start-content': {
    base: { /* CSS properties */ },
  },
}
```
