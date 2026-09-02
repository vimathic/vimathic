---
title: Quick Start
order: 1
group: getting-started
description: First five minutes with VIMATHIC — load a track, watch it react, try a few hotkeys.
---

# Quick Start

VIMATHIC is a mathematical VJ studio that runs in your browser. Drop in a track — a music file, the microphone, a browser tab, or system audio — and 192 mathematical formulas, 38 GPU shaders, and 54 colour schemes come to life, reacting to the music in real time.

> ⚠️ **Before you start.** VIMATHIC produces rapid flashing visuals — please read [Safety & Privacy](./safety.md) if you have epilepsy, migraines, or motion sickness. The app is tested primarily in **Chrome and Edge on desktop**; other browsers may have reduced functionality. **On mobile** the visualizer renders at a lower frame rate to manage thermal load, but extended use can still warm the device — give it breaks during long sessions. A dedicated mobile app is on the [Roadmap](./roadmap.md).

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

The control panel in the bottom-right corner exposes the main knobs — on narrow screens it becomes a full-width sheet along the bottom edge:

- **Visual Style** — Surface / Wireframe / Points rendering modes.
- **Shape** — Pyramid, Sphere, Torus, Icosahedron, and others. The mesh that the math deforms.
- **Math Formula / GPU Shader** — the equation driving the animation. 192 CPU formulas + 38 GPU shaders.
- **Color Scheme** — 54 palettes from cinematic to synthwave to scientific to dark, ending in a 10-palette Night collection for a dark room. The **☾ NIGHT** button beside ⟳ AUTO narrows the automatic pickers to those ten, hides the starfield and dims the grid; the dropdown stays free.
- **Surface Material** — six finishes from Matte to Mirror. SURFACE mode only; the row hides itself in Wireframe and Points, where reflections cannot be drawn.
- **Particle Style** — the same idea for POINTS mode, and it appears with it: **Squares (large)** is the original look, **Dots (small)** turns each point into a small round particle, and **Smoke trail** keeps those small particles but has them glow and drag a decaying wake behind them. The trail is motion-driven, so it shows best with the camera moving or the music hitting.
- **⟳ AUTO** — the button beside either of those two lets it drive itself: a new palette (or finish) at random, always as a crossfade, never a cut. With music playing the changes land on the beat — every 8 bars for colour, 16 for material, off the detected BPM; with the track stopped they come on a timer instead. While AUTO is on it owns that parameter: **clip player** steps apply everything else their preset holds but stop overwriting the colour / material it is cycling. Loading a preset by hand still applies both, and RESET ALL switches AUTO off.
- **Spectrum Rings** — the one slider that changes what the body is *listening to*. The other audio controls hand the shape three lumped numbers (bass, mid, treble); this one spreads twenty-four bands of hearing **across the body**, so different regions answer different parts of the spectrum instead of all of them answering all of it. It ships at 0.30, which is enough to see without the music taking the formula over; drag it to 0 and you get exactly the picture the app drew before the layer existed.
  - **Rings follow the formula** (checked by default) decides where the bands land. Unchecked, they are concentric rings from the axis — the same layout under every figure. Checked, the layout is built from the **formula's own texture**: where the equation is broad and lazy a region listens to the bass, where it is finely corrugated it listens to the cymbals. Each band also moves in its own way — a slow breath at the smooth end, a travelling ripple in the middle, a shimmer where the detail is finest. The body's own curvature has a say too, so the same formula on a gyroid and on a sphere does not land the same way.
  - Bass moves the body further than treble does, for the same loudness — closer to how sound is actually felt. And a zone's place on the colour ramp tells you which part of the spectrum it belongs to, so the layout reads as a map. That tint is fixed per region: it does not flash with the music (see **Safety** for why nothing here is beat-driven by default).
  - In **Points** mode a loud band also throws its grains off the surface and swells them, so the body reads as a cloud the music stirs.
- **Audio sliders** — Amplitude, Wave Intensity, Bass/Treble Sensitivity, Bloom.
- **Camera** — Reset camera position, toggle Auto-Rotate.
- **⏸ STOP MOTION** — in the FPS row near the bottom of the panel, beside the FPS counter and the **i** button, it freezes the picture on its current frame; the music keeps playing, and a second click resumes exactly where it held.

## 5. Save what you like — and play it back

When you've got a look you want to keep:

1. Type a name in **PRESET NAME**, click **SAVE**.
2. It appears in the preset list with its own thumbnail-style button.
3. Click any saved preset to load it back instantly.

For VJ sets there's also **CLIP PLAYER** — auto-cycle through your presets with a configurable hold time (seconds or musical bars). Click ▶ PLAY to start, ■ STOP to stop.

## What next

- **Hotkeys** — full keyboard reference
- **MIDI** — map a hardware controller to any parameter
- **Camera Programmer** — script camera movement in tiny JavaScript snippets
- **Shader Editor** — write your own GLSL fragments and vertex code
- **Recording** — export GIF or WebM of what you see

The **i** button, in that same FPS row, opens this documentation any time.