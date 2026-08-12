# Changelog

All notable changes to VIMATHIC are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/) once it reaches 1.0
proper.

---

<!-- Entries transcribed from `git log 03caff7..HEAD`, PR numbers in
     parentheses. CONTRIBUTING.md promises contributors are credited here. -->
## [Unreleased]

Changes on `main` since the v1.0.0-beta tag. Not yet released.

### Added

- **DARK palette group** — 8 new colour schemes at indices 36–43 (Charcoal
  Smoke, Slate Indigo, Moss Stone, Petrol, Ember Black, Burgundy Velvet,
  Midnight Forest, Coal Plum), taking the total from 36 to **44**. (#18)
- **Procedural PBR surface materials** — six looks (Matte, Glossy, Metal,
  Mirror, Velvet, Glass), with a `T` hotkey that cycles them and preset
  capture support. SURFACE render mode only; the control is hidden (and `T`
  is a no-op) in Wireframe and Points. (#22)
- **Portrait, square and native export aspects** for the recorder. Export was
  landscape-16:9-only and stretched anything else; GIF and WebM now cover-crop
  to the chosen aspect instead of distorting, and WebM sizes its composite
  canvas to the real output dimensions. The watermark was restyled. (#23)
- **Full favicon package** — .ico, 16/32/48 PNG, apple-touch-icon,
  android-chrome 192/512, plus a web app manifest. (#14)
- **Richer web app manifest** for a better PWA install experience. (#15)
- **OG image** for social link previews. (#13)
- **Feedback and email links** in the About modal footer. (#16)

### Changed

- **Pristine-snapshot architecture** in the math visualizer. Mode transitions
  and shape changes now restore from a clean per-shape geometry snapshot taken
  before any tick writes to the live attribute, instead of from "whatever the
  previous mode last wrote". (#20)
- Roadmap donation section simplified. (#21)
- License wording corrected from "open-source" to "source-available" for
  BUSL-1.1 across README, CONTRIBUTING, MATHEMATICAL_ACCURACY, and the docs
  site. (#26)
- Hotkeys documentation now covers the `T` surface-material cycle. (#24)

### Fixed

- **`R` and `F` can land on a GPU shader.** The FORMULA dropdown holds two
  families — 38 GPU shaders (numeric values) and 192 CPU math formulas
  (`m:collection:key`) — and the randomiser built its pool from
  `getAllFormulasList()`, which knows only the second. No amount of pressing
  reached a shader: they were not in the bag at all. Both families are in the
  pool now, with the family chosen by a coin flip before the shuffle bag draws
  inside it, so a shader comes up about as often as a formula rather than one
  press in six. The pick is applied through the same branch the dropdown's own
  change handler uses, which also gives the hotkeys the GPU path they never
  had (`mathViz.deactivate()` + `setGPUModeAnimated`) instead of routing every
  draw through `setFormula`.
- **Hénon Map no longer tears the mesh.** Its divergence guard tested the
  double, but the height field is Float32 — a diverging orbit reached ~1e38 and
  became ±Infinity on the way into the vertex buffer, so every triangle touching
  such a vertex was dropped. Reachable at plain boot defaults, with nothing
  playing. The orbit now escapes at |x| > 10, the same bound Tinkerbell already
  used, which leaves the canonical attractor untouched.
- **"Curl of Vector Field" draws something.** The central-difference stencil was
  correct but was applied to a gradient field, and the curl of a gradient is
  identically zero: the formula returned ~1e-14 everywhere and rendered a flat,
  single-colour plate. The field is now rotational.
- **A preset saved on a GPU shader comes back as that shader.** Switching from
  DEFORM: VOLUME to a GPU shader leaves the visualizer's mode field untouched,
  so the snapshot carried `deformMode: volume` next to the shader and restoring
  it re-armed the CPU deformation — which sets `uMathMode = 1` and makes the GPU
  displacement no-op. Also visible on a plain page reload, which restores the
  same snapshot.
- **A preset with no custom shader can now clear a live one.** The apply path
  only handled `hasCustom: true`, so one shader-carrying step in a clip locked
  its program in for the whole set and no preset could get the built-in look
  back.
- **A custom shader survives the POINTS mode.** The points proxy is rebuilt on
  every entry into PTS and was always built from the built-in program, so an
  applied shader silently vanished there and reappeared in SURF; shader-editor
  RESET had the mirror bug and reported success while the points kept the old
  program. Both materials now go through one owner, and editor vertex shaders
  write `gl_PointSize`.
- **A camera tween interrupted by a second one no longer costs you damping.**
  The tween borrows OrbitControls damping and returned it on completion only, so
  clicking a second preset within the transition left the orbit camera snapping
  1:1 for the rest of the session.
- **The Camera Programmer playhead stops when the track stops.** It read the
  audio context clock without checking playback state, so with the transport at
  0:00 it kept crawling and every keyframe added from a stopped track landed at
  a time that depended on how long the user spent typing.
- **Clip camera mode "Snap (instant, old)" keeps each preset's camera script.**
  The instant path fires its post-tween queue synchronously, and the queue was
  drained before the camera-programmer block had pushed the script into it.
- **Switching ♩ BARS → ⏱ SEC mid-clip keeps the hold.** The bars branch built
  its steps with a 0 ms sentinel, so a live switch to seconds strobed through
  presets at morph speed while the Hold(s) box still read 5.
- **A MIDI encoder mapped to "Color Scheme" stays inside the palette.** Relative
  mode had a lower clamp but no ceiling, so past scheme 43 the picture froze and
  the colour dropdown blanked. Enumerated params now wrap; continuous params keep
  their deliberate "extended values stay extended" behaviour.
- **Exported GIFs play for as long as you asked.** The per-frame delay is stored
  in centiseconds, and capturing at an unrounded period left a 10 s export
  playing 10.50 s at the default 15 fps and 9.00 s at 30 fps — and walked a
  beat-synced loop out of its bar. The capture period is now quantised to what
  the format can express, rounded so the rate never exceeds the one you picked:
  a 24 fps export records at 20 and a 30 fps export at 25, and the file plays
  back at exactly the rate it was captured at. The reported fps in the finished
  file's metadata is the real one.
- **Camera control taken by hand during a clip now outranks the presets.**
  Switching AUTO-ROTATE on — or applying a Camera Programmer script — while the
  Clip Player was cycling used to last exactly one hold time: the next preset
  carried `autoRot: false` and switched it straight back off. The player now
  hands the camera over for the rest of the clip and applies the look only
  (shape, colour, formula, shader keep cycling); AUTO-ROTATE off, or the next
  PLAY, hands it back. The panel shows `🎥 MANUAL` while the camera is yours.
- **Volume-mode formula changes no longer keep the previous distortion.** Four
  compounding issues: `setFormula` left `_mode` untouched, `setMode` restored
  the baseline only for `surface`, and `_snapshotBasePositions` read the live
  mesh and so baked distorted geometry in as the rest state. Baseline restore
  is now symmetric across modes and volume mode auto-exits on formula
  change. (#19)
- **Polyhedra lost their identity** — detail is now set to 0 so icosahedron,
  dodecahedron and friends render with their true flat faces. (#17)
- **Missing `og:image` meta tags** added and the large Twitter card
  enabled. (#25)

<!-- Date of the v1.0.0-beta tag, commit 03caff7. -->
## [1.0.0-beta] — 2026-05-18

First public release. Browser-based mathematical VJ studio with audio-reactive
visualization powered by 192 mathematical formulas, 38 GPU shaders, and a
full creative-control toolchain — packaged as a single-file deployment.

<!-- Counts below are the v1.0.0-beta record, not today's `main` — 36
     schemes and ~900 KB were the figures at tag 03caff7. Don't "correct" them
     to the current 44 / ~1.1 MB; that would falsify the release history. -->
### Features

- **192 mathematical formulas** across 12 domains (fractals, special
  functions, probability, linear algebra, trigonometry, complex analysis,
  Fourier series, differential equations, integral transforms, topology,
  cellular automata, quantum mechanics). Per-formula accuracy tier
  documented in [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md).
- **38 GPU shaders** (audio-reactive vertex/fragment) — Mandelbrot, Lorenz,
  Ramanujan modular forms, Schrödinger, wave and heat equations, and more.
- **36 colour schemes** across cinematic / synthwave / scientific / premium
  / monochrome / trending / new collections.
- **20 base shapes** + three render modes (surface / wireframe / points) +
  three deformation modes (surface / volume / collapse) + six volume vector
  fields.
- **Seven post-processing effects**: Bloom, God Rays, Motion Blur,
  Chromatic Aberration, Afterglow, Film Grain, Vignette.
- **Audio**: file playback (MP3, WAV, FLAC, OGG) with drag-drop and
  crossfade; live microphone, browser-tab audio (Chrome/Edge), and system
  audio (Chrome/Edge on Windows).
- **Bundled intro track** *S. Melentyev — Vimathic* plays on first load.
  Click Clear to skip and load your own music.
- **MIDI controller support** (Chrome/Edge) with one-tap Learn mode and
  persistent mappings. Tested with Novation Impulse 61.
- **Camera Programmer** — small JavaScript DSL for scripting camera motion
  with audio-reactive variables. Eight built-in presets.
- **GLSL Shader Editor** — live vertex/fragment editing with audio uniforms.
  Eight starter presets.
- **Clip Player** — sequence presets in seconds or musical bars; survives
  backgrounded-tab throttling.
- **Recording**: animated GIF with beat-synced loops, WebM video up to
  5 minutes per file. "VIMATHIC" watermark on exports.
- **Output paths**: second-screen popup for projectors, virtual camera via
  `captureStream()`, OBS Browser Source workflow, transparent background.
  NDI and Spout integrations exist as postMessage stubs (require an
  Electron bridge — not implemented in the browser-only build).
- **Documentation**: in-app About modal plus static SEO-friendly site at
  `vimathic.com/docs/`, both generated from the same Markdown source.
- **Single-file deployment**: ~900 KB `index.html` plus three companion
  files (`math-worker-*.js`, `second-screen.html`, `vimathic-intro.mp3`).
  Works fully offline after first load.

### Known limitations

- Web MIDI is not supported in Firefox or Safari (browser-side limit).
- Tab audio capture is Chrome/Edge only.
- System audio capture requires Chrome/Edge on Windows.
- WebM recording reliability on mobile Safari is limited by the platform's
  MediaRecorder implementation.
- The `dawson` special function (Tier B) loses accuracy near the
  Taylor/asymptotic branch boundary (~10⁻⁵ at x ≈ 3.5, ~10⁻¹⁵ elsewhere).
  Documented in `MATHEMATICAL_ACCURACY.md`.
- NDI and Spout outputs are not implemented in the browser-only build.
  Vingester is the recommended bridge for live performance.

### Licensing

Code: **Business Source License 1.1**, auto-converting to **GPL v3** on
2031-05-09. Educational exception: accredited educational institutions
may use VIMATHIC immediately under either Apache 2.0 or GPL v3 (recipient's
choice).

Contributions are accepted under a dual-grant model: contributors license
their work to the project under BUSL-1.1 / GPL v3, and separately grant
the maintainer rights to use it in proprietary commercial derivatives.
See CONTRIBUTING.md for full terms.

Bundled intro track is licensed separately under the bundled-media clause
in [LICENSE.txt](./LICENSE.txt) — personal/non-commercial playback inside
VIMATHIC is permitted; commercial use, public performance, and sampling
require separate permission.

Bundled libraries (Three.js, gif.js, micromark, micromark-extension-gfm-table,
Vite, vite-plugin-singlefile) retain their original MIT licenses.

[Unreleased]: https://github.com/vimathic/vimathic/compare/v1.0.0-beta...main
[1.0.0-beta]: https://github.com/vimathic/vimathic/releases/tag/v1.0.0-beta
