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
      // Queued, not run: the real engine holds the work until the flat frame,
      // up to 400 ms later, and that gap is exactly what these tests are about.
      _queued: [],
      triggerMorphTransition(fn) { calls.push(['morph']); if (fn) this._queued.push(fn); },
      flatFrame() { const q = this._queued; this._queued = []; q.forEach(fn => fn()); },
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

  test('control — the dropdown itself goes through the same door', () => {
    byId('gpu-sel').value = '20';
    fire('gpu-sel', 'change', { target: byId('gpu-sel') });

    assert.deepEqual(ui.called('setGPUModeAnimated')[0], ['setGPUModeAnimated', 20]);
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
