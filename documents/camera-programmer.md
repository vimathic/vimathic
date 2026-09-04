---
title: Camera Programmer
order: 4
group: production
description: Tiny JavaScript DSL for scripting camera behaviour — audio-reactive, beat-aware, keyframed.
---

# Camera Programmer

The Camera Programmer lets you write small JavaScript snippets that run every frame to drive the camera. Variables for time, audio bands, beats, and BPM are passed in directly — no API calls needed. Eight built-in presets cover most use cases; the editor exists for when you want something specific.

## Opening it

In the control panel, open **CAMERA PROGRAMMER** (under ADVANCED) and click **PROGRAM CAM.** A modal opens with three panes:

- **CODE** — your script
- **PARAMS** — sliders for tunables (rotSpeed, radius, height, gravity, etc.)
- **TIMELINE** — keyframes that layer extra script code at moments in the track

The preset strip beneath the code editor has eight starter scripts to try. Click one to load it into the editor.

## How it runs

Your script is wrapped in a function and called once per animation frame, while auto-rotate is ON. Stop conditions: a drag held past half a second, which switches auto-rotate off with it; auto-rotate toggled off directly; or you click **RESET**. A short drag or a wheel zoom only pauses the script while it lasts — it resumes by itself when you let go.

The script receives a `ctx` object — but in your code you write the variables directly (they're destructured for you). Modify `ctx.cam.x`, `ctx.cam.y`, `ctx.cam.z` to position the camera; `ctx.target.x/y/z` to aim; `ctx.fov` to zoom; `ctx.roll` to bank.

### While a clip is playing

Arming the programmer during a Clip Player run takes the camera away from the player for the rest of that clip: the presets keep cycling their look, but they stop restoring their saved viewpoint over your script. Switching auto-rotate off — or pressing **▶ PLAY** again — hands the camera back. See [Presets & Clips](./presets.md) for the full rule.

## Available in your script

### Audio-reactive variables

| Variable | What it is | Range |
|---|---|---|
| `time` | The app's animation clock — 0.48 units per real second, held still by STOP MOTION | grows monotonically |
| `bass` | Bass band energy | 0.0 – 1.2 typical |
| `mid` | Mid band energy | 0.0 – 1.0 typical |
| `treble` | Treble band energy | 0.0 – 1.2 typical |
| `beat` | 1 on a detected beat, else 0 | binary impulse |
| `bpm` | Detected tempo | 60 – 180 typical |

### Camera state (mutable)

| Variable | Purpose |
|---|---|
| `cam.x`, `cam.y`, `cam.z` | Camera position in world space |
| `target.x`, `target.y`, `target.z` | Point the camera looks at |
| `fov` | Field of view in degrees (clamped 10–160) |
| `roll` | Z-rotation in radians (small values, e.g. `0.1`) |
| `rotAngle` | Internal orbit angle, used by `orbit()` helper |
| `R` | Read-only orbit-radius constant from the app config (currently 7.2). Most scripts should use `p.radius` instead — that's the slider-tunable one — but `R` is available if you want the unmodified default. |

### Tunables (the `p.` namespace)

Bound to the sliders in the **PARAMS** pane:

| Variable | Default | Range | Use |
|---|---|---|---|
| `p.rotSpeed` | 0.00002 | 0–0.002 | Orbit speed |
| `p.radius` | 7.2 | — | Orbit radius |
| `p.height` | 3.2 | — | Vertical position |
| `p.gravity` | 0.0004 | — | Vertical force scale |
| `p.bassReact` | 1.0 | — | How much bass modulates speed |
| `p.damping` | 0.996 | — | Velocity decay per frame |
| `p.fov` | 45 | — | Resting FOV |
| `p.roll` | 0 | — | Resting roll |

These let you tweak a script without editing the code — change a knob, see the effect immediately.

### Persistent state

`state` is an object that **persists across frames**. Use it for velocities, phases, accumulators:

```javascript
state.phase = (state.phase || 0) + 0.01;
ctx.cam.y = sin(state.phase) * 3;
```

### Math helpers

`sin`, `cos`, `abs`, `pow` — passed in directly (no `Math.` prefix needed). Plus:

- `lerp(a, b, t)` — linear interpolation
- `clamp(v, lo, hi)` — clamp to range
- `orbit(radius, speed, height)` — sets `cam.x/y/z` for a circular orbit; advances `rotAngle` internally

## Eight starter presets

| Preset | What it does |
|---|---|
| 🎬 Cinematic | Slow drift orbit with subtle FOV breathing on bass |
| ⚡ Reactive | Aggressive orbit speed-up on bass + camera shake on beats |
| 🌊 Float | Lissajous-like vertical figure with phase drift |
| 🎡 Spiral | Tight inward zoom on beats, then expand |
| 🔭 Telescope | Close-in narrow FOV, treble-driven zoom |
| 🎢 Roller | Looping rollercoaster path with bass-driven climbs |
| 🌑 Dark Matter | Slow spiral orbit with bass pull and gentle vertical wobble |
| 🌙 Moon | Slow hopping vertical motion — a hop every ~8 s, quickening with bass |

Click a preset name to load its code into the editor. You can then click **APPLY** to run it, edit freely, or **RESET** to go back to the default.

## A minimal example

```javascript
// Slowly orbit while bass pushes the camera up
orbit(p.radius, p.rotSpeed, p.height + bass * 2);

// Look at a point that drifts on mids
ctx.target.y = mid * 0.3;

// Punch the FOV on beats
ctx.fov = lerp(ctx.fov, p.fov + beat * 10, 0.15);
```

## Keyframes

The **TIMELINE** pane lets you layer scripts at specific points in the track:

1. Position the audio playhead where you want a change.
2. Click **+** to add a keyframe at that moment.
3. The keyframe captures the current editor code.
4. As the track plays, the latest keyframe you've passed runs every frame as a *pre-script* — it executes just before your main script, which runs on top of it and can override what it set. Keyframes fire only while a script is armed via **APPLY**.

Markers on the bar drag to retime a keyframe, the ✕ on a list row deletes it, and clicking the bar scrubs the track to that point.

This is how you compose a multi-part "shot list" — different camera language for verse, chorus, bridge.

## Tips

- **Start with `lerp`** for smooth transitions: `ctx.fov = lerp(ctx.fov, target, 0.1)` is much more cinematic than direct assignment.
- **Use `state` for velocities**, not derivatives. Computing `vel = (newPos - oldPos)` per frame creates jitter; integrating `vel += accel * dt` and `pos += vel` is stable.
- **Don't write `Math.random()` per frame** — it produces visible noise. Sample once into `state` and reuse.
- **Beats are short impulses.** `beat * 0.05` gives a frame-long nudge; for smoother reactions use `state.kick = state.kick * 0.85 + beat * 0.5`.
- **Test your script with auto-rotate ON** — that's when it actually runs. Dragging the camera pauses the script for as long as you hold it; hold the drag past half a second and auto-rotate switches off too, so the script stays stopped until you flip auto-rotate back on. A quick drag or a wheel zoom never gets that far — the script resumes by itself when you let go.

## Safety note

Camera Programmer scripts run via `new Function()` — they execute as JavaScript in your tab's origin. Imported preset files are sanitized (the `active` flag is forced to `false`, and a code preview prompts you before running anything). See `SECURITY.md` in the repository for details.
