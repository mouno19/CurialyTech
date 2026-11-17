package: @curialy/ui

# DialogHeader

labelled dialog title area + optional close control

**Import:** `import {DialogHeader} from '@curialy/ui/Dialog';`

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
| `title` | `ReactNode` | - | dialog title node inside focusable h2 (focused on open; text content labels dialog via aria-labelledby); inline, non-interactive, non-empty |
| `subtitle` | `ReactNode` | - | subtitle node below title; inline content ok (e.g. Link), no block elements |
| `onOpenChange` | `(isOpen: boolean) => unknown` | - | close button callback (omit=no button) |
| `startContent` | `ReactNode` | - | content before title (e.g. back button) |
| `endContent` | `ReactNode` | - | content after title, before close button |
| `endContentEdgeCompensation` | `'inline' \| 'block' \| 'all'` | - | end-content slot axes: inline \| block \| all; omit=automatic close-action compensation |
| `hasDivider` | `boolean` | `true` | bottom border |

## Examples

### Basic

```tsx

import {DialogHeader} from '@curialy/ui/Dialog';

<DialogHeader title="Delete file?" subtitle="This action cannot be undone." />;

```

### With close button

```tsx

import {useState} from 'react';
import {DialogHeader} from '@curialy/ui/Dialog';

function Header() {
  const [, setIsOpen] = useState(true);

  // Passing onOpenChange renders a close button that calls it with false.
  return <DialogHeader title="Settings" onOpenChange={setIsOpen} />;
}

```

### With a link in the subtitle

```tsx

import {DialogHeader} from '@curialy/ui/Dialog';
import {Link} from '@curialy/ui/Link';

<DialogHeader
  title="Share conversation"
  subtitle={
    <>
      Anyone with the link can view it. Review the{' '}
      <Link href="#sharing-policy">sharing policy</Link> first.
    </>
  }
/>;

```

### With start and end content

```tsx

import {DialogHeader} from '@curialy/ui/Dialog';
import {Icon} from '@curialy/ui/Icon';
import {Badge} from '@curialy/ui/Badge';

<DialogHeader
  title="Notifications"
  startContent={<Icon icon="chevronLeft" size="sm" />}
  endContent={<Badge label="3" />}
/>;

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-dialog-header` | - | - | - |
| `cui-dialog-header-start-content` | - | - | - |
| `cui-dialog-header-title-block` | - | - | - |
| `cui-dialog-header-end-content` | - | - | - |
| `cui-dialog-header-close-icon` | - | - | - |

Override in defineTheme:
```ts
components: {
  'dialog-header': {
    base: { /* CSS properties */ },
  },
  'dialog-header-start-content': {
    base: { /* CSS properties */ },
  },
}
```
