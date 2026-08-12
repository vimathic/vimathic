// tests/controls-wiring.test.js
//
// Contract tests for the wiring in src/ui/controls.js — the panel's own rules
// about when a control may act, and whether the panel and the engine agree
// about what is on screen.
//
// Run:
//   node --test tests/controls-wiring.test.js
//
// ── Defect 1: AUTO MATERIAL stalls whenever the panel is collapsed ────────────
// The cycler's veto asked `_matSel.offsetParent !== null`, meaning to ask "are
// we in WIRE/PTS, where the material row is hidden and the finish forced to
// Matte". offsetParent is null under ANY display:none ancestor, and collapsing
// the controls panel — or just the ▸ VISUAL STYLE section — is one. So an armed
// AUTO MATERIAL froze for as long as the panel stayed collapsed, while AUTO
// COLOUR (which has no veto) kept running, and nothing reported the stall. The
// question the veto wants to ask has a direct answer: the engine's viz mode.
//
// ── Defect 2: R and F leave the deform panel describing the wrong mode ────────
// MathVisualizer.setFormula auto-exits volume mode, because the 192 scalar
// formulas have nothing to apply there. The dropdown's handler knows and paints
// the panel to match — COLLAPSE lights, the volume row hides, a toast explains.
// The R/F hotkeys called setFormula through their own path, so the engine went
// to Collapse while the panel kept VOLUME highlighted and its formula row open,
// one click away from writing a volume formula that no longer applies. The
// JSDoc over that path claims the three entry points "cannot drift apart".
//
// ── Controls ──────────────────────────────────────────────────────────────────
// "the veto still holds in WIRE" and "picking a formula outside volume mode
// leaves the panel alone" pass before and after: the first keeps the veto doing
// its actual job, the second stops the fix from switching modes unasked.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// Same import-order rule as tests/preset-apply.test.js: dom.js resolves every
// REQUIRED id at module load, so a document that answers with a stub element
// for any id is installed BEFORE the import. The stubs record their listeners,
// which is what lets a test fire the change event the app fires.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// controls.js → about-modal.js imports two Vite virtual modules (the docs
// bundle and the build stamp), which only exist inside a Vite build. That is
// the reason no test has reached controls.js until now. A resolve hook answers
// them with an inert stub — the About modal is not what these tests are about,
// and nothing here reads either value.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'virtual:vimathic-docs') {
      return { url: 'data:text/javascript,export default []', shortCircuit: true };
    }
    if (specifier === 'virtual:vimathic-build-info') {
      return {
        url: 'data:text/javascript,export const VIMATHIC_VERSION="test";'
           + 'export const VIMATHIC_BUILD_HASH="0000000";'
           + 'export const VIMATHIC_BUILD_DATE="1970-01-01";'
           + 'export const VIMATHIC_REPO_URL="";',
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

function makeEl(id = '') {
  return {
    id,
    value: '', textContent: '', checked: false, disabled: false,
    // offsetParent === null means "hidden" to the app; the tests set it.
    offsetParent: {},
    style: {}, dataset: {}, options: [],
    _classes: new Set(),
    classList: {
      _o: null,
      add(c)          { this._o._classes.add(c); },
      remove(c)       { this._o._classes.delete(c); },
      contains(c)     { return this._o._classes.has(c); },
      toggle(c, on)   { const has = this._o._classes.has(c);
                        const want = on ?? !has;
                        want ? this._o._classes.add(c) : this._o._classes.delete(c);
                        return want; },
    },
    _listeners: new Map(),
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent(e) { (this._listeners.get(e?.type) ?? []).forEach(fn => fn({ target: this, ...e })); return true; },
    getAnimations: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10 }),
    querySelectorAll: () => [], querySelector: () => null, closest: () => null,
    appendChild() {}, remove() {}, focus() {}, click() {}, blur() {},
    requestFullscreen: () => Promise.resolve(),
  };
}
function newEl(id) { const el = makeEl(id); el.classList._o = el; return el; }

const els = new Map();
const byId = id => {
  if (!els.has(id)) els.set(id, newEl(id));
  return els.get(id);
};
globalThis.document = {
  body: newEl('body'),
  documentElement: newEl('html'),
  getElementById: byId,
  createElement: () => newEl(),
  querySelectorAll: () => [],
  querySelector:    () => null,
  addEventListener() {}, removeEventListener() {},
  activeElement: { tagName: 'BODY' },
  fullscreenElement: null,
  exitFullscreen: () => Promise.resolve(),
};
globalThis.requestAnimationFrame = fn => { fn(0); return 0; };
globalThis.localStorage = { getItem: () => '1', setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };

let bindControls;
before(async () => { ({ bindControls } = await import('../src/ui/controls.js')); });

/** Fire the listener the app registered, the way the browser would. */
const fire = (id, type, extra = {}) => {
  const el = byId(id);
  (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
};

function makeUi() {
  const calls = [];
  const ui = {
    calls,
    called: name => calls.filter(c => c[0] === name),
    audio: {
      cb: {}, isPlaying: false, estimatedBpm: 120, colorIdx: 16,
      togglePlay() {}, prevTrack() {}, nextTrack() {}, clearPlaylist() {},
      addFiles() {}, seek() {}, setVolume() {},
    },
    render: {
      vizMode: 'surface',
      currentMaterial: 'matte', currentParticleStyle: 'squares',
      grid: { visible: false, material: { opacity: 0.1 } },
      orbit: { addEventListener() {}, target: { set() {} } },
      setSurfaceMaterial: (m, ms) => calls.push(['setSurfaceMaterial', m, ms]),
      setSurfaceMaterialAnimated: (m, ms) => calls.push(['setSurfaceMaterial', m, ms]),
      setParticleStyle:   s => calls.push(['setParticleStyle', s]),
      setVizModeGPU:      m => calls.push(['setVizModeGPU', m]),
      setGPUModeAnimated: n => calls.push(['setGPUModeAnimated', n]),
      setColorSchemeAnimated: i => calls.push(['setColorSchemeAnimated', i]),
      cancelPendingMorph: () => calls.push(['cancelPendingMorph']),
      // The morph runs its work immediately, so a test sees the effect.
      triggerMorphTransition: fn => { calls.push(['morph']); fn?.(); },
      setShape: s => calls.push(['setShape', s]),
      fadeGrid: on => calls.push(['fadeGrid', on]),
    },
    camera: { autoRot: false, cb: {}, cpParams: {}, cpKeyframes: [] },
    shaderEditor: { customVS: null, customFS: null },
    modelLoader: { clear: () => calls.push(['ml.clear']) },
    mathViz: {
      _mode: 'surface',
      setFormula: (c, k) => calls.push(['setFormula', `${c}:${k}`]),
      setVolumeFormula: k => calls.push(['setVolumeFormula', k]),
      setMode: m => calls.push(['setMode', m]),
      deactivate: () => calls.push(['deactivate']),
    },
    renderPL() {}, _showToast: m => calls.push(['toast', m]),
    _renderPresets() {}, savePreset() {}, setLoading() {},
    syncVizModeUI() {}, syncDeformUI() {},
  };
  return ui;
}

let ui;
beforeEach(() => {
  els.clear();
  ui = makeUi();
  bindControls(ui);
});

describe('AUTO MATERIAL asks the engine what is on screen, not the layout', () => {

  test('a collapsed panel does not stop the cycle', () => {
    ui.render.vizMode = 'surface';                 // ◄ SURF: material is drawable
    byId('surface-material-sel').offsetParent = null;   // panel collapsed

    assert.equal(ui.autoMaterial._canFire(), true,
      'collapsing the panel to clear the view must not freeze an armed AUTO');
  });

  test('control — the veto still holds where the material cannot be drawn', () => {
    // Both facts together, because in the app they always coincide: the viz
    // mode handler hides the row exactly when it forces Matte.
    ui.render.vizMode = 'wireframe';                   // ⬡ WIRE: forced to Matte
    byId('surface-material-sel').offsetParent = null;  // ...and its row hidden
    assert.equal(ui.autoMaterial._canFire(), false);

    ui.render.vizMode = 'points';
    assert.equal(ui.autoMaterial._canFire(), false);
  });

  test('control — in SURF with the panel open it fires as before', () => {
    ui.render.vizMode = 'surface';
    assert.equal(ui.autoMaterial._canFire(), true);
  });
});

describe('a scalar formula moves the deform panel with the engine', () => {

  test('the hotkey path auto-exits volume mode the way the dropdown does', () => {
    byId('deform-volume').classList.add('active');       // the user is in VOLUME

    ui.applyMathFormula('fractals', 'henon');

    assert.ok(ui.called('setFormula').length, 'the formula is applied either way');
    assert.equal(byId('deform-volume').classList.contains('active'), false,
      'the panel must not keep VOLUME highlighted while the engine left it');
    assert.equal(byId('deform-collapse').classList.contains('active'), true);
    assert.equal(byId('volume-formula-wrap').style.display, 'none',
      'the volume formula row is one click away from writing a formula that no longer applies');
    assert.ok(ui.called('toast').length, 'and the operator is told why the mode changed');
  });

  test('the work the caller passes lands in the same morph', () => {
    byId('deform-volume').classList.add('active');
    const order = [];
    ui.applyMathFormula('fractals', 'henon', () => order.push('shape'));

    assert.deepEqual(ui.calls.filter(c => c[0] === 'morph').length, 1,
      'R changes shape and formula together — two morphs would cancel each other');
    assert.deepEqual(order, ['shape']);
  });

  test('control — outside volume mode the panel is left alone', () => {
    byId('deform-surface').classList.add('active');

    ui.applyMathFormula('fractals', 'henon');

    assert.equal(byId('deform-surface').classList.contains('active'), true,
      'nothing asked for a mode change here');
    assert.equal(byId('deform-collapse').classList.contains('active'), false);
    assert.equal(ui.called('toast').length, 0);
    assert.ok(ui.called('setFormula').length);
  });
});
