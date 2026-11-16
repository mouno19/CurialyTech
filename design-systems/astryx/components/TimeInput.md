package: @astryxdesign/core

# TimeInput

TimeInput uses a browser/OS picker on coarse pointers by default and Astryx typed entry on fine pointers. It standardizes values and supports arrow-key adjustment on the typed surface.

**Import:** `import {TimeInput} from '@astryxdesign/core/TimeInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Clock icon | No | A leading clock icon that identifies the field and opens the browser/OS picker in native mode. |
| Time control | Yes | A real input type=time in native modes, or Astryx's editable text field for fine pointers, presentation="text-input", seconds, and custom increments. |
| Clear button | No | A trailing button to reset the value, shown when hasClear is true and a value is set. |
| Status icon | No | A trailing icon indicating error, warning, or success state. |
| Spinner | No | Replaces trailing content during loading to show an async action is in progress. |

## Best Practices

- **Do:** Base props such as ref, id, data-*, aria-*, and DOM event handlers go to the time input, the element that is focused and announced. A DOM handler runs after TimeInput's own handler for the same event and still receives events it handled (including ones it called preventDefault on), so it cannot cancel built-in behavior.
- **Do:** Leave hourFormat unset to follow the provider locale's hour cycle; put a person's 12/24h preference on the locale tag (en-US-u-hc-h23), not on each field.
- **Do:** Set min/max constraints for valid ranges like business hours.
- **Do:** Provide description or placeholder hinting at expected format.
- **Do:** Use status prop for inline validation errors.
- **Do:** Enable hasClear for optional fields.
- **Do:** Place inside InputGroup for a single-line prefix or suffix addon, like a label or timezone marker.
- **Don't:** Don't use for date-and-time; pair with DateInput instead.
- **Don't:** Don't hide the label; keep it visible for clarity.
- **Don't:** Don't wrap a disabled TimeInput in Tooltip; use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text (required for a11y). **(required)** |
| `isLabelHidden` | `boolean` | `false` | Visually hides label; keeps screen reader access. |
| `description` | `string` | - | Description text between label+input. |
| `isOptional` | `boolean` | `false` | Shows "(optional)" indicator. Mutually exclusive w/ isRequired. |
| `isRequired` | `boolean` | `false` | Marks required+sets aria-required. Mutually exclusive w/ isOptional. |
| `isDisabled` | `boolean` | `false` | Disables input, suppresses interactions. |
| `disabledMessage` | `string` | - | Reason shown in a tooltip on hover/focus when disabled; describes the input. |
| `value` | `ISOTimeString` | - | Controlled time in ISO format (HH:MM or HH:MM:SS). |
| `onChange` | `(value: ISOTimeString \| undefined) => void` | - | Fired on time change. Receives undefined when cleared. |
| `changeAction` | `(value: ISOTimeString \| undefined) => void \| Promise<void>` | - | Async action after onChange in React transition; triggers spinner while pending. |
| `isLoading` | `boolean` | `false` | Loading state w/ spinner. |
| `min` | `ISOTimeString` | - | Min selectable time in ISO format. Out-of-range rejected. |
| `max` | `ISOTimeString` | - | Max selectable time in ISO format. Out-of-range rejected. |
| `hasSeconds` | `boolean` | `false` | Includes seconds in display+parsing. |
| `hasClear` | `boolean` | `false` | Shows clear button when value set+not disabled. |
| `hourFormat` | `'12h' \| '24h'` | `the locale's hour cycle` | Display format. '12h' shows the locale's day period; '24h' uses 24-hour notation. Unset follows the provider locale's hour cycle (a -u-hc- tag carries a user preference). |
| `increment` | `number` | `1` | Minutes to add/subtract on arrow up/down. Whole minutes only; a fractional value leaves the time unchanged. |
| `presentation` | `'text-input' \| 'popover' \| 'bottom-sheet' \| 'native' \| 'adaptive-bottom-sheet' \| 'adaptive-native'` | `'adaptive-native'` | picker surface: 'adaptive-native' (default) = typed field fine / browser/OS coarse (hasSeconds or increment!=1 retains typed); 'native' = browser/OS always, no fallback; 'adaptive-bottom-sheet' = typed fine / Astryx wheel sheet coarse; 'bottom-sheet' = sheet always; 'text-input'/'popover' = typed field only. |
| `nativePicker` | `'touch' \| 'always' \| 'never'` | `'touch'` | deprecated, use presentation: 'touch'='adaptive-native', 'always'='native', 'never'='text-input'. still works as released; presentation wins if both set. |
| `placeholder` | `string` | `'Select a time'` | Placeholder when empty. Focused+empty shows format hint. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Input element height. |
| `status` | `{type: 'warning' \| 'error' \| 'success', message?: string}` | - | Colored border+icon. Message rendered below input. A rejected typed time or native edit outside min/max shows its own error instead; an error status w/ message wins (rejection still announced); warning/success never hide a rejection. |
| `onEntryErrorChange` | `(error: {kind: 'unreadable' \| 'outOfRange', text: string, value?: ISOTimeString} \| null) => void` | - | (error\|null) on each typed-rejection change: kind 'unreadable'\|'outOfRange' (min/max), text, value (ISO time, outOfRange); shows when the typed time is complete (12h: day period unless hour 0/13-23) or at Enter/blur under complete, only at Enter/blur under blur-or-enter, text kept; also on new min/max/value, disable; never twice for one rejection; null on unmount mid-rejection; never on native/sheet |
| `entryErrorBehavior` | `'complete' \| 'blur-or-enter'` | `the nearest FormLayout's defaultEntryErrorBehavior, else 'complete'` | 'complete'\|'blur-or-enter': when the field's own rejection shows (not when validation runs; not React Aria validationBehavior; never changes status). complete: complete out-of-range typed time and native out-of-range edit at once, other text at Enter/blur. blur-or-enter: message, aria-invalid, styling, announcement and onEntryErrorChange report all wait for Enter/blur. Accepted or emptied entry clears at once; still-wrong edit keeps a shown error (blur-or-enter). Default: nearest FormLayout defaultEntryErrorBehavior, else complete |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached'` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. |
| `labelTooltip` | `string` | - | Tooltip as info icon at label row end. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | Field box (label+control+status); also containerClassName/containerStyle. no effect in InputGroup or horizontal-labels FormLayout |
| `controlXstyle` | `StyleXStyles` | - | visual control box (border/bg/icons), never the native input; also controlClassName/controlStyle. no root xstyle/className/style |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-time-input` | `data-size`, `data-status`, `data-disabled` | size, status | disabled |

Override in defineTheme:
```ts
components: {
  'time-input': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
    'disabled': { /* state-specific */ },
  },
}
```
