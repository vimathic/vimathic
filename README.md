<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="logo-light.svg">
  <img alt="VIMATHIC" src="logo-dark.svg" height="80">
</picture>

# VIMATHIC™

**Mathematical VJ Studio 1.0 (Beta)**
Drop in a track — 192 mathematical formulas come to life on screen, driven by your music in real time.

![CI](https://github.com/vimathic/vimathic/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-BUSL--1.1-blue)
![Version](https://img.shields.io/badge/version-1.0--beta-green)
![Single File](https://img.shields.io/badge/deploy-single%20HTML-blueviolet)
> ⚠️ **Read first:** VIMATHIC produces rapid flashing visuals — photosensitive users should read the full disclaimer before using. [Disclaimer →](./DISCLAIMER.md)

---

<!-- Tier split is summed from the 12 per-collection headings in
     MATHEMATICAL_ACCURACY.md — keep the two in step (122 + 35 + 35 = 192). -->
> **157 of 192 formulas at verifiable accuracy. Open tests.**
>
> 122 closed-form expressions at IEEE 754 double precision (~10⁻¹⁴).
> 35 validated approximations with bounded error ≤ 10⁻³ to 10⁻⁷ — documented per
> formula, read at the factory sliders, and stated in the row where it is larger.
> 35 visualisation-grade (qualitatively faithful, not numerically verified).
> Cross-checked against mpmath, scipy.special, and NIST DLMF.
> `node --test tests/math-validation.test.js`

---

## Quick Start

**Option A — try it online:**

👉 **[vimathic.com](https://vimathic.com)** — open in Chrome or Edge, no install required.

**Option B — run it locally:**
```
dist/index.html   ← open in any modern browser, no server needed
```

**Option C — dev mode:**
```bash
git clone https://github.com/vimathic/vimathic
cd vimathic
npm install
npm run dev
```

**Option D — build your own single file:**
```bash
npm run build    # → dist/index.html  (self-contained, no external deps)
```

---

![VIMATHIC demo](./demo.gif)

---

## What It Is

VIMATHIC is a **mathematical VJ studio** that turns your music into reactive geometry.
Not a player with presets, not a winamp visualizer clone: a generator that
*computes* every frame from canonical mathematics and the spectral content
of whatever you're listening to.

Load a track (or mic, tab audio, system audio) — the music drives everything
in real time.

**Bass** and **treble** push geometry into motion. **Beat detection** runs in
the background — its BPM feeds the Camera Programmer and the beat-synced GIF
recorder, while its direct effect on the default visualisation is intentionally
muted. MIDI controllers map to any parameter. A second screen or projector
connects in one click.

Swap the formula, the shape, the colour scheme, and other knobs — and dive
into geometry you didn't expect.

### A combinatorial space, not a preset gallery

VIMATHIC was designed as a *generator of visual diversity*. The five primary
axes — geometry, formula, colour scheme, render mode, deformation mode —
multiply out to a state space of this size before any slider, audio input, or
custom code enters the picture:

<!-- Colour schemes track COLOR_SCHEME_COUNT in src/params.js (54). -->
| Axis | Count |
|---|---|
| 3D shapes (Plane, Sphere, Torus, Klein Bottle, and others) | 32 |
| Formulas (192 CPU + 38 GPU shaders) | 230 |
| Colour schemes | 54 |
| Render modes (surface / wireframe / points) | 3 |
| Deformation modes (surface / volume / collapse) | 3 |
| Volume vector fields (when Volume mode is active) | 6 |

<!-- (2 deform modes × 230 formulas + 6 volume fields) × 32 shapes ×
     3 render modes × 54 schemes = 2 415 744. Recompute if any factor moves. -->
Counting these combinations honestly — accounting for the fact that Volume
mode replaces the formula slot with one of 6 vector fields, while Surface and
Collapse use the chosen formula — gives **roughly 2.4 million distinct base
states**.

That's before:

- 6 audio-reactive sliders in the panel (amplitude, wave intensity, Spectrum Rings, bass/treble sensitivity, bloom), plus two more parameters on the same registry with no slider of their own — colour scheme and auto-rotate speed
- The MIDI mapping table (any CC → any parameter)
- 6 post-processing passes in the engine covering 7 effects (Film Grain and Vignette share a pass), two of them reachable from the app — the bloom slider above and the afterglow the *smoke* particle style brings in PTS mode
- The **Camera Programmer** (arbitrary JavaScript camera scripts + keyframe timeline)
- The **GLSL Shader Editor** (live-edit vertex and fragment shaders)
- The audio itself — every track produces a different spectral fingerprint

Add the continuous dimensions — sliders, MIDI, audio itself — and the space
becomes **effectively unbounded**. VIMATHIC is a generator for exploration,
not a catalogue of finished pieces.

---

## Features

### 192 Mathematical Formulas across 12 domains
Fractals & Chaos · Special Functions · Probability & Statistics · Linear Algebra ·
Trigonometry · Complex Numbers · Fourier Series · Differential Equations ·
Integral Transforms · Topology & Geometry · Cellular Automata · Quantum Mechanics

**Accuracy tiers** — see [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md) for full breakdown:

<!-- Tier counts come from MATHEMATICAL_ACCURACY.md. -->
| Tier | Count | What it means |
|------|-------|---------------|
| 🟢 A | 122 | IEEE 754 double precision — machine accuracy |
| 🔵 B | 35 | Bounded approximation, error ≤ 10⁻³ to 10⁻⁷ — documented per formula and read at the factory sliders (amp 0.7, freq 1, comp 0.5), not as one ceiling over the whole tier. Two entries exceed it and say so in their rows: `manifoldCurvature`, 3.24 world units over a third of the plate at the loudest the audio path drives it unaided, and `ornsteinUhlenbeck`, 17 % on the two statistics that define its process. |
| 🟡 C | 35 | Visualization-grade — qualitatively faithful, not numerically exact |

This is not "math-flavoured visuals". These are canonical implementations —
Bessel J₁ from Numerical Recipes, Gamma via Lanczos g=7, Dawson F via Rybicki's lattice sum,
Gray-Scott reaction-diffusion as a real PDE on a 64×64 grid.

### 38 GPU Shaders
Jacobi and Ramanujan theta sums, a τ(n)-weighted lattice, standing and travelling
waves, turbulence, and a spectrum family driven by the three audio bands — running
in real time on the GPU with audio-reactive uniforms. Which branch computes which
object is listed in [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md).

### 54 Colour Schemes
Cinematic, Synthwave, Scientific, Premium, Monochrome, Trending, a 12-palette "New" collection (cyberpunkGold, arcticFire, bloodMoon, cosmicDust, toxicWaste, cherryBlossom, midnightChrome, solarFlare, deepSpace, acidRain, volcanic, bioluminescence), an 8-palette "Dark" collection (charcoalSmoke, slateIndigo, mossStone, petrol, emberBlack, burgundyVelvet, midnightForest, coalPlum), and a 10-palette "Night" collection (burgundyBlack, crimsonAbyss, tarnishedGold, fathomBlue, cedarSmoke, fernShadow, orchidAsh, driedRose, deepJade, rustSlate) built for a dark room: dark enough at rest to stay under the bloom threshold, bright enough on peaks to cross it.

### Deformation Modes
- **Surface** — classic height-field displacement along Y axis
- **Volume** — full 3D vector-field deformation (6 built-in fields: Lorenz, twist, magnetic dipole, etc.)
- **Collapse** — spherical-parametrization displacement along surface normals

### Post-Processing Effects
Bloom · God Rays · Motion Blur · Chromatic Aberration · Afterglow · Film Grain · Vignette
— composer passes. Four are custom GLSL written here (God Rays, Motion Blur,
Chromatic Aberration, and the combined Film Grain + Vignette); Bloom and the
afterglow are three.js's own `UnrealBloomPass` and `AfterimagePass`, used
unmodified. Two are reachable from the UI: Bloom's strength slider (the pass
itself always runs) and the afterglow the *smoke* particle style switches on in
PTS mode. The vignette runs for everyone; the rest
are engine capability with no control wired to them yet.

### Audio Engine
- **Spectrum Rings** — the 24 Bark bands of the spectrum laid across the body itself: each band moves its own region, placed by the formula's own texture, stereo-aware (L/R) — on by default
- File playback (MP3, WAV, FLAC, OGG) with drag & drop
- Crossfade between tracks (fixed 1.5 s)
- Bass / Treble sensitivity controls
- Beat detection in the background — feeds BPM to the Camera Programmer and beat-synced GIF recorder; the visualizer deliberately holds back on flash response in the default scene
- Live microphone input (works with virtual loopback devices: VB-Audio Cable, BlackHole)
- Browser tab audio capture (Chrome)
- System audio capture (Windows Chrome)
- MIDI controller support — any CC → any parameter, with Learn mode

### Production Tools
- **Clip Player** — automate formula/shader sequences in seconds or bars, with background-tab catch-up
- **Camera Programmer** — keyframe camera paths in JavaScript
- **GLSL Shader Editor** — live-edit vertex and fragment shaders in-app
- **About / Docs modal** — full documentation embedded in-app, browser-style tabs
- **Second Screen** — borderless popup for projector or external monitor
- **Virtual Camera** — feed into OBS, Zoom, any capture device (Chrome)
- **NDI / Spout stubs** — architecture ready for Electron-based bridge to professional VJ software

### Recording & Export
- **GIF Recorder** — beat-synchronized animated GIF (perfect loop mode)
- **WebM Recorder** — high-quality VP9/VP8 capture via MediaRecorder
- Configurable resolution, FPS, quality, and duration (seconds or beats)
- Automatic "VIMATHIC" watermark on exported media

### Single-File Deploy
The entire application builds to one `dist/index.html` — math Web Worker included, embedded and started from a `blob:` URL — plus the second-screen popup and an SEO docs site. No server, no CDN, no external requests.
Share it as a file attachment. Open from USB. Works offline.

---

## Architecture

```
src/
  main.js              — bootstrap, event loop, hotkeys
  render.js            — Three.js renderer, geometry, animation, post-processing
  shaders.js           — GLSL shaders (54 colour schemes, 38 GPU formulas)
  shapes.js            — the shape catalogue: every body the build can draw
  parametric-surfaces.js — Möbius, Klein, catenoid, helicoid, hyperboloid, pseudosphere
  implicit-surfaces.js — gyroid, Schwarz P, Chmutov, Clebsch, Cayley (equation-only bodies)
  marching-cubes.js    — turns an implicit equation into a mesh
  math-collections.js  — 192 CPU formula implementations + 6 volume vector fields
  math-visualizer.js   — CPU math engine (worker/sync hybrid)
  math-worker.js       — Web Worker for off-main-thread evaluation
  band-map.js          — which of the 24 Bark bands each point of the body listens to
  formula-picker.js    — the randomiser's pool: both formula families, GPU and CPU
  viz-mode.js          — render-mode whitelist (surface / wireframe / points)
  camera.js            — Camera physics, programmer, keyframes
  audio.js             — Web Audio API, FFT, beat detection, live capture
  dom.js               — Centralised DOM lookups (single source of truth)
  params.js            — Declarative parameter registry (slider + MIDI + presets)
  utils.js             — MIDI controller, ShuffleBag
  recorder.js          — GIF + WebM recorders with watermark
  outputs.js           — Second screen, virtual camera, NDI/Spout stubs
  ui/
    controller.js      — UIController + ClipPlayer wiring
    controls.js        — Panel sliders, hotkeys, fullscreen, model loader
    modals.js          — Shader / camera / output / audio-source / MIDI modals
    presets.js         — Capture/apply state, import/export JSON, migration registry
    clip-player.js     — Sequence automation with backgrounded-tab catch-up
    auto-cycle.js      — Timed palette/material cycling: bars of BPM when playing, wall time when idle
    about-modal.js     — Documentation viewer with browser-style tabs

plugins/
  vimathic-docs.js     — Vite plugin: documents/*.md → app modal + static SEO site
  vimathic-build-info.js — Vite plugin: version + build hash as a virtual module

documents/             — Markdown documentation (loaded into About modal + indexed by Google)
  index.md  quick-start.md  hotkeys.md  midi.md  camera-programmer.md
  shader-editor.md  recording.md  presets.md  output.md  troubleshooting.md
  roadmap.md  safety.md  science.md  license.md
```

**Stack:** Three.js (WebGL) · Web Audio API · Web MIDI API · Vite + vite-plugin-singlefile · micromark (build-time)
**Tests:** `node --test` — no test framework dependency
**CI:** GitHub Actions, on pull requests to `main` and on pushes to `main` — the full unit suite, the Playwright suite split across three shards behind one summary check, the single-file build, and CodeQL analysis. A push to any other branch runs nothing; open a pull request to get a run

---

## Why It Works

Two independent lines of published research are *adjacent* to what VIMATHIC does:
fractal patterns produce measurable EEG signatures including elevated alpha activity
([Hägerhäll et al., 2008](https://doi.org/10.1068/p5918)), and audiovisual stimulation
has shown anxiety-reduction effects comparable to short meditation in a controlled trial
([Johnson et al., 2024](https://doi.org/10.1038/s41598-024-75943-8)).

Neither study used VIMATHIC. The combination of *user-chosen music + real-time
mathematical animation* has not been studied. We don't make therapeutic claims.
[Read the research →](./SCIENCE.md)

---

## Authorship

VIMATHIC was designed and built by **S. Melentyev** in close collaboration with [Claude](https://claude.ai) (Anthropic). The project direction, design choices, scope, and decisions about what's in and what's out are the author's. The code, mathematical implementations, accuracy methodology, reference-value checks against mpmath / scipy.special / NIST DLMF, and the test suite that verifies them — were produced with Claude.

Where the author's role was strongest: deciding what the instrument should *be*, which formulas matter, how the parameter space should feel, and which trade-offs to accept. Where Claude's role was strongest: turning those decisions into working code, building out the math library, drafting documentation, and writing the tests that check it.


---

## Support

VIMATHIC 1.0 is free, ad-free, telemetry-free, and source-available — and becomes fully open-source (GPL v3) in 2030.
For the roadmap of what comes next and ways to support development,
see the [Roadmap](./documents/roadmap.md).

---

## Documentation

**For users:** the in-app **About modal** (click the **i** icon next to FPS) and the live docs site at
**[vimathic.com/docs/](https://vimathic.com/docs/)** — quick start, hotkeys, MIDI, shader editor, camera programmer, recording, presets, output, roadmap, troubleshooting.

The [Roadmap](./documents/roadmap.md) lays out what VIMATHIC is today, the planned next step (mobile app), and how community support shapes what comes after.

**For developers / contributors:**

- [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md) — accuracy methodology, per-formula tier breakdown
- [SCIENCE.md](./SCIENCE.md) — research behind the neuroscience and why it works
- [DISCLAIMER.md](./DISCLAIMER.md) — photosensitivity warning, AI-assisted authorship, hardware notes
- [SECURITY.md](./SECURITY.md) — vulnerability disclosure policy
- [LICENSE.txt](./LICENSE.txt) — BUSL-1.1 → GPL v3 four years after each version's release (2030-05-18 for 1.0.0-beta); educational exception (Apache 2.0 or GPL v3 at recipient's option)

---

## License

**[BUSL-1.1](./LICENSE.txt)** — source-available, non-competing use only.

**Educational exception:** accredited schools, universities, and non-profit educational
organizations may use VIMATHIC immediately under either **Apache 2.0** or **GPL v3** terms
— recipient's choice, free of charge.

**After the Change Date** — four years after a version's release, **2030-05-18** for 1.0.0-beta —
the codebase converts to **GPL v3**, a copyleft open-source license.
Any derivative work that gets distributed must remain open-source under GPL v3.
No company can take this code and lock it behind a paywall.

**Contributions:** by opening a pull request, contributors grant the project rights
under BUSL-1.1 / GPL v3 and, separately, grant the maintainer rights to use the
contribution in proprietary commercial derivatives. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the full dual-grant terms.

Uses Three.js, gif.js, micromark, micromark-extension-gfm-table, Vite, and vite-plugin-singlefile — all MIT.
See [LICENSE.txt](./LICENSE.txt) for full third-party attributions.

### Bundled audio

VIMATHIC ships with an intro track — *S. Melentyev — Vimathic* (`vimathic-intro.mp3`) — that plays on first load. It's © 2026 S. Melentyev, licensed for personal/non-commercial playback inside the app. Public live use, monetised streaming, sampling, and commercial use require separate permission. See [LICENSE.txt](./LICENSE.txt) for the full bundled-media clause. Click **Clear** in the playlist to skip it and load your own music.

---

## Contact

For collaboration, licensing, or urgent matters: **vimathic.info@proton.me**
Security vulnerabilities or conduct reports: **vimathic.reports@proton.me**

*One person maintaining this in spare time. Replies aren't guaranteed and may take a while. For bugs, [GitHub Issues](https://github.com/vimathic/vimathic/issues) are faster.*

---

<sub>VIMATHIC™ · v1.0 (Beta) · Mathematical VJ Studio · Built with mathematics, music, and a browser</sub>
