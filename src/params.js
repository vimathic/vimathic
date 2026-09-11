// params.js — declarative registry of every numeric parameter that has a
// slider, a MIDI mapping or a preset capture/apply path.
//
// One entry per parameter. The MIDI dropdown, the slider event handlers,
// the MIDI-driven dispatch in main.js, the RESET ALL button and the preset
// system all consume this registry, so adding a new audio-reactive knob
// is a single-place change instead of touching five files.
//
// Context shape (passed to get/set):
//   { audio, render, camera }
//
// Field reference:
//   label       — Human-readable name (used in the MIDI dropdown).
//   slider      — DOM key in dom.js for the <input type="range"> (optional).
//   display     — DOM key for the <span> that shows the formatted value (optional).
//   min, max    — Range boundaries (inclusive).
//   default     — Factory-reset value.
//   integer     — When true, values are rounded before applying.
//   format      — (value) => string for the display label.
//   get(ctx)    — Read the live value from the engine.
//   set(ctx, v) — Apply value to the engine. Some params write to multiple
//                 places (audio + render uniform) — that's all encapsulated here.
//   midi        — Whether this param appears in the MIDI mapping dropdown.
//   extendedMax — Hint for the "comfortable reach" of hold-and-drag and
//                 MIDI CC with a wide curve. This is NOT a ceiling: any
//                 path (click-to-type on the .vd badge, programmatic
//                 applyParam, preset apply) can set values arbitrarily
//                 higher and the slider will grow to fit them. extendedMax
//                 only controls (a) the speed scaling of keyboard-drag —
//                 600 px of drag, a fixed distance and not a fraction of
//                 the window, covers [max(min, DRAG_FLOOR)..extendedMax],
//                 not [min..Infinity] — and (b) the default upper bound
//                 when a tool needs a "sensible default range".
//
// DECISION (08.09.2026): the unbounded values stay unbounded. An audit raised
// the missing ceiling on amp and waveInt as a loose end from the black-squares
// work, and the owner's answer was to leave it. Recorded here rather than
// re-litigated, because the case for a cap looks obvious and is wrong:
//
//   • The consequence that made it urgent is already closed. Unbounded
//     displacement produced degenerate quads, and those produced the black
//     rectangles — but shaders.js now sanitises the displaced position before
//     gl_Position and clamps the dot product that fed pow() a negative base.
//     Measured after those two: 0 artefacts in 10,283 frames across seven
//     conditions. A large number now costs a wrecked picture and frame rate,
//     which is visible and reversible, not a corrupted frame.
//
//   • A cap at extendedMax would have been actively wrong. Amplitude 11 —
//     against a designed maximum of 1.5 — is one of the conditions the
//     black-squares report was reproduced under, so the over-drive range well
//     past extendedMax is a used part of the instrument, not an accident.
//
// So: this is a VJ tool, the operator is allowed to over-drive it, and the
// thing that made over-driving dangerous has been fixed at the other end.
//
// ── Slider-grow rationale ────────────────────────────────────────────────
// HTML5 <input type="range"> silently clamps any .value above `max`.
// Without slider-grow, a hotkey-driven value of 2.85 on a max=2.5 slider
// would clobber back to 2.5 on the next sync — making the slider visually
// pinned to the right and behaviourally an undo of the hotkey extension.
// syncParamUI() compares incoming value against the current slider.max and
// raises max to fit, with no upper cap — the slider grows arbitrarily so
// the thumb keeps representing the true value and the slider stays usable
// as a fine-tuner from wherever it is.

import { DOM } from './dom.js';

// Total number of color schemes defined in shaders.js (_COLOR_FUNS + getColor()).
// Schemes are indexed 0..COLOR_SCHEME_COUNT-1. If you add a new GLSL palette,
// bump this constant and the MIDI/slider ranges follow.
//
// Layout: 0..23 original schemes · 24..35 NEW (Cyberpunk Gold..Bioluminescence)
//         36..43 DARK series (Charcoal Smoke..Coal Plum)
//         44..53 NIGHT series (Burgundy Black..Rust Slate)
//
// The five enumerations that have to move with this number — _COLOR_FUNS,
// getColor(), #color-sel, and the two catalogue comments in shaders.js — are
// checked against it by tests/palette-catalogue.test.js. Bumping it alone
// turns that test red in five places, on purpose.
export const COLOR_SCHEME_COUNT = 54;

// Where the NIGHT series starts. NIGHT mode draws only from here up — the
// automatic pickers, that is: the dropdown stays free, because the mode is
// about what the app chooses unattended, not about what the operator may
// choose. Derived rather than written out twice so a future series appended
// after NIGHT joins the pool by construction instead of by remembering — the
// same mistake the R shape pool made for eleven shapes.
export const NIGHT_SCHEME_FIRST = 44;
export const NIGHT_SCHEMES = Array.from(
  { length: COLOR_SCHEME_COUNT - NIGHT_SCHEME_FIRST }, (_, i) => NIGHT_SCHEME_FIRST + i);
export const ALL_SCHEMES = Array.from({ length: COLOR_SCHEME_COUNT }, (_, i) => i);

/**
 * The next scheme along, INSIDE a pool — the rule behind the E hotkey.
 *
 * It lives here rather than in main.js's keydown switch for the reason
 * controls.js gives for the other three that moved: nothing in tests/ can reach
 * that switch, and that is where it was wrong. E stepped
 * `(colorIdx + 1) % COLOR_SCHEME_COUNT` — the whole catalogue — while NIGHT was
 * narrowing every other unattended picker to the ten dark schemes, so ten
 * presses of "next colour" walked out of the mode and onto scheme 0.
 *
 * Two behaviours worth stating because both are load-bearing:
 *   • On ALL_SCHEMES, indexOf(i) === i, so this IS `(i + 1) % count` — the
 *     step outside NIGHT is bit-identical to the line it replaces.
 *   • A `current` the pool does not contain gives indexOf === -1 and
 *     (-1 + 1) % n = 0, i.e. the first entry of the pool. That is the right
 *     answer rather than an accident: the dropdown is deliberately NOT narrowed
 *     by NIGHT (the mode is about what the app picks unattended), and a preset
 *     carries its own palette, so a bright scheme under NIGHT is reachable and
 *     E has to step INTO the series from it rather than stand still.
 *
 * @param {number[]} pool     ALL_SCHEMES or NIGHT_SCHEMES
 * @param {number}   current  the scheme on screen
 * @returns {number} the next scheme, or `current` for an empty pool
 */
export function nextInPool(pool, current) {
  if (!pool || !pool.length) return current;
  return pool[(pool.indexOf(current) + 1) % pool.length];
}

// Floor for hold-and-drag. Some params allow min = 0 (bassSens, trebleSens,
// bloom), and dragging one to exactly 0 makes the visualiser go silent, which
// reads as broken mid-performance — 0.1 keeps a sliver of motion. min stays 0
// for the MIDI, preset and RESET paths. Exported so the drag path and the
// documented range table cannot drift apart; tests/docs-consistency.test.js
// checks them against each other.
export const DRAG_FLOOR = 0.1;

export const PARAMS = {
  amp: {
    label:   'Amplitude',
    slider:  'amplitude',
    display: 'ampv',
    min: 0.2, max: 1.5, default: 0.7,
    // J + drag covers up to 2.0 over a 600-pixel sweep — typical
    // performance over-drive range. Values above 2.0 are reachable via
    // click-to-type.
    extendedMax: 2.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.amp,
    set: (ctx, v) => { ctx.audio.amp = v; ctx.render.U.uAmp.value = v; },
    midi: true,
  },

  waveInt: {
    label:   'Wave Intensity',
    slider:  'waveInt',
    display: 'wiv',
    // Range matches index.html slider (was 0..2.0 — drift from HTML 0.3..3.5).
    // Keep them aligned: index.html is the visible truth for slider geometry.
    min: 0.3, max: 3.5, default: 1.0,
    // N + drag covers up to 5.0 over a 600-pixel sweep — comfortable range
    // before FFT phase wraps so densely the surface aliases. Higher values
    // are reachable via click-to-type if the user wants extreme ripple.
    extendedMax: 5.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.waveInt,
    set: (ctx, v) => { ctx.audio.waveInt = v; ctx.render.U.uWI.value = v; },
    midi: true,
  },

  bandDepth: {
    label:   'Spectrum Rings',
    slider:  'bandDepth',
    display: 'bdv',
    // 0 is off; the shipped default is 0.30 — see AudioEngine.bandDepth for why
    // it stopped being 0, and why saved presets are unaffected by the change.
    //
    // The top of the plain range is 1.0 world unit ON AVERAGE ACROSS THE
    // SPECTRUM, which is about a third of the catalogue's envelope radius
    // (~3.2) and roughly two thirds of the amplitude the formula field itself
    // reaches at the factory sliders. Past that the rings stop reading as the
    // body's own texture and start reading as a second object; the extended
    // range is there for VJ use where that is the point.
    //
    // "On average" is not hedging — it is BAND_DEPTH_PROFILE, which weights the
    // 24 bands by centre frequency to a mean of exactly 1. Band 0 carries 1.94x
    // and band 23 carries 0.62x, so at the top of the plain range a kick reaches
    // 1.94 world units and a cymbal 0.62. That asymmetry is the feature; what it
    // costs is that this slider no longer names a single distance, and the
    // paragraph above used to read as though it did.
    min: 0, max: 1.0, default: 0.3,
    extendedMax: 2.5,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.bandDepth,
    set: (ctx, v) => { ctx.audio.bandDepth = v; },
    midi: true,
  },

  bassSens: {
    label:   'Bass Sensitivity',
    slider:  'bassSens',
    display: 'bsv',
    // FIX(#19): default was 1.0 while the engine boots at 1.2 — RESET ALL
    // silently nudged bass sensitivity below the startup value. Keep the
    // three aligned: audio.js (`this.bassSens = 1.2`) is the engine truth and
    // index.html is the visible truth (slider value="1.2", <span id="bsv">1.20</span>).
    min: 0, max: 2.5, default: 1.2,
    // L + drag covers 0.1..3.0 over a 600-pixel sweep — the bottom is
    // DRAG_FLOOR, not min. Comfortable range for very quiet tracks;
    // click-to-type can go higher (e.g. 500 for ambient material).
    extendedMax: 3.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.bassSens,
    set: (ctx, v) => { ctx.audio.bassSens = v; },
    midi: true,
  },

  trebleSens: {
    label:   'Treble Sensitivity',
    slider:  'trebleSens',
    display: 'tsv',
    min: 0, max: 2.5, default: 1.0,
    // K + drag covers 0.1..3.0 over a 600-pixel sweep — symmetry with bass,
    // same DRAG_FLOOR bottom. Click-to-type can go higher.
    extendedMax: 3.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.trebleSens,
    set: (ctx, v) => { ctx.audio.trebleSens = v; },
    midi: true,
  },

  bloom: {
    label:   'Bloom',
    slider:  'bloom',
    display: 'blmv',
    min: 0, max: 1.5, default: 0.55,
    // B + drag covers 0.1..2.0 over a 600-pixel sweep (the bottom is
    // DRAG_FLOOR, not min). Above ~2 the EffectComposer's bloom pass clips
    // highlights to flat white; the visual signal stops responding past
    // that point, so extending via click-to-type rarely helps — but it's
    // allowed.
    extendedMax: 2.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.render.bloomPass.strength,
    // FIX(r6): strength 0 also switches the pass OFF. Two reasons, and the
    // first is a correctness one: UnrealBloomPass's composite multiplies the
    // blurred mips by the strength, and 0 * Inf is NaN — so at exactly 0 a
    // non-finite texel that the blur had already spread across a mip tile
    // stops being an invisible overflow and becomes a solid BLACK rectangle.
    // The slider's min is 0 and its 0.05 step lands on it exactly. The shader
    // guard in shaders.js removes the non-finite input; this makes the symptom
    // unreachable even if a future shader reintroduces one.
    // The second reason is free performance: at strength 0 the pass is a
    // visual no-op that still costs 12 full-screen passes every frame.
    set: (ctx, v) => {
      ctx.render.bloomPass.strength = v;
      ctx.render.bloomPass.enabled  = v > 0;
    },
    midi: true,
  },

  colorIdx: {
    label:   'Color Scheme (step)',
    // Bound to a <select>, not a slider — controls.js handles the change event
    // directly. The MIDI path uses set() below, which keeps the select in sync.
    //
    // max MUST equal COLOR_SCHEME_COUNT-1 so MIDI CC mapping reaches every
    // palette. Previously hardcoded to 23, which silently cut off the 12 new
    // schemes added at indices 24-35.
    //
    // FIX(#2): default was 0 — RESET ALL wrote 16 (Amber) and then
    // resetParamsToDefault() clobbered it straight back to 0 (Teal Orange)
    // through set() below, which also rewrites DOM.colorSel. The default MUST
    // match the startup state: main.js sets `audio.colorIdx = 16` and
    // index.html carries `<option value="16" selected>Amber</option>`.
    // Keep all three aligned — same rule as waveInt's range above.
    min: 0, max: COLOR_SCHEME_COUNT - 1, default: 16,
    integer: true,
    // The one enumerated param in the registry, so the one that needs a real
    // ceiling: past COLOR_SCHEME_COUNT-1 there is no palette and no <option>,
    // the shader falls back to a fixed look and DOM.colorSel.selectedIndex
    // goes -1, i.e. the dropdown blanks and the operator cannot see where
    // they are. Named as the constant, not as a literal, so the next appended
    // series cannot rot it — the NIGHT series already did once. An encoder
    // on a palette selector should be endless, and 'E' already cycles with
    // `(colorIdx + 1) % COLOR_SCHEME_COUNT`, so wrap rather than clamp.
    wrap: true,
    format: v => String(Math.round(v)),
    get: ctx => ctx.audio.colorIdx,
    set: (ctx, v) => {
      const i = Math.round(v);
      ctx.audio.colorIdx = i;
      ctx.render.setColorSchemeAnimated(i);
      if (DOM.colorSel) DOM.colorSel.value = String(i);
    },
    midi: true,
  },

  rotSpeed: {
    label:   'Auto-Rotate Speed',
    // No slider — exposed only via MIDI and via camera-editor params pane.
    min: 0, max: 0.002, default: 0.00002,
    format: v => v.toFixed(5),
    get: ctx => ctx.camera.cpParams.rotSpeed,
    set: (ctx, v) => {
      ctx.camera.cpParams.rotSpeed = v;
      // Same reason as the preset path: this param has no slider of its own in
      // the panel, only the camera editor's, and a MIDI CC moving it must move
      // the thumb too.
      ctx.camera.cb?.onParamsChanged?.();
    },
    midi: true,
  },

  // ── Shader knobs — four numbers the GPU side plays on ───────────────────
  //
  // They reach `uK0…uK3` in the shader editor's scaffolds, where the meaning is
  // whatever the author gave them — that is the point of the bank, and it is
  // what makes a hand-written shader playable instead of frozen.
  //
  // FIX(r6): and they now reach the BUILT-IN program too, which they did not
  // before. Declared in the editor's two templates and nowhere else, all four
  // were dead on the ~38 numbered SHADER MODE entries — the list the app opens
  // on. Measured: 1.1x and 1.4x the frame-to-frame noise floor on "1. Bass
  // Reactive Waves" against 4.3x under a gallery body that reads one. Under a
  // numbered mode they carry a fixed meaning instead — 1 scale, 2 depth,
  // 3 phase, 4 palette — applied at the call to computeMode and at the ramp in
  // FS, each identity at rest. See the notes on VS and FS in shaders.js.
  //
  // So one knob has two meanings, which is the surprise PARAMS.detail below
  // refuses to allow BETWEEN the banks. Inside this one it is deliberate and
  // stated in the panel: a custom body is the operator's own program, and a
  // program that could not reassign its own uniforms would not be one.
  //
  // FIX(r6): this used to say "Nothing in the app reads these", and it was true
  // when it was written — which was the problem. Both shipped default bodies now
  // read one, two gallery presets are built around them, and the factory preset
  // seeded on a first visit carries a shader that plays on them. A capability
  // with no demonstration is indistinguishable from one that does not work.
  //
  // Before them, every number in a custom shader was baked into its text.
  // Changing one meant reopening a modal that blacks out the screen and, because
  // focus sits in a TEXTAREA, disarms every global hotkey — then editing, then a
  // recompile, which builds a probe scene and a render target and swaps the
  // program with needsUpdate. That is a CUT. Every other live change in this app
  // is a tween: a GPU mode crossfades over 1200 ms, a palette over 600, a shape
  // through a morph. So the one authoring surface the product calls its most
  // powerful was also the only one that could not be played.
  //
  // 0..1 with a default of 0 on purpose: it is the range a MIDI CC maps onto
  // without a curve, and the author scales it in the shader, where they can see
  // what they are scaling. Default 0 means a shader that reads uK0 starts from
  // the knob at rest rather than from a number nobody chose.
  //
  // They are in PARAM_FIELDS, so they travel in presets and in the autosave
  // beside the shader that reads them — a knob position IS part of the look. No
  // migration: a preset written before these existed simply carries no value,
  // applyState skips a null, and no shader in such a preset can mention uK
  // anyway, because the uniforms did not exist when it was written.
  // ── The two hands on a CPU formula ──────────────────────────────────────
  //
  // The knobs above are the GPU side's: four free scalars a hand-written shader
  // may read, meaning assigned by whoever wrote the shader. These are the other
  // engine's, and they are the opposite kind of control — a fixed meaning that
  // 192 formulas already interpret, finally given a hand.
  //
  // Deliberately NOT uK0..uK3 reused. Those rest at 0 and carry an author's
  // meaning; `detail` has to rest at 0.5 because it is bipolar, and giving one
  // MIDI CC "shader frequency" on one mode and "formula detail" on the next is
  // the kind of surprise a set does not survive. Two banks, one per engine,
  // each inert where its engine is not drawing — which is the arrangement the
  // app already had, unstated.
  //
  // Both are stored on RenderEngine (see its constructor) rather than on
  // MathVisualizer, because `render` is what this registry's ctx carries.
  detail: {
    label: 'Formula Detail', slider: 'formulaDetail', display: 'fdv',
    // Bipolar about the centre, and the centre is where it rests: at 0.5 the
    // `comp` a formula receives is exactly `0.5 + mid*0.4`, the arithmetic that
    // shipped. Below centre it coarsens — fewer iterations, a simpler regime —
    // and that half is not a consolation prize. `npm run bench:formulas` puts
    // Winding Number Field at 46 ms per tick at comp 0 against 188 ms at 0.9,
    // against a 16.7 ms tick, so turning detail DOWN is how an operator buys
    // back the update rate on the eleven formulas that cannot keep up. Turning
    // it up spends it.
    min: 0, max: 1, default: 0.5, format: v => v.toFixed(2),
    get: ctx => ctx.render.formulaDetail,
    set: (ctx, v) => { ctx.render.formulaDetail = v; }, midi: true },
  phase: {
    label: 'Formula Phase', slider: 'formulaPhase', display: 'fpv',
    // Additive, so 0 is rest. One sweep is one full turn of the formula clock:
    // the beat already nudges that clock by 0.3, and this is the same nudge
    // held in a hand — slide a crest onto a downbeat instead of waiting for the
    // track to put it there.
    min: 0, max: 1, default: 0, format: v => v.toFixed(2),
    get: ctx => ctx.render.formulaPhase,
    set: (ctx, v) => { ctx.render.formulaPhase = v; }, midi: true },

  k0: { label: 'Shader Knob 1', slider: 'shaderK0', display: 'k0v',
        min: 0, max: 1, default: 0, format: v => v.toFixed(2),
        get: ctx => ctx.render.U.uK0.value,
        set: (ctx, v) => { ctx.render.U.uK0.value = v; }, midi: true },
  k1: { label: 'Shader Knob 2', slider: 'shaderK1', display: 'k1v',
        min: 0, max: 1, default: 0, format: v => v.toFixed(2),
        get: ctx => ctx.render.U.uK1.value,
        set: (ctx, v) => { ctx.render.U.uK1.value = v; }, midi: true },
  k2: { label: 'Shader Knob 3', slider: 'shaderK2', display: 'k2v',
        min: 0, max: 1, default: 0, format: v => v.toFixed(2),
        get: ctx => ctx.render.U.uK2.value,
        set: (ctx, v) => { ctx.render.U.uK2.value = v; }, midi: true },
  k3: { label: 'Shader Knob 4', slider: 'shaderK3', display: 'k3v',
        min: 0, max: 1, default: 0, format: v => v.toFixed(2),
        get: ctx => ctx.render.U.uK3.value,
        set: (ctx, v) => { ctx.render.U.uK3.value = v; }, midi: true },
};

// ── DOM-write coalescing ───────────────────────────────────────────────────
//
// High-frequency callers — relative MIDI encoders firing 50–100 CC/s on a
// fast twist, keyboard hold-and-drag at full mouse rate — can flood the
// main thread with DOM writes. Each syncParamUI call writes 2–3 attributes
// (slider.value, optionally slider.max, display.textContent). At 100 calls
// per second per param, the slider's visual position visibly lags behind
// the engine value, and on slower machines the layout-thrash starves
// composer.render().
//
// Fix: coalesce per-param DOM writes into a single rAF tick. Engine writes
// (p.set) stay synchronous — they're cheap uniform updates and the audio
// thread needs them prompt. Only the cosmetic DOM mirror is throttled.
//
// _pendingUI: latest pending value per param id. Older values are simply
// overwritten; lossy compression is correct here because intermediate
// slider positions aren't perceptible.
//
// _uiRafId: single rAF handle. We coalesce ALL params into one flush
// pass per frame, not per param — fewer scheduler entries, and the writes
// happen close together in time for visual coherence.
const _pendingUI = new Map();
let   _uiRafId   = 0;

function _flushUI() {
  _uiRafId = 0;
  for (const [id, value] of _pendingUI) {
    const p = PARAMS[id];
    if (!p) continue;
    if (p.slider) {
      const el = DOM[p.slider];
      if (el) {
        const cur = parseFloat(el.max);
        if (value > cur) {
          // Stash the original HTML max on first grow so resetParamsToDefault
          // can shrink the slider back later. Subsequent grows don't overwrite.
          if (!el.dataset.htmlMax) el.dataset.htmlMax = String(cur);
          el.max = String(value);
        }
        el.value = String(value);
      }
    }
    if (p.display) {
      const el = DOM[p.display];
      if (el) el.textContent = p.format ? p.format(value) : String(value);
    }
  }
  _pendingUI.clear();
}

// ── Public helpers ─────────────────────────────────────────────────────────

/**
 * Apply a value to a parameter and mirror the change into slider + display.
 *
 * The only clamp is at the *bottom*: value < p.min becomes p.min. There is
 * NO upper clamp here. The user is allowed to set any value — via click-to-
 * type, MIDI with a wide curve, a preset, or programmatic call — and the
 * engine takes it. extendedMax exists only as a hint to the slider-grow
 * logic in syncParamUI and the speed scaling in hold-and-drag; it is not
 * a ceiling.
 *
 * Rationale: the slider's `max` attribute is for visual range of the
 * thumb, not for absolute clamping. A VJ who wants bass sensitivity at
 * 500 (e.g. to react to very quiet ambient material) should get 500.
 */
export function applyParam(ctx, id, value) {
  const p = PARAMS[id];
  if (!p) return;
  // Defensive guard: a corrupted preset or a runaway calculation upstream
  // could send NaN or Infinity here. Either silently breaks the engine
  // (uniform writes become NaN, three.js renders nothing) or crashes
  // localStorage round-trip. Fall back to default rather than propagate.
  if (!Number.isFinite(value)) value = p.default;
  if (p.integer) value = Math.round(value);
  // `wrap` opts a param out of the "extended values stay extended" policy
  // above, for enumerated params where a value past max means nothing. Every
  // writer funnels through here — MIDI relative mode, preset and autosave
  // restore, RESET ALL, hotkeys — so this is the only place that needs it.
  if (p.wrap) {
    const n = p.max - p.min + 1;
    value = p.min + (((value - p.min) % n) + n) % n;
  } else if (value < p.min) value = p.min;
  p.set(ctx, value);
  syncParamUI(id, value);
}

/**
 * Reflect a value into the slider element + value display, without setting
 * engine state.
 *
 * Writes are coalesced into the next animation frame — a fast MIDI sweep
 * that fires 100 CC/s won't trigger 100 layout passes; only the latest
 * value per param survives to the next frame. This keeps the slider thumb
 * tracking the live value smoothly under fast input. Engine state is NOT
 * coalesced (see applyParam) — uniforms update synchronously so audio
 * stays tight.
 *
 * Slider-grow policy: if value exceeds the slider's current `max`, the max
 * is grown to fit so the thumb represents the true stored value instead of
 * silently clamping (HTML5 default) to the visible right edge. There is no
 * upper cap on growth — extendedMax is only a hint for the "normal" reach
 * of hold-and-drag, not a hard limit. A 500 value grows the slider to 500.
 *
 * Display label always shows the true value via p.format, independent of
 * slider geometry.
 */
export function syncParamUI(id, value) {
  _pendingUI.set(id, value);
  if (!_uiRafId) _uiRafId = requestAnimationFrame(_flushUI);
}

/** Wire every slider-backed param to its <input>. Called once from controls.js. */
export function bindParamSliders(ctx) {
  for (const [id, p] of Object.entries(PARAMS)) {
    if (!p.slider) continue;
    const el = DOM[p.slider];
    if (!el) continue;
    el.addEventListener('input', e => applyParam(ctx, id, +e.target.value));
  }
}

/**
 * Reset every parameter to its declared default and reflect in UI.
 *
 * Also shrinks each slider's `max` attribute back to its original HTML
 * value. syncParamUI may have grown it to fit an extended hotkey value;
 * after reset the value sits inside the normal range, so we shrink the
 * slider back so the thumb position represents the value against the
 * "natural" range (otherwise a default 0.7 amp sits at the left third of
 * a slider stretched to extendedMax=2.0).
 *
 * The original max is captured lazily on the first slider grow — see
 * syncParamUI's `dataset.htmlMax` write.
 */
export function resetParamsToDefault(ctx) {
  for (const id of Object.keys(PARAMS)) {
    const p = PARAMS[id];
    if (p.slider) {
      const el = DOM[p.slider];
      // dataset.htmlMax is populated by syncParamUI on the first grow.
      // If it was never grown, there's nothing to restore.
      if (el && el.dataset.htmlMax) el.max = el.dataset.htmlMax;
    }
    applyParam(ctx, id, p.default);
  }
}

/** Snapshot of all current values, keyed by param id. Used by preset capture. */
export function captureParams(ctx) {
  const out = {};
  for (const [id, p] of Object.entries(PARAMS)) {
    out[id] = p.get(ctx);
  }
  return out;
}

// ── MIDI dropdown options ──────────────────────────────────────────────────
// Built from PARAMS so adding a midi-mappable param surfaces automatically.
// The 'none' sentinel keeps the "— Unassigned —" entry at the end of the list.
export const MIDI_PARAMS = [
  ...Object.entries(PARAMS)
    .filter(([, p]) => p.midi)
    .map(([id, p]) => ({
      id, label: p.label,
      min: p.min, max: p.max, default: p.default,
      integer: !!p.integer,
      // FIX: `wrap` has to travel with the rest. The MIDI decoder lower-clamps
      // a relative delta before handing it on, and applyParam — where the wrap
      // lives — never saw a value below min. An encoder on the palette was
      // endless clockwise and dead anticlockwise, which is exactly what the
      // wrap flag exists to prevent.
      wrap: !!p.wrap,
    })),
  { id: 'none', label: '— Unassigned —', min: 0, max: 1, default: 0 },
];
