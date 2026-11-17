package: @curialy/ui

# useAnnounce

Imperatively announces a message to screen readers through a visually-hidden live region. Use it for state that is only conveyed visually; search result counts, "no results", loading and saved confirmations, validation errors (WCAG 4.1.3 Status Messages). The polite and assertive regions are created empty on first use and stay mounted, which is what makes announcements reliable: most screen readers ignore a live region that is inserted together with its content. Each message is cleared a couple of seconds after it is announced so stale status does not linger in the accessibility tree. A message is delivered where its caller is: from inside an open Curialy UI modal it goes to a region inside that modal and is heard there with no change to the calling code; a message sent just as the modal is dismissed is delivered through whatever is exposed afterwards rather than lost. A call made outside the modal, even by the component that renders it, uses the page-body region.

## Best Practices

- **Do:** Reach for this instead of hand-rolling an aria-live div; a region rendered with its content usually does not announce at all.
- **Do:** Keep "polite" for status and result counts; reserve "assertive" for errors and time-sensitive alerts, since it interrupts whatever the screen reader is saying.
- **Do:** Announce the outcome, not the interaction; "12 results" rather than "search ran".
- **Do:** Send a value that keeps changing, such as a result count as the user types, through its own useAnnounce({hasReplace: true}) instance, so input faster than a frame says only the latest count.
- **Don't:** Announce content that is already visible and correctly labeled in the DOM; that doubles up for screen reader users.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options` | `UseAnnounceOptions` | - | Configuration object. |
| `options.hasReplace` | `boolean` | `false` | The instance states one current state, such as a search's result count: each message it writes withdraws the instance's previous message while that one has not been spoken yet, whatever their politeness, and is spoken at its own politeness. A message already spoken stays. Messages from other instances, and from instances without hasReplace, still join. Give each state a component reports its own instance, for example one for the result count and one for selection changes. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `announce` | `(message: string, politeness?: "polite" \| "assertive") => void` | Speaks a message through the live region the caller can be heard from: the shared one on the page body, or, when the calling component is rendered inside an open Curialy UI modal (Dialog, modal BottomSheet, modal Drawer, Lightbox, MobileNav, CommandPalette), a persistent region inside that modal, since a native modal hides the page-body region from assistive technology. Politeness defaults to "polite"; messages announced in the same frame are joined, in order, into one announcement, and an identical repeat is kept once, except that each message from a hasReplace instance replaces the previous message of that instance not yet spoken. An empty message clears any lingering status, including joined messages not yet spoken, instead of announcing. |


Block templates: design_system component <name> --blocks for VisuallyHidden, Toast
