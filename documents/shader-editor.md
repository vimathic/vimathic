---
title: Shader Editor
order: 5
group: production
description: Write live GLSL vertex and fragment code — audio uniforms, 36 palettes, 8 starter presets.
---

# Shader Editor

The Shader Editor lets you replace VIMATHIC's built-in GLSL with your own code, compiled live against the GPU. Two tabs: **vertex** (geometry deformation) and **fragment** (per-pixel coloring). Both have access to the same audio-reactive uniforms as the built-in shaders.

If GLSL is new to you: vertex shaders move points in 3D space, fragment shaders pick the color of each pixel. The editor wraps your code in a minimal scaffold so you can focus on the math.

## Prerequisite — switch to a GPU shader first

**The Shader Editor only affects rendering when the visualizer is in GPU mode.** In CPU mode the geometry is deformed by JavaScript and your custom shader sits unused — your code compiles fine but nothing changes on screen.

How to tell which mode you're in: open the **SHADER MODE** dropdown in the panel. It contains both types in groups:

- **GPU shaders are numbered** — *1. Bass Reactive Waves*, *2. Spectrogram Mode*, … through *38. Spectral Centroid*. Pick any one of these to put the visualizer in GPU mode.
- **CPU formulas have no number** — *Mandelbrot Escape*, *Julia Set (animated)*, *Lorenz Attractor Slice*, etc. These run on the CPU and bypass the Shader Editor.

To use the Shader Editor: pick a **numbered** entry from the dropdown, then open **SHADER EDITOR** and APPLY your code.

If you APPLY a custom shader while a CPU formula is active, you'll see "✔ Compiled & applied" in green — that means your GLSL is valid, but you won't see it on the canvas until you switch to a numbered GPU shader.

## Opening it

Click **SHADER EDITOR** in the control panel (below the camera section). The modal has:

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
| `t` | `float` | Normalized height, 0–1 (from current vertex Y) |
| `c` | `vec3` | **Output** — assign your color here |
| `uCM`, `uCMNext`, `uCMBlend` | uniforms | Active palette index and crossfade |
| `uTime`, `uBass`, `uTreble` | uniforms | Audio-reactive globals |

You also have **all 36 palette functions** available by name (`tealOrange`, `lava`, `cyberpunkGold`, etc.) plus a dispatcher:

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
| ⚡ Lightning | vert | High-frequency strikes triggered by beats |
| 🌀 Vortex | vert | Spiral that rotates in time |
| 💎 Crystal | vert | Hard angular tiles + radial shimmer |
| 🔥 Plasma | vert | Turbulent noise + radial wave + beat punch |
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

The shader editor compiles GLSL via Three.js `compileAsync()`. GLSL runs in the GPU process and cannot escape its sandbox, but malformed code can still crash GPU drivers in extreme cases. If your screen freezes after APPLY, refresh the page — `customVS`/`customFS` are runtime-only and don't persist across reloads unless saved as a preset.
