# Changelog

All notable changes to VIMATHIC are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/) once it reaches 1.0
proper.

---

## [1.0.0-beta] — 2026-05-13

First public release. Browser-based mathematical VJ studio with audio-reactive
visualization powered by 192 mathematical formulas, 38 GPU shaders, and a
full creative-control toolchain — packaged as a single-file deployment.

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

Code: **Business Source License 1.1** with educational/non-commercial
exception, auto-converting to **GPL v3** on 2031-05-09.

Bundled intro track is licensed separately under the bundled-media clause
in [LICENSE.txt](./LICENSE.txt) — personal/non-commercial playback inside
VIMATHIC is permitted; commercial use, public performance, and sampling
require separate permission.

Bundled libraries (Three.js, gif.js, micromark) retain their original MIT
licenses.

[1.0.0-beta]: https://github.com/vimathic/vimathic/releases/tag/v1.0.0-beta
