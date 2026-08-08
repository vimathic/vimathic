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
