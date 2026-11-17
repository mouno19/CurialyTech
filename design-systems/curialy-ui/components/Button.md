package: @curialy/ui

# Button

Button triggers an action when clicked. Use for form submissions, confirmations, navigation, or any interaction needing a clear CTA.

**Import:** `import {Button} from '@curialy/ui/Button';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Icon | No | A leading icon that reinforces the label, like a trash icon on a Delete button. |
| Label | Yes | The visible text describing the action. Also used as the accessible name. |
| End content | No | A trailing badge or icon after the label, like a notification count or dropdown arrow. |
| Spinner | No | Replaces the icon during loading to show the action is in progress. |

## Best Practices

- **Do:** Primary for the single most important action. Secondary or ghost for the rest.
- **Do:** Labels that describe the action: "Save changes" not "OK" or "Click here".
- **Do:** Show loading state for async actions so the user knows it is working.
- **Do:** Icon-only buttons need a label for screen readers and a tooltip for sighted users.
- **Do:** For dedicated icon-only buttons, use IconButton from @curialy/ui/IconButton. Separate component, not exported from @curialy/ui/Button.
- **Don't:** Multiple primary buttons in one view; dilutes hierarchy.
- **Don't:** Destructive without confirmation for irreversible actions.
- **Don't:** Button for navigation; use a link if it only takes the user to another page.
- **Don't:** xstyle or className on ::before: under a coarse primary pointer it is the touch press layer while a press is on or fading (z-index -1, opacity animated); nothing at rest.

## Accessibility

- **Text label:** Button text must have at least 4.5:1 contrast with the button background in every state. For Hover and Pointer down, measure the final background after the overlay is applied.
- **Essential icon or spinner arc:** An icon used instead of text must have at least 3:1 contrast with the button background. The moving spinner arc must also meet 3:1. An icon beside a visible label does not need its own check.
- **Badge text:** Badge text inside a button must have at least 4.5:1 contrast with the Badge background. Check all 14 built-in Badge colors in Rest, Hover, and Pointer down on page and surface backgrounds. This covers 336 pairs per mode. Check custom end content separately.
- **Visible control boundary:** The button edge needs 3:1 contrast only when users need it to see the control. A text-only button can rely on its label.
- **Keyboard focus indicator:** The focus outline needs at least 3:1 contrast with the area around the button. Check every style. Destructive buttons use a red outline.
- **Disabled appearance:** Disabled controls do not need to meet these contrast ratios.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | accessible label; visible text by default, aria-label when isIconOnly **(required)** |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'destructive'` | `'secondary'` | visual style variant |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | size variant |
| `elevation` | `'none' \| 'low' \| 'med' \| 'high'` | `'none'` | resting shadow depth for floating buttons/FABs: none\|low\|med\|high; ignored inside ButtonGroup |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | HTML button type; defaults to "button" |
| `name` | `string` | - | HTML name for form submission |
| `value` | `string \| number \| readonly string[]` | - | HTML value for form submission |
| `form` | `string` | - | associates button with form element by ID |
| `isLoading` | `boolean` | `false` | shows spinner, blocks re-activation but stays focusable (aria-disabled, not native disabled); announces via live region |
| `isInterruptible` | `boolean` | `false` | Keep the button clickable while a clickAction is pending: the spinner and aria-busy still show, but the button is not disabled and the action is not deduped, so a re-click lands and interrupts the in-flight action with a fresh one. |
| `isDisabled` | `boolean` | `false` | disables button; uses aria-disabled instead of native disabled |
| `icon` | `ReactNode` | - | icon element rendered before label text; unsized Curialy UI Icon defaults to sm for sm/md buttons and md for lg |
| `isIconOnly` | `boolean` | `false` | when true, renders square icon-only button; label becomes aria-label |
| `width` | `SizeValue` | - | Width of button. Numbers=pixels, strings=as-is (e.g. '100%' for full-width). Default: content width, capped at the container; label truncates w/ ellipsis in a narrow row; icon-only stays square. |
| `children` | `ReactNode` | - | optional visible override; label is still required for a11y. Prefer <Button label="Save" /> over using children |
| `endContent` | `ReactElement<IconProps> \| ReactElement<BadgeProps>` | - | trailing icon/badge after label; ignored when isIconOnly; color inherited |
| `tooltip` | `string` | - | tooltip on hover |
| `onClick` | `(e: MouseEvent) => void` | - | standard click handler; fires before clickAction |
| `clickAction` | `(e: MouseEvent) => void \| Promise<void>` | - | async click handler; shows loading while promise pending |
| `href` | `string` | - | When provided, renders the button as a link element (<a> or custom link component). The destination follows the shared navigation rule described on the Link `href` prop. |
| `as` | `ComponentType` | - | Custom link component to use when href is provided (e.g. Next.js Link). |
| `target` | `string` | - | HTML target attribute when rendered as a link (e.g. "_blank"). |
| `rel` | `string` | - | HTML rel attribute when rendered as a link (e.g. "noopener noreferrer"). |

## Examples

### Actions in narrow rows

```tsx

import {useState} from 'react';
import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {Heading} from '@curialy/ui/Heading';
import {HStack} from '@curialy/ui/HStack';
import {Icon} from '@curialy/ui/Icon';
import {IconButton} from '@curialy/ui/IconButton';
import {StackItem} from '@curialy/ui/Stack';
import {TextInput} from '@curialy/ui/TextInput';
import {VStack} from '@curialy/ui/VStack';

// On a phone (or any card narrower than its actions), a labelled Button
// shrinks with its row and truncates its label with an ellipsis instead of
// overflowing or being clipped by the card. The full label stays the
// accessible name. Icon-only buttons keep their square size.
function ReviewersCard() {
  const [emails, setEmails] = useState('');
  return (
    <Card maxWidth={560}>
      <VStack gap={4}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Heading level={3} maxLines={1}>
              Design review
            </Heading>
          </StackItem>
          <Button label="Request review from the design team" size="sm" />
          <IconButton
            label="More review options"
            icon={<Icon icon="moreHorizontal" />}
            variant="ghost"
            size="sm"
          />
        </HStack>
        <TextInput
          label="Reviewer emails"
          placeholder="name@example.com"
          value={emails}
          onChange={setEmails}
        />
        {/* In a 320px form footer the long primary action truncates.
            StackItem size="static" keeps the short Cancel label whole. */}
        <HStack gap={2} hAlign="end">
          <StackItem size="static">
            <Button label="Cancel" variant="secondary" />
          </StackItem>
          <Button label="Send invitations to all 12 reviewers" variant="primary" />
        </HStack>
      </VStack>
    </Card>
  );
}

```

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `cui-button` | `data-size`, `data-variant`, `data-elevation` | primary, secondary, ghost, destructive | - |

Override in defineTheme:
```ts
components: {
  'button': {
    base: { /* CSS properties */ },
    'size:value': { /* variant-specific */ },
  },
}
```

**Themeable CSS variables** - additional properties that can be overridden in `defineTheme` component overrides.

| CSS Variable | Default | Description |
|-------------|---------|-------------|
| `--button-focus-offset` | `var(--focus-outline-offset)` | Focus ring outline offset |
| `--button-icon-only-aspect` | `1 / 1` | Aspect ratio for icon-only buttons |

Some properties are set via standard CSS in component overrides:
```ts
components: {
  button: {
    base: {
      borderRadius: '...',
    },
  },
}
```
