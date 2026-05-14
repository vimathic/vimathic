---
title: Quick Start
order: 1
group: getting-started
description: First five minutes with VIMATHIC — load a track, watch it react, try a few hotkeys.
---

# Quick Start


VIMATHIC is a mathematical VJ studio that runs in your browser. Drop in a track — a music file, the microphone, a browser tab, or system audio — and 192 mathematical formulas, 38 GPU shaders, and 36 colour schemes come to life, reacting to the music in real time.

> ℹ️ **Before you start.** VIMATHIC was built with AI assistance (Claude, Anthropic) — mathematical, scientific, and legal claims have not been independently verified. The visualizer also produces rapid flashing visuals; please read [Safety & Privacy](./safety.md) if you have epilepsy, migraines, or motion sickness. **Tested primarily in Chrome and Edge** — other browsers may have reduced functionality.

## 1. Get audio into the app

VIMATHIC starts with an intro track already loaded — *S. Melentyev — Vimathic*. Click **▶ PLAY** and it'll play, driving the visualization. The track is bundled with the app and works offline.

If you want to play your own music instead:

- **Drag-and-drop** an MP3, WAV, FLAC or OGG file onto the window. Multiple files at once queue up as a playlist.
- Click **CLEAR** in the playlist to remove the intro track first, then drop your files.
- Open **AUDIO SOURCE** in the panel and pick microphone, browser tab, or system audio for live input instead of a file.

Once you click Clear, the intro track won't auto-load on future visits — VIMATHIC remembers you prefer your own music. You can clear localStorage to bring it back if you change your mind.

You'll see a seek bar, track name, and a small loading bar while the file decodes.

## 2. Watch the math react

The visualizer is already running with sensible defaults: Pyramid Smooth shape, Amber color scheme, wireframe mode, Nonlinear Pendulum formula. As soon as audio plays:

- **Bass** pushes geometry up and down.
- **Treble** sharpens edges and detail.
- A **beat detector** runs in the background. Its output is intentionally muted in the default look (so the picture stays musical, not strobe-like), but it's available where it matters: BPM feeds the Camera Programmer, and the GIF recorder can beat-sync perfect loops.

If nothing visibly happens — your audio is probably very quiet, or muted. Check the **Amplitude** and **Bass Sensitivity** sliders in the control panel.

## 3. Try a few hotkeys

The single most useful key while exploring:

- `R` — randomize *everything* (shape + color + formula)
- `F` — random math formula only
- `Q` — random color scheme
- `H` — show the full hotkey hint

That's enough to get a feel for what the system can do. See the **Hotkeys** tab for the full list.

## 4. Find a look you like

The control panel on the left exposes the main knobs:

- **Visual Style** — Surface / Wireframe / Points rendering modes.
- **Shape** — Pyramid, Sphere, Torus, Icosahedron, and others. The mesh that the math deforms.
- **Math Formula / GPU Shader** — the equation driving the animation. 192 CPU formulas + 38 GPU shaders.
- **Color Scheme** — 36 palettes from cinematic to synthwave to scientific.
- **Audio sliders** — Amplitude, Wave Intensity, Bass/Treble Sensitivity, Bloom.
- **Camera** — Reset camera position, toggle Auto-Rotate.

## 5. Save what you like — and play it back

When you've got a look you want to keep:

1. Type a name in **PRESET NAME**, click **SAVE**.
2. It appears in the preset list with its own thumbnail-style button.
3. Click any saved preset to load it back instantly.

For VJ sets there's also **CLIP PLAYER** — auto-cycle through your presets with a configurable hold time (seconds or musical bars). Click ▶ to start, ⏹ to stop.

## What next

- **Hotkeys** — full keyboard reference
- **MIDI** — map a hardware controller to any parameter
- **Camera Programmer** — script camera movement in tiny JavaScript snippets
- **Shader Editor** — write your own GLSL fragments and vertex code
- **Recording** — export GIF or WebM of what you see

The **i** button (top of FPS panel) opens this documentation any time.