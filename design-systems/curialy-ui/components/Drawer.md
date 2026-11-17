package: @curialy/ui

# Drawer

Overlay side panel for inspectors and detail views; floats over content, never reflows it. width = desktop budget; 56px page reveal below 640px, capped by width. Escape closes topmost (not when purpose=required); focus restores to the opener. Siblings stack last-opened on top; never nest. Slide animation respects prefers-reduced-motion. Dialog-like container: content area inset = --spacing-4 (16px) by default, or the padding prop / a theme's drawer padding (padding={0} = full bleed). Compose like Dialog: Layout with DrawerHeader in the header slot (close button only when given onOpenChange), LayoutContent, LayoutFooter; Layout redistributes the inset so regions line up and the header is not inset twice; a lone Section escapes the inset. No built-in close button, so every drawer needs a visible exit; data-autofocus picks the focus target. purpose matches Dialog: info = Escape + scrim click, form = Escape only, required = neither (modal → alertdialog). Choose: Dialog for centered decisions/short forms, Drawer for full-height side detail, BottomSheet for block-axis sheets, docked layout column to reflow instead of float. Theming: single target cui-drawer (data-side); scrim is its ::backdrop; DrawerHeader has cui-drawer-header targets.

**Import:** `import {Drawer} from '@curialy/ui/Drawer';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Panel | Yes | The root <dialog> element: a full-height surface anchored to the inline start or end edge, flush with three viewport edges (square corners). |
| Content area | Yes | Scrollable container that receives children; compose the header, body, and footer inside it with a Layout, as in Dialog. Inset by --spacing-4 (16px) by default; the padding prop or a theme sets a different container inset. |
| Header | No | DrawerHeader, composed in a Layout header slot as DialogHeader is in Dialog: a title row with optional subtitle and start/end content. Pass it onOpenChange to show a close button, as with DialogHeader. |
| Scrim | No | Backdrop that dims and blocks the page behind a modal drawer (hasScrim, the default); a non-modal drawer renders none. |

## Best Practices

- **Do:** Use for row inspectors and entity detail views.
- **Do:** Derive isOpen from selection state; clear it in onOpenChange.
- **Do:** Use hasScrim={false} for non-modal master-detail flows (no focus trap, page stays interactive).
- **Do:** Keep last-selected content rendered on close (children stay mounted during exit).
- **Do:** Give every drawer a visible close action (DrawerHeader + onOpenChange); non-modal has no scrim.
- **Do:** Use purpose="form" when a stray scrim click would lose input.
- **Don't:** Use for confirmations or small forms; use Dialog instead.
- **Don't:** Use when content should push the page aside (it floats over) or as a bottom sheet (use BottomSheet).
- **Don't:** Nest Drawers: render as siblings; Escape closes the last-opened first.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the drawer is open. Fully controlled; pair with onOpenChange. **(required)** |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Called when the drawer requests an open-state change. Escape and a scrim click call it with false as purpose allows; a DrawerHeader given the same callback calls it from its close button. The caller owns the open state. With sibling drawers open, Escape only closes the last-opened one. **(required)** |
| `label` | `string` | - | Accessible label for the drawer. Required; the drawer has no built-in heading to derive a name from. **(required)** |
| `children` | `ReactNode` | - | Drawer content, rendered inside a full-height scrollable area. Compose your own header/body/footer; an element with data-autofocus is focused on open. Children stay mounted during the exit animation; keep the last-selected item rendered instead of nulling content on close. **(required)** |
| `side` | `'start' \| 'end'` | `'end'` | Edge the drawer slides from: 'end' is right in LTR (the inspector convention), 'start' is left. Inline axis only; for a bottom sheet use BottomSheet. |
| `width` | `number \| string` | `400` | Desktop width budget. A number is pixels; a string is any CSS length ('50%', '32rem'). Below the 640px mobile breakpoint this remains the maximum while the drawer preserves a 56px reveal of the page behind. |
| `experimental` | `{isFullWidthOnMobile?: boolean}` | - | Experimental options: anything in this object may change or be removed in a patch release, and omitting it keeps the stable behavior. isFullWidthOnMobile (default false) covers the full viewport width below the 640px mobile breakpoint instead of preserving the default 56px reveal of the page behind, which makes the drawer read as an overlay, not a navigation. **(experimental)** |
| `hasScrim` | `boolean` | `true` | Modal scrim behind the drawer. true uses showModal() (top layer, focus trap, scroll lock; clicking the scrim closes unless purpose prevents it; modal only); false uses the manual Popover API for a non-modal top-layer overlay that does NOT trap focus and keeps the page behind interactive. |
| `purpose` | `'required' \| 'form' \| 'info'` | `'info'` | Configures implicit dismissal, matching Dialog. info: Escape and a scrim click close. form: Escape closes, a scrim click does not. required: neither closes (Escape is consumed) and a modal drawer is exposed as an alertdialog, so give its content a way out. A non-modal drawer has no scrim, so form and info behave the same. |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Internal padding of the drawer content using the spacing scale, matching Dialog. When omitted, uses the theme default for drawers: --spacing-4 (16px) unless the theme sets padding on drawer. Pass 0 for a full-bleed content area. A lone Section child escapes the padding, bleed children such as Table and Divider compensate against it, and a Layout picks it up for its regions. The content area's block-end edge adds the home-indicator safe area on top in every mode. |

## Examples

### Basic

```tsx
const [isOpen, setIsOpen] = useState(false);
<>
  <Button label="Open drawer" onClick={() => setIsOpen(true)} />
  <Drawer
    isOpen={isOpen}
    onOpenChange={setIsOpen}
    label="Details"
    width={360}>
    <Layout
      header={<DrawerHeader title="Details" onOpenChange={setIsOpen} />}
      content={
        <LayoutContent>
          <Text type="body">Close with Escape, the scrim, or the close button.</Text>
        </LayoutContent>
      }
    />
  </Drawer>
</>
// Modal by default: the scrim dims the page and focus is trapped. Escape, a
// scrim click, or the header's close button closes it, and focus returns to
// the trigger.
```

### Modal or non-modal (hasScrim)

```tsx
const [openModal, setOpenModal] = useState(false);
const [openPanel, setOpenPanel] = useState(false);
<>
  {/* Modal (default): the scrim dims the page, focus is trapped, and a
      scrim click closes. */}
  <Drawer isOpen={openModal} onOpenChange={setOpenModal} label="Edit details">
    <EditForm />
  </Drawer>
  {/* Non-modal: no scrim, no focus trap; the page behind stays interactive.
      With no scrim to click, the header's close button is the visible exit. */}
  <Drawer
    isOpen={openPanel}
    onOpenChange={setOpenPanel}
    label="Details"
    hasScrim={false}>
    <Layout
      header={<DrawerHeader title="Details" onOpenChange={setOpenPanel} />}
      content={<LayoutContent><DetailsPanel /></LayoutContent>}
    />
  </Drawer>
</>
```

### Edit form with footer actions

```tsx
const [isOpen, setIsOpen] = useState(false);
<Drawer
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Edit host"
  purpose="form">
  <Layout
    header={<DrawerHeader title="Edit host" onOpenChange={setIsOpen} />}
    content={<LayoutContent><HostFields /></LayoutContent>}
    footer={
      <LayoutFooter>
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="secondary" onClick={() => setIsOpen(false)} />
          <Button label="Save" variant="primary" onClick={save} />
        </HStack>
      </LayoutFooter>
    }
  />
</Drawer>
// purpose="form" keeps Escape but ignores scrim clicks, so a stray click
// outside does not discard edits. The footer stays pinned while the fields
// scroll.
```

### Slide in from the start edge

```tsx
const [isOpen, setIsOpen] = useState(false);
<Drawer
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Navigation"
  side="start">
  <NavPanel />
</Drawer>
// 'start' is left in LTR and mirrors under RTL; 'end' (the default) is the
// inspector convention.
```

### Width budget: pixels or any CSS length

```tsx
const [isOpen, setIsOpen] = useState(false);
<Drawer
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Details"
  width="50%">
  <DetailsPanel />
</Drawer>
// A number is pixels (width={320}); a string is any CSS length ('32rem',
// '50%'). The budget also caps the drawer on mobile.
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-drawer` | `data-side` | side | - |
| `cui-drawer-header` | - | - | - |
| `cui-drawer-header-start-content` | - | - | - |
| `cui-drawer-header-title-block` | - | - | - |
| `cui-drawer-header-end-content` | - | - | - |
| `cui-drawer-header-close-icon` | - | - | - |

Override in defineTheme:
```ts
components: {
  'drawer': {
    base: { /* CSS properties */ },
    'side:value': { /* variant-specific */ },
  },
  'drawer-header': {
    base: { /* CSS properties */ },
  },
}
```
