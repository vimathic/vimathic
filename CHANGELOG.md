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

- **Twenty-four bands the body answers with.** The whole spectrum used to
  arrive as three numbers — bass, mid, treble — and every part of the surface
  answered all three the same way. A second 4096-point analyser now folds the
  signal into 24 Bark bands, and each region of the body answers its own: the
  formula's local roughness picks which band a point listens to (behind a
  "Rings follow the formula" checkbox; unchecked, the bands are the concentric
  rings they were before), the body's own curvature gets a say, and each band
  plays a gesture rather than a loudness — BREATHE, RIPPLE or SHATTER by how
  rough its region is. The layer arrives switched on at `bandDepth` 0.30,
  beside Amplitude and Wave Intensity rather than three clicks deep in
  ADVANCED. A depth profile weights bass 1.94× against treble 0.62×, so a kick
  moves the body and a cymbal draws on it; in PTS a loud band throws its
  region off the surface as grains and swells them; a zone's colour shifts,
  statically, with the band it listens to, so the layout reads as a map of the
  spectrum; and a channel splitter makes the analysis stereo — a band's pan
  tilts its displacement from side to side, with pan 0 bit-identical to mono.
  Dragging the slider to zero restores, bit for bit, the picture the catalogue
  had before the layer existed. (#64)
- **Five bodies that have an equation but no parametrisation** — a gyroid,
  Schwarz P, the smooth Chmutov quartic, the Clebsch cubic and a clipped
  Cayley cubic, under a new — IMPLICIT — group in the picker, plus the
  marching-cubes mesher that turns a level set into a mesh. Every shape until
  now said where a surface is; these five say where it isn't. Three of the
  five labels carry a parenthetical, and none of them is modesty: "Chmutov
  Quartic (smooth level set)", because the nodal members the name belongs to
  live at level −1 and this is not one of them; "Clebsch Cubic (24 of its 27
  lines)", because the other three lie in the plane at infinity; and "Cayley
  Cubic (clipped before its 4 nodes)". Neither periodic body says "minimal
  surface": what ships is the trigonometric nodal approximation, and the
  catalogue's own estimator says so — mean |H|·L 0.040 for the gyroid against
  0.00017 for the catenoid. Alongside them, `foldRadius`: the cap on how far a
  field may push a body along its normals now respects the body's own
  curvature as well as the nearest opposing sheet, because a patch pushed past
  the centre of its curvature turns over — which the helicoid had been quietly
  doing since round 11. (#62)
- **Seven shapes a height field cannot be.** The catalogue had been assembled
  from the renderer's constructor rather than from mathematics — sixteen of
  its twenty entries were three.js primitives straight out of the box — and
  the gap was exactly everything three does not ship. This branch adopts a
  rule: a body that is the graph of a function over the plane belongs to the
  formula catalogue, and a shape earns its slot only when it is closed,
  one-sided, self-intersecting, multi-sheeted or fractal. Under it arrive the
  Möbius strip, the Klein bottle, the catenoid, the helicoid, the hyperboloid
  and the pseudosphere — and `sierpinski-tetra`, four contractions recursed to
  depth 7 on desktop and 6 on mobile; at depth 7 that is 16 384 cells, 32 770
  distinct vertices, 62.3 % of them strictly inside the hull. The one body in
  the catalogue with an inside, where every other has zero. (#60)
- **A NIGHT mode, and ten palettes dark enough for it.** The existing DARK
  series is not dark: five of its eight clear the bloom threshold in silence, so
  they glow on their own with no music playing, and the comment describing them
  has its two tiers the wrong way round — `charcoalSmoke`, labelled truly-dark,
  is the brightest of the eight. That comment is left alone except for a
  correction beside it; the numbers behind both claims are in the new NIGHT
  block. The ten NIGHT palettes (`burgundyBlack` … `rustSlate`, 44–53) are built
  to a stated contract instead of an adjective: dark enough at rest to stay
  under the bloom gate, bright enough at the crest to cross it, so a track lights
  its own peaks and silence stays still. Two of the ten are the requested pairs,
  burgundy-into-black and red-into-deep-blue.
  The **☾ NIGHT** button sits beside ⟳ AUTO and does only what a dark room needs:
  it narrows the unattended pickers — AUTO COLOUR and the R/Q bag — to those ten,
  hides the starfield, and dims the grid. It writes no bloom setting; it writes
  exactly one shader uniform — `uGlare`, the multiplier on the lamps, turned
  down from 0.65 to 0.45 while the mode is on, since the glare work (#66) — and
  one palette number, but only when it has to: turned on over a bright scheme it
  moves the palette to the first NIGHT one, because opening the mode under a
  glaring picture and leaving it there is not what the button is for. Turned on
  over a NIGHT palette it leaves the choice alone. With it off the frame is
  unchanged and there is nothing to prove about that. The dropdown stays free:
  the mode changes what
  the app picks for you, not what you can pick. `G` is untouched. Bloom keeps its
  shipped strength, radius and threshold, so the dark can still be lifted with
  it. It rides in snapshots, because a look captured at 3 a.m. that comes back
  with the starfield on is not the look that was captured.
- **A guard for the palette catalogue.** Adding a palette touches six places and
  the recipe in the source named three; the three it left out are the ones that
  fail silently — a missing dispatcher branch renders the out-of-range default, a
  missing `<option>` blanks the dropdown, a missing name reads as "unsupported"
  in the shader editor. `tests/palette-catalogue.test.js` checks all six against
  each other and against `COLOR_SCHEME_COUNT`, by index and by name, and proves
  it can fail by reinjecting each of the six half-edits.
- **A real solar system** behind the Solar System shape. It used to be six
  invented spheres on circular orbits at made-up distances, one of them wearing
  a torus for a ring; it is now the eight planets, built from published J2000
  orbital and physical elements. Distance and radius each run through a power
  law — nothing else fits Mercury and Neptune in one frame — but the compression
  keeps the running order and the direction of every ratio, and orbital speed is
  then re-derived from the compressed distances by Kepler's third law instead of
  being a separate table that disagrees with the geometry. Kepler's second law
  runs per frame, so Mercury visibly hurries through perihelion. Every surface is
  generated rather than drawn: banded flow warped by noise for the giants, a
  cloud deck for Venus, regolith and craters for the rocky worlds and the Moon,
  and for Earth a land field whose sea level was measured to leave 29 % of the
  sphere dry with clouds thinning over the deserts. Saturn, Jupiter, Uranus and
  Neptune get their real ring band radii, with the divisions painted as gaps
  rather than stripes; Earth gets the Moon and an atmosphere, four others get a
  limb glow, and the main belt is sampled with the four Kirkwood gaps swept
  clear. The studio light rig is swapped for a single star at the origin while
  the shape is up, at an exposure worked out rather than dialled in. All of it is
  seeded from each object's own name, so leaving the shape and coming back gives
  you the same solar system, and a preset or a recording replays it. (#36)
- **Particle styles for POINTS mode** — a Particle Style row that appears with
  PTS the way Surface Material appears with SURF. POINTS drew one thing, a
  large square sprite, because that is what a point primitive is; a mask over
  `gl_PointCoord` in the shared fragment shader turns the same primitive into
  **Dots (small)** — small round particles — or **Smoke trail**, which keeps
  those small particles, makes them glow additively and hands them the
  composer's afterimage pass so each one drags a decaying wake behind it. The
  wake is screen-space on purpose: it works the same for GPU shaders and for
  CPU formulas, where a re-render at `t-dt` would show nothing (CPU positions
  are baked into the attribute buffer, not computed from time). The style is
  captured in presets, remembered across a trip through another viz mode, and
  cleared by RESET ALL; outside PTS the mask is provably off, because
  `gl_PointCoord` is undefined for triangles.
- **AUTO COLOUR / AUTO MATERIAL** — a ⟳ AUTO toggle beside the Color Scheme and
  Surface Material dropdowns. Each cycles its parameter on its own, drawing
  without repetition from the whole pool and always crossfading rather than
  cutting: the palette blends in the fragment shader, and the material now
  interpolates its four reflection scalars instead of switching them in one
  frame (that fade is used by the dropdown and the `T` hotkey too). Cadence
  follows the music — 8 bars for colour, 16 for material, off the detected BPM —
  and falls back to a wall-clock interval while nothing is playing. While a
  toggle is on it owns its parameter: clip player steps apply the rest of each
  preset but stop overwriting it. Loading a preset by hand still applies both;
  RESET ALL disarms them.
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

- **The grid, the glare, the S key, and three fields that stopped taking
  text.** The four-harmonic noise under the SHATTER gesture was `abs(sin·cos)`
  — separable and kinked, so its creases ran along X and Z of the undisplaced
  world: the same still lattice under every formula and every shape, only
  scaled by the music. Four tilted plane waves fitted to the old moments
  replace it, and the measured crease excess falls from 1.63× to 0.96×. The
  white that cut the eyes is answered by `uGlare`, a multiplier on the lamps —
  the three studio soft-boxes, the material's own highlight, the lighting
  specular, and deliberately not the reflections — at 0.65 normally and 0.45
  in NIGHT, where a mirror had measured well above the same body in matte, on
  the mode whose whole promise is a dark picture. (The ratio is left un-quoted
  here on purpose: the tree carries two tables of that one measurement, in the
  `studioEnv` note and in `tests/glare-lamps.test.js`, and they disagree —
  1.67× against 1.58×. One re-measurement retires the wrong one.) `S` now drives
  Spectrum Rings as a hold-and-drag parameter and the glitch punch it used to
  fire lives on `Y`, because a letter cannot hold both. And 3D SHAPE, SHADER
  MODE and COLOR SCHEME are read-only dropdowns again — along with VOLUME
  FORMULA, which the same wrapper takes the moment VOLUME mode reveals it — the
  filter went with the typing, so a phone stops raising its keyboard over a list
  you can only pick from. (#66)
- **AUTO no longer parks between changes.** The fade was 0.35 of the period
  under a 3-second ceiling, and the ceiling was doing the damage: at the shipped
  8-bar cadence that is three seconds of crossfade followed by thirteen seconds
  of a still picture — twenty-nine for material at 16 bars. The in-between
  shades went past in a fifth of the time they were on screen, so an automatic
  change read as a switch rather than as drift. The fade is now the whole
  period: a palette arrives and is already on its way to the next one. Chaining
  back to back is safe by construction rather than by luck —
  `setColorSchemeAnimated` lands on a clean `uCMBlend = 0` in its `onDone`, and
  `TransitionManager` retires a tween before calling it precisely so the
  callback can start the next one in the same slot. The floor stays, as the only
  clamp left: below it a fade would outlast its own period and each change would
  cancel the one before it half way through. AUTO ships off, so nothing changes
  for anyone who has not switched it on.
- **`R` can reach every shape in the picker** — all twenty at the time, all
  thirty-two now that the parametric and implicit waves have landed, because
  the pool is the catalogue itself. The randomiser drew its shape from a
  nine-name literal in `main.js`, so eleven of the twenty — disc, ring, circle,
  hex, pyramid-smooth, tetrahedron, octahedron, icosahedron-smooth,
  dodecahedron, star, solar — never appeared under `R`, although
  `documents/hotkeys.md` promised a deck in which "every shape will appear
  before any repeats". Nothing recorded why those nine; the list had simply
  stopped being extended as shapes were added. The pool is `SHAPE_NAMES` itself
  now, so a shape in the picker is a shape `R` can deal. The guard that was
  supposed to catch this checked the pool was a *subset* of the whitelist —
  true, and blind to what had fallen out; it checks the construction now.

- **The Circle shape is a surface now, not an outline.** It was
  `THREE.CircleGeometry` — a triangle fan of 162 vertices with exactly one, the
  centre, off the rim, and 160 triangles each spanning a radius of the disc.
  Every displacement this app performs is per vertex, so the picker offered a
  round shape that could not carry a formula: asked to draw
  sin(1.7x)·cos(1.3z), the fan was off by 0.776 at the worst triangle against
  the square plane's 0.001. It is built from the square grid now and carried
  onto the disc by the elliptical grid mapping, which keeps the quad topology,
  so the round surface is 161 × 161 like the square one, its rim is round to
  1.3e-7, and the same field is drawn to 0.002. Nothing else needed a special
  case: everything that derives a grid from the vertex count sees the same 161
  it sees for the plane.

- **Pristine-snapshot architecture** in the math visualizer. Mode transitions
  and shape changes now restore from a clean per-shape geometry snapshot taken
  before any tick writes to the live attribute, instead of from "whatever the
  previous mode last wrote". (#20)
- Roadmap donation section simplified. (#21)
- License wording corrected from "open-source" to "source-available" for
  BUSL-1.1 across README, CONTRIBUTING, MATHEMATICAL_ACCURACY, and the docs
  site. (#26)
- Hotkeys documentation now covers the `T` surface-material cycle. (#24)
- **robots.txt now says which half of "AI crawler" it means.** The site
  publishes llms.txt — a summary addressed to language models — while sitting
  behind Cloudflare's managed block, which disallows the AI crawlers; read
  together the two artefacts contradicted each other. They do not, because the
  managed block turns away crawlers that collect for *training* while llms.txt
  is written for agents that read a page because a person asked. The generated
  file now states that split outright: an explicit `Allow` for the read-time
  agents, the training policy still left to the Cloudflare default it belongs
  to, and a comment saying which is which. `tests/robots-ai-policy.test.js`
  holds the two lists apart so an agent can never end up in both.

### Fixed

- **Spectrum Rings follow the deformation mode.** Switching SURFACE → COLLAPSE
  left the rings where they were on many formulas, and they were not merely
  similar: measured, the layouts were bit-for-bit identical, 0.000 bands of 24
  apart. Two causes and neither alone would have shown — `setMode()` did not
  invalidate the character map, and the rebuild knew only one reading of a
  kernel, as a height field over (x, z). COLLAPSE evaluates the same kernel as
  f(θ, φ) about the body's centroid, so it now gets the map that reading
  deserves: the analysis lattice is that chart, taken from the one function the
  displacement itself calls. What the old map could not express is sharpest on
  a closed body — (x, z) is a projection, so on the sphere all 6 339 vertex
  pairs that share a column but sit on opposite sides landed on the SAME band,
  while the mode's own field separates the two sides by 0.458 world units on
  average. Over sphere, torus, cylinder and plane and five kernels the right
  map sits 6.9–8.9 bands away from the one COLLAPSE wore, against an
  independence ceiling of 23/3 = 7.67 — unrelated, not merely different. The
  report said "on some formulas", so the sweep covers the catalogue: all 192
  kernels now lay out differently in the two modes, none under 4 bands of 24,
  mean 7.658 — and none of them falls back to the plain radius rule on the way.
  The SURFACE path is untouched and asserted bit-identical. VOLUME is a defect
  of the same family, named in the code and deliberately not guessed at: its
  tick runs a vector field the map never sees.
- **NIGHT keeps the `E` key.** The mode narrows every unattended palette
  picker to its ten dark schemes — `Q`, `R` and AUTO COLOUR all draw from the
  narrowed pool — and `E` did not: it stepped `(colorIdx + 1) % 54`, the whole
  catalogue. Since the mode opens on scheme 44, ten presses of "next colour"
  walked out of the series and onto scheme 0, the brightest thing in the
  build, with the mode still on. The step now moves inside the pool and wraps
  from its last entry to its first; outside NIGHT the arithmetic is
  bit-identical to the line it replaces. It lived in `main.js`'s keydown
  switch, which no test can reach because importing the file boots the whole
  app, so the rule moved to `params.js` — the same remedy the four hotkeys
  before it took — and is pinned there.
- **The pyramid can carry a pattern.** `pyramid` was built with four radial
  segments — the pyramid *is* its four flat faces — so all 423 vertices sat on
  four rays along x = 0 and z = 0 and a face had no interior vertex. On Rule
  90 both sampled lines happened to be dead, so the whole body took one
  height: the pyramid sank as a rigid block and drew no pattern whatever. It
  is built from the smooth segment count now with each ring snapped back onto
  the square — the same trick the disc already plays — so the body does not
  move (same four planes, same volume to 34.1440) while the population goes
  423 → 6 883 vertices and Rule 90 goes from one distinct height to 1 181:
  the Sierpiński gasket, in relief, on the pyramid. (#59)
- **A foreign viz mode resolves instead of falling through, and the points
  proxy stops re-buying shared work.** A `vizMode` string from another build —
  preset, import, clip step or localStorage — fell into the "not points, not
  surface" gap: surface material with lighting off, no proxy built, no mode
  button lit, and nothing said why. `normalizeVizMode()` closes it the way
  `shapes.js` already closes shape values — known strings pass through
  untouched, anything else lands on `surface` and says so on the console,
  because silent was the whole defect. And since the PTS proxy borrows the GPU
  mesh's geometry, every "and now the same for the proxy" branch was doing its
  per-vertex work a second time on the same buffers — a full formula pass per
  tick in collapse mode, byte-identical second copies of the pristine arrays —
  which it no longer does. (#57)
- **The formula clock keeps one speed at every frame rate.** `time += 0.008`
  sat after the frame-skip early-return, so formula time was a multiple of the
  render rate: ×4.8 between the mobile path at 60 Hz and a 144 Hz desktop,
  ×9.6 across the matrix — and a desktop opened in a narrow window sat at half
  speed for the whole session, because `isMobile` reads the width once at
  load. The clock is measured now rather than counted: dt off
  `performance.now()`, capped at `0.05·RENDER_FRAME_SKIP`, floored at 1e-4, at
  0.48 units per second — which keeps a 60 Hz desktop at exactly its old speed
  and converges every other configuration to it. The mobile path doubles;
  that is the fix, not a side effect, and presets tuned by eye on a phone will
  look different. (#56)
- **A height field deforms a closed body instead of shearing it.** The field
  only ever moved a vertex along +Y, so every vertex sharing a shadow on the
  ground plane travelled together and a closed body could not change its
  thickness at all — 1.2e-7 across 25 921 vertices on the sphere. It now
  follows the surface normal on the bodies measurement says can carry it — the
  four at the time, sphere, torus, icosahedron-smooth and solar, joined by
  `catenoid` and `hyperboloid` when the parametric wave landed — capped at 0.8 of
  the local medial radius; every other body keeps the vertical rule and was
  bit-identical to what `main` drew. Hard edges keep it because welding their normals trades
  an open seam for a fold, and the thin disc keeps it because pushing its
  faces apart measured a thickness of −0.606. Colour rides in its own
  attribute now, since along a normal the old base-y subtraction stops being
  the field; and the shape-change hitch this brought is paid down in the same
  change — sphere 64.6 → 22.6 ms, plane 25.5 → 1.31 — with no answer moved.
  (#54)
- **Round 11's tail: seven more labels, a GPU one, and the report's Name
  column.** Seven more entries whose visible label named something the plate
  does not draw — `complexSin` (the real part of a holomorphic function must
  be harmonic; this has Δu = −0.75u), `argandField`, `reynoldsFlow`,
  `hankelTransform`, `continuousWavelet`, `hyperbolicGeom`, `langtonAnt` —
  plus GPU mode 1, which had no chirp. The accuracy report's Name column now
  holds the name a viewer actually sees: 146 of 192 rows carried an older or
  shortened caption, and a test keeps catalogue, picker and report in step.
  Three rows were corrected against measurement, and the tag entry below
  gained its correction note: checked on the tagged commit, none of
  Mandelbrot, Lorenz or Schrödinger was in those 38 branches. (#53)
- **The output paths, where five controls did something other than they
  said.** STOP saved the partial GIF the documentation says it discards. SIZE
  sat live but inert under ASPECT: Native and said nothing — it is disabled
  now, with the reason in its title. Virtual Camera accepted 0 fps and went
  green, because `captureStream(0)` does not throw. A blocked Second Screen
  popup left its captureStream running with nothing able to reach it. And
  relative MIDI encoders decoded as sign-magnitude while the class header
  declares two's complement — mirror images, so one detent anticlockwise swept
  the whole parameter range. Nine tests; six fail against the unpatched
  source. (#51)
- **The background, the fog and the grid are the colours they were written
  as.** three.js converts a colour given as sRGB bytes into its working linear
  space on construction, and the conversion back out lives in a chunk only its
  own materials carry — this app draws its frame through its own GLSL, so an
  authored colour reached the screen linearised: `#050515` displayed as
  `#000002`, `#88aaff` as `#3f67ff`. The repair is deliberately narrow: these
  colours are declared in the space they are written to, because a
  renderer-level output transform would also shift every shader palette — 44
  at the time — none of which pass through `THREE.Color` and all of which land
  as authored. One of the three tests is a source-level guard, since this is a
  one-token regression whose symptom is that the background looks a bit dark,
  which nobody files. (#52)
- **The analysis half of the audio engine, which nothing had ever tested.**
  The bass band was pinned at its ceiling: the analyser dB window sat at the
  Web Audio defaults (−100..−30), so every bin at or above −30 dBFS reads 255
  and mixed material read 1.000 constantly — the window is −85..−10 now, and
  the 1.4/1.2 band multipliers are gone. The beat detector had no baseline —
  an absolute level test that was always true, so the beat rate was the 190 ms
  refractory period and `estimatedBpm` converged on ~300 for any track; it is
  a surge in the band's linear power over its running mean now, and a 120 BPM
  pattern reads 120.0. The beat flash faded per frame rather than per second,
  bin geometry was hardcoded for 44.1 kHz, and the refractory period and the
  BPM estimate ran on two different clocks. Six tests in a new file — this
  half of the engine had none. (#50)
- **RESET ALL resets, auto-save saves, and a preset stops typing over you.**
  RESET ALL switched auto-rotate ON — the comment above the call claimed it
  did not — and restored only one of the camera programmer's eight knobs; they
  have a named default object now, and the editor sliders are told. Auto-save
  starved itself: a 1500 ms debounce re-armed by a 1000 ms interval writes
  nothing while anything keeps changing, so a maximum wait was added — and its
  fingerprint watched 6 values against the snapshot's 13 keys. And a preset
  carrying a custom shader rewrote the editor buffer on every apply, throwing
  away unapplied keystrokes every few seconds during clip playback. Fifteen
  tests, two stubs made faithful first. (#49)
- **The two simulations that restarted twenty times a second.** The cached
  heavy sampler calls its simulator on every rebuild — 16 to 20 per second —
  and both media re-seeded their fields each time, so neither ever advanced
  past its first hundred Euler steps. Gray–Scott showed one blob, and removing
  the restart alone floods the lattice to 100 % coverage with zero interface;
  the path runs Pearson δ→θ now, from a deterministic scatter.
  FitzHugh–Nagumo could not sustain a wave at any step count — measured 0.0 %
  excited from step 1000 on — and is replaced by Barkley, and the label says
  so. Both continue across rebuilds through a cache, and a test requires the
  continued field and the cold field to be equal to the bit. (#48)
- **The two deform modes reach the whole mesh and the whole slider.** WAVE
  INTENSITY did nothing in VOLUME — the mode built its frequency without the
  slider, so every vector field saw [1.00, 1.30] wherever it stood. The volume
  field stopped short of the mesh: gridSize² entries against the vertex count
  left 326 vertices across 8 of the 20 shapes that never moved — two whole
  rows of a cap; it is evaluated per vertex now. And COLLAPSE had one dead
  coordinate on a flat figure — φ = acos(dy/r) is exactly π/2 when dy = 0,
  measured on all 162 vertices of circle — where the polar radius now takes
  its place; bodies with height are untouched, and a control pins that. (#47)
- **Round 11: the label is the claim, and four of them were false.** The only
  text a viewer ever sees is the `<option>` label, and four names promised
  objects the plate does not draw — `crossCap` (a graph over the plane cannot
  be RP²), `enneperSurface` (a quadric where Enneper is minimal),
  `hopfFibration` (96–100 % residual against every Hopf coordinate),
  `pythagorean` (sin²−cos², the double-angle identity) — and are renamed to
  what they compute. Three kernels contradicted rulings already written down
  here: two stationary states carried a pulse a stationary state cannot have,
  and `dragon` ran a private chaos game at every vertex, so neighbours were
  independent samples of the attractor — one cached orbit draws the set now,
  Jaccard 0.971 against a paper-folding dragon built with no IFS at all. New
  coverage: all 192 names must equal their `<option>` label. (#46)
- **The deform panel leaves VOLUME when a GPU shader takes the surface.** Two
  of the three doors out of VOLUME were guarded in round 4; a shader picked
  while VOLUME was lit went through neither, so the button stayed lit with its
  formula row open, a second click on it was refused by the guard above, and
  the saved preset carried `deformMode: volume` beside a numeric shader value
  — the one pair `applyState` refuses — so it came back as SURFACE rather than
  the screen it was saved from. The engine mode is written as well as the
  panel; COLLAPSE is left alone, because it never touches `uMathMode` and
  round-trips over a shader. (#45)
- **Round 10: the twenty base shapes measured against what they claim to
  be.** Nine rounds checked what the formulas say; nothing had checked the
  bodies carrying them. Eight defects, four visible in the built app, one in
  the boot shape: cone and both pyramids missing half their lateral surface
  (64.507 against an analytic 96.140), disc and hex standing on edge, Surface
  drawing a permutation of the formula on nineteen shapes of twenty, and the
  GPU path collapsing every (x,z) column onto one point. The colour ramp
  follows the fix — vH carries the displacement rather than the absolute
  height on the two paths this round touches, so the palette stays the audio
  channel it was calibrated to be — while GPU mode is bit-identical to before
  and Volume and Collapse are untouched, to the float32 word. Tests
  923 → 1054. (#44)
- **A written rule for what a caption may leave unsaid, and 95 captions made
  true under it.** The catalogue had no rule for which of a kernel's factors a
  caption must name, and it had drifted into disagreeing with itself in a way
  no reader could catch by eye — `hydrogenS` forgiven for absorbing its 1/π
  into the display scale while `maxwellBoltzmann` was charged, in the same
  round, for absorbing its normalisation. Those look identical on the page;
  they are not, and the difference is measurable. MATHEMATICAL_ACCURACY.md now
  carries the rule in three clauses — a factor may be omitted iff
  `drawn ÷ named` is one positive constant over the whole plate and the whole
  reachable slider box; anything that offsets, saturates, wraps, blanks or
  changes sign must be stated; a time gain is forgiven only where the named
  object is not required to be time-independent — with the numbers that
  separate the cases, and a section on what the rule costs. (#43)
- **Round 8: the reference sweep repaired, and the rows made to say what the
  kernels draw.** The 192-entry sweep against mpmath, scipy, sympy,
  numpy-LAPACK and PARI found 151 in agreement, 20 carrying a tier higher than
  they earned and 11 drawing something other than what they named — and
  repaired nothing; this is the repair. Four entries drew a different object
  than the one they named: `lorenz` and `duffing` were the same affine-sheet
  defect round 6 found in `rossler` and `chua` and did not look for next door.
  A sweep of every guard constant found the largest in the file guarding
  nothing, and `beamBending` drawing a plate 6.8e-4 world units tall while
  exact to 4.3e-18 against sympy. Twelve folding entries now state their
  measured fold coverage, four tiers move A → C on one statistic applied to
  all twelve, and the three slider settings the rows quote by number are
  finally written in the file, so a headline percentage is reproducible.
  (#42)
- **The two repairs from round 6 that cost more than they bought.** Found by
  an adversarial review that finished after the round had merged, and both had
  passed CI, the whole unit suite, every e2e spec and the round's own
  measurements.
  The Rössler attractor redrew itself from scratch about twenty times a second:
  its RK4-orbit cache rebuilt under a `c` wired to the Compression slider, so
  every rebuild came back a different realisation of the same invariant
  measure — not evolution, a fresh Monte-Carlo sample. Between consecutive
  frames 75.4 % of the plate's own norm changed with nothing playing, which at
  ~20 Hz is flashing, the thing DISCLAIMER warns photosensitive users about by
  name. `c` is the canonical 5.7 now and the same measurement gives 0.24 %.
  And Ornstein–Uhlenbeck grew a tabletop just above the factory slider — the
  rewrite scaled x by freq and left the recentring alone, so the left half of
  every row indexed to the same sample. (#41)
- **Rounds 5 and 6: the maths checked against references, and the surfaces
  made watchable.** Round 5 checked the catalogue against outside references
  rather than against the code that produced it; round 6 repairs the 159
  findings its adversarial pass left standing. Kernels that computed a
  different quantity than their name: `spectralRadius` returned the eigenvalue
  spread, `eigenField` computed nothing eigen and went identically flat every
  65 s, the 1s hydrogen orbital blinked out completely every 21.8 seconds, and
  `rossler` and `chua` integrated a two-hundredth of one loop, so both were
  planes to six digits — they splat an RK4 orbit density now. Five entries
  were unbounded inside the drawn region, their peak set by whichever vertex
  landed nearest the pole; each got the remedy for its own singularity rather
  than a clamp. Twelve entries asserted an accuracy tier their method cannot
  deliver, each now measured against a reference computed a different way and
  checked first on a case with a known answer. (#40)
- **Round 4, remainder: mode refusals, leftovers, docs and test
  sensitivity.** The panel stops claiming modes the engine never entered:
  ⬡ VOLUME lit up and opened its formula row with a GPU shader selected,
  though the two cannot both be on — the button now refuses and names the
  selection in the way, rather than reaching a view no preset could save. The
  unfinished half of the third audit: a live capture no longer gets an
  abandoned track played over it, the loading bar belongs to whoever raised
  it, and a Matte chosen in SURF is what a preset records. Closed overlays
  leave the tab order. Thirteen documents brought back into agreement with the
  code, and eleven blind spots in the suite — code a green run would have
  stayed green through — now have assertions, each verified by breaking what
  it guards. (#39)
- **Round 4: recorder lifecycle, preset camera sanitising, catalog and
  build.** The recorder now gives back what a take borrows — the encoder, its
  worker threads and the scratch canvas — on the successful path and not only
  on abort; clears its destination canvas between frames; recomputes the
  cover-crop rect per frame; keeps a real failure diagnostic from being
  overwritten by its own teardown; and no longer delivers a file after an
  abort, or a timed GIF one frame short of its own plan. Preset apply drops an
  unusable camera coordinate instead of tweening to NaN and committing it
  permanently; a reload no longer eats the camera script, and DISCARD CODE now
  discards it. Alongside: the 192-formula catalog swept over its declared
  ranges, the main-thread and worker paths pinned to one contract, and a
  two-way `dist/` spec in CI. (#38)
- **Every document promised GPL v3 a year later than the license grants it.**
  LICENSE.txt sets the Change Date as a rule with two halves — four years after
  a version is published, or 2031-05-09, whichever comes first — and seven
  documents quoted the second half as the answer. It never binds: 1.0.0-beta
  was published 2026-05-18, four years later is 2030-05-18, and that comes
  first. README, CHANGELOG, the license, overview and roadmap pages, the PR
  template and the llms.txt body now state the rule and the date it produces.
  LICENSE.txt is unchanged — it was right. `tests/license-date-consistency.test.js`
  computes the date from the clause rather than repeating it, so the documents
  cannot drift from the license again in silence.

- **58 logical defects from the third audit, with regression tests.** The one
  high-severity defect: the timeline ✕ deleted a different keyframe than the
  row clicked. The rest fall into four shapes — a control describing state it
  does not own, work queued for a later frame landing after the world moved
  on, a capability answered by brand rather than by test, and something taken
  and not given back. Each fix has a regression test written first and failing
  against the unfixed code, with controls that pass on both sides. Tests
  256 → 454. (#35)
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
     to whatever `main` ships now; that would falsify the release history. The
     live figures are carried by CONTRIBUTING.md and documents/index.md, which
     is where they belong — naming them here only dates this comment. -->
### Features

- **192 mathematical formulas** across 12 domains (fractals, special
  functions, probability, linear algebra, trigonometry, complex analysis,
  Fourier series, differential equations, integral transforms, topology,
  cellular automata, quantum mechanics). Per-formula accuracy tier
  documented in [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md).
- **38 GPU shaders** (audio-reactive vertex/fragment) — Mandelbrot, Lorenz,
  Ramanujan modular forms, Schrödinger, wave and heat equations, and more.

  > **Correction (round 11, 2026-08-20).** This line was not true of the tag it
  > describes. `git show 03caff7:src/shaders.js` has 38 `mode ==` branches and zero
  > matches for mandel, lorenz or schr, case-insensitively: no branch iterated
  > anything, none was a partial differential equation, and none was Schrödinger.
  > Of the modular forms the theta sums (modes 6, 8 and 9) were real; the τ(n)
  > weighting arrived in round 5, which is also when nineteen of the labels were
  > renamed to what their branch computes. The entry stands as written because a
  > changelog records what was claimed at the time — this note records what was so.
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

Code: **Business Source License 1.1**, auto-converting to **GPL v3** four
years after this release — 2030-05-18. Educational exception: accredited educational institutions
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
