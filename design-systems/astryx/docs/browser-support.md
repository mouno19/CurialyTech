package: @astryxdesign/cli

# Browser support

What browsers Astryx targets, which modern platform features it depends on, and how to support older browsers for your own audience.

## Overview

Astryx is built on modern web platform features: the [`Popover`](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) API, CSS anchor positioning, and CSS `light-dark()`. These let components stay small, accessible, and dependency-free, but they also set a floor on which browsers render everything correctly.

A design system does not own its traffic; the products built on it do. Their audiences range from evergreen-Chrome-only internal tools to public sites with meaningful older-Safari share. So Astryx does not declare a single hard browser floor the way an app would. Instead it defines tiers that describe what works at each level, and hands the final decision to you. Pick the tier that matches your audience.

## Support Tiers

Astryx officially supports Tier 1 and Tier 2. Tier 3 is best-effort: components will not crash, but positioning and theming may degrade.

Tier                  | Baseline                  | Representative versions                          | What your users experience
--------------------- | ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
Tier 1: Full fidelity | Current Baseline (2026)   | Chrome 125+, Edge 125+, Safari 26+, Firefox 147+ | Everything works, including CSS anchor positioning. This is the reference target.
Tier 2: Functional    | Baseline − 2 years (2024) | Chrome 114+, Edge 114+, Safari 17+, Firefox 125+ | Components open, dismiss, and are fully usable. Only anchor positioning is missing, so layered surfaces (tooltips, menus, popovers) may not be positioned next to their trigger.
Tier 3: Below Tier 2  | Older than Baseline − 2   | Anything older                                   | Best-effort. The only guarantee is "does not crash." `light-dark()` is unavailable, so theme colors may fall back to defaults.

## Which Features Set the Floor

Only three modern features carry a browser requirement. Everything else Astryx uses (`:has()`, `color-mix()`, container queries, the `<dialog>` element) has been widely available since 2023 or earlier and needs no special handling.

Feature                | Role in Astryx                                                                                                          | Widely available
---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------
CSS Anchor Positioning | Positions layered surfaces relative to their trigger (tooltips, menus, popovers, dropdowns).                            | Baseline 2026: the tightest requirement.
`Popover` API          | Opens, stacks, and light-dismisses layered surfaces via the top layer.                                                  | Baseline 2025.
CSS light-dark()       | Compiles every theme color tuple into a single value that responds to color scheme. Underpins the whole theming system. | Widely available since mid-2024.

The gap that matters is between Tier 1 and Tier 2: the `Popover` API and `light-dark()` reached wide availability well before anchor positioning. So in Tier 2 browsers, layered surfaces open and dismiss correctly; they just are not positioned. This is the one feature most consumers will need to reason about.

## Which Components Are Affected

Any component that opens a menu, popover, tooltip, or dropdown carries the browser requirement: it renders that surface in an overlay positioned against its trigger. That includes:

- Tooltip, HoverCard, and Popover, and any prop that shows one (such as the Button `tooltip`)
- DropdownMenu, MoreMenu, and ContextMenu
- Selector, MultiSelector, ComplexSelector, Typeahead, and PowerSearch (dropdown surfaces)
- DateInput, DateRangeInput, and DateTimeInput (calendar popovers)
- Tokenizer (suggestion menu)
- The overflow and flyout menus in Breadcrumbs, TabList, TopNav, and SideNav
- Carousel (anchored controls)

If your product opens no menus, popovers, tooltips, or dropdowns, it has no anchor-positioning requirement; it needs only `light-dark()` (Tier 2 and up) for correct theme colors. Page layout, typography, forms, buttons, cards, and tables work down to Tier 2 with no special handling.

## What Astryx Guarantees

+ Components never throw on missing platform APIs. Where a browser lacks the `Popover` API, layers fall back to plain visibility instead of crashing.
+ Tier 1 and Tier 2 are officially supported and tested.
+ Non-layered components render correctly down to Tier 2.

x Astryx does not guarantee correct layer positioning below Tier 1 (anchor positioning). Closing that gap for a Tier 2 audience is a consumer choice; see below.
x Astryx does not ship a `light-dark()` fallback, so theme colors are not guaranteed below Tier 2.

## The On-Screen Keyboard

On a phone, the components that respond to the on-screen keyboard, a fully expanded `height='tall'` BottomSheet and ChatLayout's composer, measure it the same way: the layout viewport's height minus the visual viewport's height times its scale. Where the visual viewport shrinks for the keyboard, as in Safari on iOS in the browser and as a home-screen app, in Firefox for Android and in Chrome on Android, they keep the focused field and the surface around it above the keyboard and leave the page where it was. If Firefox for Android pans to the field, they put the page back within a couple of frames.

In Chrome on Android, ChatLayout’s composer rides the keyboard as Gboard slides it up and down. A Tall BottomSheet’s focused field rides the keyboard as Gboard slides it up, and as Gboard slides it down after the field loses focus. The scroll room stays until the keyboard is down. A hide Chrome reports late, such as Back, which keeps the focus, rides down from Chrome’s report. When the keyboard is reported, the sheet places the field just above it in that same frame, so Chrome has no covered field to pan to; if Chrome pans anyway, the sheet puts the page back when that pan ends. Chrome follows your viewport setting, which Astryx documents and never sets: your app owns its viewport `<meta>` element. By default (`interactive-widget=resizes-visual`) Chrome lays the keyboard over the page and pans to a focused field elsewhere on the page. With `interactive-widget=resizes-content` it shrinks the layout viewport instead, so content anchored to the bottom sits above the keyboard, and those components measure no keyboard and change nothing: the browser has already made the room.

Chrome on Android resizes the page for the keyboard:
```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
```

## Supporting Older Browsers

If your audience includes Tier 2 browsers and you need correct layer positioning, you have three options, cheapest first. All of them are decisions you make for your audience; Astryx does not impose one.

1. Polyfill anchor positioning. Load a CSS anchor positioning polyfill conditionally behind an `@supports` check so it costs nothing on Tier 1. This is the lowest-effort way to get correct positioning; polyfills may not cover every position-fallback feature.
2. Provide a JS positioning fallback. Detect missing support with `CSS.supports("anchor-name", "--x")` and position layers with a measurement-based library (e.g. a floating-element positioner) when it returns false. More code, full control.
3. Accept degraded positioning. Document for your users that on Tier 2 browsers, layered surfaces open correctly but may not sit next to their trigger. Cheapest, and often fine for internal tools on evergreen browsers.

Feature-detect at runtime rather than sniffing user agents:

Feature detection:
```js
// Popover API (Tier 2 and up)
const hasPopover = typeof HTMLElement !== 'undefined'
  && typeof HTMLElement.prototype.showPopover === 'function';

// CSS anchor positioning (Tier 1)
const hasAnchorPositioning = CSS.supports('anchor-name', '--x');

// CSS light-dark() (Tier 2 and up)
const hasLightDark = CSS.supports('color', 'light-dark(#000, #fff)');
```

## How These Tiers Move Over Time

The tiers are rolling, not frozen to specific versions. They track the Web Baseline year:

- Tier 1 tracks the current Baseline year.
- Tier 2 tracks Baseline minus two years.
- Tier 3 is everything older, and remains best-effort.

This is not an arbitrary window: Baseline − 2 is close to where anchor positioning stops being available while the `Popover` API and `light-dark()` still are, so the tier boundary tracks a real capability edge, not a guessed date. The version floors above are reviewed and advanced roughly once a year as new Baseline years land. Always feature-detect rather than hardcoding version numbers, so your app adapts automatically as the platform moves.

Up: astryx docs guides
Previous: astryx docs author-a-theme
Next: astryx docs getting-started
