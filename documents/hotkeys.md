---
title: Hotkeys
order: 2
group: getting-started
description: Every keyboard shortcut in VIMATHIC. Tap for one-shot actions, hold-and-drag for live parameter control.
---

# Hotkeys

VIMATHIC has two kinds of keyboard shortcuts: **tap** keys that trigger an action once, and **hold-and-drag** keys that let you control a parameter by moving the mouse while a key is held. Hotkeys stand down while a **text** field has focus — a preset name, a number field, a value badge you are typing into — so typing never fires one. They also stand down after you pick from one of the panel's plain drop-downs — Surface Material, Particle Style, Wire Style, the clip player's Bars and Camera, and the "+ Add parameter…" list in MIDI mapping: a drop-down keeps focus after a pick and uses a typed letter to jump to the option that starts with it, so it keeps every key; click the canvas after one of those. The panel's pickers (3D SHAPE, SHADER MODE, COLOR SCHEME, and VOLUME FORMULA in VOLUME mode) and its sliders are different: they keep focus after you use them with the mouse, but they keep only the keys they act on — a picker <kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>Enter</kbd> and <kbd>Esc</kbd>, a slider the arrows, Home, End, Page Up and Page Down — and let everything else through. So you can pick a shader and go straight to its knobs, or press <kbd>Space</kbd> or <kbd>←</kbd> / <kbd>→</kbd> for the music right after a pick, or drag a slider and go straight to a hotkey, with no click on the canvas in between. The one key that fires regardless is <kbd>Esc</kbd>, which has to keep working inside the editors or a modal could not be closed by keyboard at all.

## Tap shortcuts

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause audio |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next track in playlist |
| <kbd>R</kbd> | Randomize everything — shape, color, formula |
| <kbd>F</kbd> | Random formula — GPU shader or CPU math formula |
| <kbd>D</kbd> | Next shape (sequential, looping through all 32 shapes) |
| <kbd>T</kbd> | Next surface material — Matte / Glossy / Metal / Mirror / Velvet / Glass (SURFACE mode only) |
| <kbd>Q</kbd> | Random color scheme — from all 54, or from the NIGHT ten while that mode is on |
| <kbd>E</kbd> | Next color scheme — steps through all 54, or around the NIGHT ten while that mode is on |
| <kbd>W</kbd> | Flip camera 180° around its orbit |
| <kbd>G</kbd> | Toggle ground grid |
| <kbd>P</kbd> | Glitch punch — a brief bloom surge plus ~200 ms of viewport jitter, with the beat ring flashed once |
| <kbd>I</kbd> | Toggle this hotkey hint overlay |
| <kbd>Esc</kbd> | Close whichever modal is open — About, Output, Camera Editor, Shader Editor, Audio Source — and leave fullscreen. The one key here that still fires while you are typing, so that a modal can always be closed by keyboard: pressed inside the Shader Editor it shuts the panel, and code typed but not yet applied is gone with it |

The randomization keys (`R`, `Q`, `F`) use a **shuffle bag**: every color, shape, and formula will appear before any repeats. You will not see the same value twice in a row, ever — even at deck boundaries the next pick is guaranteed different from the last.

> **Note on `F` and `R`:** the FORMULA dropdown holds two families — 38 GPU shaders and 192 CPU math formulas — and both randomizers draw from both. The choice of family is a coin flip, then the shuffle bag picks inside it, so a shader comes up about as often as a formula even though there are five times more formulas. Each family keeps its own no-repeat deck.

> **Note on NIGHT:** the mode narrows what the app picks *unattended*, so all three colour keys draw from the same ten NIGHT schemes while it is on — `Q` and `R` by shuffle, `E` by stepping around the series and wrapping from the last back to the first. The COLOR SCHEME dropdown is deliberately left free: the mode is about what the app chooses, not about what you may. If you pick a bright palette from it under NIGHT, the next `E` steps back into the series rather than continuing along the catalogue. Until 03.09.2026 `E` ignored the mode entirely and walked out of the ten onto scheme 0 after ten presses.

> **Note on `R`:** `R` rotates colour, formula and shape across their full pools — 54 schemes, 38 shaders + 192 formulas, and all 32 shapes. With NIGHT on, the colour half of that pool narrows to the 10 NIGHT schemes; the dropdown is unaffected. Until August 2026 the shape half drew from a curated subset of nine, and the other eleven (disc, ring, circle, hex, pyramid-smooth, tetrahedron, octahedron, icosahedron-smooth, dodecahedron, star, solar) were reachable only through the Shape dropdown or `D`. Nothing recorded why those nine; the list had simply stopped being extended as shapes were added. The pool is the shape whitelist itself now, so a shape that appears in the dropdown appears under `R`.

## Hold-and-drag shortcuts

Hold the key, then drag horizontally with mouse, two-finger touchpad swipe, or scroll wheel to adjust the parameter live. Works in both normal mode and full-screen mode. While a held key is driving its parameter the wheel turns that parameter and nothing else — the camera does not zoom and the panel does not scroll. Hold two drag keys and the one pressed last drives; let go of it and the one still held takes over again. A letter pressed together with <kbd>Ctrl</kbd>, <kbd>Alt</kbd> or <kbd>Cmd</kbd> is left to the browser — <kbd>Ctrl</kbd>+<kbd>H</kbd> still opens its history, <kbd>Ctrl</kbd>+<kbd>U</kbd> its page source — and drags nothing.

| Keys | Parameter | Range |
|---|---|---|
| <kbd>L</kbd> / <kbd>X</kbd> | Bass sensitivity | 0.1 – 3.0 |
| <kbd>K</kbd> / <kbd>Z</kbd> | Treble sensitivity | 0.1 – 3.0 |
| <kbd>V</kbd> | Amplitude | 0.2 – 2.0 |
| <kbd>C</kbd> | Wave intensity | 0.3 – 5.0 |
| <kbd>A</kbd> | Bloom | 0.1 – 2.0 |
| <kbd>S</kbd> | Spectrum Rings | 0.1 – 2.5 |
| <kbd>B</kbd> | Formula Detail | 0 – 1 |
| <kbd>N</kbd> | Formula Phase | 0 – 1 |
| <kbd>Y</kbd> | Shader Knob 1 | 0 – 1 |
| <kbd>U</kbd> | Shader Knob 2 | 0 – 1 |
| <kbd>H</kbd> | Shader Knob 3 | 0 – 1 |
| <kbd>J</kbd> | Shader Knob 4 | 0 – 1 |

Each range is one 600-pixel sweep of the drag — a fixed distance, not a fraction of your window. For the audio and bloom keys the panel slider shows the narrower everyday range and grows to fit when a drag takes a value past it, and the floor is 0.1 even where the parameter itself allows 0 — dragging one of them to exactly zero makes the picture go still, which reads as a fault mid-set. The formula pair and the Shader Knobs are the other way round: their 0 is a rest position (Phase, and every knob) or the useful coarse end (Detail), so the drag covers their whole 0 – 1 and stops at both ends. You can always drag one back to rest, and a drag cannot wind past 1 into a stretch that does nothing. A value you typed above 1 is left where it is by a drag up, and a drag down lowers it from there.

**B** and **N** act only while a CPU formula is drawing, which is when Formula Detail and Formula Phase are on the panel. **Y**, **U**, **H** and **J** act only while the SHADER KNOBS are on the panel: on a numbered SHADER MODE entry, or over a formula while your own shader is applied. A key whose sliders are swapped out of the panel does nothing — its value stays where it is, and the wheel scrolls as usual. The rule is the same in full-screen mode and with the panel collapsed or its section folded, where every slider is out of sight by design: what counts is which sliders the panel would show for the engine that is drawing, and those keys keep working there. MIDI reaches either set at any time.

These are the "performance" keys — hold one and move the mouse, like a modulation wheel. The left-hand letters (`A`, `C`, `V`, `X`, `Z` and `S`) are there so you can hold one with the left hand while the right aims the mouse. The slider in the side panel moves in sync as you drag.

## Tips

- `I` shows a small reference overlay in the bottom-left corner. Tap it once to show, again to hide. It was `H` until 08.10.2026, when `H` went to Shader Knob 3; the **i** button in the panel is a different thing — it opens this documentation.
- `R` is by far the most useful key while exploring — it gives you a new combination in one keystroke.
- `D` complements `R` — both now reach all 32 shapes, but `D` walks them in order, which is what you want when comparing looks systematically rather than being surprised.
- `T` cycles the surface material (Matte, Glossy, Metal, Mirror, Velvet, Glass) — it only has an effect in SURFACE render mode; in Wireframe or Points it does nothing.
- Combine `R` and `Q`: `R` for a full reset of the look, `Q` to swap just the color afterward.
- `P` (glitch) plus a beat-heavy moment of music produces a satisfying punch — use it as a manual accent during sets. It answered to `S` until 01.09.2026, when `S` was given to Spectrum Rings, and to `Y` until 08.10.2026, when `Y` went to Shader Knob 1.
- `S` has no alias in the other hand cluster — the letters beside it are taken.
- Amplitude, Wave intensity and Bloom answer only to `V`, `C` and `A` now: on 08.10.2026 `J`, `N` and `B` went to the formula pair and the knobs. Bass and Treble sensitivity are the two that keep a key in each hand.
- The randomization affects the dropdowns in the panel too, so whatever `R` lands on becomes the "current" selection if you want to keep iterating from there.

## What is NOT a hotkey

A few things you might expect to be keys but aren't (yet):

- No keyboard shortcut for opening modals (Output, Camera Editor, Shader Editor) — they're all click-only.
- The Shader Editor has its own keys while you type in it: `Ctrl+S` or `Ctrl+Enter` (`Cmd` on Mac) compiles and applies — the APPLY button says so — and `Tab` inserts two spaces instead of moving focus.
- The Camera Programmer's code box takes `Ctrl+Enter` (`Cmd` on Mac) to apply the script — the same run gesture most code editors use.
- No mute key — `Space` only pauses the source; use your OS volume.
- No global save-preset shortcut — but once you've typed a name, <kbd>Enter</kbd> in the name field saves it, same as clicking SAVE.

If a key you want isn't here, MIDI mapping covers the gap (any CC can drive any parameter — see the MIDI tab).
