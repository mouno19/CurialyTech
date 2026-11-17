package: @curialy/ui

# Banner

Banner shows a persistent message at the top of a page or section. Use for form errors, system updates, maintenance notices, or success confirmations.

**Import:** `import {Banner} from '@curialy/ui/Banner';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Banner frame | Yes | Outer frame that groups the status surface and optional content surface. It carries whole-banner elevation and, for elevated card banners, the radius that shapes that silhouette. |
| Status surface | Yes | The primary painted surface. It communicates status and contains the icon, title, description, actions, and controls. |
| Icon | Yes | Automatically set based on the status (info, warning, error, success). |
| Title | Yes | The main message. Always required. |
| Description | No | Additional detail below the title. |
| Action button | No | A button for the user to act on the message, like "Review" or "Retry". |
| Dismiss button | No | Lets the user close the banner. Enabled by setting isDismissable. |
| Content surface | No | Secondary surface for extra detail below the status surface, like a list of errors. Sits behind an expand/collapse toggle by default; set collapsible={false} to keep it visible. |

## Best Practices

- **Do:** Match status to message: info for updates, warning for caution, error for problems, success for confirmations.
- **Do:** Card container for inline content, section container for full-width page-level messages.
- **Do:** Make info/success dismissable. Keep error banners until the issue is fixed.
- **Do:** Keep titles short: "Payment failed" not "There was a problem processing your payment."
- **Don't:** Use for auto-dismissing messages; use Toast instead.
- **Don't:** Stack multiple banners of the same status; combine into one.
- **Do:** Status controls color + icon only; Banner is non-live by default. Announce async outcomes from the transition handler with useAnnounce. role="alert" only for urgent messages; it lands on title + description, not controls or content. Never both.
- **Don't:** Rely on status color or icon alone; state the status in the title text, since the icon is decorative to a screen reader.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `status` | `'info' \| 'warning' \| 'error' \| 'success'` | - | controls icon+color **(required)** |
| `title` | `ReactNode` | - | title text/ReactNode in header **(required)** |
| `description` | `ReactNode` | - | text below title in header |
| `icon` | `ReactNode` | - | override default status icon |
| `isDismissable` | `boolean` | `false` | user can dismiss banner |
| `onDismiss` | `() => void` | - | dismiss callback; banner self-hides regardless |
| `dismissLabel` | `string` | - | a11y name + visible tooltip for dismiss; defaults to "Dismiss <title>" |
| `endContent` | `ReactNode` | - | end-aligned action in header, typically button/link; wraps to its own row when the header is too narrow |
| `container` | `'card' \| 'section'` | `'card'` | card=border-radius; section=full-width no radius for page-level |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth: none\|low\|med\|high; raise for a floating banner |
| `children` | `ReactNode` | - | content in card-bg area below colored header; behind a toggle unless collapsible={false} |
| `collapsible` | `boolean \| {defaultIsOpen?: boolean; isOpen?: boolean; onOpenChange?: (isOpen: boolean) => void}` | `true` | children behind a header toggle; default true=collapsed. false=always visible, no toggle. {defaultIsOpen:true}=starts open, {isOpen,onOpenChange}=controlled |
| `xstyle` | `StyleXStyles` | - | StyleX layout customization via stylex.create() |

## Examples

### Announce an async outcome from its transition handler

```tsx
import {useState} from 'react';
import {Banner} from '@curialy/ui/Banner';
import {Button} from '@curialy/ui/Button';
import {useAnnounce} from '@curialy/ui/hooks';

function SaveSettings() {
  const announce = useAnnounce();
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  async function handleSave() {
    try {
      await saveSettings();
      setResult('success');
      announce('Settings saved');
    } catch {
      setResult('error');
      announce('Settings could not be saved');
    }
  }

  return (
    <>
      <Button label="Save settings" onClick={handleSave} />
      {result != null ? (
        <Banner
          status={result}
          title={result === 'success' ? 'Settings saved' : 'Save failed'}
        />
      ) : null}
    </>
  );
}
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-banner-frame` | `data-container`, `data-elevation` | container, elevation | - |
| `cui-banner` | `data-container`, `data-status` | container, status | - |
| `cui-banner-icon` | `data-status` | status | - |
| `cui-banner-description` | - | - | - |
| `cui-banner-content` | `data-container`, `data-status` | container, status | - |

Override in defineTheme:
```ts
components: {
  'banner-frame': {
    base: { /* CSS properties */ },
    'container:value': { /* variant-specific */ },
  },
  'banner': {
    base: { /* CSS properties */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  banner-frame: {
    base: {
      borderRadius: '...',
    },
  },
}
```
