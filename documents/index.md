---
title: Overview
order: 0
description: VIMATHIC is a browser-based mathematical VJ studio that turns audio into real-time visualizations driven by 192 canonical mathematical formulas, 38 GPU shaders, and 36 colour schemes.
---

# VIMATHIC — Mathematical VJ Studio

VIMATHIC is a browser-based mathematical VJ studio. It runs entirely in a modern web browser, with no installation, no accounts, and no plugins. You load audio — a music file, the microphone, a browser tab, or system output — and the visualizer reacts in real time using 192 mathematical formulas, 38 GPU shaders, and 36 colour schemes.

## What it does

The visualizer takes any audio source and decomposes it into bass and treble bands plus beat detection. Bass and treble drive geometric deformation through canonical mathematical functions — Bessel functions, modular forms, fractals, reaction-diffusion equations, and others — rather than from pre-rendered animations. The beat detector runs in the background: its BPM feeds the Camera Programmer and the beat-synced GIF recorder, while its direct effect on the default visualisation is intentionally muted.

- **192 CPU formulas** across 12 mathematical domains (fractals, special functions, probability, linear algebra, trigonometry, complex analysis, Fourier series, differential equations, integral transforms, topology, cellular automata, quantum mechanics)
- **38 GPU shaders** (audio-reactive vertex and fragment programs) running on the graphics card for real-time performance
- **36 colour schemes** ranging from cinematic to synthwave to scientific
- **20 base 3D shapes** with three render modes (surface, wireframe, points) and three deformation modes (surface, volume, collapse)
- **MIDI controller support** for any controller that sends standard CC messages
- **Recording suite** for animated GIF (beat-synchronized loops) and high-quality WebM video
- **Live performance tools**: clip player, second-screen output, virtual camera, OBS integration

## Mathematical accuracy

Every formula is documented with its accuracy tier. 120 formulas use closed-form mathematical expressions at IEEE 754 double precision (~10⁻¹⁴). 44 use bounded numerical approximations with documented error margins (10⁻³ to 10⁻⁷). 28 are visualisation-grade — qualitatively faithful but not numerically verified for production scientific use. Reference values are cross-checked against mpmath, scipy.special, and NIST DLMF. Full per-formula breakdown and test methodology is available in the project's [Mathematical Accuracy](https://github.com/vimathic/vimathic/blob/main/MATHEMATICAL_ACCURACY.md) document on GitHub.

## Single-file deployment

The entire application — UI, renderer, audio engine, math engine, shader compiler, GIF recorder, WebM recorder, and full documentation — is bundled into a single `index.html` file (~900 KB) plus three companion files: the Web Worker for off-main-thread math, the second-screen popup target, and the bundled intro track. The app runs offline after first load and makes no runtime network requests beyond fetching the intro track once.

## Documentation

This documentation covers every part of VIMATHIC in detail. Pick the topic that matches what you want to do:

### Getting started

- [Quick Start](./quick-start.md) — first five minutes with VIMATHIC: load a track, watch it react, try a few hotkeys
- [Hotkeys](./hotkeys.md) — full keyboard shortcut reference, including hold-and-drag performance keys

### Audio and controllers

- [MIDI](./midi.md) — map any hardware MIDI controller to any VIMATHIC parameter using one-tap Learn mode

### Visual control

- [Camera Programmer](./camera-programmer.md) — small JavaScript DSL for scripting audio-reactive camera motion
- [Shader Editor](./shader-editor.md) — write live GLSL vertex and fragment code with audio-reactive uniforms

### Production

- [Recording](./recording.md) — export visualizations as animated GIF or WebM video
- [Presets & Clips](./presets.md) — save looks, recall them instantly, sequence them as live clips
- [Output](./output.md) — send VIMATHIC to a projector, OBS, or professional VJ software

### Support

- [Troubleshooting](./troubleshooting.md) — common issues and their fixes
- [Safety & Privacy](./safety.md) — how VIMATHIC handles data and a few health notes worth knowing
- [The Science](./science.md) — what published research says about fractal patterns and audiovisual stimulation
- [License](./license.md) — plain-English explanation of how VIMATHIC is licensed
- [Support the Project](./support.md) — ways to contribute if you find VIMATHIC useful

## Technical details

VIMATHIC is built with Three.js for WebGL rendering, the Web Audio API for spectral analysis and beat detection, and the Web MIDI API for controller integration. The source code is on [GitHub](https://github.com/vimathic/vimathic) under Business Source License 1.1, automatically converting to GPL v3 on 2031-05-09. After conversion, VIMATHIC and any derivative work that gets distributed must remain open-source under GPL v3. Accredited educational institutions can use VIMATHIC under Apache 2.0 terms immediately, free of charge.

## Browser support

VIMATHIC targets modern browsers with WebGL 2.0 and the Web Audio API. Chrome and Edge have the fullest feature support including Web MIDI and tab audio capture. Firefox and Safari work for the core visualizer but lack Web MIDI. On mobile, Chrome on Android is the most capable platform; iOS Safari works for playback but has limitations on recording and audio capture.

## Author and AI-assistance disclosure

VIMATHIC was designed and built by **S. Melentyev** in collaboration with **Claude** (Anthropic AI). Code, documentation, and mathematical claims were produced with AI assistance. The collaboration is documented openly because honesty matters more than the optics of it.

---

*VIMATHIC™ · v1.0 (Beta) · Mathematical VJ Studio*
