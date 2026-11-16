package: @astryxdesign/core

# BottomSheet

Mobile touch surface for filters, actions, forms, and detail views that should rise from the bottom of the viewport; for a multi-step flow give each step its own sheet and one state value naming the open step: a same-update close and open is a replace handoff (entering sheet above, retained sheet aligns then fades, one steady scrim, focus back to the flow's opener on close). Open a sheet over another to stack: each sheet keeps its own isOpen, the top sheet is the most recently opened one, the covered sheet recedes and is blocked, one scrim dims the page, and dismissal pops only the top sheet. Sheets rendered in a closing sheet's content leave with it (their isOpen stays yours; they return with the host while still open); siblings above it stay open.

**Import:** `import {BottomSheet} from '@astryxdesign/core/BottomSheet';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Sheet panel | Yes | Painted surface that rises from the bottom edge and contains the sheet. |
| Content area | Yes | Padded, scrollable container that presents the caller-provided sheet content. |
| Handle | Yes | Decorative grab affordance and drag region at the top of the panel. |
| Scrim | No | Backdrop that dims and blocks the page in a scrim-backed presentation. |

## Best Practices

- **Do:** Use for mobile-first surfaces (filters, share sheets, quick actions) where the content should rise from the bottom edge.
- **Do:** Pick the starting height that fits the content: 'hug' for short bounded content, 'capped' for lists, and 'tall' for forms or streaming/resizing content.
- **Do:** Use purpose='form' to protect entered data from scrim clicks and swipes while keeping Escape available; reserve purpose='required' for flows that must end through an explicit action.
- **Don't:** Don't make the sheet content overly long. Break it into steps, each its own sheet, with one state value naming the open step; moving on replaces one with the next.
- **Don't:** Don't stack more than two or three sheets; replace steps (close one, open the next in one update) when they need not stay visible.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether a standalone sheet is open. Fully controlled; pair with onOpenChange. Omitted only inside the deprecated BottomSheetSwitcher, which drives its steps itself. |
| `onOpenChange` | `(isOpen: boolean) => void` | - | For a standalone sheet, called when it requests an open-state change. Automatic calls follow purpose: info dismisses on Escape, scrim click, or swipe; form dismisses on Escape only; required never dismisses implicitly. Omitted only inside the deprecated BottomSheetSwitcher, which drives its steps itself. |
| `finalFocusRef` | `RefObject<HTMLElement \| null>` | - | Optional explicit focus-return target for a standalone sheet. Use when the opener can remount or the active element is not a reliable trigger, such as an adaptive presentation switch. Always focused when the sheet closes on its own or last; when a modal sheet is still open beneath, focus returns into that sheet (to this element if it is inside it, else the revealed panel). Omitted only inside the deprecated BottomSheetSwitcher, which drives its steps itself. |
| `purpose` | `'required' \| 'form' \| 'info'` | `'info'` | Controls implicit dismissal behavior, matching Dialog. info allows Escape, scrim click, and swipe-to-dismiss. form protects entered data by blocking scrim click and swipe while allowing Escape. required blocks every implicit dismissal path and uses role='alertdialog'. Explicit controls may still update the controlled state. Works for standalone and BottomSheetSwitcher-managed sheets. |
| `sheetId` | `string` | - | Deprecated with BottomSheetSwitcher: give each step its own standalone sheet with isOpen instead. Still works as released: the unique ID of this sheet inside a BottomSheetSwitcher, which opens it when activeSheet matches; omit isOpen and onOpenChange when sheetId is used. |
| `label` | `string` | - | Accessible label for the sheet. Required; the sheet has no built-in heading to derive a name from. **(required)** |
| `children` | `ReactNode` | - | Sheet content in a scrollable area. The named body is keyboard reachable while overflowing. Forward Tab entry may move directly to the first native link or button; input controls, composite widgets, and nested scroll areas retain the body stop. Shift+Tab from a delegated first child skips the body. Fitting content adds no body stop. The internal observed content box preserves block flow and percentage heights. If it includes a text-entry control that can bring up the mobile keyboard, use height='tall' and keep the sheet fully expanded while editing. **(required)** |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | - | Internal padding of the sheet content using the spacing scale, matching Dialog. When omitted, uses the theme default for bottom sheets (--spacing-4 unless the theme sets padding on bottom-sheet). A lone Section child escapes the padding, and bleed children such as Table and Divider compensate against it. Use 0 for edge-to-edge content that supplies its own inset. Whatever the padding, the block-start inset is never less than the grab bar's height (--spacing-6), so resting content starts below the bar. |
| `height` | `'hug' \| 'capped' \| 'tall' \| number \| string` | `'capped'` | How tall the sheet is. Named budgets: 'hug' fits its content up to 92% of the viewport, 'capped' is a scrolling mid-height panel (~62%), and 'tall' is a pinned near-full panel (~92%) for content that streams in. Or pass a number (px) / CSS length for a custom budget. Give snapPoints to let the user drag between heights. On shorter viewports the sheet fills the available height. Only a fully expanded 'tall' sheet provides mobile-keyboard accommodation: it stays put and scrolls each focused control above the keyboard. Hug, Capped, numeric and CSS-length heights never do, and a Tall sheet stops doing it the moment the user drags it to a shorter detent, resuming when they drag it back. Outside that state the sheet neither moves nor adds keyboard scroll space, and the browser's own focus reveal is left in place; on iOS that reveal can shift the whole page. This accommodation applies where the visual viewport shrinks for the keyboard, as in Safari on iOS, Firefox for Android and Chrome on Android, where the sheet places the focused control just above the keyboard as it comes up, and the control rides the rest of Gboard’s slide up, and the slide down after it loses focus; a hide Chrome reports late, such as Back, rides down from Chrome’s report (`astryx docs browser-support`). |
| `snapPoints` | `ReadonlyArray<number \| string>` | - | Extra heights the sheet can rest at when dragged; its own height is always the tallest stop, and omitting this gives a sheet that only opens and closes. Each stop is the sheet's visible height: a number is a viewport fraction (0.5 is half the screen), '50%' the same in CSS, '320px' an absolute length. A stop of a quarter of the sheet or less is a peek: it slides away instead of reflowing, and thins the scrim. |
| `hasScrim` | `boolean` | `true` | For a standalone BottomSheet, whether to render a scrim, the semi-transparent overlay that covers and blocks the background. true (default) uses showModal(): top layer, native focus containment, ::backdrop scrim, body scroll lock, and tap-scrim-to-dismiss when purpose='info', with the background inert. A scrim sheet also takes part in stacking (see Stacking below). false presents the sheet in the top layer as a manual popover (below the Popover API support floor, show() in page stacking order as a reduced fallback) with no scrim, no focus trap and no scroll lock, leaving the page behind interactive and scrollable; a no-scrim sheet neither stacks nor is stacked on, but no-scrim steps replace each other with the same handoff. A no-scrim sheet shown while a modal (a scrim sheet or a Dialog) that does not contain it is open is inert under that modal and stays beneath it (show(), no page-level z-index) until that modal has gone, then enters the top layer; a modal mid-exit counts as gone, and rendered inside the modal the sheet enters the top layer at once. In a multi-step flow, set hasScrim the same on every step. |

## Examples

### Basic

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Filters">
  <FilterControls />
</BottomSheet>
```

### Tall sheet (a list)

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Nearby places"
  height="tall">
  <PlaceList />
</BottomSheet>
```

### Collapsible to half the screen

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Nearby places"
  height="tall"
  snapPoints={[0.5]}>
  <PlaceList />
</BottomSheet>
```

### A peek, a working height, and full

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Route"
  height="tall"
  snapPoints={['96px', '50%']}>
  <RouteDetails />
</BottomSheet>
```

### Hug height (fits content)

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Share"
  height="hug">
  <ShareActions />
</BottomSheet>
```

### Long scrolling content

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Release notes"
  height="hug">
  <ReleaseNotes />
</BottomSheet>
```

### Multi-step flow (one sheet at a time, each step replaces the last)

```tsx
// One value names the open step. Moving on closes one sheet and opens the
// next in the same update: the next step rises above the current one, which
// fades once it has arrived. A dismissed step closes the flow.
const [step, setStep] = useState(null);
const stepProps = own => ({
  isOpen: step === own,
  onOpenChange: isOpen => !isOpen && setStep(current => (current === own ? null : current)),
});
<>
  <Button label="Start" onClick={() => setStep('details')} />
  <BottomSheet {...stepProps('details')} label="Details">
    <Button label="Continue" onClick={() => setStep('confirm')} />
  </BottomSheet>
  <BottomSheet {...stepProps('confirm')} label="Confirm">
    <Button label="Back" onClick={() => setStep('details')} />
    <Button label="Done" onClick={() => setStep(null)} />
  </BottomSheet>
</>
```

### Stacked sheets (drill-in: list, order, edit)

```tsx
const [isListOpen, setIsListOpen] = useState(false);
const [orderId, setOrderId] = useState(null);
const [isEditing, setIsEditing] = useState(false);
const closeAll = () => {
  setIsListOpen(false);
  setOrderId(null);
  setIsEditing(false);
};
<>
  <Button label="Orders" onClick={() => setIsListOpen(true)} />
  <BottomSheet isOpen={isListOpen} onOpenChange={setIsListOpen} label="Orders">
    {orders.map(order => (
      <Button key={order.id} label={order.title} onClick={() => setOrderId(order.id)} />
    ))}
  </BottomSheet>
  {/* Opens over the list; the list recedes and stays mounted. */}
  <BottomSheet
    isOpen={orderId != null}
    onOpenChange={open => !open && setOrderId(null)}
    label="Order">
    <Button label="Edit" onClick={() => setIsEditing(true)} />
    <Button label="Close all" onClick={closeAll} />
  </BottomSheet>
  <BottomSheet isOpen={isEditing} onOpenChange={setIsEditing} label="Edit order">
    <Button label="Save" onClick={() => setIsEditing(false)} />
  </BottomSheet>
</>
```

### Detail sheet inside the list sheet that opens it

```tsx
function PlaceRow({place}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button label={place.name} onClick={() => setIsOpen(true)} />
      {/* Rendered in the list sheet's content: stacks above it, leaves with it, and comes back with it while still open. */}
      <BottomSheet isOpen={isOpen} onOpenChange={setIsOpen} label={place.name}>
        <PlaceDetail place={place} />
      </BottomSheet>
    </>
  );
}

<BottomSheet isOpen={isListOpen} onOpenChange={setIsListOpen} label="Places">
  {places.map(place => <PlaceRow key={place.id} place={place} />)}
</BottomSheet>
```

### Deep link into a stack (several sheets open in one update)

```tsx
// From a URL: list, order and editor open together. With no open order
// between them, tree order decides: the list is at the bottom, the editor on top.
const [isListOpen, setIsListOpen] = useState(() => route.list);
const [orderId, setOrderId] = useState(() => route.orderId);
const [isEditing, setIsEditing] = useState(() => route.edit);
<>
  <BottomSheet isOpen={isListOpen} onOpenChange={setIsListOpen} label="Orders">…</BottomSheet>
  <BottomSheet isOpen={orderId != null} onOpenChange={open => !open && setOrderId(null)} label="Order">…</BottomSheet>
  <BottomSheet isOpen={isEditing} onOpenChange={setIsEditing} label="Edit order">…</BottomSheet>
</>
```

### Mobile keyboard

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Add a comment"
  height="tall">
  <LongCommentForm />
</BottomSheet>
```

### No scrim

```tsx
const [isOpen, setIsOpen] = useState(true);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  label="Nearby places"
  hasScrim={false}>
  <PlaceList />
</BottomSheet>
```

### Protect form input

```tsx
const [isOpen, setIsOpen] = useState(false);
<BottomSheet
  isOpen={isOpen}
  onOpenChange={setIsOpen}
  purpose="form"
  label="Edit profile">
  <ProfileForm onSave={() => setIsOpen(false)} />
</BottomSheet>
```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-bottom-sheet` | - | - | - |

Override in defineTheme:
```ts
components: {
  'bottom-sheet': {
    base: { /* CSS properties */ },
  },
}
```
