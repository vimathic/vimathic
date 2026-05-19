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
//                 a full window sweep covers [min..extendedMax], not
//                 [min..Infinity] — and (b) the default upper bound when
//                 a tool needs a "sensible default range".
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
export const COLOR_SCHEME_COUNT = 44;

export const PARAMS = {
  amp: {
    label:   'Amplitude',
    slider:  'amplitude',
    display: 'ampv',
    min: 0.2, max: 1.5, default: 0.7,
    // J + drag covers up to 2.0 at full window sweep — typical performance
    // over-drive range. Values above 2.0 are reachable via click-to-type.
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
    // N + drag covers up to 5.0 at full window sweep — comfortable range
    // before FFT phase wraps so densely the surface aliases. Higher values
    // are reachable via click-to-type if the user wants extreme ripple.
    extendedMax: 5.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.waveInt,
    set: (ctx, v) => { ctx.audio.waveInt = v; ctx.render.U.uWI.value = v; },
    midi: true,
  },

  bassSens: {
    label:   'Bass Sensitivity',
    slider:  'bassSens',
    display: 'bsv',
    min: 0, max: 2.5, default: 1.0,
    // L + drag covers up to 3.0 at full window sweep — comfortable range
    // for very quiet tracks. Click-to-type can go higher (e.g. 500 for
    // ambient material).
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
    // K + drag covers up to 3.0 at full window sweep — symmetry with bass.
    // Click-to-type can go higher.
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
    // B + drag covers up to 2.0 at full window sweep. Above ~2 the
    // EffectComposer's bloom pass clips highlights to flat white; the
    // visual signal stops responding past that point, so extending via
    // click-to-type rarely helps — but it's allowed.
    extendedMax: 2.0,
    format: v => v.toFixed(2),
    get: ctx => ctx.render.bloomPass.strength,
    set: (ctx, v) => { ctx.render.bloomPass.strength = v; },
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
    min: 0, max: COLOR_SCHEME_COUNT - 1, default: 0,
    integer: true,
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
    set: (ctx, v) => { ctx.camera.cpParams.rotSpeed = v; },
    midi: true,
  },
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
  if (value < p.min) value = p.min;
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
    })),
  { id: 'none', label: '— Unassigned —', min: 0, max: 1, default: 0 },
];
