// src/viz-mode.js
//
// FIX(#51): the viz-mode whitelist, mirroring shapes.js for the same reason.
// A viz mode is not something this build can afford to take on faith: it
// arrives from presets, imported settings, clip steps and localStorage — all
// doors that a value from another build (or a hand-edited file) walks through.
// setVizModeGPU used to store whatever string it was handed: an unknown mode
// fell into the "not points, not surface" gap — surface material with lighting
// off, no proxy, no button lit — and said nothing. Silent was the whole
// defect; shapes.js already names that class, this file closes the same door
// one row up.

export const VIZ_MODES = Object.freeze(['surface', 'wireframe', 'points']);

export const DEFAULT_VIZ_MODE = 'surface';

/** @returns {boolean} true iff v names a mode this build renders */
export function isKnownVizMode(v) {
  return typeof v === 'string' && VIZ_MODES.includes(v);
}

/**
 * Resolve any value to a viz mode this build can draw.
 *
 * Known values are returned unchanged, so every call site is a provable no-op
 * on the paths that are already correct. Anything else resolves to
 * DEFAULT_VIZ_MODE and says so once on the console.
 *
 * @param {*} v
 * @returns {string} a member of VIZ_MODES
 */
export function normalizeVizMode(v) {
  if (isKnownVizMode(v)) return v;
  console.warn(
    `[viz-mode] unknown viz mode ${JSON.stringify(v)} — falling back to '${DEFAULT_VIZ_MODE}'.`,
  );
  return DEFAULT_VIZ_MODE;
}
