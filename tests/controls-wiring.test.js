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

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// controls.js → about-modal.js imports two Vite virtual modules (the docs
// bundle and the build stamp), which only exist inside a Vite build. That is
// the reason no test has reached controls.js until now. A resolve hook answers
// them with an inert stub — the About modal is not what these tests are about,
// and nothing here reads either value.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'virtual:vimathic-docs') {
      // One standalone doc and one inside a group: the grouped item is the
      // case that goes into document.body rather than the tab strip.
      const DOCS = JSON.stringify([
        { slug: 'quick-start', title: 'Quick Start', group: null,         html: '<p>a</p>' },
        { slug: 'recording',   title: 'Recording',   group: 'production', html: '<p>b</p>' },
      ]);
      return {
        url: 'data:text/javascript,export default ' + encodeURIComponent(DOCS),
        shortCircuit: true,
      };
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
function newEl(id) {
  const el = makeEl(id);
  el.classList._o = el;
  // about-modal.js builds its tabs with `el.className = '...'`, and the tests
  // below find them by class — so the two have to be the same set.
  Object.defineProperty(el, 'className', {
    get: () => [...el._classes].join(' '),
    set: v => { el._classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => el._classes.add(c)); },
  });
  created.push(el);
  return el;
}

// Everything the app has built, so a document-wide query can answer. A real
// document would only return attached nodes; nothing here detaches, and the
// alternative is a DOM implementation.
const created = [];

/** Matches '.cls' and '.cls[data-x="y"]' — all these tests need. */
function matches(el, sel) {
  const m = sel.match(/^\.([\w-]+)(?:\[data-([\w-]+)="([^"]*)"\])?$/);
  if (!m) return false;
  const [, cls, attr, val] = m;
  if (!el._classes.has(cls)) return false;
  if (!attr) return true;
  const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return String(el.dataset?.[key]) === val;
}

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
  querySelectorAll: sel => created.filter(el => matches(el, sel)),
  querySelector:    sel => (sel.startsWith('.about-') ? created.find(el => matches(el, sel)) ?? null : bySel(sel)),
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
// FIX(review K6): window keeps its listeners too, with their options. The
// hold-and-drag wheel listener moved there, into the capture phase, so that
// OrbitControls' wheel listener on the canvas never sees a notch that turns a
// knob; a window that dropped what it was given would drop that listener.
const winLtnr = new Map();   // type → [{ fn, opts }]
globalThis.window = {
  addEventListener(type, fn, opts) {
    if (!winLtnr.has(type)) winLtnr.set(type, []);
    winLtnr.get(type).push({ fn, opts });
  },
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};

let bindControls;
// The two palette pools NIGHT swaps between, and where the series starts.
// Imported rather than written out: the point of the assertions below is that
// the panel hands the cycler the pool params.js declares, not that the pool
// happens to be ten numbers today.
let NIGHT_SCHEMES, ALL_SCHEMES, NIGHT_SCHEME_FIRST;
// The registry and the audio keys' floor, for the hold-and-drag groups: values
// are read and seeded through PARAMS' own get / set, and DRAG_FLOOR is what the
// old drag rule (dragBefore, further down) is written in.
let PARAMS, DRAG_FLOOR;
before(async () => {
  ({ bindControls } = await import('../src/ui/controls.js'));
  ({ NIGHT_SCHEMES, ALL_SCHEMES, NIGHT_SCHEME_FIRST, PARAMS, DRAG_FLOOR } = await import('../src/params.js'));
});

/** Fire the listener the app registered, the way the browser would. */
const fire = (id, type, extra = {}) => {
  const el = byId(id);
  (el._listeners.get(type) ?? []).forEach(fn => fn({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra }));
};
/** The same for listeners the app put on `document`. */
const fireDoc = (type, extra = {}) =>
  (docLtnr.get(type) ?? []).forEach(fn => fn({ type, preventDefault() {}, stopPropagation() {}, ...extra }));
/** …and on `window`. */
const fireWin = (type, extra = {}) =>
  (winLtnr.get(type) ?? []).forEach(({ fn }) => fn({ type, preventDefault() {}, stopPropagation() {}, ...extra }));
/** Let an awaited fullscreen request settle. */
const settle = () => new Promise(r => setImmediate(r));

const CP_DEFAULT_TEMPLATE = '// the camera-programmer starting template';

// The eight camera-programmer knobs at factory settings — camera.js owns the
// real copy (CP_DEFAULT_PARAMS); this is the value the reset has to restore.
const CP_FACTORY = {
  rotSpeed: 0.00002, radius: 7.2, height: 3.2, gravity: 0.0004,
  bassReact: 1.0, damping: 0.996, fov: 45, roll: 0,
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
      orbit: { addEventListener() {}, target: { set() {} }, update() {} },
      // RESET ALL drives the real camera and the real resetParamsToDefault
      // through these; every other test in this file leaves them untouched.
      camera: {
        fov: 60, position: { set() {} }, up: { set() {} }, updateProjectionMatrix() {},
      },
      // uCM / uCMNext / uCMBlend are the pair NIGHT's switch-on guard reads to
      // find out what is actually on screen, as opposed to where the palette
      // is headed. A stub without them would send that guard down its
      // `?? a.colorIdx` fallback, i.e. back to the very question the fix
      // stopped asking, and the tests below would pass on the old code.
      U: { // PARAMS.k0..k3 store their value IN the uniform, as bloom does in the
      // composer pass. A ctx stub that omits them throws on capture and reset.
      uAmp: { value: 0.7 }, uWI: { value: 1 },
         uK0: { value: 0 }, uK1: { value: 0 }, uK2: { value: 0 }, uK3: { value: 0 },
           uCM: { value: 16 }, uCMNext: { value: 16 }, uCMBlend: { value: 0 } },
      bloomPass: { strength: 0.6, radius: 0.4, threshold: 0.85 },
      setShapeAnimated: s => calls.push(['setShapeAnimated', s]),
      setSurfaceMaterial: (m, ms) => calls.push(['setSurfaceMaterial', m, ms]),
      setSurfaceMaterialAnimated: (m, ms) => calls.push(['setSurfaceMaterial', m, ms]),
      setParticleStyle:   s => calls.push(['setParticleStyle', s]),
      currentWireStyle: 'classic',
      setWireStyle:       s => calls.push(['setWireStyle', s]),
      setVizModeGPU:      m => calls.push(['setVizModeGPU', m]),
      setGPUModeAnimated: n => calls.push(['setGPUModeAnimated', n]),
      setColorSchemeAnimated: i => calls.push(['setColorSchemeAnimated', i]),
      cancelPendingMorph: () => calls.push(['cancelPendingMorph']),
      // Queued, not run: the real engine holds the work until the flat frame,
      // up to 400 ms later, and that gap is exactly what these tests are about.
      _queued: [],
      triggerMorphTransition(fn) { calls.push(['morph']); if (fn) this._queued.push(fn); },
      flatFrame() { const q = this._queued; this._queued = []; q.forEach(fn => fn()); },
      setShape: s => calls.push(['setShape', s]),
      fadeGrid: on => calls.push(['fadeGrid', on]),
      // NIGHT. The engine half is tested against the real method in
      // tests/night-mode.test.js; what matters here is that the panel drives
      // it and that `nightly` is where the click handler reads the current
      // state from, so the stub keeps the flag rather than only recording.
      nightly: false,
      setNightly(on) { this.nightly = !!on; calls.push(['render.setNightly', !!on]); },
      // STARS, the same way: the engine half (the wish against TRANSPARENT BG)
      // is tested against the real methods in tests/stars-toggle.test.js; here
      // the click handler reads `starsOn` to decide which way to flip, so the
      // stub keeps the flag as well as recording the call.
      starsOn: true,
      setStarsOn(on) { this.starsOn = !!on; calls.push(['render.setStarsOn', !!on]); },
    },
    // resetScript, setCamPhysics and buildTimeline are what the RESET ALL
    // handler calls; the mirror below is deliberately thin — it copies only the
    // part of camera.js:322 (resetScript) that a reset is judged by, which is that the editor
    // buffer stops holding the user's script (real one: cb.onSetCode(CP_DEFAULT)).
    camera: {
      autoRot: false, cpActive: false, cpSource: null, cpParams: { ...CP_FACTORY, radius: 99, damping: 0.5 }, cpKeyframes: [],
      cb: { onAutoRotChanged(v) { calls.push(['autoRotChanged', v]); }, onSetCode(code) { byId('ce-code').value = code; }, onParamsChanged() { calls.push(['paramsChanged']); } },
      getDefaultCode: () => CP_DEFAULT_TEMPLATE,
      // FIX(r11): the real setCamPhysics ends with `this.autoRot = true` and
      // `onAutoRotChanged(true)` (camera.js). The stub used to record the call
      // and stop there, which is why nothing here could see RESET ALL switching
      // auto-rotate back on twelve lines after clearing it. A stub that omits
      // the side effect under test is a test that cannot fail.
      setCamPhysics(p) {
        calls.push(['setCamPhysics', p]);
        this.autoRot = true;
        this.cb.onAutoRotChanged(true);
      },
      buildTimeline: () => calls.push(['buildTimeline']),
      resetScript() {
        this.cpActive = false; this.cpFn = null; this.cpSource = null;
        this.cb.onSetCode(this.getDefaultCode());
        calls.push(['resetScript']);
        // Mirrors the real one's last line, which is where the defect lived.
        this.setCamPhysics('dark_matter');
      },
    },
    // `cb` because bindControls hangs the formula slot's re-sync on
    // cb.onProgramChange — the real editor fires it when customVS / customFS
    // change, and the tests below fire it the same way.
    shaderEditor: { customVS: null, customFS: null, cb: {} },
    modelLoader: {
      clear:  () => calls.push(['ml.clear']),
      cancel: () => calls.push(['ml.cancel']),
    },
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
  winLtnr.clear();
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
    ui.render.flatFrame();

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
    ui.render.flatFrame();

    assert.deepEqual(ui.calls.filter(c => c[0] === 'morph').length, 1,
      'R changes shape and formula together — two morphs would cancel each other');
    assert.deepEqual(order, ['shape']);
  });

  test('control — outside volume mode the panel is left alone', () => {
    byId('deform-surface').classList.add('active');

    ui.applyMathFormula('fractals', 'henon');
    ui.render.flatFrame();

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

// ── Regression on the fix itself (found by adversarial review of 49c69cd) ─────
// Commit 49c69cd made a superseded morph hand its queued work to the morph that
// replaces it — correct — and then had the GPU-shader branches call
// cancelPendingMorph() to disclaim a formula the shader supersedes. Two things
// were wrong with that. It dropped the ENTIRE queued closure, and applyState
// bundles the shape swap and the deform switch into the same one, so picking a
// shader mid-preset threw away geometry work that used to land. And it was
// wired to two of the THREE places that switch to a shader: applyState never
// called it, so the stale formula rode into the preset's own morph and re-armed
// the CPU path over the shader the preset had just applied — the very defect
// the commit set out to fix.
//
// The queue is no longer cancelled by anyone. Instead the queued formula asks,
// at the flat frame, whether it is still the selection — #gpu-sel is the single
// value every path writes — which covers all three shader entry points at once
// and leaves everything else in the queue alone.
describe('work queued for a flat frame consults the live selection when it gets there', () => {

  test('a formula superseded by a shader does not re-arm the CPU path', () => {
    byId('gpu-sel').value = 'm:fractals:henon';
    ui.applyMathFormula('fractals', 'henon');

    byId('gpu-sel').value = '20';        // any of the three: dropdown, R/F, a preset
    ui.render.flatFrame();

    assert.equal(ui.called('setFormula').length, 0,
      'setFormula sets uMathMode = 1 and the shader draws nothing at all');
  });

  test('but the geometry queued beside it still lands', () => {
    byId('gpu-sel').value = 'm:fractals:henon';
    const landed = [];
    ui.applyMathFormula('fractals', 'henon', () => landed.push('shape'));

    byId('gpu-sel').value = '20';
    ui.render.flatFrame();

    assert.deepEqual(landed, ['shape'],
      'the shape dropdown was already written; dropping the swap makes it a lie');
    assert.equal(ui.called('setFormula').length, 0);
  });

  test('a formula superseded by ANOTHER formula does not land either', () => {
    byId('gpu-sel').value = 'm:fractals:henon';
    ui.applyMathFormula('fractals', 'henon');

    byId('gpu-sel').value = 'm:waves:standing';
    ui.applyMathFormula('waves', 'standing');
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setFormula').map(c => c[1]), ['waves:standing'],
      'only the selection the operator is actually looking at gets armed');
  });

  test('control — nothing superseded it, so it lands', () => {
    byId('gpu-sel').value = 'm:fractals:henon';
    ui.applyMathFormula('fractals', 'henon');
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setFormula').map(c => c[1]), ['fractals:henon']);
  });

  test('the volume deformation queued by DEFORM: VOLUME is guarded the same way', () => {
    byId('gpu-sel').value = 'm:fractals:henon';
    fire('deform-volume', 'click');

    byId('gpu-sel').value = '20';        // a shader taken during the morph
    ui.render.flatFrame();

    assert.equal(ui.called('setVolumeFormula').length, 0,
      'setVolumeFormula sets uMathMode = 1 too — same consequence, same rule');
  });

  test('control — DEFORM: VOLUME with nothing superseding it still arms', () => {
    byId('gpu-sel').value = 'm:fractals:henon';
    fire('deform-volume', 'click');
    ui.render.flatFrame();

    assert.equal(ui.called('setVolumeFormula').length, 1);
  });
});

// ── What main.js used to own ──────────────────────────────────────────────────
// Adversarial review of 1f6bb53 showed both of that commit's main.js fixes were
// pinned by nothing: the whole suite stayed green with them reverted verbatim,
// because no test can import main.js — its module body boots the app. The
// behaviour moved into the layer that owns the panel, and these are the tests
// that were impossible before.
describe('the finish cycle (T) belongs to the panel', () => {
  const OPTS = [{ value: 'matte' }, { value: 'glass' }, { value: 'mirror' }];

  test('it steps to the next finish', () => {
    byId('surface-material-sel').options = OPTS;
    byId('surface-material-sel').value = 'matte';
    ui.render.vizMode = 'surface';

    // bindControls applies the finish once while wiring, so count from here.
    const before = ui.called('setSurfaceMaterial').length;
    ui.cycleMaterial();

    assert.equal(byId('surface-material-sel').value, 'glass');
    assert.equal(ui.called('setSurfaceMaterial').length, before + 1);
    assert.deepEqual(ui.called('setSurfaceMaterial').at(-1).slice(0, 2), ['setSurfaceMaterial', 'glass']);
  });

  test('a collapsed panel does not make T dead', () => {
    byId('surface-material-sel').options = OPTS;
    byId('surface-material-sel').value = 'matte';
    ui.render.vizMode = 'surface';
    byId('surface-material-sel').offsetParent = null;      // panel collapsed

    ui.cycleMaterial();

    assert.equal(byId('surface-material-sel').value, 'glass',
      'the finish is drawable in SURF whether or not its row is on screen');
  });

  test('control — T is inert where the finish cannot be drawn', () => {
    byId('surface-material-sel').options = OPTS;
    byId('surface-material-sel').value = 'matte';
    ui.render.vizMode = 'points';

    const before = ui.called('setSurfaceMaterial').length;
    ui.cycleMaterial();

    assert.equal(byId('surface-material-sel').value, 'matte');
    assert.equal(ui.called('setSurfaceMaterial').length, before, 'nothing was applied');
  });

  test('and it restarts the AUTO MATERIAL countdown, on purpose now', () => {
    byId('surface-material-sel').options = OPTS;
    byId('surface-material-sel').value = 'matte';
    ui.render.vizMode = 'surface';
    let deferred = 0;
    ui.autoMaterial.defer = () => { deferred++; };

    ui.cycleMaterial();

    assert.equal(deferred, 1,
      'a hand-picked finish earns its full period — the old version got this only ' +
      'as a side effect of dispatching a change event');
  });
});

describe('applyFormulaValue is the one door for the dropdown, R and F', () => {

  test('a shader value hands the surface to the GPU', () => {
    ui.applyFormulaValue('20');

    assert.equal(byId('gpu-sel').value, '20', 'the selection is what queued work reads');
    assert.equal(ui.called('deactivate').length, 1);
    assert.deepEqual(ui.called('setGPUModeAnimated')[0], ['setGPUModeAnimated', 20]);
  });

  test('a shader gets the shape swap its own morph, since uMode crossfades', () => {
    const landed = [];
    ui.applyFormulaValue('20', () => landed.push('shape'));
    assert.deepEqual(landed, [], 'queued for the flat frame, not run on the way');

    ui.render.flatFrame();
    assert.deepEqual(landed, ['shape']);
  });

  test('a formula value goes through the shared CPU path, panel and all', () => {
    byId('deform-volume').classList.add('active');

    ui.applyFormulaValue('m:fractals:henon');
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setFormula').map(c => c[1]), ['fractals:henon']);
    assert.equal(byId('deform-collapse').classList.contains('active'), true,
      'the volume auto-switch is the reason this door exists');
  });

  test('a shader picked in VOLUME takes the panel out of it', () => {
    byId('deform-volume').classList.add('active');   // the user is in VOLUME
    byId('volume-formula-wrap').style.display = '';  // with its formula row open

    ui.applyFormulaValue('20');

    assert.deepEqual(ui.called('setMode').map(c => c[1]), ['surface'],
      'the engine mode is written too: captureState reads mathViz._mode, and a stale ' +
      "'volume' beside a numeric gpuSelVal is the one pair applyState refuses to restore");
    assert.equal(byId('deform-volume').classList.contains('active'), false,
      'the panel must not keep VOLUME lit while a shader owns the surface — the guard in ' +
      '_setDeformMode refuses the very mode the button is showing as current');
    assert.equal(byId('deform-surface').classList.contains('active'), true);
    assert.equal(byId('volume-formula-wrap').style.display, 'none',
      'the volume formula row is one click away from a mode the shader forbids');
    assert.ok(ui.called('toast').length, 'and the operator is told why the mode changed');
  });

  test('control — a shader picked in COLLAPSE leaves the panel alone', () => {
    byId('deform-collapse').classList.add('active');

    ui.applyFormulaValue('20');

    assert.equal(byId('deform-collapse').classList.contains('active'), true,
      'collapse never touches uMathMode, so it round-trips over a shader and applyState honours it');
    assert.equal(ui.called('setMode').length, 0, 'nothing asked for a mode change here');
    assert.equal(ui.called('toast').length, 0);
  });

  test('control — the dropdown itself goes through the same door', () => {
    byId('gpu-sel').value = '20';
    fire('gpu-sel', 'change', { target: byId('gpu-sel') });

    assert.deepEqual(ui.called('setGPUModeAnimated')[0], ['setGPUModeAnimated', 20]);
  });
});

// ✕ CLEAR MODEL was revealed by every import and bound by nobody, so an
// imported model could not be removed for the rest of the session — clear() was
// reached only from beforeunload. The listener that fixed it had no test of its
// own, and the file input is half of it: without clearing #model-file, picking
// the same file again fires no 'change' event and the way back is dead too.
describe('an imported model can be removed again', () => {

  test('✕ CLEAR MODEL gives the stage back and re-arms the file picker', () => {
    byId('model-file').value = 'C:\\fakepath\\bunny.obj';
    byId('model-info').textContent = 'bunny.obj — 4968 verts';
    byId('btn-clear-model').style.display = '';

    fire('btn-clear-model', 'click');

    // cancel(), not clear(). FIX(r6): the button is the user saying "no model",
    // and clear() alone does not touch the loader's _loadId — so an import still
    // being decoded when the button was pressed came back a moment later, found
    // itself un-superseded, and put the model the user had just removed back on
    // the stage. cancel() bumps the id first. The bump cannot live inside
    // clear(), because load() calls clear() itself three lines after taking its
    // own id: every import would supersede itself and nothing would ever load.
    assert.equal(ui.called('ml.cancel').length, 1, 'the model itself has to go, in flight or not');
    assert.equal(ui.called('ml.clear').length, 0,
      'clear() alone leaves an in-flight import free to arrive after the user cancelled it');
    assert.equal(byId('model-info').textContent, '');
    assert.equal(byId('model-file').value, '',
      're-picking the same file fires no change event unless the input is cleared');
    assert.equal(byId('btn-clear-model').style.display, 'none',
      'nothing left to clear, so the button goes away with it');
  });
});

// ── ⬡ VOLUME and the selection it was pressed against ────────────────────────
// setVolumeFormula sets uMathMode = 1, and the GPU displacement is gated on
// uMathMode == 0 — so a shader that claims #gpu-sel inside the 400 ms morph
// window must not have volume armed under it when the flat frame arrives. The
// guard for that asked "is an m: formula selected NOW", which is a different
// question: applyMathFormula can ask it because it WRITES #gpu-sel itself and
// only re-reads it to catch a later writer, while this button writes nothing.
// So it also refused the state it was pressed from — with a shader selected the
// click lit VOLUME and opened its formula row while the engine never moved,
// and #volume-formula-sel (which had no check at all) reached volume mode
// anyway one nudge later. The two doors have to agree, and the question both
// can answer is "is this still the selection the click was made against".
describe('the deform buttons refuse a mode the engine cannot enter, and say why', () => {
  // A pick by hand, the way the dropdown makes one: the value, then its change
  // event, which runs ui.applyFormulaValue. FIX(review K2): the refusal asks
  // the formula slot's memory now rather than reading #gpu-sel back, and every
  // app path that writes the select tells the slot — so these tests make the
  // write an app path makes. (They used to assign the stub's value alone.)
  const pickByHand = v => { byId('gpu-sel').value = v; fire('gpu-sel', 'change'); };

  test('⬡ VOLUME with a GPU shader on screen refuses instead of lighting up', () => {
    pickByHand('7');                                // a GPU shader, picked by hand
    byId('volume-formula-sel').value = 'twist';
    byId('deform-volume').classList.toggle('active', false);
    byId('volume-formula-wrap').style.display = 'none';

    fire('deform-volume', 'click');
    ui.render.flatFrame();

    assert.equal(ui.called('setVolumeFormula').length, 0,
      'setVolumeFormula sets uMathMode = 1 and shaders.js gates the shader\'s WHOLE ' +
      'displacement on uMathMode == 0: honouring this click would switch off the ' +
      'shader #gpu-sel still names, and produce a view applyState refuses to restore');
    assert.equal(byId('deform-volume').classList.contains('active'), false,
      'and the button must not paint a mode the engine did not enter — the lie was the defect');
    assert.equal(byId('volume-formula-wrap').style.display, 'none',
      'nor open a formula row for a mode that is not on');
    assert.ok(ui.called('toast').length,
      'a dead button is a different lie: the operator is told which selection is in the way');
  });

  test('control — with a CPU formula selected ⬡ VOLUME still works in full', () => {
    pickByHand('7');                                // from a shader…
    pickByHand('m:waves:standingWave');             // …to a formula, so the slot has moved
    byId('volume-formula-sel').value = 'twist';

    fire('deform-volume', 'click');
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setVolumeFormula'), [['setVolumeFormula', 'twist']],
      'the refusal must be narrow — this is the case the button exists for');
    assert.equal(byId('deform-volume').classList.contains('active'), true);
    assert.equal(byId('volume-formula-wrap').style.display, '');
  });

  test('a shader claiming the selection inside the morph window still stops it', () => {
    pickByHand('m:waves:standingWave');
    byId('volume-formula-sel').value = 'twist';

    fire('deform-volume', 'click');
    ui.applyFormulaValue('7');                      // F, or the dropdown, mid-morph
    ui.render.flatFrame();

    assert.equal(ui.called('setVolumeFormula').length, 0,
      'uMathMode = 1 gates the shader\'s whole displacement off — it would draw nothing');
  });

  test('#volume-formula-sel refuses in the same voice — one door of two is not a rule', () => {
    // This row stays on screen if the shader was picked AFTER volume mode was
    // entered, so it is a live way back into uMathMode = 1 behind the shader.
    pickByHand('7');
    byId('volume-formula-sel').value = 'fluidVortex';

    fire('volume-formula-sel', 'change');
    ui.render.flatFrame();

    assert.equal(ui.called('setVolumeFormula').length, 0,
      'a rule enforced on one of two adjacent doors is not a rule');
    assert.ok(ui.called('toast').length, 'and it refuses out loud, like the button does');
  });

  test('control — the row still works over a CPU formula, and still stands down when superseded', () => {
    pickByHand('7');
    pickByHand('m:waves:standingWave');
    byId('volume-formula-sel').value = 'fluidVortex';

    fire('volume-formula-sel', 'change');
    ui.render.flatFrame();
    assert.deepEqual(ui.called('setVolumeFormula'), [['setVolumeFormula', 'fluidVortex']]);

    ui.calls.length = 0;
    fire('volume-formula-sel', 'change');
    ui.applyFormulaValue('9');                      // superseded before the flat frame
    ui.render.flatFrame();
    assert.equal(ui.called('setVolumeFormula').length, 0,
      'the morph-window race is still guarded on this door too');
  });

  test('control — ⬡ SURF and ⬡ COLLAPSE still switch the engine mode', () => {
    byId('gpu-sel').value = '7';

    fire('deform-collapse', 'click');
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setMode'), [['setMode', 'collapse']],
      'collapse never touches uMathMode, so it has nothing to ask about');
  });
});

// ── Three more places where the panel and the engine disagreed ────────────────
describe('a material refresh that changes nothing leaves the fade alone', () => {
  const OPTS = ['matte', 'glass', 'mirror', 'metal', 'pearl', 'chrome'].map(value => ({ value }));

  test('naming the finish already in force does not re-apply it', () => {
    byId('surface-material-sel').options = OPTS;
    byId('surface-material-sel').value = 'mirror';
    ui.render.vizMode = 'surface';
    ui.render.currentMaterial = 'mirror';

    const before = ui.called('setSurfaceMaterial').length;
    ui.syncVizModeUI('surface', 'mirror', 'squares');

    assert.equal(ui.called('setSurfaceMaterial').length, before,
      'every clip step calls this; re-applying restarts the fade at its default ' +
      '700 ms and cuts a cadence-scaled AUTO MATERIAL crossfade short every time');
  });

  test('control — a refresh that names a different finish still applies it', () => {
    byId('surface-material-sel').options = OPTS;
    byId('surface-material-sel').value = 'mirror';
    ui.render.vizMode = 'surface';
    ui.render.currentMaterial = 'mirror';

    ui.syncVizModeUI('surface', 'glass', 'squares');

    assert.deepEqual(ui.called('setSurfaceMaterial').at(-1).slice(0, 2), ['setSurfaceMaterial', 'glass']);
  });
});

describe('the panel can be asked which finish a preset should record', () => {

  test('in WIRE it names the finish a return to SURF would restore', () => {
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    byId('surface-material-sel').value = 'mirror';
    ui.render.vizMode = 'surface';
    ui.render.currentMaterial = 'mirror';

    ui.syncVizModeUI('wireframe', null, 'squares');     // WIRE forces Matte
    ui.render.vizMode = 'wireframe';
    ui.render.currentMaterial = 'matte';

    assert.equal(ui.getPresetMaterial(), 'mirror',
      'the pick survives the mode switch as a closure variable and nothing could read it, ' +
      'so a preset saved in WIRE recorded Matte and handed it back on the way out');
  });

  test('in SURF it names the live finish', () => {
    ui.render.vizMode = 'surface';
    ui.render.currentMaterial = 'glass';
    assert.equal(ui.getPresetMaterial(), 'glass');
  });

  // The stash on the way out to WIRE/PTS refuses Matte on purpose — WIRE → PTS
  // would otherwise overwrite the pick with the Matte those modes force. It
  // cannot tell that Matte from one the operator chose, so a deliberate Matte
  // was never remembered, and this getter handed the finish from BEFORE it to
  // every preset saved outside SURF. Fixed by stashing where the pick is made.
  test('a Matte chosen in SURF is what a preset saved in PTS records', () => {
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'mirror';        // an earlier pick…
    fire('surface-material-sel', 'change');
    ui.syncVizModeUI('points', null, 'squares');          // …round-tripped through PTS
    ui.render.vizMode = 'points';
    ui.syncVizModeUI('surface', null, 'squares');
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'matte';         // now the plain look, deliberately
    fire('surface-material-sel', 'change');
    ui.syncVizModeUI('points', null, 'squares');          // and a preset is saved out here
    ui.render.vizMode = 'points';
    ui.render.currentMaterial = 'matte';                  // forced by PTS

    assert.equal(ui.getPresetMaterial(), 'matte',
      'the snapshot recorded the finish from before the operator chose Matte, and ' +
      'applying it later put that finish back over a surface set to Matte on purpose');
  });

  test('control — a non-Matte pick is still what the same round trip records', () => {
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'mirror';
    fire('surface-material-sel', 'change');
    ui.syncVizModeUI('points', null, 'squares');
    ui.render.vizMode = 'points';
    ui.syncVizModeUI('surface', null, 'squares');
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'glass';
    fire('surface-material-sel', 'change');
    ui.syncVizModeUI('points', null, 'squares');
    ui.render.vizMode = 'points';
    ui.render.currentMaterial = 'matte';

    assert.equal(ui.getPresetMaterial(), 'glass');
  });

  test('control — a snapshot\'s own material still wins over the remembered pick', () => {
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    ui.render.vizMode = 'surface';
    byId('surface-material-sel').value = 'matte';
    fire('surface-material-sel', 'change');

    ui.syncVizModeUI('wireframe', 'mirror', 'squares');   // a preset applied in WIRE
    ui.render.vizMode = 'wireframe';

    assert.equal(ui.getPresetMaterial(), 'mirror',
      'presetMaterial becomes the remembered pick — the pick-time stash must not shadow it');
  });

  // The dropdown is one of THREE places a finish is picked, and the argument
  // above is about the pick, not about the widget: the T hotkey and AUTO
  // MATERIAL put a finish on screen without the dropdown's change event ever
  // firing. For every finish but Matte the stash on the way out to WIRE/PTS
  // covers for them by accident, which is why both cases below have to land on
  // Matte — that is the one the exit stash refuses, and the one that was lost.
  test('a Matte reached with the T hotkey is what a preset saved in PTS records', () => {
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'mirror';        // an earlier pick…
    fire('surface-material-sel', 'change');

    ui.cycleMaterial();                                   // …and T steps it round to Matte
    assert.equal(byId('surface-material-sel').value, 'matte', 'precondition: the list wraps');

    ui.syncVizModeUI('points', null, 'squares');          // a preset is saved out in PTS
    ui.render.vizMode = 'points';
    ui.render.currentMaterial = 'matte';                  // forced by PTS

    assert.equal(ui.getPresetMaterial(), 'matte',
      'T is a pick like any other — recording the finish from before it puts Mirror ' +
      'back over a surface the operator had cycled to the plain look');
  });

  test('a Matte that AUTO MATERIAL drew is recorded the same way', () => {
    // AutoCycler calls the `apply` callback this file hands it with the drawn
    // value and the cadence-scaled fade; it is invoked here directly because
    // the draw itself is a shuffle-bag lottery on a live timer, and what is
    // under test is what the callback does with the value, not which one it got.
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'mirror';
    fire('surface-material-sel', 'change');

    ui.autoMaterial._apply('matte', 900);                 // AUTO's draw lands on Matte
    assert.equal(byId('surface-material-sel').value, 'matte', 'precondition: AUTO drew it');

    ui.syncVizModeUI('points', null, 'squares');
    ui.render.vizMode = 'points';
    ui.render.currentMaterial = 'matte';

    assert.equal(ui.getPresetMaterial(), 'matte',
      'what AUTO put on screen is what a return from WIRE/PTS restores, so it is also ' +
      'what a preset saved out there has to record');
  });

  test('control — a non-Matte finish from either path is still the one recorded', () => {
    byId('surface-material-sel').options = OPTS_FOR_MAT;
    ui.render.vizMode = 'surface';

    byId('surface-material-sel').value = 'matte';
    fire('surface-material-sel', 'change');
    ui.cycleMaterial();                                   // matte → glass
    assert.equal(byId('surface-material-sel').value, 'glass', 'precondition');

    ui.syncVizModeUI('points', null, 'squares');
    ui.render.vizMode = 'points';
    ui.render.currentMaterial = 'matte';
    assert.equal(ui.getPresetMaterial(), 'glass');

    ui.syncVizModeUI('surface', null, 'squares');         // back to SURF, and AUTO fires
    ui.render.vizMode = 'surface';
    ui.autoMaterial._apply('mirror', 900);

    assert.deepEqual(ui.called('setSurfaceMaterial').at(-1).slice(0, 2),
      ['setSurfaceMaterial', 'mirror'],
      'remembering the value must not cost the apply that puts it on screen');
    assert.equal(ui.called('setSurfaceMaterial').at(-1)[2]?.duration, 900,
      'nor the cadence-scaled fade AUTO asked for');

    ui.syncVizModeUI('points', null, 'squares');
    ui.render.vizMode = 'points';
    assert.equal(ui.getPresetMaterial(), 'mirror');
  });
});
const OPTS_FOR_MAT = ['matte', 'glass', 'mirror'].map(value => ({ value }));

describe('SAVE PRESET says so when the write is refused', () => {

  test('the name is kept and the operator is told', () => {
    ui.savePreset = () => false;                 // storage full, or blocked for the origin
    byId('preset-name').value = 'MySet';

    fire('btn-preset-save', 'click');

    assert.equal(byId('preset-name').value, 'MySet',
      'clearing the field throws away what the operator typed for a save that did not happen');
    assert.equal(ui.called('toast').length, 1, 'and nothing on screen said the save failed');
  });

  test('control — a successful save still clears the field', () => {
    ui.savePreset = () => true;
    byId('preset-name').value = 'MySet';

    fire('btn-preset-save', 'click');

    assert.equal(byId('preset-name').value, '');
  });

  test('control — an empty name is still refused before anything is written', () => {
    let called = 0;
    ui.savePreset = () => { called++; return true; };
    byId('preset-name').value = '   ';

    fire('btn-preset-save', 'click');

    assert.equal(called, 0);
  });
});

// Two owners of one piece of state: this module kept a boolean and the inline
// script in index.html toggled the class directly, on the same element and the
// same header. A mobile swipe writes the class without the boolean knowing, so
// the next header tap toggled the boolean to a value the class already had —
// and the panel either stayed collapsed or collapsed again. The class is the
// only state that can be observed by CSS, so the class is the state.
describe('the panel has one owner of "collapsed"', () => {

  test('a header click after a swipe still expands it', () => {
    const panel = document.querySelector('.controls-panel');
    panel.classList.add('collapsed');            // what the swipe leaves behind

    fire('ctrl-header', 'click');

    assert.equal(panel.classList.contains('collapsed'), false,
      'the module boolean started at false, so the click set it to true — matching ' +
      'the class the swipe had already written, and nothing moved');
  });

  test('control — clicking twice from expanded still collapses and expands', () => {
    const panel = document.querySelector('.controls-panel');
    assert.equal(panel.classList.contains('collapsed'), false, 'precondition');

    fire('ctrl-header', 'click');
    assert.equal(panel.classList.contains('collapsed'), true);
    fire('ctrl-header', 'click');
    assert.equal(panel.classList.contains('collapsed'), false);
  });

  test('control — the floating expand button follows the state', () => {
    fire('ctrl-header', 'click');
    assert.equal(byId('ctrl-collapse').style.display, 'none', 'hidden while collapsed');
    fire('ctrl-header', 'click');
    assert.equal(byId('ctrl-collapse').style.display, '');
  });
});

// The About dialog is aria-modal and modal for the POINTER — its backdrop takes
// pointer-events when open — but nothing consulted it for keys. So a key
// pressed while reading the docs armed a hold-and-drag on a parameter behind
// the overlay, and a brand-new profile is in exactly that state: the modal
// opens itself on first run.
describe('hold-and-drag does not reach through the About dialog', () => {

  test('a drag key pressed over the dialog arms nothing', () => {
    ui.audio.bassSens = 1.2;
    byId('about-overlay').classList.add('open');

    fireDoc('keydown', { key: 'l' });
    fireDoc('mousemove', { movementX: 200 });

    assert.equal(ui.audio.bassSens, 1.2,
      '200 px of drag would have written about 2.17 into a parameter nobody was aiming at');
  });

  test('control — with the dialog closed the same keys still drag', () => {
    ui.audio.bassSens = 1.2;
    byId('about-overlay').classList.remove('open');

    fireDoc('keydown', { key: 'l' });
    fireDoc('mousemove', { movementX: 200 });

    assert.notEqual(ui.audio.bassSens, 1.2, 'this is the feature, and it has to survive the guard');
  });
});

// ── FIX(knob keys): every knob in the formula slot gets a hold-and-drag key ──
//
// The owner asked (08.10.2026): B Formula Detail, N Formula Phase, and Y U H J
// Shader Knobs 1-4. B, N and J leave Bloom, Wave Intensity and Amplitude to do
// it, which keep A, C and V; Y's glitch and H's hint move to P and I in
// main.js (tests/hotkey-map.test.js holds that half). Three decisions ride on
// the binding, and these groups drive each through the real listeners
// bindControls puts on the stub document:
//
//   • A key reaches only the bank the slot is showing — the pair on a CPU
//     formula, the knobs on a numbered shader or under the operator's own
//     shader — asked of the slot's logical state, at the key AND at every
//     delta, because the bank can leave while the key is held. A key that does
//     not reach does not arm: no preventDefault on the keydown, none on the
//     wheel, and whatever was armed stays armed.
//   • The six drag over exactly [min..max]: no DRAG_FLOOR, a stop at max, and
//     a value already above max left where it is by a drag up.
//   • A modified key belongs to the browser — main.js's FIX(r6) rule, which
//     the arming listener never had (Ctrl+L and Ctrl+K were being swallowed).
//
// The eight letters left on the audio and bloom must drag bit for bit as they
// did; dragBefore is the old _applyDragDelta, verbatim, as the oracle.

/** The pre-change _applyDragDelta for one delta, verbatim: the old rule. */
function dragBefore(p, cur, pixels) {
  const hi        = p.extendedMax ?? p.max;
  const lo        = Math.max(p.min, DRAG_FLOOR);
  const spdBase   = (hi - lo) / 600;
  const absVal    = Math.abs(cur);
  const overshoot = absVal > hi ? absVal / hi : 1;
  const mult      = overshoot > 1 ? Math.log2(overshoot + 1) : 1;
  const spd       = spdBase * mult;
  return Math.max(lo, cur + pixels * spd);
}

describe('hold-and-drag reaches the bank of the formula slot that is on the panel', () => {
  const FORMULA = 'm:fractals:henon', SHADER = '7';
  const PAIR  = [['b', 'detail'], ['n', 'phase']];
  const KNOBS = [['y', 'k0'], ['u', 'k1'], ['h', 'k2'], ['j', 'k3']];

  const ctxOf = () => ({ audio: ui.audio, render: ui.render, camera: ui.camera });
  const val   = id => PARAMS[id].get(ctxOf());
  const put   = (id, v) => PARAMS[id].set(ctxOf(), v);
  /** A keydown the way the browser sends it; true if the app called preventDefault. */
  const keyDown = (key, mods = {}) => {
    let prevented = false;
    fireDoc('keydown', { key, ...mods, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  const keyUp = key => fireDoc('keyup', { key });
  const move  = px => fireDoc('mousemove', { movementX: px });
  /** A wheel event; true if the app took it from the page. (On window since FIX(review K6).) */
  const wheel = (deltaX, deltaY = 0, deltaMode = 0) => {
    let prevented = false;
    fireWin('wheel', { deltaX, deltaY, deltaMode, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  /** Hold a key, drag, let go; true if the key armed. */
  const hold = (key, px) => { const armed = keyDown(key); move(px); keyUp(key); return armed; };
  const near = (got, want, msg = '') => assert.ok(Math.abs(got - want) < 1e-9, `${msg} — got ${got}, want ${want}`);

  beforeEach(() => {
    // The stub engine carries the uniforms; these are the rest of the values a
    // drag reads, at their shipped defaults (the knobs rest at 0 in the stub).
    ui.render.formulaDetail = 0.5;
    ui.render.formulaPhase  = 0;
    Object.assign(ui.audio, { amp: 0.7, waveInt: 1.0, bassSens: 1.2, trebleSens: 1.0, bandDepth: 0.3 });
  });

  test('on a formula, B drags Formula Detail and N drags Formula Phase', () => {
    ui.applyFormulaValue(FORMULA);
    assert.equal(hold('b', -150), true, 'B did not arm over a formula, where its slider is on the panel');
    near(val('detail'), 0.25, 'B, 150 px left from the 0.5 rest');
    assert.equal(byId('fdv').textContent, '0.25', 'the Detail badge does not follow the drag');
    assert.equal(hold('n', 150), true, 'N did not arm over a formula');
    near(val('phase'), 0.25, 'N, 150 px right from rest');
  });

  test('on a formula, Y U H J arm nothing and move nothing — the knob sliders are hidden', () => {
    ui.applyFormulaValue(FORMULA);
    for (const [key, id] of KNOBS) {
      assert.equal(keyDown(key), false, `${key.toUpperCase()} called preventDefault for a knob that is not on the panel`);
      move(300);
      assert.equal(wheel(300), false, `${key.toUpperCase()} took the wheel from the page`);
      keyUp(key);
      assert.equal(val(id), 0, `${key.toUpperCase()} moved ${id}, whose slider is hidden`);
    }
  });

  test('a key that does not arm leaves the key already held in charge', () => {
    ui.applyFormulaValue(FORMULA);
    assert.equal(keyDown('l'), true, 'precondition: L arms');
    keyDown('y');                         // a knob key over a formula: not on the panel
    move(200);
    assert.equal(ui.audio.bassSens, dragBefore(PARAMS.bassSens, 1.2, 200),
      'the knob key that did not arm took the drag away from Bass');
    keyUp('l');
  });

  test('control — on a numbered shader Y U H J drag Shader Knobs 1-4, each its own', () => {
    ui.applyFormulaValue(SHADER);
    for (const [key, id] of KNOBS) {
      for (const [, k] of KNOBS) put(k, 0);
      assert.equal(hold(key, 300), true, `${key.toUpperCase()} did not arm on a numbered shader`);
      for (const [, k] of KNOBS) {
        if (k === id) near(val(k), 0.5, `${key.toUpperCase()} did not land on ${id}`);
        else assert.equal(val(k), 0, `${key.toUpperCase()} moved ${k} as well as ${id}`);
      }
    }
    assert.equal(byId('k3v').textContent, '0.50', 'the Knob 4 badge does not follow the drag');
  });

  test('on a numbered shader, B and N arm nothing and move nothing — nothing reads the pair there', () => {
    ui.applyFormulaValue(SHADER);
    for (const [key, id] of PAIR) {
      const before = val(id);
      assert.equal(keyDown(key), false, `${key.toUpperCase()} called preventDefault with its slider hidden`);
      move(-300);
      assert.equal(wheel(-300), false, `${key.toUpperCase()} took the wheel from the page`);
      keyUp(key);
      assert.equal(val(id), before, `${key.toUpperCase()} moved ${id} under a numbered shader`);
    }
  });

  test('over a formula with your own shader applied, all six act', () => {
    // Both banks are on the panel there: a custom fragment body colours a
    // formula, so the knobs are live beside the pair.
    ui.shaderEditor.customFS = 'FS';
    ui.applyFormulaValue(FORMULA);
    for (const [key, id] of [...PAIR, ...KNOBS]) {
      put(id, 0);
      assert.equal(hold(key, 300), true, `${key.toUpperCase()} did not arm with both banks up`);
      near(val(id), 0.5, `${key.toUpperCase()} → ${id}`);
    }
  });

  test('a collapsed panel or full screen does not stand the keys down — the slot is asked, not the layout', () => {
    // Both hide every slider (.collapsed, fs-hidden). A gate that read the
    // wrappers' visibility back would stop the keys exactly where hotkeys.md
    // promises they work.
    ui.applyFormulaValue(SHADER);
    const panel = document.querySelector('.controls-panel');
    panel.classList.add('collapsed');
    panel.classList.add('fs-hidden');
    for (const id of ['formula-knobs-wrap', 'shader-knobs-wrap', 'formula-detail', 'shader-k0']) {
      byId(id).offsetParent = null;
    }
    assert.equal(hold('y', 300), true, 'Y stood down because the panel is out of sight');
    near(val('k0'), 0.5);
    assert.equal(keyDown('b'), false, 'and the bank rule still holds there: the pair is not the slot\'s bank');
  });
});

describe('the formula slot\'s six drag over exactly their range', () => {
  const ctxOf = () => ({ audio: ui.audio, render: ui.render, camera: ui.camera });
  const val   = id => PARAMS[id].get(ctxOf());
  const put   = (id, v) => PARAMS[id].set(ctxOf(), v);
  const hold  = (key, px) => {
    fireDoc('keydown', { key });
    fireDoc('mousemove', { movementX: px });
    fireDoc('keyup', { key });
  };
  const near = (got, want, msg = '') => assert.ok(Math.abs(got - want) < 1e-9, `${msg} — got ${got}, want ${want}`);

  beforeEach(() => {
    ui.render.formulaDetail = 0.5;
    ui.render.formulaPhase  = 0;
  });

  test('a knob at rest dragged down stays at 0 — the six take no DRAG_FLOOR', () => {
    ui.applyFormulaValue('7');
    hold('y', -200);
    assert.equal(val('k0'), 0, 'the knob stopped at the audio keys\' floor and can never come back to rest');
    ui.applyFormulaValue('m:fractals:henon');
    put('detail', 0.05);
    hold('b', -200);
    assert.equal(val('detail'), 0, 'Detail 0 is the coarse end an operator buys update rate back with');
  });

  test('control — Bloom on A still stops at DRAG_FLOOR', () => {
    ui.render.bloomPass.strength = 0.15;
    hold('a', -600);
    assert.equal(ui.render.bloomPass.strength, DRAG_FLOOR,
      'the floor is for the audio and bloom keys, and it has to survive the change');
  });

  test('a knob at 1 dragged up stays at 1', () => {
    ui.applyFormulaValue('7');
    put('k1', 1);
    hold('u', 200);
    assert.equal(val('k1'), 1, 'the drag wound the knob past the end of its range');
    ui.applyFormulaValue('m:fractals:henon');
    put('phase', 0.9);
    hold('n', 300);
    assert.equal(val('phase'), 1, 'Phase ran past one full turn');
  });

  test('a value typed above 1 is not snapped down: a drag up leaves it, a drag down lowers it from there', () => {
    ui.applyFormulaValue('7');
    put('k2', 3);                         // typed into the badge, or from a preset
    hold('h', 200);
    assert.equal(val('k2'), 3, 'a drag UP pulled a typed 3 down to the top of the range');
    hold('h', -200);
    assert.ok(val('k2') < 3, `a drag down from 3 did not lower it: ${val('k2')}`);
    assert.ok(val('k2') > 1, `a drag down from 3 jumped to the range: ${val('k2')}`);
  });

  test('300 px from rest is the middle — 600 px is the whole 0 – 1', () => {
    ui.applyFormulaValue('7');
    hold('j', 300);
    near(val('k3'), 0.5, 'the first 300 px');
    hold('j', 300);
    near(val('k3'), 1, 'the second 300 px');
  });
});

describe('the letters the formula slot took no longer drag what they used to', () => {
  // Each old letter is pressed where it DOES arm now, for its new param, so a
  // stale entry cannot hide behind the bank gate.
  const hold = (key, px) => {
    fireDoc('keydown', { key });
    fireDoc('mousemove', { movementX: px });
    fireDoc('keyup', { key });
  };
  beforeEach(() => {
    ui.render.formulaDetail = 0.5;
    ui.render.formulaPhase  = 0;
    Object.assign(ui.audio, { amp: 0.7, waveInt: 1.0 });
  });

  test('J drags Shader Knob 4, not Amplitude; V drags Amplitude', () => {
    ui.applyFormulaValue('7');
    hold('j', 200);
    assert.equal(ui.audio.amp, 0.7, 'J still reaches Amplitude');
    assert.ok(ui.render.U.uK3.value > 0, 'precondition: J armed, for Knob 4');
    hold('v', 200);
    assert.equal(ui.audio.amp, dragBefore(PARAMS.amp, 0.7, 200), 'V lost Amplitude');
  });

  test('N drags Formula Phase, not Wave Intensity; C drags Wave Intensity', () => {
    ui.applyFormulaValue('m:fractals:henon');
    hold('n', 200);
    assert.equal(ui.audio.waveInt, 1.0, 'N still reaches Wave Intensity');
    assert.ok(ui.render.formulaPhase > 0, 'precondition: N armed, for Phase');
    hold('c', 200);
    assert.equal(ui.audio.waveInt, dragBefore(PARAMS.waveInt, 1.0, 200), 'C lost Wave Intensity');
  });

  test('B drags Formula Detail, not Bloom; A drags Bloom', () => {
    ui.applyFormulaValue('m:fractals:henon');
    hold('b', 200);
    assert.equal(ui.render.bloomPass.strength, 0.6, 'B still reaches Bloom');
    assert.ok(ui.render.formulaDetail > 0.5, 'precondition: B armed, for Detail');
    hold('a', 200);
    assert.equal(ui.render.bloomPass.strength, dragBefore(PARAMS.bloom, 0.6, 200), 'A lost Bloom');
  });
});

describe('the bank is asked at every delta, not only when the key went down', () => {
  const val  = id => PARAMS[id].get({ audio: ui.audio, render: ui.render, camera: ui.camera });
  const near = (got, want, msg = '') => assert.ok(Math.abs(got - want) < 1e-9, `${msg} — got ${got}, want ${want}`);
  const wheel = deltaX => {
    let prevented = false;
    fireWin('wheel', { deltaX, deltaY: 0, deltaMode: 0, preventDefault: () => { prevented = true; } });
    return prevented;
  };

  test('the knobs leaving while Y is held stop the drag at the next delta', () => {
    ui.applyFormulaValue('7');
    fireDoc('keydown', { key: 'y' });
    fireDoc('mousemove', { movementX: 60 });
    near(val('k0'), 0.1, 'precondition: Y drags Knob 1 on a numbered shader');

    ui.syncFormulaKnobsUI('m:fractals:henon');  // a clip step or a preset lands on a formula
    fireDoc('mousemove', { movementX: 300 });
    near(val('k0'), 0.1, 'the knob kept moving after its slider left the panel');
    assert.equal(wheel(300), false, 'the wheel is still taken from the page for a bank that has gone');
    near(val('k0'), 0.1);
    fireDoc('keyup', { key: 'y' });
  });

  test('the editor taking your shader away over a formula does the same to U', () => {
    const se = ui.shaderEditor;
    se.customFS = 'FS';
    ui.applyFormulaValue('m:fractals:henon');
    fireDoc('keydown', { key: 'u' });
    fireDoc('mousemove', { movementX: 60 });
    near(val('k1'), 0.1, 'precondition: U drags Knob 2 beside the pair');

    se.customFS = null;
    se.cb.onProgramChange();                     // the editor's RESET
    fireDoc('mousemove', { movementX: 300 });
    near(val('k1'), 0.1, 'Knob 2 kept moving after the shader that shows it was reset');
    fireDoc('keyup', { key: 'u' });
  });

  test('control — a bank that comes back while the key is still held is driven again', () => {
    // The gate drops deltas; it does not disarm. Without this the two tests
    // above would pass on a key that stopped working for good.
    ui.applyFormulaValue('7');
    fireDoc('keydown', { key: 'y' });
    ui.syncFormulaKnobsUI('m:fractals:henon');
    fireDoc('mousemove', { movementX: 300 });
    assert.equal(val('k0'), 0, 'precondition: nothing moves while the knobs are away');
    ui.syncFormulaKnobsUI('7');
    fireDoc('mousemove', { movementX: 300 });
    near(val('k0'), 0.5, 'the knobs came back under a held Y and it did nothing');
    fireDoc('keyup', { key: 'y' });
  });

  test('the wheel drives a knob the way the mouse does', () => {
    ui.applyFormulaValue('7');
    fireDoc('keydown', { key: 'u' });
    assert.equal(wheel(300), true, 'the wheel scrolled the page instead of turning Knob 2');
    near(val('k1'), 0.5, '300 px of horizontal wheel');
    let prevented = false;
    fireWin('wheel', { deltaX: 0, deltaY: -150, deltaMode: 0, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    near(val('k1'), 0.75, 'a plain vertical wheel: up is more');
    fireDoc('keyup', { key: 'u' });
    assert.equal(wheel(300), false, 'control — let go, and the wheel is the page\'s again');
  });
});

describe('a hold-and-drag key pressed with a modifier belongs to the browser', () => {
  // main.js has stood its tap keys down for Ctrl / Cmd / Alt since FIX(r6);
  // the arming listener never did, so Ctrl+L and Ctrl+K armed a drag and the
  // preventDefault swallowed the browser's shortcut. With Y, U and H in the
  // map, the same hole would have taken Ctrl+Y, Ctrl+U and Ctrl+H.
  const keyDown = (key, mods = {}) => {
    let prevented = false;
    fireDoc('keydown', { key, ...mods, preventDefault: () => { prevented = true; } });
    return prevented;
  };

  test('Ctrl, Cmd or Alt with a drag key arms nothing and prevents nothing', () => {
    ui.applyFormulaValue('7');                   // so Y, U and H would arm unmodified
    ui.audio.bassSens = 1.2; ui.audio.trebleSens = 1.0;
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      for (const key of ['l', 'k', 'y', 'u', 'h']) {
        assert.equal(keyDown(key, { [mod]: true }), false,
          `${mod} + ${key.toUpperCase()} was swallowed — that shortcut is the browser's`);
        fireDoc('mousemove', { movementX: 200 });
        fireDoc('keyup', { key });
      }
    }
    assert.equal(ui.audio.bassSens, 1.2, 'Ctrl+L dragged Bass Sensitivity');
    assert.equal(ui.audio.trebleSens, 1.0, 'Ctrl+K dragged Treble Sensitivity');
    for (const k of ['uK0', 'uK1', 'uK2']) assert.equal(ui.render.U[k].value, 0, `a modified key moved ${k}`);
  });

  test('control — the same keys unmodified still arm and drag, and Shift is not one of the three', () => {
    ui.applyFormulaValue('7');
    ui.audio.bassSens = 1.2;
    assert.equal(keyDown('l'), true, 'plain L no longer arms');
    fireDoc('mousemove', { movementX: 200 });
    fireDoc('keyup', { key: 'l' });
    assert.equal(ui.audio.bassSens, dragBefore(PARAMS.bassSens, 1.2, 200));
    // Shift+Y reports 'Y'; the map is read case-folded, as before this change.
    assert.equal(keyDown('Y', { shiftKey: true }), true, 'Shift+Y stopped arming Knob 1');
    fireDoc('keyup', { key: 'Y' });
  });
});

// ── FIX(review): the second review of the knob keys ──────────────────────────
//
// Four defects the keys inherited, each older than the knob keys and each made
// easy to hit by them:
//   • K1 — any focused <input> stood every key down. The SHADER MODE picker
//     keeps focus after a mouse pick (a readOnly field, by design) and a slider
//     keeps it after a mouse drag, so "pick a numbered shader, hold Y" did
//     nothing until the canvas was clicked. elementOwnsKey's matrix lives in
//     tests/hotkey-focus-standdown.test.js; here the real listener is driven.
//   • K4 / K5 — one armed key, matched by character on keyup. Rolling Y → U and
//     letting go of U left Y held and dead, and a key released under AltGr
//     (L reports 'ł') or under Cmd on a Mac (no keyup at all) stayed armed.
//   • K6 — the wheel listener sat on document in the bubble phase, after
//     OrbitControls' listener on the canvas, so one notch turned the knob AND
//     dollied the camera.
//   • L2 — the hint's boot flash took away a hint the operator had shown.
// The groups below drive each through the listeners bindControls installs.

/** A keydown as the browser sends it; true if the app called preventDefault. */
const keyDownAs = (key, code, mods = {}) => {
  let prevented = false;
  fireDoc('keydown', { key, code, ...mods, preventDefault: () => { prevented = true; } });
  return prevented;
};
const keyUpAs = (key, code) => fireDoc('keyup', { key, code });
const moveBy  = px => fireDoc('mousemove', { movementX: px });
/** A wheel event through the window listeners: what the app did with it. */
const wheelAs = (deltaX, deltaY = 0) => {
  const ev = { prevented: false, stopped: false };
  fireWin('wheel', { deltaX, deltaY, deltaMode: 0,
                     preventDefault: () => { ev.prevented = true; },
                     stopPropagation: () => { ev.stopped = true; } });
  return ev;
};
const valOf  = id => PARAMS[id].get({ audio: ui.audio, render: ui.render, camera: ui.camera });
const nearly = (got, want, msg = '') => assert.ok(Math.abs(got - want) < 1e-9, `${msg} — got ${got}, want ${want}`);
/** Run `fn` with this element focused, the way document.activeElement reports it. */
const withFocus = (el, fn) => {
  const was = document.activeElement;
  document.activeElement = el;
  try { return fn(); } finally { document.activeElement = was; }
};

describe('a pick in a panel picker, or a drag on a slider, leaves the drag keys live', () => {
  // What index.html's makeDropdown builds for SHADER MODE, and what it leaves
  // focused after a mouse pick; and a range slider after a mouse drag.
  const PICKER = { tagName: 'INPUT', type: 'text', readOnly: true, className: 'srch-input' };
  const SLIDER = { tagName: 'INPUT', type: 'range', id: 'shader-k0' };

  test('with the SHADER MODE picker still focused after a pick, Y arms and drags Knob 1', () => {
    ui.applyFormulaValue('7');
    withFocus(PICKER, () => {
      assert.equal(keyDownAs('y', 'KeyY'), true, 'Y stood down for a picker that takes no text');
      moveBy(300);
      keyUpAs('y', 'KeyY');
    });
    nearly(valOf('k0'), 0.5, 'Knob 1 after a pick and 300 px');
  });

  test('with a slider still focused after a drag on it, H arms and drags Knob 3', () => {
    ui.applyFormulaValue('7');
    withFocus(SLIDER, () => {
      assert.equal(keyDownAs('h', 'KeyH'), true, 'H stood down for a focused slider');
      moveBy(300);
      keyUpAs('h', 'KeyH');
    });
    nearly(valOf('k2'), 0.5);
  });

  test('control — a writable text field still stands the keys down', () => {
    // The preset name, a value badge being typed into: typing Y there is a
    // letter in a name, not Knob 1.
    ui.applyFormulaValue('7');
    withFocus({ tagName: 'INPUT', type: 'text', readOnly: false }, () => {
      assert.equal(keyDownAs('y', 'KeyY'), false, 'typing Y into a name armed Knob 1');
      moveBy(300);
      keyUpAs('y', 'KeyY');
    });
    assert.equal(valOf('k0'), 0, 'a key typed into a text field moved Knob 1');
  });
});

describe('the held drag keys are a set, tracked by the physical key', () => {

  test('Y down, U down, U up: the mouse drives Knob 1 again', () => {
    // The roll across the cluster. One slot was cleared by U's keyup while Y
    // was still down, and Windows resumes no auto-repeat for Y to re-arm it.
    ui.applyFormulaValue('7');
    keyDownAs('y', 'KeyY');
    keyDownAs('u', 'KeyU');
    keyUpAs('u', 'KeyU');
    moveBy(300);
    nearly(valOf('k0'), 0.5, 'Y is still held and drives nothing');
    assert.equal(valOf('k1'), 0, 'U was let go and still drove Knob 2');
    keyUpAs('y', 'KeyY');
  });

  test('U down, Y down, Y up: Knob 2', () => {
    ui.applyFormulaValue('7');
    keyDownAs('u', 'KeyU');
    keyDownAs('y', 'KeyY');
    keyUpAs('y', 'KeyY');
    moveBy(300);
    nearly(valOf('k1'), 0.5);
    assert.equal(valOf('k0'), 0);
    keyUpAs('u', 'KeyU');
  });

  test('control — while both are down the one pressed last drives, and a release ends the hold', () => {
    ui.applyFormulaValue('7');
    keyDownAs('y', 'KeyY');
    keyDownAs('u', 'KeyU');
    moveBy(300);
    nearly(valOf('k1'), 0.5, 'the newest key does not have the drag');
    assert.equal(valOf('k0'), 0, 'two knobs moved on one mouse');
    keyUpAs('u', 'KeyU');
    keyUpAs('y', 'KeyY');
    moveBy(300);
    nearly(valOf('k0'), 0, 'a key let go still drives');
    nearly(valOf('k1'), 0.5);
  });

  test('a keyup that spells the key differently still lets it go — AltGr+L reports ł', () => {
    // Polish (programmer) layout: hold L, press AltGr, release L. The keyup's
    // `key` is the character under the modifiers, 'ł'; its `code` is KeyL.
    ui.applyFormulaValue('m:fractals:henon');
    ui.audio.bassSens = 1.2;
    assert.equal(keyDownAs('l', 'KeyL'), true, 'precondition: L arms');
    keyUpAs('ł', 'KeyL');
    moveBy(200);
    assert.equal(ui.audio.bassSens, 1.2, 'L was let go and Bass still follows the mouse');
    assert.equal(wheelAs(300).prevented, false, 'and the wheel is still taken from the page');
  });

  test('control — the keyup of a different key leaves the held one held', () => {
    ui.applyFormulaValue('m:fractals:henon');
    ui.audio.bassSens = 1.2;
    keyDownAs('l', 'KeyL');
    keyUpAs('k', 'KeyK');
    moveBy(200);
    assert.equal(ui.audio.bassSens, dragBefore(PARAMS.bassSens, 1.2, 200), 'K\'s keyup let go of L');
    keyUpAs('l', 'KeyL');
  });

  test('a Cmd keyup ends every hold — macOS sends no keyup for a letter released under Cmd', () => {
    ui.applyFormulaValue('7');
    ui.audio.bassSens = 1.2;
    keyDownAs('y', 'KeyY');
    keyDownAs('l', 'KeyL');
    keyUpAs('Meta', 'MetaLeft');
    moveBy(300);
    assert.equal(valOf('k0'), 0, 'Knob 1 still follows the mouse after Cmd was let go');
    assert.equal(ui.audio.bassSens, 1.2, 'Bass still follows the mouse after Cmd was let go');
  });

  test('control — a Shift keyup ends nothing', () => {
    ui.applyFormulaValue('7');
    keyDownAs('y', 'KeyY');
    keyUpAs('Shift', 'ShiftLeft');
    moveBy(300);
    nearly(valOf('k0'), 0.5, 'a Shift keyup let go of Y');
    keyUpAs('y', 'KeyY');
  });

  test('the window losing focus, or the document hiding, ends every hold', () => {
    // FIX(r11)'s rule, which nothing here could reach while the stub window
    // dropped its listeners.
    ui.applyFormulaValue('7');
    keyDownAs('y', 'KeyY');
    keyDownAs('u', 'KeyU');
    fireWin('blur');
    moveBy(300);
    assert.equal(valOf('k0') + valOf('k1'), 0, 'a blurred window still drags');
    keyDownAs('h', 'KeyH');
    document.hidden = true;
    try { fireDoc('visibilitychange'); } finally { delete document.hidden; }
    moveBy(300);
    assert.equal(valOf('k2'), 0, 'a hidden document still drags');
  });

  test('control — without either, the same held key drags', () => {
    ui.applyFormulaValue('7');
    keyDownAs('h', 'KeyH');
    fireDoc('visibilitychange');                 // visible again, say
    moveBy(300);
    nearly(valOf('k2'), 0.5);
    keyUpAs('h', 'KeyH');
  });

  test('a key event with no `key` at all throws nothing — Chrome\'s autofill sends them', () => {
    assert.doesNotThrow(() => fireDoc('keydown', {}), 'keydown without key');
    assert.doesNotThrow(() => fireDoc('keyup', {}), 'keyup without key');
    assert.doesNotThrow(() => fireDoc('keyup', { code: 'KeyL' }), 'keyup with a code and no key');
  });

  test('control — the events above are the ones the listeners read: a plain Y still arms', () => {
    ui.applyFormulaValue('7');
    assert.equal(keyDownAs('y', ''), true, 'an empty code falls back to the letter');
    keyUpAs('y', '');
    moveBy(300);
    assert.equal(valOf('k0'), 0, 'a keyup with an empty code did not let go of Y');
  });
});

describe('the wheel turns the knob, not the camera as well', () => {

  test('the drag wheel listener is on window, in the capture phase, and not passive', () => {
    // Capture on window runs before any element sees the event — OrbitControls'
    // wheel listener included, which is on the canvas (render.js).
    const onWin = winLtnr.get('wheel') ?? [];
    assert.equal(onWin.length, 1, 'expected one wheel listener on window');
    assert.equal(onWin[0].opts?.capture, true, 'the wheel listener is not a capture listener');
    assert.equal(onWin[0].opts?.passive, false, 'a passive listener cannot take the wheel from the page');
    assert.equal((docLtnr.get('wheel') ?? []).length, 0, 'a wheel listener is still on document, in the bubble phase');
  });

  test('while a held key reaches its param, the wheel is stopped as well as prevented', () => {
    ui.applyFormulaValue('7');
    keyDownAs('y', 'KeyY');
    const ev = wheelAs(0, -150);
    assert.equal(ev.prevented, true, 'the panel would scroll');
    assert.equal(ev.stopped, true, 'the event goes on to the canvas, and OrbitControls zooms on it');
    nearly(valOf('k0'), 0.25, 'and the knob turns');
    keyUpAs('y', 'KeyY');
  });

  test('control — with no key held, or only one whose bank is hidden, the wheel is left alone entirely', () => {
    ui.applyFormulaValue('7');
    let ev = wheelAs(0, -150);
    assert.deepEqual(ev, { prevented: false, stopped: false }, 'the camera can no longer zoom with no key held');
    ui.applyFormulaValue('m:fractals:henon');
    keyDownAs('y', 'KeyY');                       // a knob key over a formula: not on the panel
    ev = wheelAs(0, -150);
    assert.deepEqual(ev, { prevented: false, stopped: false }, 'a key that drives nothing kept the wheel');
    assert.equal(valOf('k0'), 0);
    keyUpAs('y', 'KeyY');
  });
});

describe('the hint\'s boot flash yields to the operator\'s I', () => {
  // Bind again with the timers in hand: the flash is two setTimeouts, 1 s to
  // show and 3 s more to hide, and these tests run them on demand.
  let timers, realSet, realClear;
  beforeEach(() => {
    for (const el of [...els.values(), ...selEls.values(), document.body, document.documentElement]) {
      el._classes.clear(); el._listeners.clear();
    }
    docLtnr.clear(); winLtnr.clear();
    timers = [];
    realSet = globalThis.setTimeout; realClear = globalThis.clearTimeout;
    globalThis.setTimeout   = (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; };
    globalThis.clearTimeout = t => { if (t && typeof t === 'object' && 'live' in t) t.live = false; else realClear(t); };
    ui = makeUi();
    bindControls(ui);
  });
  afterEach(() => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; });

  /** Run the flash's timers still live — the 1 s show, and the 3 s hide it sets. */
  const runFlash = () => {
    for (let i = 0; i < timers.length; i++) {
      const t = timers[i];
      if (t.live && (t.ms === 1000 || t.ms === 3000)) { t.live = false; t.fn(); }
    }
  };
  const showTimer = () => timers.find(t => t.ms === 1000);
  const hint = () => byId('hotkey-hint');
  const shown = () => hint().classList.contains('visible');
  /** What main.js's case 'i' does (tests/hotkey-map.test.js pins that it does). */
  const pressI = () => { ui.cancelHintFlash(); hint().classList.toggle('visible'); };
  // Earlier tests' bindings left real flash timers running on this same
  // element; each test starts from a hidden hint inside its own synchronous
  // body, where none of those can fire.
  const start = () => hint().classList.remove('visible');

  test('an I pressed before the flash shows the hint, and the flash does not take it away', () => {
    start();
    pressI();
    assert.equal(shown(), true, 'precondition: I showed the hint');
    runFlash();
    assert.equal(shown(), true, 'the boot flash hid a hint the operator had shown');
  });

  test('an I that hides the hint mid-flash, and a second that shows it, both stand', () => {
    start();
    const show = showTimer();
    show.live = false; show.fn();                // the flash comes on
    assert.equal(shown(), true, 'precondition: the flash is showing');
    pressI();
    assert.equal(shown(), false);
    pressI();
    runFlash();
    assert.equal(shown(), true, 'the flash\'s own hide outlived the operator\'s show');
  });

  test('control — left alone, the flash still shows the hint and then hides it', () => {
    start();
    const show = showTimer();
    assert.ok(show, 'no 1 s timer — the flash is gone, so the tests above prove nothing');
    show.live = false; show.fn();
    assert.equal(shown(), true, 'the flash did not show the hint');
    runFlash();
    assert.equal(shown(), false, 'the flash did not hide it again');
  });
});

describe('the audio and bloom keys drag exactly as they did before', () => {
  const ctxOf = () => ({ audio: ui.audio, render: ui.render, camera: ui.camera });

  test('every one of the eight letters, inside the range, at the floor and past extendedMax', () => {
    // [key, id, start, px]: a routine drag, the floor, the log-scaled regime
    // past extendedMax, and no ceiling — for each param, through each letter.
    const CASES = [
      ['l', 'bassSens',   1.2,  200], ['x', 'bassSens',   0.4, -333],
      ['k', 'trebleSens', 0.2, -600], ['z', 'trebleSens', 2.9,   77],
      ['v', 'amp',        3.0,  100], ['v', 'amp',        1.9,  600],
      ['c', 'waveInt',    4.9,  600], ['c', 'waveInt',   12,    -40],
      ['a', 'bloom',      0.15, -600], ['a', 'bloom',     0.6,   13],
      ['s', 'bandDepth',  0.3,  250], ['s', 'bandDepth',  7.5,   90],
    ];
    for (const [key, id, start, px] of CASES) {
      PARAMS[id].set(ctxOf(), start);
      fireDoc('keydown', { key });
      fireDoc('mousemove', { movementX: px });
      fireDoc('keyup', { key });
      assert.equal(PARAMS[id].get(ctxOf()), dragBefore(PARAMS[id], start, px),
        `${key.toUpperCase()} on ${id}, from ${start} by ${px} px, no longer drags as it did`);
    }
  });

  test('control — the oracle is the old rule, and the six no longer follow it', () => {
    // A dragBefore that had drifted into the new rule would make the test above
    // pass on anything; here it has to disagree with the app where the rule
    // really changed.
    ui.applyFormulaValue('7');
    fireDoc('keydown', { key: 'y' });
    fireDoc('mousemove', { movementX: -200 });
    fireDoc('keyup', { key: 'y' });
    assert.equal(ui.render.U.uK0.value, 0);
    assert.equal(dragBefore(PARAMS.k0, 0, -200), DRAG_FLOOR, 'the old rule floors a knob at 0.1');
    assert.ok(dragBefore(PARAMS.k0, 1, 200) > 1, 'the old rule has no top');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX(#24, r4) made a reload restore the persisted camera script instead of
// blanking it. That blanking was also, by accident, the only thing that ever
// cleared a script out of RESET ALL: the handler nulled cpActive/cpFn and left
// the source sitting in #ce-code, and the autosave this very button schedules
// wrote it back a second later. So "reset to defaults" survived exactly until
// the boot code stopped laundering it.
describe('RESET ALL — the camera programmer goes back to defaults for real', () => {
  const A_SCRIPT = 'ctx.cam.y = 4 + sin(time)*2;';

  test('the script source is cleared out of the editor, not just disarmed', () => {
    ui.camera.cpActive = true;
    ui.camera.cpSource = A_SCRIPT;
    byId('ce-code').value = A_SCRIPT;

    fire('btn-reset-all', 'click');

    assert.equal(byId('ce-code').value, CP_DEFAULT_TEMPLATE,
      'the reset left the script in the editor, where the next autosave picks it up again');
    assert.equal(ui.camera.cpSource, null);
    assert.equal(ui.camera.cpActive, false);
    assert.equal(ui.called('resetScript').length, 1,
      'camera.js:322 (resetScript) owns what a script reset means — the handler must route through it');
  });

  test('the keyframe timeline is cleared with it', () => {
    ui.camera.cpKeyframes = [{ t: 0.25, code: 'p.radius = 9;' }];

    fire('btn-reset-all', 'click');

    assert.deepEqual(ui.camera.cpKeyframes, []);
    assert.equal(ui.called('buildTimeline').length, 1);
  });
});

// ── The Wire Style row ──────────────────────────────────────────────────────
// The WIRE counterpart of Particle Style: shown in WIRE and nowhere else, a
// pick goes to the engine, a snapshot's key lands in the row unless this build
// does not know it, and RESET ALL goes back to Classic. The engine half — what
// each style does to the wire, and that nothing leaks out of WIRE — is
// tests/wire-style.test.js.
describe('the Wire Style row belongs to WIRE', () => {
  const WIRE_OPTS = ['classic', 'neon', 'hidden', 'trails', 'depth', 'scan', 'hologram', 'rows', 'grid', 'contour',
                     'lattice', 'electric', 'aurora', 'paint', 'glass']
    .map(value => ({ value }));
  const shown = () => byId('wire-style-wrap').style.display !== 'none';

  test('the mode buttons show it in WIRE and hide it everywhere else', () => {
    fire('mode-surface', 'click');
    assert.equal(shown(), false, 'the row is up in SURF');
    fire('mode-wireframe', 'click');
    assert.equal(shown(), true, 'the row is missing in WIRE');
    fire('mode-points', 'click');
    assert.equal(shown(), false, 'the row is up in PTS, next to its particle twin');
  });

  test('a pick reaches the engine and says what it does', () => {
    byId('wire-style-sel').options = WIRE_OPTS;
    byId('wire-style-sel').value = 'neon';
    fire('wire-style-sel', 'change');
    assert.deepEqual(ui.called('setWireStyle').at(-1), ['setWireStyle', 'neon']);
    assert.notEqual(byId('wire-style-desc').textContent, '', 'the description line stayed empty');
  });

  test('a mode switch hands the remembered pick to the engine, in every mode', () => {
    // Outside WIRE the engine only files it away (setWireStyle returns early);
    // the panel still has to tell it, or a style picked and left would not be
    // the one that comes back.
    byId('wire-style-sel').options = WIRE_OPTS;
    byId('wire-style-sel').value = 'scan';
    fire('mode-surface', 'click');
    assert.deepEqual(ui.called('setWireStyle').at(-1), ['setWireStyle', 'scan']);
  });

  test('a snapshot\'s style lands in the row, and an unknown one leaves it alone', () => {
    byId('wire-style-sel').options = WIRE_OPTS;
    byId('wire-style-sel').value = 'classic';
    ui.syncVizModeUI('wireframe', null, null, 'hologram');
    assert.equal(byId('wire-style-sel').value, 'hologram');
    assert.equal(shown(), true);
    // A key from a build with more styles: writing it to a <select> would blank it.
    ui.syncVizModeUI('wireframe', null, null, 'laser-show-2000');
    assert.equal(byId('wire-style-sel').value, 'hologram', 'an unknown key reached the dropdown');
    // And omitting it leaves the pick alone — a plain UI refresh.
    ui.syncVizModeUI('surface');
    assert.equal(byId('wire-style-sel').value, 'hologram');
    assert.equal(shown(), false);
  });

  test('RESET ALL goes back to Classic, with the row on screen', () => {
    byId('wire-style-sel').options = WIRE_OPTS;
    byId('wire-style-sel').value = 'trails';
    fire('btn-reset-all', 'click');
    assert.equal(byId('wire-style-sel').value, 'classic');
    assert.deepEqual(ui.called('setWireStyle').at(-1), ['setWireStyle', 'classic'],
      'the engine was not told — the trail of the old style would run under a Classic label');
    assert.equal(shown(), true, 'RESET ALL lands in WIRE, so the row belongs on screen');
  });
});


// ── NIGHT: the half of the mode that lives in the panel ─────────────────────
//
// tests/night-mode.test.js covers RenderEngine.setNightly — four lines of
// furniture. Everything the mode actually claims is here instead: which pool
// the unattended pickers draw from, what the switch-on does to the palette,
// and whether the mode is a mode (something RESET ALL clears) or a value.
// None of it had a test, which is how the three defects below survived review.
describe('NIGHT — what the panel switch owns', () => {

  test('turning it on narrows AUTO COLOUR to the NIGHT series, and off widens it back', () => {
    fire('night-btn', 'click');
    assert.deepEqual(ui.autoColor.pool, NIGHT_SCHEMES,
      'AUTO COLOUR is still free to draw a bright palette inside a mode whose claim is that it does not');
    fire('night-btn', 'click');
    assert.deepEqual(ui.autoColor.pool, ALL_SCHEMES);
  });

  test('switching on over a bright palette moves it to the first NIGHT scheme', () => {
    ui.audio.colorIdx = 16;                 // Amber — the shipped default
    ui.render.U.uCM.value = 16;
    fire('night-btn', 'click');

    assert.equal(ui.audio.colorIdx, NIGHT_SCHEME_FIRST);
    assert.deepEqual(ui.called('setColorSchemeAnimated').at(-1), ['setColorSchemeAnimated', NIGHT_SCHEME_FIRST]);
    assert.equal(byId('color-sel').value, String(NIGHT_SCHEME_FIRST),
      'the dropdown must follow the engine, or the panel reports a palette that is not on screen');
  });

  test('a NIGHT destination that has not arrived yet is kept, not overwritten', () => {
    // AUTO COLOUR writes a.colorIdx at fire time and the fade now fills the
    // whole period, so "where we are going" and "what is on screen" can differ
    // for a minute. Reading the destination alone said "nothing to do" while
    // the screen was still glaring — and reading it alone the other way would
    // throw away a NIGHT palette the cycler or the operator had just chosen.
    ui.audio.colorIdx     = 47;   // bound for a NIGHT scheme...
    ui.render.U.uCM.value = 16;   // ...but still showing Amber
    ui.render.U.uCMNext.value = 47;
    fire('night-btn', 'click');

    assert.equal(ui.audio.colorIdx, 47, 'the chosen NIGHT palette was overwritten with 44');
    assert.deepEqual(ui.called('setColorSchemeAnimated').at(-1), ['setColorSchemeAnimated', 47],
      'the mode arrived with a bright palette still on screen for the rest of the fade');
  });

  test('control — with a NIGHT palette already on screen the switch writes no palette at all', () => {
    ui.audio.colorIdx     = 47;
    ui.render.U.uCM.value = 47;
    ui.render.U.uCMNext.value = 47;
    fire('night-btn', 'click');

    assert.equal(ui.called('setColorSchemeAnimated').length, 0,
      'a switch-on that restarts a fade nobody needed is a visible flicker');
  });

  test('it paints the panel and the button, not just the engine', () => {
    // body.nightly is what brings the three accent hues down with the picture
    // (index.html) — in a dark room the panel is the brightest thing on
    // screen, so a mode that dims the scene and not the chrome is half a mode.
    fire('night-btn', 'click');
    assert.equal(document.body.classList.contains('nightly'), true);
    assert.equal(byId('night-btn').classList.contains('active'), true);

    fire('night-btn', 'click');
    assert.equal(document.body.classList.contains('nightly'), false);
    assert.equal(byId('night-btn').classList.contains('active'), false,
      'the button reads ON in a session where the mode is off');
  });

  test('keepPalette — a snapshot brings its own palette, so the switch-on leaves it', () => {
    // The preset and ClipPlayer path. applyState has already applied the
    // snapshot's colorIdx through PARAM_FIELDS; the switch-on nudge is for a
    // hand on the button, not for a file that has already said which palette
    // it wants. The pool must still narrow — that is about what the app picks
    // unattended, which the snapshot says nothing about.
    ui.audio.colorIdx = 16;
    ui.render.U.uCM.value = 16;

    ui.setNightly(true, { keepPalette: true });

    assert.equal(ui.audio.colorIdx, 16, "the snapshot's own palette was dragged to 44");
    assert.equal(ui.called('setColorSchemeAnimated').length, 0);
    assert.deepEqual(ui.autoColor.pool, NIGHT_SCHEMES);
  });

  test('re-asserting the mode leaves both shuffle decks alone', () => {
    // What a preset click, an import, a boot restore and every ClipPlayer step
    // do: captureState writes `nightly` unconditionally, so applyState calls
    // setNightly with the value it already has. Each call used to build two
    // fresh ShuffleBags, and a fresh bag is a fresh deck — so the no-repeat
    // guarantee both pools advertise restarted several times a minute during a
    // clip, which is exactly where it matters most.
    let poolCalls = 0;
    ui.onColorPoolChange = () => { poolCalls++; };

    fire('night-btn', 'click');                     // NIGHT on — a real change
    const bag = ui.autoColor._bag;
    const afterRealChange = poolCalls;
    assert.ok(bag, 'precondition: the cycler has a deck to protect');

    ui.setNightly(true, { keepPalette: true });     // ...and now the no-op apply
    ui.setNightly(true, { keepPalette: true });

    assert.equal(ui.autoColor._bag, bag,
      'the deck was rebuilt by an apply that changed nothing');
    assert.equal(poolCalls, afterRealChange,
      'the R/Q bag in main.js was rebuilt by an apply that changed nothing');
  });

  test('control — a real change still swaps both pools', () => {
    let poolCalls = 0;
    ui.onColorPoolChange = () => { poolCalls++; };

    fire('night-btn', 'click');
    const bag = ui.autoColor._bag;
    fire('night-btn', 'click');                     // ...and back off

    assert.notEqual(ui.autoColor._bag, bag, 'the early-out swallowed a real change');
    assert.equal(poolCalls, 2);
    assert.deepEqual(ui.autoColor.pool, ALL_SCHEMES);
  });

  test('the switch-on defers AUTO COLOUR, like every other hand-driven colour write', () => {
    // Assigning DOM.colorSel.value from script fires no change event, so the
    // dropdown\'s own deferring handler cannot rescue this path. Without the
    // call, AUTO could crossfade the mode\'s opening palette away a fraction of
    // a second later — the defect main.js:196 already fixed for Q, E and R.
    const deferred = [];
    ui.autoColor.defer = () => deferred.push(1);
    ui.audio.colorIdx = 16;
    ui.render.U.uCM.value = 16;
    fire('night-btn', 'click');

    assert.equal(deferred.length, 1, 'the mode\'s own palette pick did not get its full period');
  });
});

// ── STARS: the starfield's switch, and its button ──────────────────────────
//
// The engine half — the wish against TRANSPARENT BG, the one writer — is in
// tests/stars-toggle.test.js. What lives here is the panel half: the click
// reaches the engine, and the button says what the engine now holds. The grid
// button is the cautionary tale: its look is written in three places and the
// G hotkey writes none of them, so it can read the opposite of the scene.
// STARS has one painter, ui.setStars, and these tests drive it from both of
// its kinds of caller — a click, and a direct call as applyState makes one.
describe('STARS — the button drives the engine and paints itself', () => {

  test('a click switches the starfield off and dims the button; a second puts both back', () => {
    fire('btn-toggle-stars', 'click');
    assert.equal(ui.render.starsOn, false, 'the click did not reach the engine');
    assert.deepEqual(ui.called('render.setStarsOn').at(-1), ['render.setStarsOn', false]);
    assert.equal(byId('btn-toggle-stars').style.opacity, '0.45',
      'the stars are off and the button still reads ON');

    fire('btn-toggle-stars', 'click');
    assert.equal(ui.render.starsOn, true);
    assert.equal(byId('btn-toggle-stars').style.opacity, '1',
      'the stars are back and the button still reads OFF');
  });

  test('control — binding alone touches neither the engine nor the button', () => {
    // The button ships ON in index.html (no inline opacity) because the stars
    // ship visible. A bind-time paint or engine call would be harmless today
    // and wrong the day a boot restore runs first — bootPersist runs after
    // bindControls and is the one that brings back a saved STARS-off.
    assert.equal(ui.called('render.setStarsOn').length, 0);
    assert.equal(byId('btn-toggle-stars').style.opacity, undefined);
  });

  test('a direct ui.setStars call — what applyState makes — paints the button too', () => {
    ui.setStars(false);
    assert.equal(ui.render.starsOn, false);
    assert.equal(byId('btn-toggle-stars').style.opacity, '0.45',
      'a preset switched the stars off and left the button reading ON');
    ui.setStars(true);
    assert.equal(byId('btn-toggle-stars').style.opacity, '1');
  });

  test('the button reports what the engine holds, not what it was asked for', () => {
    // The paint reads r.starsOn after the call rather than echoing its own
    // argument — the same rule the grid button's click follows. An engine that
    // kept the stars off (here: one that ignores the wish) must leave the
    // button reading OFF; the direct-call test above is this one's control.
    ui.render.setStarsOn = function () { this.starsOn = false; };
    ui.setStars(true);
    assert.equal(byId('btn-toggle-stars').style.opacity, '0.45');
  });
});

// ── Round 11: RESET ALL has to reset ────────────────────────────────────────
describe('RESET ALL leaves the state it advertises', () => {

  test('the starfield comes back ON, and its button with it', () => {
    fire('btn-toggle-stars', 'click');
    assert.equal(ui.render.starsOn, false, 'precondition: STARS is off');
    assert.equal(byId('btn-toggle-stars').style.opacity, '0.45');

    fire('btn-reset-all', 'click');

    assert.equal(ui.render.starsOn, true,
      'RESET ALL left the starfield off — the startup sky has stars in it');
    assert.equal(byId('btn-toggle-stars').style.opacity, '1',
      'the stars are back and the button still reads OFF');
  });

  test('control — with the stars already on, RESET ALL leaves them on', () => {
    fire('btn-reset-all', 'click');
    assert.equal(ui.render.starsOn, true);
    assert.equal(byId('btn-toggle-stars').style.opacity, '1');
  });

  test('NIGHT is a mode, so the reset clears it', () => {
    // The button's own comment calls AUTO COLOUR and AUTO MATERIAL "modes, not
    // values" and switches them off for that reason. NIGHT is one by the same
    // test, and the reset did not restore it: it left bright Amber (under a
    // starless sky, back then — NIGHT has not touched the stars since r6) with
    // both unattended pickers still locked to the NIGHT ten, and the panel's
    // autosave then persisted that across a reload.
    // (`volumeKey` is also unrestored, and separately so — a pre-existing gap
    // this test does not speak for.)
    fire('night-btn', 'click');
    assert.equal(ui.render.nightly, true, 'precondition: the mode is on');

    fire('btn-reset-all', 'click');

    assert.equal(ui.render.nightly, false, 'RESET ALL ended in a mode it never announced');
    assert.deepEqual(ui.autoColor.pool, ALL_SCHEMES,
      'the reset left the unattended pickers confined to the NIGHT ten');
    assert.equal(byId('night-btn').classList.contains('active'), false,
      'the button still reads ON after a reset that says "back to the startup state"');
  });


  test('auto-rotate is OFF afterwards, as the button\'s own comment promises', () => {
    ui.camera.autoRot = true;
    fire('btn-reset-all', 'click');

    assert.equal(ui.camera.autoRot, false,
      'RESET ALL ended with auto-rotate on — resetScript() re-enters setCamPhysics, which sets it');
    // And the button's label follows the flag: the last onAutoRotChanged wins.
    const paints = ui.called('autoRotChanged');
    assert.equal(paints.at(-1)?.[1], false,
      `the last repaint said ${paints.at(-1)?.[1]}, so the button would read ON`);
  });

});

// ── SHADER KNOBS take Formula Detail / Formula Phase's place ────────────────
//
// One slot under Wave Intensity, two banks of hands, and the engine that is
// drawing decides which is on screen. The pair (#formula-knobs-wrap) speaks to
// CPU formulas and moves nothing under a numbered GPU shader; the four Shader
// Knobs (#shader-knobs-wrap) carry a fixed meaning on a numbered shader, and
// any meaning the operator gives them in a custom shader — which colours CPU
// formulas too, so they also show over a formula while one is applied.
//
// Before the swap the pair was dimmed under a shader and the knobs lived in
// ADVANCED → SHADER EDITOR. The dim had the same hole this has to close: only
// applyFormulaValue re-synced it, so a preset, an import, a clip step, the boot
// restore and RESET ALL — all of which write #gpu-sel directly — left the panel
// describing the previous engine. The groups below drive every road.
describe('the formula slot shows the bank of the engine that is drawing', () => {
  const pair  = () => byId('formula-knobs-wrap').style.display;
  const knobs = () => byId('shader-knobs-wrap').style.display;
  const SHOWN = '', HIDDEN = 'none';

  test('bind time paints the shipped selection: the pair shown, the knobs hidden', () => {
    // beforeEach leaves #gpu-sel at '' — which counts as a CPU formula, as it
    // does for _cpuOwnsSurface — and wipes every inline style first, so these
    // values were written by bindControls and not inherited from a test.
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), HIDDEN);
  });

  test('a numbered shader puts the Shader Knobs in the pair\'s place', () => {
    ui.applyFormulaValue('7');
    assert.equal(pair(), HIDDEN, 'Formula Detail / Phase stay up under a shader that never reads them');
    assert.equal(knobs(), SHOWN, 'the knobs that DO act on a numbered shader are not on screen');
  });

  test('an m: formula puts the pair back', () => {
    ui.applyFormulaValue('7');
    ui.applyFormulaValue('m:fractals:henon');
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), HIDDEN, 'the knobs outlived the shader they were shown for');
  });

  test("an empty selection counts as a CPU formula", () => {
    // What a <select> reports for a value it does not ship. _cpuOwnsSurface
    // treats it as a formula; the slot must not disagree with it.
    ui.syncFormulaKnobsUI('7');
    ui.syncFormulaKnobsUI('');
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), HIDDEN);
    ui.syncFormulaKnobsUI('7');
    ui.syncFormulaKnobsUI(null);
    assert.equal(pair(), SHOWN, 'null reads as a shader');
  });

  test('a formula under the operator\'s own shader shows both banks', () => {
    // A custom fragment body colours CPU formulas, and the shipped default
    // body reads uK1 — hiding the knobs here would hide live controls.
    ui.shaderEditor.customVS = 'VS'; ui.shaderEditor.customFS = 'FS';
    ui.applyFormulaValue('m:fractals:henon');
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), SHOWN, 'the knobs a custom shader reads are hidden over a formula it colours');
  });

  test('control — the same formula under the built-in program shows the pair alone', () => {
    ui.applyFormulaValue('m:fractals:henon');
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), HIDDEN);
  });

  test('a numbered shader under a custom shader still hides the pair', () => {
    ui.shaderEditor.customVS = 'VS'; ui.shaderEditor.customFS = 'FS';
    ui.applyFormulaValue('7');
    assert.equal(pair(), HIDDEN, 'a custom shader does not make Formula Detail / Phase reach anything');
    assert.equal(knobs(), SHOWN);
  });

  test('the editor\'s program-change announcement repaints the slot', () => {
    // APPLY and the editor's RESET reach the slot only this way: neither
    // touches #gpu-sel. The real editor fires it after customVS / customFS
    // change (tests/shader-editor-status.test.js pins that half).
    const se = ui.shaderEditor;
    assert.equal(typeof se.cb.onProgramChange, 'function', 'bindControls did not take the editor\'s announcement');
    se.customVS = 'VS'; se.customFS = 'FS';
    se.cb.onProgramChange();
    assert.equal(knobs(), SHOWN, 'APPLY over a formula left the knobs hidden');
    se.customVS = null; se.customFS = null;
    se.cb.onProgramChange();
    assert.equal(knobs(), HIDDEN, 'the editor\'s RESET left the knobs over a formula');
  });

  test('control — without the announcement the slot does not move on its own', () => {
    // So the repaint above came from the hook, not from something that polls.
    ui.shaderEditor.customVS = 'VS'; ui.shaderEditor.customFS = 'FS';
    assert.equal(knobs(), HIDDEN);
  });

  test('the announcement repaints for the last selection, so a revert on a numbered shader keeps the knobs', () => {
    // FIX(knobs-K1): it used to read #gpu-sel back, which a value the select
    // does not ship had blanked — see the group on such values further down.
    ui.applyFormulaValue('7');
    ui.shaderEditor.cb.onProgramChange();     // a custom shader reverted, say
    assert.equal(pair(), HIDDEN);
    assert.equal(knobs(), SHOWN);
  });

  test('RESET ALL from a numbered shader brings the pair back and hides the knobs', () => {
    ui.applyFormulaValue('7');
    assert.equal(knobs(), SHOWN, 'precondition: the knobs are up');

    fire('btn-reset-all', 'click');

    assert.equal(byId('gpu-sel').value, 'm:differentialEqs:pendulumNonLinear', 'precondition: the reset wrote the boot formula');
    assert.equal(pair(), SHOWN, 'RESET ALL lands on a formula with Formula Detail / Phase hidden');
    assert.equal(knobs(), HIDDEN, 'RESET ALL left the Shader Knobs up over the boot formula');
  });

  test('RESET ALL takes the knobs away with a custom shader, whether or not the editor says so', () => {
    // This editor clears its program and announces nothing. The handler's own
    // sync, placed after the shader reset, is what has to get it right.
    const se = ui.shaderEditor;
    se.customVS = 'VS'; se.customFS = 'FS';
    se.reset = function () { this.customVS = null; this.customFS = null; };
    ui.applyFormulaValue('m:fractals:henon');
    assert.equal(knobs(), SHOWN, 'precondition: both banks are up');

    fire('btn-reset-all', 'click');

    assert.equal(se.customFS, null, 'precondition: the reset reached the editor');
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), HIDDEN, 'the shader was cleared and its knobs were left over the formula');
  });

  test('control — RESET ALL from the pair leaves the pair', () => {
    fire('btn-reset-all', 'click');
    assert.equal(pair(), SHOWN);
    assert.equal(knobs(), HIDDEN);
  });

  test('ui.applyMathFormula tells the slot itself — it writes #gpu-sel, and VOLUME is judged by the slot', () => {
    // FIX(review K2): every writer of the select tells the slot, because the
    // slot's memory is what VOLUME's refusal asks now. applyFormulaValue, its
    // one caller today, tells it first; this is a caller going straight in.
    ui.applyFormulaValue('7');
    ui.applyMathFormula('fractals', 'henon');
    assert.equal(pair(), SHOWN, 'the slot still describes shader 7 after a formula was written');
    assert.equal(knobs(), HIDDEN);
    ui.calls.length = 0;
    byId('volume-formula-sel').value = 'twist';
    fire('deform-volume', 'click');
    assert.equal(ui.called('toast').length, 0, 'VOLUME was refused over the formula applyMathFormula just armed');
  });
});

// ── …and a snapshot, which restores the shader AFTER it writes #gpu-sel ─────
//
// applyState writes #gpu-sel early and restores the custom shader at its very
// end, so the slot is synced while the PREVIOUS program is still live. For a
// snapshot that carries a shader it is the editor's own announcement, fired from
// inside that late compile or revert, that settles the slot — and these tests
// prove it by unplugging the announcement and watching the result go wrong.
//
// Real PresetMixin, real ShaderEditor (compileAndApply against a renderer stub
// that links everything, as tests/shader-editor-status.test.js does), real
// bindControls. The preset path is the boot restore's path too: bootPersist
// runs after bindControls and hands its snapshot to the same applyState.
describe('a snapshot settles the formula slot in the order it restores things', () => {
  let PresetMixin, ShaderEditor, se;
  before(async () => {
    ({ PresetMixin } = await import('../src/ui/presets.js'));
    ({ ShaderEditor } = await import('../src/shaders.js'));
  });

  const pair  = () => byId('formula-knobs-wrap').style.display;
  const knobs = () => byId('shader-knobs-wrap').style.display;

  /** The smallest host compileAndApply runs against: nothing ever fails to link. */
  const editorHost = () => ({
    U: { uMathMode: { value: 1 } },
    applyShaderSource() {},
    renderer: { debug: {}, compile() {}, render() {}, getRenderTarget() { return null; }, setRenderTarget() {} },
  });

  beforeEach(() => {
    // Rebind from scratch with a real editor in place of the stub: bindControls
    // hangs its hook on whatever editor it is handed, and the listeners of the
    // outer beforeEach's binding have to go first or every event fires twice.
    for (const el of [...els.values(), ...selEls.values(), document.body, document.documentElement]) {
      el._classes.clear(); el._listeners.clear();
      el.textContent = ''; el.value = ''; el.style = {}; el.offsetParent = {};
    }
    docLtnr.clear();
    winLtnr.clear();
    se = new ShaderEditor(editorHost());
    ui = makeUi();
    ui.shaderEditor = se;
    bindControls(ui);
    // Only the two apply methods: the mixin's preset-list methods would take
    // over the stubs bindControls calls at bind time.
    ui.applyState = PresetMixin.applyState;
    ui._applyStateFields = PresetMixin._applyStateFields;
  });
  // The success path arms a two-second timer that blanks the status line; it
  // has nothing to say to these tests and would hold the run open.
  afterEach(() => se.claimStatus());

  const FORMULA = 'm:fractals:henon';
  const CUSTOM  = { hasCustom: true,  vert: 'y = sin(r * 4.0 + T) * a;', frag: 'c = paletteAt(t) * (1.0 + uK1);' };
  const BUILTIN = { hasCustom: false, vert: 'y = 0.0;', frag: 'c = paletteAt(t);' };

  test('a formula snapshot that brings its own shader ends with both banks', () => {
    assert.equal(ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: CUSTOM }), true);
    assert.ok(se.customFS, 'precondition: the snapshot\'s shader compiled and went live');
    assert.equal(pair(), '');
    assert.equal(knobs(), '', 'the knobs this shader reads are hidden over the formula it colours');
  });

  test('control — with the announcement unplugged, applyState\'s own sync leaves the knobs hidden', () => {
    // Its sync ran while no custom program was live yet. If this ever passes
    // with the announcement unplugged, applyState has started restoring the
    // shader before #gpu-sel and the test above no longer proves the order.
    se.cb.onProgramChange = () => {};
    assert.equal(ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: CUSTOM }), true);
    assert.ok(se.customFS);
    assert.equal(knobs(), 'none');
  });

  test('a snapshot with the built-in look reverts a live shader and takes the knobs off the formula', () => {
    ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: CUSTOM });
    assert.equal(knobs(), '', 'precondition: both banks are up');

    assert.equal(ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: BUILTIN }), true);

    assert.equal(se.customFS, null, 'precondition: the live shader was reverted');
    assert.equal(pair(), '');
    assert.equal(knobs(), 'none', 'the knobs of a shader that is gone stayed up over the formula');
  });

  test('control — unplugged, that revert leaves the knobs standing', () => {
    // revertToBuiltIn reports nothing through onCompileResult, so a slot hung
    // on that callback would fail exactly like this.
    ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: CUSTOM });
    se.cb.onProgramChange = () => {};
    ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: BUILTIN });
    assert.equal(se.customFS, null);
    assert.equal(knobs(), '');
  });

  test('a numbered snapshot puts the knobs up at once — the boot restore onto a shader', () => {
    assert.equal(ui.applyState({ _version: 4, gpuSelVal: '3' }), true);
    assert.equal(pair(), 'none');
    assert.equal(knobs(), '');
  });

  test('RESET ALL over a formula with a custom shader applied ends with the pair alone', () => {
    ui.applyState({ _version: 4, gpuSelVal: FORMULA, shader: CUSTOM });
    assert.equal(knobs(), '', 'precondition: both banks are up');

    fire('btn-reset-all', 'click');

    assert.equal(se.customFS, null, 'precondition: the real editor was reset');
    assert.equal(pair(), '');
    assert.equal(knobs(), 'none');
  });

  // ── …including a value the select cannot hold ────────────────────────────
  // FIX(knobs-K1). Two snapshot values a real <select> cannot show, which only
  // a hand-edited file or a build with more shaders produces:
  //   • '' — applyState routed it to the GPU branch (+'' = 0, shader 1 drew)
  //     while the slot read it as a CPU formula: the pair up, the live knobs
  //     hidden. It is now no selection, as a missing field is, and nothing moves.
  //   • '41' — the engine is told 41 and draws a GPU shader, and the select
  //     blanks. applyState's own sync was right; the editor's next
  //     announcement (an APPLY, its RESET, or the snapshot's own shader
  //     restore) read the blank select back as a CPU formula and put the pair
  //     over the shader. The slot now remembers what it was last told.
  // Here #gpu-sel behaves as the real one does: a value index.html does not
  // ship reads back as ''. FIX(review R1): the set is index.html's own option
  // values, read from the markup. It used to be "any `m:…`, or 0..37", which
  // kept an `m:` formula no build ships — the one value that showed the slot
  // and the engine parting (see the group on unshipped formulas below).
  describe('a snapshot value the select cannot hold', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const block = html.slice(html.indexOf('<select id="gpu-sel">'), html.indexOf('</select>', html.indexOf('<select id="gpu-sel">')));
    const OPTIONS = new Set([...block.matchAll(/<option[^>]*\bvalue="([^"]*)"/g)].map(m => m[1]));
    const SHIPPED = v => OPTIONS.has(v);
    beforeEach(() => {
      let held = byId('gpu-sel').value;
      Object.defineProperty(byId('gpu-sel'), 'value', {
        configurable: true, enumerable: true,
        get: () => held,
        set: v => { v = String(v); held = SHIPPED(v) ? v : ''; },
      });
    });
    afterEach(() => {
      // A plain field again: every other test assigns it and reads it back.
      Object.defineProperty(byId('gpu-sel'), 'value',
        { configurable: true, enumerable: true, writable: true, value: '' });
    });

    /** An APPLY from the editor's fragment tab, compiled for real. */
    const applyFromEditor = () => {
      se._tab = 'frag';
      byId('se-code').value = 'c = paletteAt(t) * (1.0 + uK1);';
      assert.equal(se.compileAndApply(), true, 'precondition: the APPLY compiled');
      assert.ok(se.customFS, 'precondition: the APPLY went live');
    };

    test('control — the stub blanks what index.html does not ship, and keeps what it does', () => {
      // The reader found the whole list (38 shaders and the formulas beside
      // them), not a fragment of it.
      assert.ok(OPTIONS.has('0') && OPTIONS.has('37') && OPTIONS.has('m:differentialEqs:pendulumNonLinear'),
        'the option reader did not find index.html\'s #gpu-sel');
      assert.ok(OPTIONS.size > 200, `read ${OPTIONS.size} options`);
      const sel = byId('gpu-sel');
      sel.value = '7';     assert.equal(sel.value, '7');
      sel.value = '37';    assert.equal(sel.value, '37');
      sel.value = FORMULA; assert.equal(sel.value, FORMULA);
      sel.value = '41';    assert.equal(sel.value, '', 'the stub held a value a real <select> would blank');
      sel.value = 'm:fractals:fromANewerBuild';
      assert.equal(sel.value, '', 'the stub held an m: value index.html does not ship');
    });

    test("'' over a numbered shader moves nothing: the shader keeps drawing and the knobs stay", () => {
      ui.applyState({ _version: 4, gpuSelVal: '3' });
      assert.equal(knobs(), '', 'precondition: the knobs are up');
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '' }), true);

      assert.deepEqual(ui.called('setGPUModeAnimated'), [], "'' still sent the engine to a shader");
      assert.deepEqual(ui.called('deactivate'), []);
      assert.equal(byId('gpu-sel').value, '3', "'' was written into the select");
      assert.equal(pair(), 'none', 'Formula Detail / Phase came up over a shader that never reads them');
      assert.equal(knobs(), '', 'the knobs of the shader still drawing were hidden');
    });

    test("'' over a formula moves nothing either: the formula keeps drawing and the pair stays", () => {
      ui.applyState({ _version: 4, gpuSelVal: FORMULA });
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '' }), true);

      assert.deepEqual(ui.called('setGPUModeAnimated'), [], "'' put shader 1 in the formula's place");
      assert.deepEqual(ui.called('deactivate'), [], "'' switched the formula engine off");
      assert.equal(pair(), '');
      assert.equal(knobs(), 'none');
    });

    test('control — a shipped number still sends the engine to its shader and puts the knobs up', () => {
      // So the two tests above pass because '' is skipped, not because this
      // snapshot path stopped routing anything.
      ui.applyState({ _version: 4, gpuSelVal: FORMULA });
      ui.calls.length = 0;
      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '3' }), true);
      assert.deepEqual(ui.called('setGPUModeAnimated'), [['setGPUModeAnimated', 3]]);
      assert.equal(pair(), 'none');
      assert.equal(knobs(), '');
    });

    test("'41' keeps the knobs through the editor's APPLY and RESET that follow it", () => {
      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '41' }), true);
      assert.deepEqual(ui.called('setGPUModeAnimated'), [['setGPUModeAnimated', 41]],
        'precondition: the engine was told shader 41');
      assert.equal(byId('gpu-sel').value, '', 'precondition: the select blanked');
      assert.equal(pair(), 'none');
      assert.equal(knobs(), '');

      applyFromEditor();
      assert.equal(pair(), 'none', 'APPLY read the blank select back and put Formula Detail / Phase over shader 41');
      assert.equal(knobs(), '');

      se.reset();                                    // the editor's RESET
      assert.equal(se.customFS, null, 'precondition: the editor reverted to the built-in program');
      assert.equal(pair(), 'none', "the editor's RESET put the pair back over shader 41");
      assert.equal(knobs(), '', 'the knobs of the shader still drawing were hidden');
    });

    test("'41' that brings its own shader ends with the knobs alone", () => {
      // The restore inside applyState announces, after applyState's own sync.
      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '41', shader: CUSTOM }), true);
      assert.ok(se.customFS, 'precondition: the snapshot\'s shader compiled, so the editor announced');
      assert.equal(pair(), 'none', 'the shader restore put the pair beside the knobs over shader 41');
      assert.equal(knobs(), '');
    });

    test('control — a formula through the same APPLY and RESET ends with the pair alone', () => {
      // The memory is of the selection, not of the knobs: a formula's slot
      // still takes the knobs on and off with the custom shader.
      ui.applyState({ _version: 4, gpuSelVal: FORMULA });
      applyFromEditor();
      assert.equal(pair(), '');
      assert.equal(knobs(), '', 'APPLY over a formula left the knobs hidden');
      se.reset();
      assert.equal(pair(), '');
      assert.equal(knobs(), 'none', 'the knobs outlived the custom shader over a formula');
    });

    test('control — after \'41\', a formula picked by hand takes the slot back for good', () => {
      // Every caller that writes #gpu-sel tells the slot, so the remembered
      // value moves on with the selection and a later announcement follows it.
      ui.applyState({ _version: 4, gpuSelVal: '41' });
      ui.applyFormulaValue(FORMULA);
      assert.equal(pair(), '');
      assert.equal(knobs(), 'none');
      se.cb.onProgramChange();
      assert.equal(pair(), '', 'the announcement went back to shader 41');
      assert.equal(knobs(), 'none');
    });

    // ── FIX(review R1/R2/R3/K2): what b11cb4e's "the slot follows the engine
    // for any snapshot" still missed ──────────────────────────────────────────
    // • an `m:` formula this build does not ship blanked the select and put
    //   the pair up, while nothing moved the engine: the shader kept drawing
    //   under a slot describing a formula, and the keys followed the slot;
    // • a snapshot with no selection counted as a CPU formula, so its
    //   deformMode 'volume' armed VOLUME over the numbered shader on screen;
    // • a numeric gpuSelVal wrote the select and the slot and only then threw;
    // • after '41' the select is blank, and VOLUME read that as a formula.
    const ENGINE = ['setGPUModeAnimated', 'deactivate', 'setFormula', 'setVolumeFormula', 'setMode', 'morph'];
    const engineCalls = () => ui.calls.filter(c => ENGINE.includes(c[0]));
    const UNSHIPPED = 'm:fractals:fromANewerBuild';
    const deformLit = () => ['surface', 'volume', 'collapse'].filter(m => byId('deform-' + m).classList.contains('active'));
    /** A keydown; true if the app armed it (called preventDefault). */
    const arms = key => { const p = keyDownAs(key, ''); keyUpAs(key, ''); return p; };

    test('an unshipped m: formula over shader 7 leaves the select, the slot and the engine where they were', () => {
      ui.applyState({ _version: 4, gpuSelVal: '7' });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: UNSHIPPED }), true);
      ui.render.flatFrame();

      assert.equal(byId('gpu-sel').value, '7', 'the select was left blank — or holding what it cannot show');
      assert.equal(knobs(), '', 'the knobs of the shader still drawing were hidden');
      assert.equal(pair(), 'none', 'Formula Detail / Phase came up over a shader that never reads them');
      assert.deepEqual(engineCalls(), [], 'the engine was moved for a formula this build cannot draw');
      assert.equal(arms('y'), true, 'Y no longer reaches the knobs of the shader on screen');
      assert.equal(arms('b'), false, 'B arms for a Formula Detail nothing reads');
    });

    test('…and the same when the snapshot brings its own shader', () => {
      ui.applyState({ _version: 4, gpuSelVal: '7' });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: UNSHIPPED, shader: CUSTOM }), true);
      ui.render.flatFrame();

      assert.ok(se.customFS, 'precondition: the snapshot\'s shader went live, so the editor announced');
      assert.equal(byId('gpu-sel').value, '7');
      assert.equal(knobs(), '');
      assert.equal(pair(), 'none', 'the shader restore put the pair up beside the knobs over shader 7');
      assert.deepEqual(engineCalls(), []);
      assert.equal(arms('y'), true);
      assert.equal(arms('b'), false);
    });

    test('control — a shipped m: formula over shader 7 still arms it and swaps the slot', () => {
      ui.applyState({ _version: 4, gpuSelVal: '7' });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: FORMULA }), true);
      ui.render.flatFrame();

      assert.equal(byId('gpu-sel').value, FORMULA);
      assert.deepEqual(ui.called('setFormula'), [['setFormula', 'fractals:henon']]);
      assert.equal(pair(), '');
      assert.equal(knobs(), 'none');
      assert.equal(arms('b'), true);
      assert.equal(arms('y'), false);
    });

    test("'' beside deformMode 'volume' over shader 3 ends on SURFACE — the shader keeps drawing", () => {
      ui.applyState({ _version: 4, gpuSelVal: '3' });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '', deformMode: 'volume', volumeKey: 'breathe' }), true);
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), [],
        'VOLUME was armed over shader 3: uMathMode = 1 switches its whole displacement off');
      assert.deepEqual(ui.called('setMode'), [['setMode', 'surface']]);
      assert.deepEqual(deformLit(), ['surface'], 'the panel lit a deform mode the engine is not in');
      assert.equal(byId('gpu-sel').value, '3');
      assert.equal(knobs(), '');
    });

    test('…and so does a snapshot with no gpuSelVal at all', () => {
      ui.applyState({ _version: 4, gpuSelVal: '3' });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, deformMode: 'volume', volumeKey: 'breathe' }), true);
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), []);
      assert.deepEqual(deformLit(), ['surface']);
    });

    test('…and an unshipped m: formula beside VOLUME, which leaves shader 3 the selection', () => {
      ui.applyState({ _version: 4, gpuSelVal: '3' });
      ui.render.flatFrame();
      ui.calls.length = 0;

      ui.applyState({ _version: 4, gpuSelVal: UNSHIPPED, deformMode: 'volume', volumeKey: 'breathe' });
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), []);
      assert.deepEqual(deformLit(), ['surface']);
    });

    test("…and after '41', where the select is blank: the slot is asked, not the select", () => {
      // The panel's adapter (ui.formulaOwnsSurface) answers from the slot's
      // memory, which still says 41; the select's own rule would read its
      // blank as a CPU formula and restore VOLUME over shader 41.
      ui.applyState({ _version: 4, gpuSelVal: '41' });
      assert.equal(byId('gpu-sel').value, '', 'precondition: the select blanked');
      ui.calls.length = 0;

      ui.applyState({ _version: 4, gpuSelVal: '', deformMode: 'volume', volumeKey: 'breathe' });
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), [], 'VOLUME was armed over shader 41');
      assert.deepEqual(deformLit(), ['surface']);
    });

    test("control — '' beside VOLUME over an m: formula still restores VOLUME", () => {
      // The no-selection case judges the selection in effect; over a formula
      // that is a CPU one, and VOLUME is the snapshot's to restore.
      ui.applyState({ _version: 4, gpuSelVal: FORMULA });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: '', deformMode: 'volume', volumeKey: 'breathe' }), true);
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), [['setVolumeFormula', 'breathe']]);
      assert.deepEqual(deformLit(), ['volume']);
    });

    test('a numeric gpuSelVal is the shader it names — "gpuSelVal": 5 is shader 5', () => {
      ui.applyState({ _version: 4, gpuSelVal: FORMULA });
      ui.render.flatFrame();
      ui.calls.length = 0;

      assert.equal(ui.applyState({ _version: 4, gpuSelVal: 5 }), true,
        'the snapshot was rejected — after the select and the slot had already moved');
      assert.equal(byId('gpu-sel').value, '5');
      assert.deepEqual(ui.called('setGPUModeAnimated'), [['setGPUModeAnimated', 5]]);
      assert.deepEqual(ui.called('deactivate'), [['deactivate']]);
      assert.equal(knobs(), '');
      assert.equal(pair(), 'none');
    });

    test('a gpuSelVal that is neither a string nor a whole number is no selection: nothing moves, nothing throws', () => {
      for (const bad of [{}, true, 1.5, ['3']]) {
        ui.applyState({ _version: 4, gpuSelVal: FORMULA });
        ui.render.flatFrame();
        ui.calls.length = 0;

        assert.equal(ui.applyState({ _version: 4, gpuSelVal: bad }), true,
          `${JSON.stringify(bad)} made applyState reject the snapshot`);
        ui.render.flatFrame();
        assert.equal(byId('gpu-sel').value, FORMULA, `${JSON.stringify(bad)} moved the select`);
        assert.equal(pair(), '', `${JSON.stringify(bad)} moved the slot`);
        assert.deepEqual(engineCalls(), [], `${JSON.stringify(bad)} moved the engine`);
      }
    });

    // FIX(review, fixer note on acc6a4c): a STRING was a selection whatever it
    // said. 'abc' went down the GPU branch as setGPUModeAnimated(+'abc' = NaN)
    // and the slot was told 'abc', which it reads as a numbered shader — so
    // over a formula the pair went down and the knobs came up for a shader
    // that does not exist. #gpu-sel holds `m:…` and shader numbers; a string of
    // neither shape is no selection now.
    test("a string that is neither m:… nor a shader's number moves nothing, over a shader or a formula", () => {
      for (const start of ['3', FORMULA]) {
        for (const bad of ['abc', '3.5', ' 7', '7 ', '-2', '0x3']) {
          ui.applyState({ _version: 4, gpuSelVal: start });
          ui.render.flatFrame();
          const slot = { pair: pair(), knobs: knobs() };
          ui.calls.length = 0;

          assert.equal(ui.applyState({ _version: 4, gpuSelVal: bad }), true,
            `${JSON.stringify(bad)} made applyState reject the snapshot`);
          ui.render.flatFrame();

          const what = `${JSON.stringify(bad)} over ${start}`;
          assert.equal(byId('gpu-sel').value, start, `${what} moved the select`);
          assert.deepEqual({ pair: pair(), knobs: knobs() }, slot, `${what} moved the slot`);
          assert.deepEqual(engineCalls(), [], `${what} moved the engine`);
          assert.ok(!ui.calls.some(c => c.slice(1).some(a => Number.isNaN(a))), `${what} handed NaN to the engine`);
        }
      }
    });

    test('control — a whole number in digits still reaches the engine as that number, shipped or not', () => {
      for (const [v, n] of [['7', 7], ['41', 41], ['0', 0]]) {
        ui.applyState({ _version: 4, gpuSelVal: FORMULA });
        ui.render.flatFrame();
        ui.calls.length = 0;

        assert.equal(ui.applyState({ _version: 4, gpuSelVal: v }), true);
        assert.deepEqual(ui.called('setGPUModeAnimated'), [['setGPUModeAnimated', n]], `'${v}' did not reach the engine as ${n}`);
        assert.equal(pair(), 'none', `'${v}' left Formula Detail / Phase up over shader ${n}`);
        assert.equal(knobs(), '');
      }
    });

    test("after '41' a click on VOLUME is refused out loud, as over any shader", () => {
      ui.applyState({ _version: 4, gpuSelVal: '41' });
      assert.equal(byId('gpu-sel').value, '', 'precondition: the select blanked');
      ui.calls.length = 0;
      byId('volume-formula-sel').value = 'twist';

      fire('deform-volume', 'click');
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), [],
        'VOLUME was accepted over shader 41: a blank select read as a CPU formula');
      assert.ok(ui.called('toast').some(([, m]) => /VOLUME needs a CPU formula/.test(m)), 'no refusal was shown');
      assert.equal(byId('deform-volume').classList.contains('active'), false);
    });

    test('control — VOLUME over a formula is accepted', () => {
      ui.applyState({ _version: 4, gpuSelVal: '41' });
      ui.applyFormulaValue(FORMULA);
      ui.render.flatFrame();
      ui.calls.length = 0;
      byId('volume-formula-sel').value = 'twist';

      fire('deform-volume', 'click');
      ui.render.flatFrame();

      assert.deepEqual(ui.called('setVolumeFormula'), [['setVolumeFormula', 'twist']]);
      assert.equal(ui.called('toast').length, 0);
    });
  });
});
