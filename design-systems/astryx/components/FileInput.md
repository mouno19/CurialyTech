package: @astryxdesign/core

# FileInput

FileInput provides file upload with optional drag-and-drop support. Use it for single or multiple file selection with built-in validation for file type, size, and count.

**Import:** `import {FileInput} from '@astryxdesign/core/FileInput';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Label | Yes | Text that identifies the field. Always rendered for accessibility even when visually hidden. |
| Description | No | Helper text between the label and the drop zone explaining accepted formats or size limits. |
| Drop zone | Yes | The clickable area for file selection. In dropzone mode, also accepts dragged files. |
| Upload icon | No | An upload-to-tray icon in the drop zone hinting at the upload action. |
| Placeholder | No | Hint text shown when no files are selected. |
| File name display | No | Shows the name(s) of selected files. |
| Clear button | No | A close button that removes selected files and returns focus to the file-selection trigger. |
| Spinner | No | Loading indicator that appears during async upload actions. |
| Status message | No | Validation feedback showing error, warning, or success with a message. |

## Best Practices

- **Do:** Always specify an accept prop to guide users toward valid file types.
- **Do:** Use maxSize and maxFiles to prevent oversized uploads.
- **Do:** Add a description to communicate constraints.
- **Do:** Use changeAction for immediate upload workflows that benefit from optimistic UI.
- **Don't:** Don't use FileInput for directory uploads.
- **Don't:** Don't use mode='input' unless space is constrained; dropzone mode provides a better experience.
- **Don't:** Don't wrap a disabled FileInput in Tooltip to explain the disabled state; use the disabledMessage prop instead.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Accessible label for the file input. **(required)** |
| `value` | `File \| File[] \| null` | - | Currently selected file(s). Controlled. **(required)** |
| `onChange` | `(files: File \| File[] \| null) => void` | - | Fired when files are selected or removed. **(required)** |
| `changeAction` | `(files: File \| File[] \| null) => Promise<void>` | - | Async action after onChange. For immediate upload. |
| `accept` | `string` | - | Accepted file types (HTML accept format). |
| `isMultiple` | `boolean` | `false` | Allow multiple file selection. |
| `maxSize` | `number` | - | Max file size in bytes. Rejects oversized files. |
| `maxFiles` | `number` | - | Max file count (isMultiple only). |
| `isLabelHidden` | `boolean` | `false` | Visually hides label; keeps screen reader access. |
| `description` | `string` | - | Description text between label+input. |
| `isOptional` | `boolean` | `false` | Shows "Optional" indicator. |
| `isRequired` | `boolean` | `false` | Shows "Required" indicator+SR-only trigger description. |
| `isDisabled` | `boolean` | `false` | Disables input, prevents interaction. |
| `disabledMessage` | `string` | - | Explains why input is disabled. With isDisabled, shows tooltip on hover/focus + keeps trigger focusable via aria-disabled (opening picker stays blocked). Use instead of wrapping a disabled FileInput in Tooltip. |
| `isLoading` | `boolean` | `false` | Loading state w/ spinner+aria-busy. |
| `placeholder` | `string` | `"Choose file" or "Choose files"` | Placeholder when no files selected. |
| `mode` | `'input' \| 'dropzone'` | `'input'` | Visual mode: 'input' (compact) or 'dropzone' (drag-and-drop). |
| `status` | `{type: 'error' \| 'warning' \| 'success', message?: string}` | - | Validation status; colored border. Message floats below. |
| `statusVariant` | `'attached' \| 'detached' \| 'tooltip'` | `'attached' in input mode; 'detached' in dropzone mode` | How status message is placed: attached overlaps below input; detached floats below w/ spacing; tooltip hides the box and shows it on the status icon. Dropzone: attached unsupported; defaults to detached (explicit attached kept until next minor). |
| `labelTooltip` | `string` | - | Tooltip in info icon at label end. |
| `width` | `SizeValue` | - | Width of the field (number = pixels, string used as-is, e.g. "100%"). Sizes the whole field (label, control, and status) so they stay aligned. |
| `containerXstyle` | `StyleXStyles` | - | StyleX styles for the field container; no effect in InputGroup or horizontal-labels FormLayout. No root xstyle/className/style. |
| `containerClassName` | `string` | - | Class name for the field container. |
| `containerStyle` | `CSSProperties` | - | Inline styles for the field container. |
| `controlXstyle` | `StyleXStyles` | - | StyleX styles for the visual control box (border, background, icons); not the native input. |
| `controlClassName` | `string` | - | Class name for the visual control box. |
| `controlStyle` | `CSSProperties` | - | Inline styles for the visual control box. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-file-input` | `data-mode`, `data-status` | mode, status | - |
| `astryx-file-input-icon` | `data-mode` | mode | - |

Override in defineTheme:
```ts
components: {
  'file-input': {
    base: { /* CSS properties */ },
    'mode:value': { /* variant-specific */ },
  },
  'file-input-icon': {
    base: { /* CSS properties */ },
  },
}
```
