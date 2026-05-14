---
title: Hotkeys
order: 2
group: getting-started
description: Every keyboard shortcut in VIMATHIC. Tap for one-shot actions, hold-and-drag for live parameter control.
---

# Hotkeys

VIMATHIC has two kinds of keyboard shortcuts: **tap** keys that trigger an action once, and **hold-and-drag** keys that let you control a parameter by moving the mouse while a key is held. Hotkeys are disabled while typing in an input field, so the panel sliders and preset names work normally.

## Tap shortcuts

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause audio |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next track in playlist |
| <kbd>R</kbd> | Randomize everything — shape, color, formula |
| <kbd>F</kbd> | Random math formula (CPU) |
| <kbd>Q</kbd> | Random color scheme |
| <kbd>E</kbd> | Next color scheme (cycles through all 36) |
| <kbd>W</kbd> | Flip camera 180° around its orbit |
| <kbd>C</kbd> | Toggle ground grid |
| <kbd>S</kbd> | Glitch punch — brief bloom + chromatic burst |
| <kbd>H</kbd> | Toggle this hotkey hint overlay |

The randomization keys (`R`, `Q`, `F`) use a **shuffle bag**: every color, shape, and formula will appear before any repeats. You will not see the same value twice in a row, ever — even at deck boundaries the next pick is guaranteed different from the last.

> **Note on `R`:** `R` rotates colour and formula across their full pools (36 schemes, 192 formulas), but rotates **shape** across a curated subset of 9 of the 20 available — plane, sphere, torus, torus knot, cylinder, cone, icosahedron, pyramid, box. The other 11 shapes (disc, ring, circle, hex, pyramid-smooth, tetrahedron, octahedron, icosahedron-smooth, dodecahedron, star, solar) remain reachable through the Shape dropdown but won't appear via `R`.

## Hold-and-drag shortcuts

Hold the key, then move the mouse **left or right** to adjust the parameter live. Works in both normal mode and full-screen mode.

| Key | Parameter | Range |
|---|---|---|
| <kbd>L</kbd> | Bass sensitivity | 0.1 – 3.0 |
| <kbd>K</kbd> | Treble sensitivity | 0.1 – 3.0 |
| <kbd>J</kbd> | Amplitude | 0.1 – 2.0 |
| <kbd>N</kbd> | Wave intensity | 0.1 – 3.0 |
| <kbd>B</kbd> | Bloom | 0.0 – 2.0 |

These are the "performance" keys — they're chosen so you can hold one with the left hand and aim the mouse with the right, like a modulation wheel. The slider in the side panel moves in sync as you drag.

## Tips

- `H` shows a small reference overlay in the bottom-left corner. Tap it once to show, again to hide.
- `R` is by far the most useful key while exploring — it gives you a new combination in one keystroke.
- Combine `R` and `Q`: `R` for a full reset of the look, `Q` to swap just the color afterward.
- `S` (glitch) plus a beat-heavy moment of music produces a satisfying punch — use it as a manual accent during sets.
- The randomization affects the dropdowns in the panel too, so whatever `R` lands on becomes the "current" selection if you want to keep iterating from there.

## What is NOT a hotkey

A few things you might expect to be keys but aren't (yet):

- No keyboard shortcut for opening modals (Output, Camera Editor, Shader Editor) — they're all click-only.
- No mute key — `Space` only pauses the source; use your OS volume.
- No save-preset shortcut — type a name and click SAVE.

If a key you want isn't here, MIDI mapping covers the gap (any CC can drive any parameter — see the MIDI tab).
