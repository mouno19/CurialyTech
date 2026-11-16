package: @astryxdesign/core

# ComplexSelector

Use when a selection needs richer custom content than a Selector row. One component: it owns field, trigger, popover, focus restore, and changeAction; the render prop owns the selector-specific accessible structure.

**Import:** `import {ComplexSelector} from '@astryxdesign/core/ComplexSelector';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Field | Yes | Field shell that provides the label and optional supporting field content. |
| Trigger | Yes | Control that displays the current value or placeholder and opens the popup. |
| Icon-rendered start icon | No | Optional leading semantic icon or icon component rendered through Icon. |
| Caller-rendered start content | No | Optional arbitrary React content rendered directly at the start of the trigger. |
| Indicator icon | No | Trailing chevron shown when status presentation does not replace it; rotates to reflect whether the popup is open. |
| Popup | Yes | Mounted dialog surface that is painted and shown while open and hidden while closed. |

## Best Practices

- **Do:** Use variant="ghost" with a startIcon for a toolbar trigger. Use alignment="end" when a wide surface should align its end edge to the trigger.
- **Do:** For staged editors, keep draft state in the composed content and call the provided onChange helper only from Apply. Cancel or dismiss without committing.
- **Do:** Compose content from the right accessible structure: RadioList for a simple choice, Calendar/date inputs for dates, TreeList or a searchable list for hierarchy, a custom grid for 2D arrow navigation.
- **Do:** Use the onChange helper from children; it calls both onChange and changeAction and updates optimistic busy state.
- **Do:** Call close() from custom content when a selection should dismiss the popup. Keep it open for multi-step or freeform flows.
- **Do:** Use Astryx focus hooks: useGridFocus for 2D grids, useTreeFocus via TreeList for hierarchies, useListFocus for custom linear collections.
- **Do:** Evaluate custom content against WCAG 2.2: keyboard operation, focus visible/not obscured, names and roles, labels/instructions, target size, and contrast.
- **Don't:** Do not rebuild trigger ARIA, popover focus management, or changeAction handling in product code.
- **Don't:** Do not use ComplexSelector for a plain single-column text list; use Selector instead.
- **Don't:** Wrap a disabled ComplexSelector in Tooltip to explain why it is disabled; the text would not describe the trigger. Use the disabledMessage prop instead.

## Components

### ComplexSelector

An input or toolbar trigger and dialog-popover shell for custom selector content.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text for accessibility and the field label. **(required)** |
| `value` | `Value` | - | Current controlled value. **(required)** |
| `onChange` | `(value: Value) => void` | - | Called when custom content commits a new value. |
| `changeAction` | `(value: Value) => void \| Promise<void>` | - | Async action after onChange. ComplexSelector exposes optimistic value and busy state while pending. |
| `children` | `(value: Value, onChange: (value: Value) => void, close: () => void, state: ComplexSelectorRenderState) => ReactNode` | - | Custom dialog content. Receives positional value, onChange, close, and state helpers. **(required)** |
| `triggerLabel` | `ReactNode` | - | Label/content shown in the closed trigger. |
| `placeholder` | `ReactNode` | `'Select...'` | Placeholder shown when triggerLabel is omitted. |
| `isDisabled` | `boolean` | - | Disables the selector. |
| `disabledMessage` | `string` | - | Explains why the selector is disabled. With isDisabled, shows the reason in a tooltip on hover and keyboard focus, and the reason describes the trigger through aria-describedby. The disabled trigger keeps its tab stop and still cannot open. Works with renderTrigger too: the tooltip and the description go to the control you render; drop the tooltip of that control while disabled, for example tooltip={isDisabled ? undefined : 'Filter'}. Use this instead of wrapping a disabled ComplexSelector in Tooltip, whose text would not describe the trigger. |
| `isLoading` | `boolean` | - | Shows loading state on the trigger. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Validation status. |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached' for input selectors; 'detached' for secondary and ghost selectors` | How the status message is placed relative to the input. attached overlaps directly below the input (bordered treatment; detached when variant is secondary or ghost); detached floats below as a separate element with spacing; tooltip reveals the message in an info-tip button. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Exact trigger height: sm 28px, md 32px, or lg 36px. |
| `variant` | `'input' \| 'secondary' \| 'ghost'` | `'input'` | Visual trigger style. Input is the bordered form treatment; secondary matches the secondary buttons of the active theme (borderless and neutral-filled by default); ghost is borderless and transparent to match ghost buttons. |
| `startIcon` | `ReactNode \| IconType` | - | Icon displayed at the start of the trigger. |
| `width` | `SizeValue` | - | Width of the field. |
| `placement` | `'above' \| 'below' \| 'start' \| 'end'` | `'below'` | Popup placement. |
| `alignment` | `'start' \| 'center' \| 'end'` | `'start'` | Popup alignment along the placement axis. |
| `renderTrigger` | `(props: ComplexSelectorRenderTriggerProps) => ReactNode` | - | Render the control the popup hangs off — a glyph in a list row, a chip, an icon button — instead of the selector's own field and button. Spread the given props ({ref, id, onClick, onKeyDown, role, aria-haspopup, aria-expanded, aria-controls, aria-busy, aria-required, aria-disabled}) onto it: the control becomes the selector's combobox field, the popup is anchored to it and still labelled by `label`, and a disabled control keeps its tab stop but does not open. The field chrome is not rendered. Pair with handleRef to open from a keystroke elsewhere. |
| `handleRef` | `React.Ref<ComplexSelectorHandle>` | - | Imperative handle for programmatic control. Exposes open(), close(), toggle(), and isOpen(). |
| `onOpenChange` | `(isOpen: boolean) => void` | - | Called whenever the surface opens or closes, however it happened — trigger, keyboard, light dismiss, Escape, close(), or the imperative handle. |
| `contentXstyle` | `StyleXStyles` | - | StyleX styles for the popup content container. |
| `onClick` | `(event: MouseEvent) => void` | - | Click handler on the trigger. Runs before the popup opens; call preventDefault() to keep it closed. A press elsewhere in the control box goes through the trigger too. With renderTrigger it runs after the built-in toggle and cannot cancel it. |
| `onKeyDown` | `(event: KeyboardEvent) => void` | - | Key handler on the trigger. Runs after the built-in handling and receives every key, including the ArrowDown that opens the popup. With renderTrigger it is skipped for keys the built-in handling cancels. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container (label, control, and status together). No effect inside InputGroup (style the InputGroup instead) or in a `horizontal-labels` FormLayout. Root `xstyle`, `className`, and `style` are not accepted. |
| `containerClassName` | `string` | - | Class name for the field container. Same targeting as `containerXstyle`. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. Same targeting as `containerXstyle`. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box: the element that paints the border and background and holds the value, icons, and end controls. Never the trigger button itself. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-complex-selector` | `data-variant`, `data-size`, `data-status` | input, secondary, ghost | - |
| `astryx-complex-selector-indicator-icon` | `data-state` | - | state |
| `astryx-complex-selector-popup` | - | - | - |

Override in defineTheme:
```ts
components: {
  'complex-selector': {
    base: { /* CSS properties */ },
    'variant:value': { /* variant-specific */ },
  },
  'complex-selector-indicator-icon': {
    base: { /* CSS properties */ },
    'state': { /* state-specific */ },
  },
}
```
