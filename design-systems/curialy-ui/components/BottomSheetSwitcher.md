package: @curialy/ui

# BottomSheetSwitcher

Deprecated: write each step as a standalone BottomSheet with isOpen driven by one state value; a same-update close and open from inside the open step is the same replace handoff. Still works: set activeSheet to a nested BottomSheet's sheetId to open or switch steps, and to null to close. A scrim flow stacks with standalone sheets as one level; a standalone sheet inside a step leaves when the step is left and returns with it while still open.

**Import:** `import {BottomSheetSwitcher} from '@curialy/ui/BottomSheet';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Sheet dialogs | Yes | One native dialog per child sheet, presented and closed by the switcher; the dialog hosting the active sheet carries the flow's ref, id, modality, and dismissal. |
| Sheet panels | Yes | Direct BottomSheet children; exactly one is interactive while a previous panel may remain visible and inert during a handoff. |
| Scrim | No | Native dialog backdrop shown by the default scrim-backed modal presentation; one sheet dialog paints it at a time, so a handoff never dims the page twice. |

## Best Practices

- **Do:** Prefer one standalone BottomSheet per step with one state value naming the open step; the replace handoff is the same and nothing has to be nested under a switcher.
- **Do:** Migrate an existing flow in place: replace activeSheet / onActiveSheetChange with one step value, give each step isOpen={step === id} and a guarded onOpenChange (clear the step only if it is still the open one) in place of sheetId, remove the wrapper and move its hasScrim onto every step. Map the other switcher props: onCancel becomes a guarded onOpenChange on each step (ignore false while the flow must stay open) — a standalone sheet reports Escape, the platform close, the scrim tap and the swipe all as onOpenChange(false) with no reason, so the guard holds the step against all of them while it applies, and a veto of Escape alone has no equivalent; the only per-path lever is purpose (form keeps Escape and blocks the scrim tap and the swipe; required blocks all three and exposes the step as an alertdialog). A consumer aria-label or aria-labelledby becomes each step label, which names its dialog. ref, id, data-testid, className, style, xstyle and the other dialog props have no dialog-level equivalent: a standalone sheet sends its ref and base props to the panel div and its dialog is implementation, so a test or anchor that needs the dialog queries the panel closest("dialog"), and dialog-level styling is dropped.
- **Don't:** Don't split information across sheets when people need to compare it; use a full-page layout that keeps the relevant content visible together instead.
- **Don't:** Don't use a step flow when multiple panels must stay interactive or visible together; a flow intentionally selects one interactive step.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `ref` | `Ref<HTMLDialogElement>` | - | Ref resolved to the native dialog hosting the flow: the active sheet's dialog, which changes to the next sheet's on a handoff; the exiting sheet's through its exit; and, while the flow is closed, the dialog that hosted it last (or the first mounted sheet's). It is never null while a sheet is mounted, from the first commit on. id and data-testid render on this dialog only: a flow that mounts open carries them on the active sheet's dialog in server markup too; a flow that mounts closed carries them from the first commit's synchronous re-render on, and its server markup carries them on no element. Other dialog props apply to every sheet dialog. |
| `onCancel` | `(event: SyntheticEvent<HTMLDialogElement>) => void` | - | Called before the switcher handles a native cancel request (Escape or the platform close). Attached to every sheet dialog; the browser raises cancel on the dialog it is presenting, the active sheet's. Calling preventDefault() keeps the controlled flow open. |
| `activeSheet` | `string \| null` | - | ID of the interactive BottomSheet, or null when the flow should close. Match a nested BottomSheet's unique sheetId; the previous sheet may remain visually present and inert while the new sheet enters, simultaneously align downward behind a shorter step, then fade away. **(required)** |
| `onActiveSheetChange` | `(activeSheet: string \| null) => void` | - | Called with null when the active sheet dismisses according to its purpose. Child BottomSheets may use purpose='form' or purpose='required' to limit implicit dismissal while flow controls can still use the same state setter to switch sheets or close the flow. **(required)** |
| `hasScrim` | `boolean` | `true` | Whether the sheet dialogs are modal. true presents each sheet with showModal() for a native ::backdrop, native focus containment, one body scroll lock held for the whole flow, and click-to-dismiss when the active BottomSheet has purpose='info'; only one backdrop paints at a time. false uses show() with no backdrop and leaves the page interactive; avoid transformed, contained, or clipping ancestors because a non-modal dialog remains in its containing context. |
| `children` | `ReactNode` | - | BottomSheets identified by unique sheetId values. **(required)** |

## Examples

### Replacement: the same three-step flow as standalone sheets

```tsx
const [step, setStep] = useState(null);

<>
  <Button label="Start" onClick={() => setStep('details')} />
  <BottomSheet isOpen={step === 'details'} onOpenChange={o => !o && setStep(c => (c === 'details' ? null : c))} label="Details" height="hug">
    <SetupDetails />
    <Button label="Continue" onClick={() => setStep('preferences')} />
  </BottomSheet>
  <BottomSheet isOpen={step === 'preferences'} onOpenChange={o => !o && setStep(c => (c === 'preferences' ? null : c))} label="Preferences" height="hug">
    <Preferences />
    <Button label="Back" onClick={() => setStep('details')} />
    <Button label="Continue" onClick={() => setStep('confirm')} />
  </BottomSheet>
  <BottomSheet isOpen={step === 'confirm'} onOpenChange={o => !o && setStep(c => (c === 'confirm' ? null : c))} label="Confirm" height="hug">
    <Confirmation />
    <Button label="Back" onClick={() => setStep('preferences')} />
    <Button label="Done" onClick={() => setStep(null)} />
  </BottomSheet>
</>
```
