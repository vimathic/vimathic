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

import { DOM } from './dom.js';

// Total number of color schemes defined in shaders.js (_COLOR_FUNS + getColor()).
// Schemes are indexed 0..COLOR_SCHEME_COUNT-1. If you add a new GLSL palette,
// bump this constant and the MIDI/slider ranges follow.
export const COLOR_SCHEME_COUNT = 36;

export const PARAMS = {
  amp: {
    label:   'Amplitude',
    slider:  'amplitude',
    display: 'ampv',
    min: 0.2, max: 1.5, default: 0.7,
    format: v => v.toFixed(2),
    get: ctx => ctx.audio.amp,
    set: (ctx, v) => { ctx.audio.amp = v; ctx.render.U.uAmp.value = v; },
    midi: true,
  },

  waveInt: {
    label:   'Wave Intensity',
    slider:  'waveInt',
    display: 'wiv',
    min: 0, max: 2.0, default: 1.0,
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

// ── Public helpers ─────────────────────────────────────────────────────────

/** Apply a value to a parameter and mirror the change into slider + display. */
export function applyParam(ctx, id, value) {
  const p = PARAMS[id];
  if (!p) return;
  if (p.integer) value = Math.round(value);
  p.set(ctx, value);
  syncParamUI(id, value);
}

/** Reflect a value into the slider element + value display, without setting state. */
export function syncParamUI(id, value) {
  const p = PARAMS[id];
  if (!p) return;
  if (p.slider) {
    const el = DOM[p.slider];
    if (el) el.value = String(value);
  }
  if (p.display) {
    const el = DOM[p.display];
    if (el) el.textContent = p.format ? p.format(value) : String(value);
  }
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

/** Reset every parameter to its declared default and reflect in UI. */
export function resetParamsToDefault(ctx) {
  for (const id of Object.keys(PARAMS)) {
    applyParam(ctx, id, PARAMS[id].default);
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
