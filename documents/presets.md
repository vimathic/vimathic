---
title: Presets & Clips
order: 7
group: production
description: Save looks, recall them instantly, sequence them as live clips. Import/export presets as JSON for portability.
---

# Presets & Clips

VIMATHIC's preset system captures *the entire look* — shape, color, formula, audio sensitivities, camera state, custom shader — into a named entry you can recall in one click. The Clip Player then sequences saved presets for hands-free playback during sets.

## Saving a preset

1. Get the look you want (shape, color, formula, slider values — everything).
2. In the **PRESETS** section of the panel, type a name.
3. Click **SAVE**.

The preset appears in the list below with a Load button. Saving a name that already exists **overwrites** it without confirmation.

What gets captured:

- Shape and color scheme indices
- Visual mode (Surface / Wireframe / Points)
- GPU mode or CPU formula (and which math collection)
- Deformation mode (Surface / Volume / Collapse) and volume formula
- All audio slider values: amplitude, wave intensity, bass/treble sensitivity, bloom
- Camera position, target, FOV, physics mode, auto-rotate state
- Camera Programmer code and keyframes (if any)
- Custom shader code (if applied)
- Grid visibility
- Per-preset hold time for the Clip Player

What does NOT get captured:

- The audio source (you reload audio manually)
- MIDI mappings (separate storage)
- Output / recording settings
- Layered deformation effects from rapid mode-switching (a known limitation — see note below)

> **About layered deformation.** Switching between Volume mode formulas quickly, or pressing `R` while in Volume mode, can produce a striking visual effect where multiple deformations stack on top of each other in the geometry buffer. This composition is a side-effect of how the deformation pipeline reuses vertex positions between mode switches; it cannot currently be saved into a preset or reproduced from a reload, because the saved snapshot captures only the final mode and formula, not the chain of deformations that produced the visible result. A proper "Compose Mode" — explicit, controllable, and preset-saveable layering of deformations — is under consideration for a future release, after the current stability period.

## Loading a preset

Click the preset name. A smooth morph animation transitions the geometry, camera tweens to its target position, and the new look applies. Multiple changes are batched into one morph so they apply at the "flat" frame together — no flicker.

## Deleting a preset

Click the **✕** next to the preset name in the list. There is no confirmation dialog and no undo. If you delete by accident, you lose the entry. (Export your library to JSON periodically — see below.)

## Hold time

Each preset row has a small number field — the hold time in seconds. This is used by the Clip Player. Default is whatever the global "hold" slider is set to.

## The Clip Player

The Clip Player cycles through your saved presets like a slideshow. Open it from the panel:

- **▶ PLAY** — start cycling from the first preset
- **■ STOP** — stop cycling, hold current preset
- **⏭ SKIP** — jump to next preset immediately

Two timing modes:

- **SEC** — each preset holds for N seconds (default 5)
- **BARS** — each preset holds for N musical bars based on detected BPM

In bars mode, the player uses VIMATHIC's BPM detector. A 4-bar hold at 120 BPM = 8 seconds; at 90 BPM = 10.7 seconds. This stays musical even when the tempo changes.

### Sync with music

The **sync with music** checkbox links the Clip Player to audio playback:

- Audio plays → clip cycling starts automatically
- Audio pauses → clip cycling stops

Useful for hands-free playback.

### Camera transition between clips

The **camera transition** dropdown controls how the camera moves between presets:

- **auto** — derives from each preset's hold time (40% of hold, clamped 0.2–2.5s)
- **0** — instant cuts (old behavior)
- **fixed values** — explicit ms

Long, smooth transitions feel cinematic. Short or instant transitions feel rhythmic.

### Backgrounded tabs

If you switch to another browser tab while a clip is playing, browsers throttle JavaScript timers heavily. VIMATHIC handles this: when you return to the tab, the Clip Player **recomputes which preset should be active by wall-clock** and jumps to it. You won't see "we should be on preset 5 but we're still on preset 2" — the player catches up automatically.

This matters because audio (Web Audio) keeps playing in the background while visuals pause. The catch-up keeps the visual sequence aligned with the music it's reacting to.

## Import / export

### Export current state

Click **EXPORT** in the panel. A JSON file downloads with the complete state (one preset's worth of data). Use it for:

- Backup before risky changes
- Sharing a look with someone else
- Versioning your library in git

### Import a state file

Click **IMPORT**, choose a `.json` file. The state applies just like a preset load (smooth morph, camera tween).

### Security: imported preset with JavaScript

If the imported file contains Camera Programmer code, VIMATHIC shows a **preview modal** with the code and asks "KEEP CODE" or "DISCARD CODE". This is a deliberate safety gate — Camera Programmer scripts execute via `new Function()` and have full access to the page's origin. Never click KEEP on code from an untrusted source you haven't read.

If you click KEEP, the code is loaded into the Camera Programmer editor but **not auto-executed**. You still need to open the editor and click APPLY manually before it runs. This is two-layer defense.

## Preset versioning

Preset JSON files carry a `_version` field. As VIMATHIC evolves, the snapshot format may change. The loader has a **migration function** that walks old presets forward through any structural changes that happen between versions — so a preset saved in one release still loads in a later one.

If you load a preset from a *future* VIMATHIC version, you'll see a warning in the console — fields the current build doesn't understand are ignored, but the load tries its best. The reverse (future loading past) is the standard path and always works.

Current preset format version: **2**.

## Tips

- **Build a library of looks for each track or set.** Name them by mood: "verse-pulse", "drop-stab", "ambient-float". Cycling four well-chosen presets gives more visual variety than fiddling with sliders mid-set.
- **Tune per-preset hold times.** A high-energy preset benefits from 4 bars; a slow ambient one wants 16. Edit the seconds field next to each row.
- **For VJ sets, use bars mode + sync with music.** Build a 16-preset clip, set 4 bars each, hit play, never touch the keyboard for an hour.
- **Export weekly.** Browser cache clearing wipes localStorage. A JSON backup once a week is the difference between losing 3 hours of work and not.

## Where the data lives

- **Named presets** — `localStorage` under key `vimathic_presets`
- **Auto-persisted live state** — `localStorage` under key `vimathic_persisted_state` (everything the current session looks like, written debounced; restored on next page load)
- **MIDI mappings** — `localStorage` under key `vimathic_midi_map`
- **Last About-modal tab** — `localStorage` under key `vimathic_about_last_tab`
- **First-launch tour flag** — `localStorage` under key `vimathic_about_seen` (set to `'1'` after the About modal has been opened once; stops the tour from appearing again)
- **Intro track preference** — `localStorage` under key `vimathic_intro_cleared` (set to `'true'` after user clicks Clear; prevents the bundled intro track from auto-loading on future visits)

To wipe all VIMATHIC data: open DevTools → Application → Local Storage → `vimathic_*` keys → delete. Clearing your browser cache normally **does not** delete localStorage; it requires explicit "site data" clearing.
