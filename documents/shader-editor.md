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

If you APPLY custom vertex code while a CPU formula is active, you'll see "✔ Compiled & applied" in green — that means your GLSL is valid, but the displacement won't show on the canvas until you switch to a numbered GPU shader. (Custom fragment color applies immediately in either mode.)

## Opening it

Open **ADVANCED** in the control panel, expand **SHADER EDITOR**, and click **✎ EDIT GLSL SHADER**. The modal has:

- **Tabs** — switch between vertex and fragment code
- **Presets strip** — eight starters covering both tab types
- **Editor textarea** — your code goes here
- **APPLY** — compile and use; errors appear in red below
- **RESET** — discard custom code, revert to built-ins

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
c = getColor(uCM, t);   // matches the palette dropdown
```

That's the default — picking a palette from the dropdown Just Works without you editing anything. You can call any palette by name explicitly to override:

```glsl
c = lava(t) * (0.7 + uBass * 0.5);
```

## Eight starter presets

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
