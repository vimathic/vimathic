# Disclaimer — VIMATHIC™ 1.0 (Beta)

> **This is VIMATHIC™ 1.0 (Beta).**
> Beta software under active development. The points below apply in full to
> anyone running this build — please read before launching.

## ⚠️ Photosensitivity & Health Warning — Read First

VIMATHIC produces **rapid visual changes synchronised to music**: bright flashes
on detected beats, high-contrast strobing patterns when the beat detector
fires, fast-moving fractal geometry, post-processing effects (bloom, motion
blur, chromatic aberration), and colour cycling at audio rate. Some scenes —
particularly with high bass sensitivity, heavy bloom, or beat-sync clip
playback — produce flashing visuals that can trigger seizures or other
adverse reactions.

**Do not use VIMATHIC if you:**

- have **epilepsy** or **photosensitive epilepsy**, or have ever had a
  seizure triggered by flashing lights or patterned imagery;
- experience **migraines triggered by light, motion, or visual patterns**;
- are prone to **vertigo, dizziness, or motion sickness** from screen
  content (vertigo can be triggered by the auto-rotating camera, the Roller
  Coaster preset, or rapid fractal motion);
- are **under the influence of substances** that lower seizure threshold,
  impair balance, or amplify sensory input.

**If you are unsure whether you are at risk**, do not use VIMATHIC.
A trial in front of a screen is not a substitute for medical advice.

If, while using VIMATHIC, you experience any of the following — stop
immediately and consult a doctor: blurred vision, eye or muscle twitching,
disorientation, involuntary movements, loss of awareness, convulsions, or
sudden severe headache.

This software is **not a medical device**. It makes **no therapeutic claims**.
The research summarised in [SCIENCE.md](./SCIENCE.md) describes effects of
related — not identical — visual stimuli on volunteer populations in
laboratory settings. Nothing in this project should be taken as medical
guidance.

---

## Hardware & Performance

- VIMATHIC runs in the browser and uses **WebGL (GPU)** for rendering, with
  parallel Web Workers driving CPU math evaluation. It is intentionally
  demanding: a complex fractal animated at 60 fps with 7 post-processing
  passes will use whatever GPU and CPU the machine provides.
- Extended use of a GPU-intensive application can cause hardware to **run
  hot**. Ensure adequate ventilation. If your machine has fan-control
  software, set it to a profile that copes with sustained load.
- **Mobile is a preview, not the primary experience.** On phones and
  tablets, VIMATHIC renders at a reduced frame rate, lower mesh resolution,
  and with the heaviest post-processing effects disabled by default. This
  keeps the app responsive but cannot fully neutralise the thermal load of
  sustained GPU rendering on hardware that was not built for it. Switching
  your mobile browser to "Desktop site" does not improve performance — it
  removes the mobile optimisations and makes the load worse. A dedicated
  mobile app is on the roadmap; until it ships, treat the web version on
  mobile as a preview.
- **No cryptominers, no trojans, no background tasks.** VIMATHIC does only
  one thing: render mathematics to a canvas in response to your audio. There
  is no analytics, no telemetry, no network activity at runtime, no
  background process that survives the tab closing. If your machine is
  warm, it is warm because of the rendering you can see on screen.
- The **GIF recorder** at maximum settings (720p, 30fps, 60s) can allocate
  up to ~1.5 GB of memory. The UI warns when estimated usage exceeds safe
  limits and suggests reducing parameters. The **WebM recorder** uses ~50–
  100 MB for the same duration.
- The codebase has not been audited for security vulnerabilities by an
  independent IT security professional. See
  [SECURITY.md](./SECURITY.md) for the disclosure policy.

---

## General

VIMATHIC was created by a human author in collaboration with Claude
(Anthropic AI). All mathematical implementations, scientific claims, accuracy
assessments, legal documents, and technical documentation were produced with
AI assistance and **have not been independently verified** by professional
mathematicians, neuroscientists, lawyers, or IT security specialists.

The author is not a mathematician, neuroscientist, medical professional, or
legal expert. All content in this repository reflects the author's best
understanding, informed by AI, and should be treated accordingly.

If something in this project matters to a decision you are about to make —
verify it against the primary source.

---

## Mathematical Claims

- Formula implementations labelled Tier A or Tier B have been tested against
  reference values using automated tests
  (`node --test tests/math-validation.test.js`, 126 tests as of v1.0-beta).
  The tests themselves may contain errors.
- Accuracy figures (e.g. "error ≤ 10⁻⁷") are estimates,
  not formal mathematical proofs or independent expert review.
- [MATHEMATICAL_ACCURACY.md](./MATHEMATICAL_ACCURACY.md) is an internal
  audit, not peer review.
- Heavy CPU formulas (cellular automata, PDEs) run on internal simulation
  grids of 40×40 to 64×64 and are bilinearly interpolated onto the display
  mesh — accuracy figures are measured at the internal grid level, not the
  interpolated output.

---

## Scientific Claims

- References to published research in [SCIENCE.md](./SCIENCE.md) are
  provided in good faith but **have not been verified by a neuroscientist or
  medical professional**.
- Bibliographic details (authors, journal names, years, sample sizes) were
  manually verified against the journals of record as of 2026-05-10, but
  may still contain errors — always check the primary source.
- No claim about relaxation, anxiety reduction, or neurological effects has
  been tested or validated in connection with VIMATHIC specifically.
- The cited studies used different stimuli (static fractal silhouettes;
  LED-based AVS devices) from what VIMATHIC produces (music-driven real-time
  mathematical animation).

---

## Recorded Content

- VIMATHIC can export visualisations as GIF or WebM files. These recordings
  are derivative works of the mathematical visualisation generated by the
  software in response to user-provided audio.
- The author makes no claim about the physiological or psychological
  effects of viewing recorded vs. live-generated mathematical animations —
  this has not been studied.
- Users are responsible for ensuring they have the rights to any audio
  used in recordings they create and distribute.
- The automatic "VIMATHIC" watermark on exported media does not confer any
  license or endorsement — it is an attribution marker, not a copyright
  claim on the user's creative output.

---

## Legal

- The license (BUSL-1.1) and its educational exception have not been
  reviewed by a lawyer.
- If you intend to rely on the license terms for commercial, institutional,
  or legal purposes, consult a qualified attorney.
- The "For tinkerers and VJs" section in the README is an informal
  statement of intent, not a legally binding contribution agreement. Formal
  contribution terms are governed by the BUSL-1.1 license.

---

## Third-Party Dependencies

VIMATHIC uses the following third-party libraries:

- [Three.js](https://threejs.org) — MIT License, © mrdoob and contributors
- [gif.js](https://github.com/jnordberg/gif.js) — MIT License, © Johan Nordberg
- [Vite](https://vitejs.dev) — MIT License, © Evan You and Vite contributors
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) — MIT License
- [Playwright](https://playwright.dev) — Apache 2.0 License (dev/test only)

All third-party code is used under its respective open-source license. The
author makes no claim to these libraries and disclaims all liability for any
issues arising from their use.

---

## In Short

VIMATHIC is a mathematical VJ studio built honestly, with care, and with the
best tools available to the author — including AI. That doesn't make every
claim correct, and it doesn't make the visuals safe for everyone.

**Use at your own risk.**
