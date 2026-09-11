---
title: Shader Editor
order: 5
group: production
description: Write live GLSL vertex and fragment code — audio uniforms, 54 palettes, 8 starter presets.
---

# Shader Editor

The Shader Editor lets you replace VIMATHIC's built-in GLSL with your own code, compiled live against the GPU. Two tabs: **vertex** (geometry deformation) and **fragment** (per-pixel coloring). Both have access to the same audio-reactive uniforms as the built-in shaders.

If GLSL is new to you: vertex shaders move points in 3D space, fragment shaders pick the color of each pixel. The editor wraps your code in a minimal scaffold so you can focus on the math.

## Prerequisite — switch to a GPU shader first

**Custom vertex displacement only affects rendering when the visualizer is in GPU mode.** In CPU mode the geometry is deformed by JavaScript and your `y` is discarded, so a body that only assigns `y` — every shipped vertex preset — changes nothing on screen. Writes straight to `pos` still count in either mode — `pos.y` scaled by the morph progress, `pos.x` and `pos.z` not. Custom **fragment** code is different: it colors every mode, CPU formulas included.

How to tell which mode you're in: open the **SHADER MODE** dropdown in the panel. It contains both types in groups:

- **GPU shaders are numbered** — *1. Bass Reactive Waves*, *2. Damped Radial Rings*, … through *38. Spectral Centroid*. Pick any one of these to put the visualizer in GPU mode.
- **CPU formulas have no number** — *Mandelbrot Escape*, *Julia Set (animated)*, *Lorenz Attractor Density*, etc. These run on the CPU and ignore custom vertex displacement.

To use the Shader Editor: pick a **numbered** entry from the dropdown, then open **SHADER EDITOR** and APPLY your code.

If you APPLY custom vertex code while a CPU formula is active, the status line turns **amber**, not green: "⚠ Compiled — a CPU formula is active, so y is discarded." Your GLSL is valid; the displacement will not show on the canvas until you pick a numbered GPU shader (1–38) in SHADER MODE. The warning stays up for ten seconds rather than two, because it is a sentence to act on rather than a tick to glance at.

It appears on the **vertex** tab only. Custom fragment colour applies in either mode, so an APPLY made while you are colouring says nothing about geometry you did not touch.

## Opening it

Open **ADVANCED** in the control panel, expand **SHADER EDITOR**, and click **✎ EDIT GLSL SHADER**. The modal has:

- **Tabs** — switch between vertex and fragment code
- **Presets strip** — ten starters covering both tab types
- **Editor textarea** — your code goes here
- **TIDY** — fix the three things GLSL is fussy about, without compiling
- **APPLY** — compile and use; errors appear in red below
- **RESET** — discard custom code, revert to built-ins

## TIDY — write it as maths, press one button

GLSL is stricter than the notation you think in, and a few of its rules cause most of the red text a newcomer sees. **✎ TIDY** rewrites your code in the box to satisfy them. It does not compile anything and it does not save anything — you read the result, then press APPLY yourself.

| You write | TIDY makes it | Why |
|---|---|---|
| `r * 8` | `r * 8.0` | GLSL has no automatic int→float, so `r * 8` is a type error — the single most common one |
| `r^2` | `pow(abs(r), 2.0)` | `^` is bitwise XOR in GLSL and does not accept floats at all |
| `bass`, `time`, `spectrum(r)` | `b`, `T`, `bandAtRadius(r)` | The scaffold's own names, which are short because they are typed constantly |

The name table is different per tab, and deliberately so: in the **vertex** body `t` is *treble* and time is `T`, while in the **fragment** body `t` is the palette ramp, so there the audio names expand to `uBass`, `uMid`, `uTreble` and `uTime` instead. `spectrum` is vertex-only, like the band functions it stands for. A name you declare yourself is never renamed — write `float time = T * 2.0;` and it stays `time`, table or no table.

**Why the `abs()`.** GLSL leaves `pow(x, y)` *undefined* when `x` is negative; on many drivers that is a NaN, and a NaN in the geometry or the colour is a black rectangle on screen. `sin(r)^2` is the commonest thing anyone writes here and `sin` is negative half the time, so the guard goes on. It appears only for an **even** whole exponent, where `|x|²` and `x²` are the same number — an odd or fractional power is expanded bare, because there `abs()` would change your answer rather than protect it. The status line names the guard when it adds one.

It is careful about numbers that must stay whole. Array indices (`uBands[3]`), `for` loop counters, `ivec2(1, 2)`, `#define` lines, any statement that mentions `int`, and an `int` variable used further down (`n = n + 2;`) are all left alone — as is anything already a float (`8.0`, `.5`, `8.`, `1e-3`) and anything inside a comment.

Where it is not sure, it does nothing. `a ^ b` with something complicated on either side is left as you wrote it rather than guessed at — a rewrite that compiles and means something else is worse than one that never happened. Ctrl+Z takes a tidy back.

`beat` is not in the name table. The scaffold pins `bt` to 0 because beat-driven displacement flashes the surface on every onset — see the note in the preset table below — so opting in stays something you write by hand.

## What you write — vertex tab

Your code is the **body** of `main()`. The scaffold provides:

| Variable | Type | Meaning |
|---|---|---|
| `pos` | `vec3` | Vertex position; **write to `y`** to deform |
| `r` | `float` | Distance from center: `length(pos.xz)` |
| `ang` | `float` | Angle from origin: `atan(pos.z, pos.x)` |
| `b`, `t`, `m` | `float` | Clamped audio: bass, treble, mid |
| `bt` | `float` | Beat (currently always 0; reserved) |
| `T` | `float` | Time (uniform `uTime`) |
| `a` | `float` | Amplitude slider |
| `wi` | `float` | Wave intensity slider |
| `y` | `float` | **Output** — assign your displacement here |

You also have helper functions: `turb(vec2 p)` for fractal turbulence, `ramu(vec2 p)` for the Ramanujan radial pattern, `h_sech(float x)` for hyperbolic secant.

### Four knobs — `uK0` … `uK3`

Everything else in your shader is a number typed into the text. These four are not: they are sliders in the panel under **ADVANCED → SHADER EDITOR**, they are MIDI-mappable like any other parameter, and they travel in presets.

```glsl
y = sin(r * (2.0 + uK0 * 20.0) + T) * (0.2 + uK1) * a;
```

Written that way, the wave's frequency and its depth are on two knobs. You are no longer editing a shader during a set — you are playing one.

That is the point of them. Without them a custom shader is frozen: to change any number you reopen a modal that blacks out the screen and, because the cursor sits in a text box, disarms every hotkey — then you edit, then APPLY recompiles, which is a hard cut rather than a fade. Every other live change in VIMATHIC is a tween: a GPU mode crossfades over 1.2 seconds, a palette over 0.6, a shape through a morph. The knobs put custom shaders on the same footing.

They run 0–1 with a default of 0, which is what a MIDI CC maps onto without a curve. Scale them in the shader, where you can see what you are scaling — `uK0 * 20.0` above is a frequency, `uK1` a depth. They are available in the fragment tab too.

To put one on a controller: **ADVANCED → MIDI**, pick *Shader Knob 1*, then move the knob.

**They also play the built-in modes.** With one of the numbered entries in SHADER MODE selected there is no custom body to give them a meaning, so they carry a fixed one: **1** scales the field (up to three times finer), **2** deepens it (up to 2.5×), **3** slides its clock (one sweep is one full turn, the same contract *Formula Phase* carries on the CPU side) and **4** moves the palette along its ramp. All four rest at 0 and every one of them is *identity* there, so a look you tuned before they did this comes back exactly as it was. Apply a custom body and the meanings go back to being yours — a program that could not reassign its own uniforms would not be one.

**Where to see them working.** Two entries in the editor's preset gallery are written around them — **🎛 Knobs** on the vertex tab (K1 frequency, K2 depth, K3 twist) and **🎛 Knob Tint** on the fragment tab (K1 hue drift, K2 contrast, K3 audio lift). Click one, press APPLY, then move a slider in **ADVANCED → SHADER KNOBS** and watch the shape change without the editor being touched again. Both shipped default bodies read a knob too, at a scale that is a no-op while the knob is at 0 — so the look you already know is the look you still get.

There is also one preset in the panel's own list, **🎛 Knobs (example)**, on a browser that has never saved one. It carries that shader, a numbered GPU mode (so the displacement is not discarded) and the knob positions it was written for — the whole thing on one click, without opening this editor at all. Delete it and it stays deleted.

### What a custom shader keeps, and the one thing it replaces

A custom body is not a trapdoor out of the rest of the app. While one is live:

| Control | Under a custom **fragment** body | Under a custom **vertex** body |
|---|---|---|
| Colour scheme (`Q` / `E`, the dropdown) | Applies. Use `paletteAt(x)` and it **crossfades** over 600 ms exactly as the built-in shader does; `getColor(uCM, x)` gives the same colour without the fade | Applies |
| SURF lighting — moving sun, diffuse, rim, specular | **Applies.** It is the same lighting block the built-in program runs, not a copy of it | Applies |
| Surface material, Bloom, Spectrum Rings, shape, the four knobs | Apply | Apply |
| **SHADER MODE 1–38** | **Does not** — see below | **Does not.** Your body *is* the displacement, so all 38 numbered entries draw the same thing until you reset. This is the one real boundary, and the editor says so above the code box |

APPLY installs **both** programs, whichever tab you pressed it on — the vertex body sitting in the other buffer goes live with your colour. So the SHADER MODE row above is not really a per-tab fact: from your first APPLY until RESET, the numbered entries stop driving the shape. If you only wanted a custom colour, RESET puts the built-in displacement back and keeps the palette dropdown meaningful again.

Two of those rows were broken until round 6 and said nothing about it: a palette change under a custom fragment body waited out the fade and then cut, and applying *any* fragment body — the shipped default included — silently deleted SURF's lighting. If you have a shader saved from before, it still compiles and still means the same thing; swap `getColor(uCM, t)` for `paletteAt(t)` when you want the fade.

### The 24-band spectrum

The vertex scaffold also hands you the analyser's full 24-band spectrum — the same data Spectrum Rings is drawn from. `uBass`, `uMid` and `uTreble` are three numbers for the whole mix; this is twenty-four, and you can put each one somewhere different on the body.

| Name | Type | Meaning |
|---|---|---|
| `bandAtRadius(float r)` | `float` | Band level at distance `r` from the centre. `r = 0` is band 0 (lowest), `r = uBandR` is band 23 (highest) |
| `bandAtU(float u)` | `float` | The same lookup on a normalised `0…1` coordinate — use it to map bands onto something other than radius |
| `uBands[24]` | `float[24]` | The raw levels, if you want one specific band. Index with a constant |
| `uBandR` | `float` | Radius the current body actually occupies, rewritten on every shape change, so band 23 lands on the rim of whatever is on screen |
| `uBandDepth` | `float` | The Spectrum Rings slider |

**These are vertex-only.** The fragment scaffold has no band functions; its only spectral channel is the `t` ramp, which the vertex stage has already shifted.

**Spectrum Rings already adds one band term**, and its default is 0.30, not 0 — so if you call `bandAtRadius` yourself while the slider is up, the body gets the spectrum twice. Set **Spectrum Rings to 0** and your call is the only band term, which is usually what you want when you are writing the mapping by hand.

A ring for each band, an octave of them from the centre outwards:

```glsl
y = bandAtRadius(r) * 1.2 * a;
```

One band on its own — band 3 is low bass, band 20 is air — driving a whole-surface pulse:

```glsl
y = sin(r * 6.0 - T * 2.0) * uBands[3] * 2.0 * a;
```

Bands mapped around the body instead of outwards from the centre, so the spectrum wraps the silhouette:

```glsl
y = bandAtU((ang + 3.14159) / 6.28318) * 1.5 * a;
```

A minimal example:

```glsl
y = sin(r * 8.0 * wi + T) * (0.2 + b * 0.8) * a;
```

This is a ring wave whose amplitude scales with bass.

## What you write — fragment tab

The scaffold defines:

| Variable | Type | Meaning |
|---|---|---|
| `t` | `float` | The palette ramp, `clamp((vH + 0.8) * 0.6, 0.03, 0.97)`, then shifted by the Spectrum Rings band that region listens to — the same shift the built-in fragment shader gets. What `vH` carries depends on the mode: the shader's own `y` in GPU mode, the CPU height field in **Surface** formula mode, and the vertex Y itself — base included — in **Volume** and **Collapse**. In GPU and Surface modes it equals the vertex Y only on a body whose base Y is zero, such as the plane. Set Spectrum Rings to 0 and the shift goes away |
| `c` | `vec3` | **Output** — assign your color here |
| `uCM`, `uCMNext`, `uCMBlend` | uniforms | Active palette index and crossfade |
| `uTime`, `uBass`, `uMid`, `uTreble`, `uBeat` | uniforms | Audio-reactive globals |

You also have **all 54 palette functions** available by name (`tealOrange`, `lava`, `cyberpunkGold`, `coalPlum`, `burgundyBlack`, etc.) plus a dispatcher:

```glsl
c = paletteAt(t);   // matches the palette dropdown, and fades when it changes
```

That's the default — picking a palette from the dropdown Just Works without you editing anything. You can call any palette by name explicitly to override:

```glsl
c = lava(t) * (0.7 + uBass * 0.5);
```

## Ten starter presets

| Preset | Tab | What it does |
|---|---|---|
| 🌊 Ocean | vert | Traveling sine waves with cross-grain detail |
| ⚡ Lightning | vert | High-frequency strikes driven by bass and treble (the beat term is muted — `bt` is 0 until you assign `bt = uBeat`) |
| 🌀 Vortex | vert | Spiral that rotates in time |
| 💎 Crystal | vert | Hard angular tiles + radial shimmer |
| 🔥 Plasma | vert | Turbulent noise + radial wave; add `bt = uBeat;` above it to get the beat punch |
| 🎆 Ramanujan | vert | The classic Ramanujan radial sum |
| 🌈 Neon | frag | RGB rainbow cycling with audio shift |
| 🔆 Lava | frag | Bass-pumped lava palette |
| 🎛 Knobs | vert | Ripples whose frequency, depth and twist sit on `uK0`, `uK1` and `uK2` — the one to reach for when you want to *play* a shader rather than write one |
| 🎛 Knob Tint | frag | Palette drift, contrast and audio lift on the same three knobs |

Click a preset to load it. It overwrites the editor's current contents; if you had unsaved changes, copy them somewhere first.

## Vertex example: a beat-pulsing wireframe

```glsl
y = sin(r * 12.0 * wi - T * 2.0) * exp(-r * 0.4) * (0.3 + b * 0.9) * a
  + sin(pos.x * 6.0 * wi) * cos(pos.z * 4.0 * wi) * 0.15 * a;
```

Damped traveling wave from the center plus a cross-grain ripple. The `exp(-r * 0.4)` damping keeps motion concentrated near the middle.

## Fragment example: chromatic strobe

```glsl
float h = t * 6.28 + uTime * 0.5;
c = vec3(
  abs(sin(h + uBass * 2.0)),
  abs(sin(h + 2.094 + uTreble)),
  abs(sin(h + 4.189))
);
```

RGB phases offset by 120° each — gives a rainbow that shifts under audio.

## Compile errors

When you click **APPLY**, the shader is compiled in a hidden test mesh first. If GLSL fails to compile, the error appears in red below the editor with the line number (relative to your code, not the full shader):

```
Line 8: 'sin' : wrong operand types
```

Common errors:

- **`'x' : redefinition`** — you declared a variable that the scaffold already defines (`r`, `ang`, `y`, etc.).
- **`'+' : wrong operand types`** — you tried `vec2 + float`. Use explicit casts or component-wise: `pos.xz + vec2(1.0, 1.0)`.
- **`syntax error`** — usually a missing semicolon. GLSL requires them.

## Combining custom shaders with built-in palette

The vertex tab is independent of palette choice. Even with custom vertex code, the palette dropdown still works — your geometry deforms with your math, and the color picks from `uCM`.

If you write only custom **fragment** code and assign `c = getColor(uCM, t)`, the dropdown continues to switch palettes. If you hardcode `c = lava(t)`, the dropdown is overridden.

## Tips

- **Start from a preset** — easier than from scratch. Click 🌊 Ocean, see how it's written, then modify one value at a time.
- **Use the audio uniforms aggressively** — `(0.3 + b * 0.7)` is the workhorse modulation pattern: a quiet floor + bass-driven scale.
- **Damping with `exp(-r * k)`** focuses motion near the center; without it, your math fights the panel edges.
- **Time scaling: `T * 0.5` slows, `T * 5.0` speeds up.** For audio sync, multiply audio bands rather than `T`.
- **Custom shader survives preset save/load** — your code is included in the preset JSON if it was applied at save time.

## Safety note

The shader editor compiles each program on a throwaway probe mesh and reports link failures through Three.js's `renderer.debug.onShaderError` hook — the compile itself is synchronous, so a shader that fails to link is reported as failed rather than as applied. GLSL runs in the GPU process and cannot escape its sandbox, but malformed code can still crash GPU drivers in extreme cases.

**If your screen freezes after APPLY, a plain refresh will not get you out.** The applied `customVS`/`customFS` are part of the auto-saved session snapshot (`localStorage` key `vimathic_persisted_state`, see [Presets & Clips](./presets.md)), so the next page load recompiles the same program. Two ways out: press **RESET ALL** if the panel still responds — it clears the custom shader *and* the snapshot — or, if the tab is unusable, delete the `vimathic_` keys in DevTools → **Application → Local Storage** ([Safety & Privacy](./safety.md)) before reloading.
