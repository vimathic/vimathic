---
title: Quick Start
order: 1
group: getting-started
description: First five minutes with VIMATHIC — load a track, watch it react, try a few hotkeys.
---

# Quick Start

VIMATHIC is a mathematical music visualizer that runs in your browser. Drop in a track — a music file, the microphone, a browser tab, or system audio — and 192 mathematical formulas, 38 GPU shaders, and 54 colour schemes come to life, reacting to the music in real time.

> ⚠️ **Before you start.** VIMATHIC produces rapid flashing visuals — please read [Safety & Privacy](./safety.md) if you have epilepsy, migraines, or motion sickness. The app is tested primarily in **Chrome and Edge on desktop**; other browsers may have reduced functionality. **On mobile** the visualizer renders at a lower frame rate to manage thermal load, but extended use can still warm the device — give it breaks during long sessions.

## 1. Get audio into the app

VIMATHIC starts with an intro track already loaded — *Stilicium*. Click **▶ PLAY** and it'll play, driving the visualization. The track is bundled with the app and works offline.

If you want to play your own music instead:

- **Drag-and-drop** an MP3, WAV, FLAC or OGG file onto the window. Multiple files at once queue up as a playlist.
- Click **CLEAR** in the playlist to remove the intro track first, then drop your files.
- Open **ADVANCED** in the panel, expand **VIDEO OUTPUT & AUDIO IN** — both ship collapsed — and click **AUDIO SOURCE** (it reads *AUDIO SOURCE: FILE* until you change it) to pick microphone, browser tab, or system audio for live input instead of a file.

Once you click Clear, the intro track won't auto-load on future visits — VIMATHIC remembers you prefer your own music. You can clear localStorage to bring it back if you change your mind.

You'll see a seek bar, track name, and a small loading bar while the file decodes.

## 2. Watch the math react

The visualizer is already running with sensible defaults: Pyramid Smooth shape, Amber color scheme, wireframe mode, Nonlinear Pendulum formula. As soon as audio plays:

- **Bass** pushes geometry up and down.
- **Treble** sharpens edges and detail.
- A **beat detector** runs in the background. Its output is intentionally muted in the default look (so the picture stays musical, not strobe-like), but it's available where it matters: BPM feeds the Camera Programmer, and the GIF recorder can beat-sync perfect loops.

If nothing visibly happens — your audio is probably very quiet, or muted. Check the **Amplitude** slider in the control panel, and **Bass Sensitivity** under **ADVANCED** → **▸ AUDIO SENSITIVITY**.

## 3. Try a few hotkeys

The single most useful key while exploring:

- `R` — randomize *everything* (shape + color + formula)
- `F` — random math formula only
- `Q` — random color scheme
- `I` — show the full hotkey hint

That's enough to get a feel for what the system can do. See the **Hotkeys** tab for the full list.

## 4. Find a look you like

The control panel in the bottom-right corner exposes the main knobs — on narrow screens it becomes a full-width sheet along the bottom edge:

- **Visual Style** — Surface / Wireframe / Points rendering modes.
- **Shape** — Pyramid, Sphere, Torus, Icosahedron, and others. The mesh that the math deforms.
- **Math Formula / GPU Shader** — the equation driving the animation. 192 CPU formulas + 38 GPU shaders.
- **Color Scheme** — 54 palettes from cinematic to synthwave to scientific to dark, ending in a 10-palette Night collection for a dark room. The **☾ NIGHT** button beside ⟳ AUTO narrows the automatic pickers to those ten and dims the grid; the starfield stays (**STARS** turns it off), and the dropdown stays free.
- **Surface Material** — six finishes from Matte to Mirror. SURFACE mode only; the row hides itself in Wireframe and Points, where reflections cannot be drawn.
- **Particle Style** — the same idea for POINTS mode, and it appears with it: **Squares (large)** is the original look, **Dots (small)** turns each point into a small round particle, and **Smoke trail** keeps those small particles but has them glow and drag a decaying wake behind them. The trail is motion-driven, so it shows best with the camera moving or the music hitting.
- **Wire Style** — the same idea once more, for WIREFRAME mode, and it is on screen from the start because the app opens in it. A line stays one pixel wide whatever you pick (browsers on Windows cannot draw thicker WebGL lines), so the styles change everything else about it: **Classic** is the original look; **Neon** makes the lines glow and add up where they cross, brightest at the silhouette and in the folds; **Hidden line** hides every line behind the body, so the shape reads as a solid; **Trails** gives each line a fading wake as the surface moves; **Depth fade** lets the far side sink into the dark; **Scan** sends a ring of light outward across the mesh, about one every two and a half seconds; **Hologram** puts a see-through glowing body under the lines, bright at its edges; **Rows** keeps one direction of the body's grid — a few dozen ridgelines — and hides everything behind the body; **Grid** is the wire without its triangle diagonals; **Contours** draws lines of equal height on the body, a relief map of the formula on the plane; **Lattice** lets the body drift through a 3D lattice of light, its glowing lines seen through the body from both sides; **Electric** sends thin veins of energy crawling over dim glowing lines; **Aurora** lets the palette flow over the wire in slow curtains, still coloured by the music; **Light painting** is Neon with a long light trail; **Glass** puts glowing edges on a dark glass body. Contours and Lattice are the styles whose lines are wider than a pixel. Rows and Grid need a body built as a grid (the plane, the sphere, the cylinders and cones, the tori, the parametric surfaces); on the polyhedra and the implicit surfaces they keep the full wire. Under **☾ NIGHT** the glowing styles — Neon, Hologram, Lattice, Electric, Light painting and Glass — are dimmed, because their lines add up. Every moving style moves on its own clock, never with the beat, so none of them flashes.
- **⟳ AUTO** — the button beside Color Scheme or Surface Material lets it drive itself: a new palette (or finish) at random, always as a crossfade, never a cut. With music playing the changes land on the beat — every 8 bars for colour, 16 for material, off the detected BPM; with the track stopped they come on a timer instead. While AUTO is on it owns that parameter: **clip player** steps apply everything else their preset holds but stop overwriting the colour / material it is cycling. Loading a preset by hand still applies both, and RESET ALL switches AUTO off.
- **Spectrum Rings** — the one slider that changes what the body is *listening to*. The other audio controls hand the shape three lumped numbers (bass, mid, treble); this one spreads twenty-four bands of hearing **across the body**, so different regions answer different parts of the spectrum instead of all of them answering all of it. It ships at 0.30, which is enough to see without the music taking the formula over; drag it to 0 and you get exactly the picture the app drew before the layer existed.
  - **Rings follow the formula** (checked by default) decides where the bands land. Unchecked, they are concentric rings from the axis — the same layout under every figure. Checked, the layout is built from the **formula's own texture**: where the equation is broad and lazy a region listens to the bass, where it is finely corrugated it listens to the cymbals. Each band also moves in its own way — a slow breath at the smooth end, a travelling ripple in the middle, a shimmer where the detail is finest. The body's own curvature has a say too, so the same formula on a gyroid and on a sphere does not land the same way.
  - The layout also follows the **deformation mode**, because the three modes read one equation differently: SURFACE reads it as a height over the ground plane, COLLAPSE reads it around the body from its centre, and VOLUME runs a different equation entirely — a vector field that pushes each point in three dimensions. Switching between them re-lays the spectrum. Until 03.09.2026 none of that reached the layer: COLLAPSE wore the layout SURFACE had built, which on a closed body meant the top and the bottom of it pulsed on one band while the mode's own displacement moved them by different amounts; and VOLUME wore whichever surface formula had last been chosen, so all six volume fields shared one identical layout.
  - Where an equation genuinely has nothing to say on a given body, the layer still steps back to plain concentric rings — as it always has. **Radial Breathe** on a **Sphere** is the clearest case: a sphere's surface is all one radius, so a field of distance-from-centre pushes every part of it equally, and there is nothing for twenty-four bands to divide up. Put the same field on a Torus and the layout comes back.
  - Bass moves the body further than treble does, for the same loudness — closer to how sound is actually felt. And a zone's place on the colour ramp tells you which part of the spectrum it belongs to, so the layout reads as a map. That tint is fixed per region: it does not flash with the music (see **Safety** for why nothing here is beat-driven by default).
  - In **Points** mode a loud band also throws its grains off the surface and swells them, so the body reads as a cloud the music stirs.
- **Audio sliders** — Amplitude, Wave Intensity and Bloom sit in the panel itself; Bass/Treble Sensitivity are under **ADVANCED** → **▸ AUDIO SENSITIVITY**.
- **Formula Detail / Formula Phase** — the two hands on a *formula*. (SHADER MODE's **numbered** entries are GPU shaders and have their own four **Shader Knobs**; everything else in that list is a formula, and these two are its.) The two sets share one place in the panel, under Wave Intensity: pick a numbered entry and the four Shader Knobs take this pair's place, pick a formula and the pair comes back.
  - **Detail** rests in the middle, and the middle is exactly what the app has always done — it is a no-op where it sits. Turn it **up** for more iterations, a finer regime, a busier surface. Turn it **down** for a coarser one, and that half is not the lesser setting: a handful of the heaviest formulas cannot finish their maths sixty times a second, so their surface updates in visible steps, and turning Detail down is how you buy that rate back. On the heaviest of them it is about four to one.
  - **Phase** slides the formula's own clock. The beat already nudges it; this is the same nudge under your hand, so you can put a crest on a downbeat instead of waiting for the track to put it there. One full sweep is one full cycle.
  - Both are MIDI-mappable and both travel in presets, so where you left them is part of the look. They are hidden while a numbered GPU shader is drawing, because they would do nothing there; MIDI and presets still reach whichever set is hidden, and RESET ALL resets both.
  - Both have a key, too: hold **B** (Detail) or **N** (Phase) and drag the mouse. On a numbered entry **Y**, **U**, **H** and **J** do the same for Shader Knobs 1–4 — right after you pick the entry, with no click on the canvas first. A key acts only while its sliders are the ones the panel shows for the engine that is drawing, so B and N rest under a numbered shader and Y U H J under a plain formula; it keeps working in full screen, with the panel collapsed or the FORMULA section folded, where the sliders are out of sight by design. The drag covers the whole 0 – 1 and stops at both ends. The **Hotkeys** tab has the details.
  - The Shader Knobs also appear *beside* the pair on a formula while your own shader is applied (see **Shader Editor**): a custom shader can colour a formula, and its knobs are live there — keys included.
- **Camera** — **RESET CAMERA** sits in the panel itself; **CAM ROTATE** (auto-rotate) is under **ADVANCED** → **CAMERA PROGRAMMER**, two collapsed levels down.
- **⏸ STOP MOTION** — in the FPS row near the bottom of the panel, beside the FPS counter and the **i** button, it freezes the picture on its current frame; the music keeps playing, and a second click resumes exactly where it held.
- **STARS** — in the same FPS row, between ⏸ STOP MOTION and TOGGLE GRID. It switches the starfield behind the body off, and a second click brings it back; the button dims while the stars are off. **TRANSPARENT BG** hides the stars either way, because an alpha capture must not carry them, and leaving it respects your choice: the stars come back only if STARS has them on. The setting travels in presets and clip steps, and **RESET ALL** turns the stars back on.

## 5. Save what you like — and play it back

When you've got a look you want to keep:

1. Open **ADVANCED** in the panel — it ships collapsed — and under **▸ STATE & PRESETS** type a name into the field marked *Preset name…*, then click **＋ SAVE**.
2. It appears in the preset list with its own thumbnail-style button.
3. Click any saved preset to load it back instantly.

For VJ sets there's also **CLIP PLAYER**, under **ADVANCED** → **▸ CLIP PLAYER** — auto-cycle through your presets with a configurable hold time (seconds or musical bars). Click ▶ PLAY to start, ■ STOP to stop.

## What next

- **Hotkeys** — full keyboard reference
- **MIDI** — map a hardware controller to any parameter
- **Camera Programmer** — script camera movement in tiny JavaScript snippets
- **Shader Editor** — write your own GLSL fragments and vertex code
- **Recording** — export GIF or WebM of what you see

The **i** button, in that same FPS row, opens this documentation any time.