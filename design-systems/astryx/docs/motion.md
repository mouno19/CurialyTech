package: @astryxdesign/cli

# Motion

Duration and easing tokens for animations and transitions.

## Overview

Motion serves two purposes: it makes interfaces easier to understand, and it makes them more pleasant to use. A panel animating open helps the eye track what changed and where new content sits in the layout. These moments reduce cognitive load and make the interface feel responsive.

At the same time, well-tuned motion gives an application a sense of craft and polish that users notice, even if they can't name it.

The design system provides duration and easing tokens that keep these moments consistent across your application.

## Duration

Nine duration tokens in fast, medium, and slow bands, and `--duration-exit`, the standard dismissal duration, which follows `--duration-fast`.

Motion duration primitives. Three bands: fast (micro-interactions), medium (entrance/exit), slow (continuous). Min/max variants derive from base × ratio. Of a theme's two `motion` knobs, `tempo` (0.75–1.5) scales every duration here; `character` leaves durations alone. A duration scale beats `tempo` for the bands it sets, and explicit `tokens` beat both. `tempo` leaves these unscaled: finger tracking, momentum, the rubber band, the on-screen keyboard, the press's onset delay, cancel distance and tap flash, hover-intent delays, gesture thresholds, Spinner's and Skeleton's loops, and the 200 ms Reduce Motion cap.

Token                 | Core default
--------------------- | --------------------
--duration-fast-min   | 130ms
--duration-fast       | 175ms
--duration-fast-max   | 230ms
--duration-medium-min | 310ms
--duration-medium     | 410ms
--duration-medium-max | 550ms
--duration-slow-min   | 730ms
--duration-slow       | 975ms
--duration-slow-max   | 1300ms
--duration-exit       | var(--duration-fast)

## Easing

Four easing curves. `--ease-standard` decelerates, for state changes. `--ease-entrance` is for things arriving and `--ease-move` for things moving on screen; a theme's `character` sets both, and at `standard` they equal `--ease-standard`. `--ease-exit` accelerates, for things leaving: it moves off from rest and leaves fast, so the travel stays visible for the whole duration, and it is the same at every `character`.

Easing curves for animations and transitions. Of a theme's two `motion` knobs, `character` sets `--ease-entrance` and `--ease-move`: `crisp` decelerates without overshoot, `expressive` overshoots slightly, and at `standard` both equal `--ease-standard`; `--ease-exit` keeps its own curve at every character. `tempo` leaves curves alone. A duration scale's own fields win over the knobs, and explicit `tokens` win over everything. No curve here shapes motion that follows a finger or the system (dragging, momentum, the rubber band, the on-screen keyboard), and the press's clocks, hover-intent delays and gesture thresholds keep their timing whatever the character.

Token           | Core default
--------------- | ------------------------------
--ease-standard | cubic-bezier(0.24, 1, 0.4, 1)
--ease-entrance | cubic-bezier(0.24, 1, 0.4, 1)
--ease-move     | cubic-bezier(0.24, 1, 0.4, 1)
--ease-exit     | cubic-bezier(0.3, 0, 0.6, 0.6)

## Where Motion Helps

Some parts of the interface benefit from animation. Panels, dialogs, and collapsible sections are disorienting when they appear instantly, so animation gives the eye something to follow. Toasts and notifications need just enough entrance to be noticed without startling. State changes like a switch flipping or a selection highlighting feel more intentional with a brief transition.

The common thread is that these are moments where the user needs to understand what happened.

## Where Motion Hurts

Table row hovers. List item highlights. Anything the user does dozens of times per minute. Adding perceptible duration to these interactions makes the interface feel like it's catching up to the cursor. Keep these fast enough that the user never notices a delay.

Animations that block interaction are worse. If a user has to wait for a panel to finish sliding before they can click something inside it, the animation has become an obstacle. Motion should never stand between the user and their next action.

## Movement Principles

- Not everything needs an animated exit. Elements the user is moving away from, such as tooltips, hover cards, and dropdown menus, can disappear instantly. The user has already shifted their attention. Animate the exit only when it helps orient the user, like a panel closing or a dialog dismissing to reveal what's underneath.
- When you do animate exit, match the entrance. A panel that slides in from the right should slide back out to the right.
- Direction should match the action. Navigating deeper into content should feel like moving forward. Going back should feel like returning. This keeps the user oriented in the structure of the application.
- Contextual UI should feel connected to its trigger. A dropdown should expand from the button that opened it. A popover should appear near the element it describes. This doesn't apply to global UI like command palettes or toasts, which have their own fixed positions.

## Respecting User Preferences

Some users experience motion sensitivity; animation that feels polished to one person can cause discomfort for another. When the OS reduced-motion setting is on, Astryx components change at once under a mouse or trackpad, and under a finger they cross-fade instead of moving: opacity only, in 200 ms or less. A value that changes in place, such as a progress fill, takes its new value at once under any pointer. Do the same in your own animations with `@media (prefers-reduced-motion: reduce)`, adding `(pointer: coarse)` for the touch cross-fade.

## Animate with motion tokens

Set transition durations and easing from the motion tokens, so a theme that retunes motion retunes your animations too. Ease something arriving on `--ease-entrance` and something moving on screen on `--ease-move`, so it follows the theme's `character`, and something leaving on `--ease-exit`, which stays the same at every `character`.

Applying motion tokens:
```tsx
import {durationVars, easeVars} from '@astryxdesign/core/theme/tokens.stylex';

const styles = stylex.create({
  fadeIn: {
    transitionProperty: 'opacity',
    transitionDuration: durationVars['--duration-fast'],
    transitionTimingFunction: easeVars['--ease-standard'],
  },
  slideUp: {
    transitionProperty: 'transform, opacity',
    transitionDuration: durationVars['--duration-medium'],
    transitionTimingFunction: easeVars['--ease-entrance'],
  },
});
```

## Tune motion from the theme

A theme sets how motion feels with two knobs in `defineTheme`'s `motion`. They drive the CSS motion tokens, and `tempo` also times the springs of touch motion; those springs don't follow `character` yet. Every theme follows each person's Reduce Motion setting; no theme loosens it.

- `tempo` scales every motion duration: 1 is Astryx's own, 0.75 the quickest and 1.5 the slowest (values outside are clamped).
- `character` sets how lively motion is: `'crisp'` decelerates without overshoot, `'standard'` is Astryx's own, and `'expressive'` overshoots slightly on entrances and moves. Exits and fades never overshoot.

A quicker, crisper theme:
```ts
export const brandTheme = defineTheme({
  name: 'brand',
  motion: {tempo: 0.85, character: 'crisp'},
});
```

Some motion never follows the knobs, because it tracks a finger or the system: finger tracking, momentum and the rubber band, the on-screen keyboard, the press model's onset delay, cancel distance and tap flash (its release fade follows tempo), hover-intent delays, gesture thresholds, the loops of busy indicators such as Spinner and Skeleton, and the 200 ms Reduce Motion cross-fade.

Precedence, lowest to highest: the knobs, then a duration scale (`fast`, `medium`, `slow`, `ratio`) for the durations it sets, then explicit `tokens`. A theme with no `motion` renders exactly as before.

## Best Practices

+ Animate transitions that involve spatial change: panels opening, content expanding, elements entering the screen.
+ Use fast tokens for small, frequent interactions. Use medium tokens for larger transitions that rearrange the layout.
+ Honor reduced motion preferences at the OS level.

x Let hover states or high-frequency interactions feel like they're lagging behind the user.
x Let animation delay when a user can interact with new content. The transition should complete before (or not block) the next action.
x Move elements in ways that contradict where they came from or where they're going.

Up: astryx docs foundations
Previous: astryx docs illustrations
Next: astryx docs shape
