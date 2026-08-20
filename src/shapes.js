// shapes.js — the catalogue of shape values, and the only list of them.
//
// Why a whitelist exists at all: a shape value is not something this build
// necessarily wrote. It arrives from localStorage (bootPersist restores
// vimathic_persisted_state on every page open), from an exported preset .json
// a user hand-edits, and from clip steps. Until 19.08.2026 nothing checked it.
// An unknown value walked into RenderEngine.setShape, fell through
// _buildShapeGeo's `default:` to a PlaneGeometry — and was NOT rotated, because
// the rotate list in setShape keys off the NAME and an unknown name is not in
// it. The result is a 7x7 plate standing on edge in XY: measured 161 distinct
// (x,z) sample points against the 25921 a real 'plane' gives, i.e. the domain
// the vertex shader samples collapses to a line, and the picker shows
// '— select —' with no error anywhere.
//
// Where that '— select —' comes from, since #shape-sel's markup has no such
// <option>: makeSearchable() (index.html:1972) hides the <select> with
// display:none and puts a text input in front of it whose placeholder is
// `sel.options[sel.selectedIndex]?.text || '— select —'` (index.html:2004,
// :2027). An unknown value leaves selectedIndex at -1, so that literal is what
// a viewer reads. The <select> is never the thing on screen.
//
// Measured on the built app in Chromium, booting with an unknown shape seeded
// into localStorage before any app script — first with the picker still being
// written raw, then after selectShape() below took over that write:
//   raw write:   input placeholder "— select —", scene pyramid-smooth
//   selectShape: input placeholder "Pyramid Smooth", scene pyramid-smooth
// One "[shape] unknown shape" warning either way. CONTROL both times, the same
// boot with 'disc': placeholder "Disc", no warning — so neither reading is the
// probe reporting a blank page. Probe and both runs in
// notes/audits/vimathic-round10-2026-08-19/close/shape-picker/ (P1-BEFORE.txt,
// P1-AFTER.txt).
//
// No imports on purpose: presets.js, render.js and main.js all need this list,
// and a module that pulls in three.js could not be imported by the preset
// tests. Renames are deliberately NOT handled here — there is no alias table,
// because no catalogue entry has ever been renamed; this file is only about
// values that do not exist.

/**
 * Every shape value this build can draw. Order and spelling match the
 * <option value> list in index.html and the `case` labels of
 * RenderEngine._buildShapeGeo. tests/shape-fallback-and-hf-once.test.js
 * ('the shape whitelist is the only list of shape values') checks all three
 * against each other, which is what keeps a fourth list from drifting in.
 */
export const SHAPE_NAMES = Object.freeze([
  'plane', 'sphere', 'box', 'cylinder', 'cone', 'disc', 'ring', 'circle',
  'torus', 'torusknot', 'hex', 'pyramid', 'pyramid-smooth',
  'tetrahedron', 'octahedron', 'icosahedron', 'icosahedron-smooth', 'dodecahedron',
  'star', 'solar',
]);

/**
 * The shape the app boots with: `selected` in index.html's picker and the
 * argument of the setShape() call in RenderEngine's constructor. It is also
 * the documented fallback — an unresolvable value becomes THIS, so the scene
 * a viewer gets is the one they would have got on a fresh profile, never a
 * geometry that no rotation rule knows about.
 */
export const DEFAULT_SHAPE = 'pyramid-smooth';

/**
 * True for a value _buildShapeGeo has an explicit `case` for.
 *
 * Exported on purpose, though as of round 10 nothing outside this module calls
 * it (`grep -rn isKnownShape src tests` finds only the definition and
 * normalizeShape's use of it). Kept rather than made private because it is the
 * only way to ASK the question without also answering it: the alternative a
 * caller reaches for is `normalizeShape(v) === v`, which is correct but reads
 * as a mistake — normalizeShape returns a valid shape for invalid input and
 * warns on the console while doing it, so using it as a predicate logs a
 * warning for every value it is asked about. A validator (a preset importer
 * reporting which fields it had to drop, a UI enabling a control) needs the
 * silent half, and that is this function.
 */
export function isKnownShape(v) {
  return typeof v === 'string' && SHAPE_NAMES.includes(v);
}

/**
 * Resolve any value to a shape this build can build.
 *
 * Known values are returned unchanged — that is what makes every call site a
 * provable no-op on the paths that are already correct. Anything else (a
 * retired name, a typo, a value from a newer build, null) resolves to
 * DEFAULT_SHAPE and says so once on the console: silent was the whole defect.
 *
 * @param {*} v
 * @returns {string} a member of SHAPE_NAMES
 */
export function normalizeShape(v) {
  if (isKnownShape(v)) return v;
  console.warn(
    `[shape] unknown shape ${JSON.stringify(v)} — falling back to '${DEFAULT_SHAPE}'.`,
  );
  return DEFAULT_SHAPE;
}

/**
 * Write a shape into the picker and hand back the string that was written.
 *
 * The point is the return value, not the assignment. RenderEngine.setShape
 * normalises its own argument, so the engine was always safe; the picker was
 * written straight from the snapshot, and the two could therefore show
 * different things. Making both call normalizeShape separately would fix that
 * by discipline. Returning the written string fixes it by leaving the caller
 * nothing else to pass on: the raw value is consumed here and only the
 * resolved one comes back out.
 *
 * The `if (sel)` is not covering for a missing picker in the app: shapeSel is
 * in dom.js's REQUIRED table, so a build without #shape-sel fails at boot,
 * loudly, before any of this runs. It is there so a caller that only wants the
 * resolution can pass nothing and still get it — and so the resolution, which
 * is the half the engine depends on, cannot be lost to a null element.
 *
 * @param {{value: string}|null|undefined} sel  the <select> (or its stub)
 * @param {*} v  a shape value from anywhere: preset, clip step, localStorage
 * @returns {string} a member of SHAPE_NAMES — exactly what `sel.value` now is
 */
export function selectShape(sel, v) {
  const shape = normalizeShape(v);
  if (sel) sel.value = shape;
  return shape;
}
