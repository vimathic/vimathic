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

const els     = new Map();
const selEls  = new Map();
const docLtnr = new Map();
const byId = id => {
  if (!els.has(id)) els.set(id, newEl(id));
  return els.get(id);
};
// .controls-panel is looked up by selector and is the element fullscreen mode
// hides, so it needs to be a real stub rather than null.
const bySel = sel => {
  if (!selEls.has(sel)) selEls.set(sel, newEl(sel));
  return selEls.get(sel);
};
globalThis.document = {
  body: newEl('body'),
  documentElement: newEl('html'),
  getElementById: byId,
  createElement: () => newEl(),
  querySelectorAll: () => [],
  querySelector:    bySel,
  addEventListener(type, fn) {
    if (!docLtnr.has(type)) docLtnr.set(type, []);
    docLtnr.get(type).push(fn);
  },
  removeEventListener() {},
  activeElement: { tagName: 'BODY' },
  fullscreenElement: null,
  exitFullscreen() { this.fullscreenElement = null; return Promise.resolve(); },
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
/** The same for listeners the app put on `document`. */
const fireDoc = (type, extra = {}) =>
  (docLtnr.get(type) ?? []).forEach(fn => fn({ type, preventDefault() {}, stopPropagation() {}, ...extra }));
/** Let an awaited fullscreen request settle. */
const settle = () => new Promise(r => setImmediate(r));

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
  // Reset the elements in place rather than dropping them: dom.js resolved its
  // whole table at import, so DOM.btnFullscreen and friends hold these exact
  // objects. Replacing them would leave the app bound to elements no test can
  // reach — which is precisely what made two controls here fail at first.
  for (const el of [...els.values(), ...selEls.values(), document.body, document.documentElement]) {
    el._classes.clear();
    el._listeners.clear();
    el.textContent = ''; el.value = ''; el.style = {}; el.offsetParent = {};
  }
  docLtnr.clear();
  document.fullscreenElement = null;
  document.documentElement.requestFullscreen = () => { document.fullscreenElement = document.documentElement; return Promise.resolve(); };
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

// ── Fullscreen: the way out has to exist ──────────────────────────────────────
// _enterFS fired requestFullscreen and then hid the panel unconditionally,
// swallowing any failure. The panel's fs-hidden class is
// `opacity:0;pointer-events:none`, and #btn-fullscreen — the button that would
// undo it, relabelled to "✕ EXIT FULLSCREEN" — lives inside that same panel.
// So the exit branch was unreachable by click, and the only way back was the
// browser's own Escape reaching `fullscreenchange`. Where the request never
// succeeds — no requestFullscreen at all (iOS Safari, and the reason for the
// optional chaining), or a rejected promise (an iframe without
// allow="fullscreen") — that event never fires and the whole panel is invisible
// and unclickable for the rest of the session.
describe('fullscreen mode cannot trap the operator', () => {
  const panel = () => document.querySelector('.controls-panel');

  test('a refused request leaves the panel where it is', async () => {
    document.documentElement.requestFullscreen = () => Promise.reject(new Error('disallowed by permissions policy'));

    fire('btn-fullscreen', 'click');
    await settle();

    assert.equal(panel().classList.contains('fs-hidden'), false,
      'the panel is the only way to reach anything — it cannot be hidden on a promise that failed');
    assert.notEqual(document.body.style.cursor, 'none');
    assert.ok(ui.called('toast').length, 'and the operator is told why nothing happened');
  });

  test('no fullscreen API at all leaves the panel where it is', async () => {
    document.documentElement.requestFullscreen = undefined;

    fire('btn-fullscreen', 'click');
    await settle();

    assert.equal(panel().classList.contains('fs-hidden'), false);
    assert.ok(ui.called('toast').length);
  });

  test('Escape leaves the app-side fullscreen mode', async () => {
    fire('btn-fullscreen', 'click');
    await settle();
    assert.equal(panel().classList.contains('fs-hidden'), true, 'precondition: we got in');

    fireDoc('keydown', { key: 'Escape' });

    assert.equal(panel().classList.contains('fs-hidden'), false,
      'the button that would undo this is inside the panel it hides');
    assert.equal(document.body.style.cursor, '');
  });

  test('control — a granted request does hide the panel', async () => {
    fire('btn-fullscreen', 'click');
    await settle();

    assert.equal(panel().classList.contains('fs-hidden'), true);
    assert.equal(document.body.style.cursor, 'none');
    assert.match(byId('btn-fullscreen').textContent, /EXIT/);
  });

  test('control — the browser leaving fullscreen still restores the panel', async () => {
    fire('btn-fullscreen', 'click');
    await settle();

    document.fullscreenElement = null;
    fireDoc('fullscreenchange');

    assert.equal(panel().classList.contains('fs-hidden'), false);
    assert.match(byId('btn-fullscreen').textContent, /FULLSCREEN/);
  });

  test('control — Escape outside fullscreen leaves the panel alone', () => {
    fireDoc('keydown', { key: 'Escape' });
    assert.equal(panel().classList.contains('fs-hidden'), false);
  });
});
