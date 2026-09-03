---
title: Hotkeys
order: 2
group: getting-started
description: Every keyboard shortcut in VIMATHIC. Tap for one-shot actions, hold-and-drag for live parameter control.
---

# Hotkeys

VIMATHIC has two kinds of keyboard shortcuts: **tap** keys that trigger an action once, and **hold-and-drag** keys that let you control a parameter by moving the mouse while a key is held. Hotkeys are disabled while an input field holds focus — not only while you are typing in one. Preset names and number fields behave as you would expect, and so do the panel's pickers (3D SHAPE, SHADER MODE, COLOR SCHEME, and VOLUME FORMULA in VOLUME mode): they take no text any more, but they keep focus after you choose from them, so click the canvas once to get the keys back. The one key that fires regardless is <kbd>Esc</kbd>, which has to keep working inside the editors or a modal could not be closed by keyboard at all.

## Tap shortcuts

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause audio |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next track in playlist |
| <kbd>R</kbd> | Randomize everything — shape, color, formula |
| <kbd>F</kbd> | Random formula — GPU shader or CPU math formula |
| <kbd>D</kbd> | Next shape (sequential, looping through all 32 shapes) |
| <kbd>T</kbd> | Next surface material — Matte / Glossy / Metal / Mirror / Velvet / Glass (SURFACE mode only) |
| <kbd>Q</kbd> | Random color scheme |
| <kbd>E</kbd> | Next color scheme (cycles through all 54) |
| <kbd>W</kbd> | Flip camera 180° around its orbit |
| <kbd>G</kbd> | Toggle ground grid |
| <kbd>Y</kbd> | Glitch punch — a brief bloom surge plus ~200 ms of viewport jitter, with the beat ring flashed once |
| <kbd>H</kbd> | Toggle this hotkey hint overlay |
| <kbd>Esc</kbd> | Close whichever modal is open — About, Output, Camera Editor, Shader Editor, Audio Source — and leave fullscreen. The one key here that still fires while you are typing, so that a modal can always be closed by keyboard: pressed inside the Shader Editor it shuts the panel, and code typed but not yet applied is gone with it |

The randomization keys (`R`, `Q`, `F`) use a **shuffle bag**: every color, shape, and formula will appear before any repeats. You will not see the same value twice in a row, ever — even at deck boundaries the next pick is guaranteed different from the last.

> **Note on `F` and `R`:** the FORMULA dropdown holds two families — 38 GPU shaders and 192 CPU math formulas — and both randomizers draw from both. The choice of family is a coin flip, then the shuffle bag picks inside it, so a shader comes up about as often as a formula even though there are five times more formulas. Each family keeps its own no-repeat deck.

> **Note on `R`:** `R` rotates colour, formula and shape across their full pools — 54 schemes, 38 shaders + 192 formulas, and all 32 shapes. With NIGHT on, the colour half of that pool narrows to the 10 NIGHT schemes; the dropdown is unaffected. Until August 2026 the shape half drew from a curated subset of nine, and the other eleven (disc, ring, circle, hex, pyramid-smooth, tetrahedron, octahedron, icosahedron-smooth, dodecahedron, star, solar) were reachable only through the Shape dropdown or `D`. Nothing recorded why those nine; the list had simply stopped being extended as shapes were added. The pool is the shape whitelist itself now, so a shape that appears in the dropdown appears under `R`.

## Hold-and-drag shortcuts

Hold the key, then drag horizontally with mouse, two-finger touchpad swipe, or scroll wheel to adjust the parameter live. Works in both normal mode and full-screen mode.

| Keys | Parameter | Range |
|---|---|---|
| <kbd>L</kbd> / <kbd>X</kbd> | Bass sensitivity | 0.1 – 3.0 |
| <kbd>K</kbd> / <kbd>Z</kbd> | Treble sensitivity | 0.1 – 3.0 |
| <kbd>J</kbd> / <kbd>V</kbd> | Amplitude | 0.2 – 2.0 |
| <kbd>N</kbd> / <kbd>C</kbd> | Wave intensity | 0.3 – 5.0 |
| <kbd>B</kbd> / <kbd>A</kbd> | Bloom | 0.1 – 2.0 |
| <kbd>S</kbd> | Spectrum Rings | 0.1 – 2.5 |

Each range is one 600-pixel sweep of the drag — a fixed distance, not a fraction of your window; the panel slider shows the narrower everyday range and grows to fit when a drag takes a value past it. The floor is 0.1 even where the parameter itself allows 0 — dragging one to exactly zero makes the picture go still, which reads as a fault mid-set.

These are the "performance" keys — they're chosen so you can hold one with the left hand and aim the mouse with the right, like a modulation wheel. The slider in the side panel moves in sync as you drag.

## Tips

- `H` shows a small reference overlay in the bottom-left corner. Tap it once to show, again to hide.
- `R` is by far the most useful key while exploring — it gives you a new combination in one keystroke.
- `D` complements `R` — both now reach all 32 shapes, but `D` walks them in order, which is what you want when comparing looks systematically rather than being surprised.
- `T` cycles the surface material (Matte, Glossy, Metal, Mirror, Velvet, Glass) — it only has an effect in SURFACE render mode; in Wireframe or Points it does nothing.
- Combine `R` and `Q`: `R` for a full reset of the look, `Q` to swap just the color afterward.
- `Y` (glitch) plus a beat-heavy moment of music produces a satisfying punch — use it as a manual accent during sets. It answered to `S` until 01.09.2026, when `S` was given to Spectrum Rings.
- `S` has no alias in the other hand cluster — the letters beside it are taken. It is the one hold-and-drag key that is not paired.
- The randomization affects the dropdowns in the panel too, so whatever `R` lands on becomes the "current" selection if you want to keep iterating from there.

## What is NOT a hotkey

A few things you might expect to be keys but aren't (yet):

- No keyboard shortcut for opening modals (Output, Camera Editor, Shader Editor) — they're all click-only.
- The Shader Editor has its own keys while you type in it: `Ctrl+S` or `Ctrl+Enter` (`Cmd` on Mac) compiles and applies — the APPLY button says so — and `Tab` inserts two spaces instead of moving focus.
- The Camera Programmer's code box takes `Ctrl+Enter` (`Cmd` on Mac) to apply the script — the same run gesture most code editors use.
- No mute key — `Space` only pauses the source; use your OS volume.
- No global save-preset shortcut — but once you've typed a name, <kbd>Enter</kbd> in the name field saves it, same as clicking SAVE.

If a key you want isn't here, MIDI mapping covers the gap (any CC can drive any parameter — see the MIDI tab).
