package: @astryxdesign/core

# ChatLayout

layout shell for full chat; msgs in page flow, composer fixed bottom w/ frosted glass dock; density prop (default balanced); scrollRef delegates to parent/body; in Chrome on Android (Gboard) the composer rides the software keyboard in step; in Safari on iOS and Firefox for Android it moves above the keyboard once reported (Chrome with interactive-widget=resizes-content: the page resizes, no move); transcript stays at newest msg, on a touch screen in a top-level page every focus route (tap, prev/next, Tab, focus()) w/o page scroll and Done rests focus on the composer group (no name, ring after keyboard input only, no tab stop); under a mouse or in an iframe: plain wrapper, browser focus

**Import:** `import {ChatLayout} from '@astryxdesign/core/Chat';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Message area | Yes | Scrollable region for messages. Renders children (typically ChatMessageList) in a flex column that pushes content to the bottom when the list is short. |
| Frosted glass dock | Yes | Sticky or fixed container at the bottom with a backdrop-blur layer. Houses the scroll button and composer. While a software keyboard is up it sits on top of the keyboard, and the message area gets room to scroll above it. |
| Scroll-to-bottom button | No | Appears when the user scrolls up or new messages arrive. Defaults to ChatLayoutScrollButton; pass null to hide or a custom element to override. |
| Composer | Yes | The input area for sending messages, typically ChatComposer. Docked at the bottom inside the frosted glass layer. In a top-level page on a touch screen, its wrapper (without the scroll button) is a group with no name. When the keyboard’s Done ends typing, focus rests on that group (it is no tab stop), so the next tap or Tab starts from the composer. It shows the focus ring after keyboard input only. Under a mouse or inside an iframe, the wrapper is a plain container. |
| Empty state | No | Centered placeholder shown when no messages exist. Use EmptyState for a consistent look. |

## Best Practices

- **Do:** Pass ChatMessageList as children and ChatComposer as composer prop for complete chat.
- **Do:** Provide emptyState so new conversations show a prompt, not blank screen.
- **Do:** Use scrollRef when chat is embedded in a page where a parent element handles scrolling.
- **Do:** full-page: container 100dvh not 100vh (100vh = viewport w/ phone toolbar hidden; composer starts below screen edge)
- **Do:** Markdown prose keeps 680px measure; code/tables span column. One right edge: pass contentWidth="100%" to Markdown.
- **Don't:** Apply fixed height on layout; let it fill container with flex: 1.
- **Don't:** Render multiple ChatLayout instances in same scroll container; each expects to own its scroll context.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | msg content; typically ChatMessageList **(required)** |
| `composer` | `ReactNode` | - | composer element; typically ChatComposer; fixed bottom w/ frosted glass **(required)** |
| `emptyState` | `ReactNode` | - | content when children empty |
| `scrollButton` | `ReactNode \| null` | - | scroll-to-bottom btn; defaults to ChatLayoutScrollButton; pass null to hide |
| `scrollRef` | `React.RefObject<HTMLElement \| null>` | - | external scroll container ref; targets parent/body instead of layout root |
| `density` | `'compact' \| 'balanced' \| 'spacious'` | `'balanced'` | visual density; dock padding, message max-width, blur height |
