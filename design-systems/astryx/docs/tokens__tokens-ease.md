package: @astryxdesign/cli

# Easing Tokens

Easing curves for animations and transitions. Of a theme's two `motion` knobs, `character` sets `--ease-entrance` and `--ease-move`: `crisp` decelerates without overshoot, `expressive` overshoots slightly, and at `standard` both equal `--ease-standard`; `--ease-exit` keeps its own curve at every character. `tempo` leaves curves alone. A duration scale's own fields win over the knobs, and explicit `tokens` win over everything. No curve here shapes motion that follows a finger or the system (dragging, momentum, the rubber band, the on-screen keyboard), and the press's clocks, hover-intent delays and gesture thresholds keep their timing whatever the character.

## Easing Tokens

Easing curves for animations and transitions. Of a theme's two `motion` knobs, `character` sets `--ease-entrance` and `--ease-move`: `crisp` decelerates without overshoot, `expressive` overshoots slightly, and at `standard` both equal `--ease-standard`; `--ease-exit` keeps its own curve at every character. `tempo` leaves curves alone. A duration scale's own fields win over the knobs, and explicit `tokens` win over everything. No curve here shapes motion that follows a finger or the system (dragging, momentum, the rubber band, the on-screen keyboard), and the press's clocks, hover-intent delays and gesture thresholds keep their timing whatever the character.

Token           | Core default
--------------- | ------------------------------
--ease-standard | cubic-bezier(0.24, 1, 0.4, 1)
--ease-entrance | cubic-bezier(0.24, 1, 0.4, 1)
--ease-move     | cubic-bezier(0.24, 1, 0.4, 1)
--ease-exit     | cubic-bezier(0.3, 0, 0.6, 0.6)

Up: astryx docs tokens
Previous: astryx docs tokens/tokens-duration
Next: astryx docs tokens/tokens-typography
