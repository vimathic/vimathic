// tests/preset-import-gate.test.js
//
// The persistence and import surface — bootPersist, _persistNow,
// _scrubImportedState, importSettings — was reached by none of the 491 tests
// before this file. Both defects the fourth audit rated high live in it.
//
// ── The two defects pinned here ──────────────────────────────────────────────
// 1. bootPersist blanked camScript.code on restore ("never keep JS code"), and
//    the autosave that fires ~2.5 s later — with the tab merely open, no user
//    gesture at all — wrote the blank back over the stored snapshot. One reload
//    destroyed the only copy of a camera script. The comment above the line
//    said the user could "re-enable it via the editor"; the editor held the
//    boot default, because applyState only pushes a non-empty code into it.
//    Own state is not foreign JSON: the module's own security note says so
//    eight lines above. cs.active = false is what stops auto-execution, and it
//    is untouched — the source comes back, it just does not run by itself.
//
// 2. The import gate read camScript.code only. camScript.keyframes[].code is
//    the same JS, compiled by the same `new Function(...)` preamble in
//    camera.js:428, so a preset carrying its payload there tripped no gate:
//    no modal, toast "✔ State loaded". Worse, a preset carrying BOTH an
//    innocuous script and a keyframe payload showed the modal and then
//    installed the keyframe code even when the user pressed DISCARD CODE,
//    under a toast that read "script discarded". SECURITY.md sells that modal
//    as the control that makes the Camera Programmer an accepted trade-off.
//
// ── Why this runs in plain Node ──────────────────────────────────────────────
// Same shape as tests/preset-apply.test.js: a document whose getElementById
// answers every id with a stub is installed before dom.js is imported, so DOM
// holds the same stubs the test can read. localStorage is a Map, FileReader
// hands its text back synchronously, and setInterval is a no-op so bootPersist
// can install its fallback tick without keeping the test process alive.
// _confirmScriptImport is replaced per-test: the defect is in what the gate
// flags and what the decline strips, not in the modal's markup.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl() {
  return {
    value: '', textContent: '', checked: false, disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
    querySelectorAll: () => [], appendChild() {}, remove() {},
  };
}
globalThis.document = {
  _els: new Map(),
  getElementById(id) {
    if (!this._els.has(id)) this._els.set(id, makeEl());
    return this._els.get(id);
  },
  createElement: () => makeEl(),
  querySelector: () => null,          // bootPersist looks for .controls-panel
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {} },
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = () => 0;
// bootPersist installs a 1 s fallback tick; a real one would hold the process
// open for the whole run. The restore step under test is synchronous.
globalThis.setInterval = () => 0;

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};

// A preset file, as FileReader hands it to importSettings.
class FakeFileReader {
  readAsText(file) { this.onload?.({ target: { result: file._text } }); }
}
globalThis.FileReader = FakeFileReader;
const asFile = obj => ({ _text: JSON.stringify(obj) });

const CP_DEFAULT = 'orbit(p.radius, p.rotSpeed, p.height);';
const USER_SCRIPT = 'ctx.cam.y = 4 + sin(time)*2;   // three hours of tuning';
const PAYLOAD = "globalThis.__PWNED = 'keyframe code ran';";

let PresetMixin;
before(async () => { ({ PresetMixin } = await import('../src/ui/presets.js')); });

function makeUi() {
  const calls = [];
  // Complete enough that captureState() runs to the end. It matters: _persistNow
  // swallows every throw, so a captureState that dies leaves the PREVIOUS
  // snapshot in storage — and an autosave assertion then passes for exactly the
  // wrong reason. The "an autosave really does reach storage" control below is
  // what keeps that from going unnoticed again.
  const render = {
    vizMode: 'surface', currentShape: 'sphere',
    currentMaterial: 'matte', currentParticleStyle: 'squares',
    grid: { visible: true }, uMathMode: 0,
    U: { uMode: { value: 0 } },
    gpuMat: { vertexShader: 'BUILTIN_VS', fragmentShader: 'BUILTIN_FS' },
    camera: { position: { x: 0, y: 0, z: 7 }, fov: 60 },
    orbit: { target: { x: 0, y: 0, z: 0 } },
    bloomPass: { strength: 0.6, radius: 0.4, threshold: 0.85 },
    setParticleStyle() {}, setShape() {}, setColorSchemeAnimated() {},
    setVizModeGPU() {}, setSurfaceMaterial() {}, setGPUModeAnimated() {},
    triggerMorphTransition(onFlat) { onFlat?.(); },
    tweenCameraTo(target, opts = {}) { opts.onDone?.(); },
  };
  const camera = {
    autoRot: false, cpActive: false, cpSource: null, camPhysics: 'smooth',
    cpParams: {}, cpKeyframes: [], cpSelectedKf: null,
    cb: {
      onAutoRotChanged() {},
      // The real callback writes the editor textarea; that write is the whole
      // question in defect 1, so it is recorded AND performed.
      onSetCode(code) {
        calls.push(['onSetCode', code]);
        document.getElementById('ce-code').value = code;
      },
      onParamsChanged() {},
    },
    setCamPhysics() {},
    loadScript(code) { this.cpActive = true; this.cpSource = code; calls.push(['loadScript', code]); },
    buildTimeline() { calls.push(['buildTimeline']); },
    getDefaultCode() { return CP_DEFAULT; },
  };
  const mathViz = {
    _mode: 'surface', _volumeKey: null, _collId: 'trig', _formulaKey: 'sine', active: false,
    deactivate() { this.active = false; }, setFormula() {}, setMode() {}, setVolumeFormula() {},
  };
  const shaderEditor = {
    _tab: 'frag', _vert: 'default vert', _frag: 'default frag',
    customVS: null, customFS: null,
    compileAndApply() {}, revertToBuiltIn() {}, reset() {},
  };
  return Object.assign(Object.create(PresetMixin), {
    calls, render, camera, mathViz, shaderEditor,
    audio: { colorIdx: 16, bassSens: 1.2, trebleSens: 1, amp: 0.7, waveInt: 1 },
    _clip: null,
    syncVizModeUI() {}, syncDeformUI() {},
    toasts: [],
    _showToast(msg, isErr) { this.toasts.push([msg, !!isErr]); },
    called(name) { return this.calls.filter(c => c[0] === name); },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('bootPersist — a reload must not eat the camera script', () => {
  let ui;
  beforeEach(() => {
    store.clear();
    ui = makeUi();
    // What the app looks like at boot: bindCameraParams has already seeded the
    // editor with the default template, before bootPersist runs (main.js:104
    // bindAll, then main.js:121 bootPersist).
    document.getElementById('ce-code').value = CP_DEFAULT;
  });

  const snapshotWith = code => JSON.stringify({
    _version: 2,
    camScript: { active: true, code, params: { radius: 9 }, keyframes: [{ t: 0.25, code: 'p.radius = 9;' }] },
  });

  test('the stored script comes back into the editor', () => {
    store.set('vimathic_persisted_state', snapshotWith(USER_SCRIPT));
    ui.bootPersist();

    assert.deepEqual(ui.called('onSetCode')[0], ['onSetCode', USER_SCRIPT],
      'the persisted source never reached the editor — this is the data loss');
    assert.equal(document.getElementById('ce-code').value, USER_SCRIPT);
  });

  test('the next autosave writes the script back, not a blank', () => {
    store.set('vimathic_persisted_state', snapshotWith(USER_SCRIPT));
    ui.bootPersist();
    // The 1 s fingerprint tick always schedules on its first run, so this is
    // what lands ~2.5 s into an untouched tab.
    ui._persistNow();

    const stored = JSON.parse(store.get('vimathic_persisted_state'));
    assert.equal(stored.camScript.code, USER_SCRIPT,
      'the autosave overwrote the stored script with a blank');
  });

  test('restoring does not start the script by itself', () => {
    store.set('vimathic_persisted_state', snapshotWith(USER_SCRIPT));
    ui.bootPersist();

    assert.equal(ui.called('loadScript').length, 0,
      'a restored script must not auto-execute — cs.active is forced false');
    assert.equal(ui.camera.cpActive, false);
  });

  test('restoring never prompts', () => {
    // The other half of the boot contract, and the premise the fix rests on:
    // own state needs no consent because it is not foreign JSON. A boot that
    // started asking would be a different product decision, not a bug fix.
    const asked = [];
    ui._confirmScriptImport = (code, onDecide) => { asked.push(code); onDecide(true); };
    store.set('vimathic_persisted_state', snapshotWith(USER_SCRIPT));
    ui.bootPersist();

    assert.deepEqual(asked, []);
  });

  test('keyframe code survives the reload too', () => {
    store.set('vimathic_persisted_state', snapshotWith(USER_SCRIPT));
    ui.bootPersist();

    assert.deepEqual(ui.camera.cpKeyframes, [{ t: 0.25, code: 'p.radius = 9;' }]);
  });

  // Controls — these pass on both sides of the fix.
  test('an autosave really does reach storage', () => {
    // Sensitivity guard for the test above, not a claim about the product.
    // _persistNow swallows exceptions; if captureState throws under these
    // fakes, storage keeps whatever was there and "the script came back"
    // reads as a pass. This asserts a change the fixture did NOT start with.
    store.set('vimathic_persisted_state', snapshotWith(USER_SCRIPT));
    ui.bootPersist();
    ui.render.grid.visible = false;
    ui._persistNow();

    assert.equal(JSON.parse(store.get('vimathic_persisted_state')).gridVisible, false,
      'captureState never completed — every autosave assertion here is blind');
  });

  test('a snapshot with no script still boots', () => {
    store.set('vimathic_persisted_state', JSON.stringify({ _version: 2, gridVisible: false }));
    ui.bootPersist();
    assert.equal(ui.called('onSetCode').length, 0);
    assert.equal(ui.render.grid.visible, false);
  });

  test('a corrupt snapshot is dropped, not thrown', () => {
    store.set('vimathic_persisted_state', '{not json');
    ui.bootPersist();
    assert.equal(store.has('vimathic_persisted_state'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('import gate — keyframe code is code', () => {
  let ui, shown;
  beforeEach(() => {
    store.clear();
    ui = makeUi();
    shown = [];
    document.getElementById('ce-code').value = CP_DEFAULT;
  });

  // Replaces the modal: records the preview it would show, answers `allow`.
  const answering = (u, allow) => {
    u._confirmScriptImport = (code, onDecide) => { shown.push(code); onDecide(allow); };
  };

  const withKeyframePayload = (mainCode = '') => ({
    _version: 2,
    camScript: {
      active: true, code: mainCode, params: { radius: 9 },
      keyframes: [{ t: 0, code: PAYLOAD }],
    },
  });

  test('a payload hidden in a keyframe raises the modal, and declining leaves nothing', () => {
    answering(ui, false);
    ui.importSettings(asFile(withKeyframePayload()));

    assert.equal(shown.length, 1,
      'a preset whose only JS is in a keyframe loaded with no gate at all');
    // The end-to-end shape of the worst branch: no main script anywhere, so a
    // fix that only clears keyframes when cs.code is also set still ships the
    // payload. That half-fix passes every other test in this file.
    assert.deepEqual(ui.camera.cpKeyframes, [],
      'DISCARD on a keyframe-only preset still installed the payload');
  });

  test('a payload in the SECOND keyframe raises the modal too', () => {
    answering(ui, false);
    ui.importSettings(asFile({
      _version: 2,
      camScript: {
        active: false, code: '', params: {},
        keyframes: [{ t: 0, code: '' }, { t: 0.5, code: PAYLOAD }],
      },
    }));

    assert.equal(shown.length, 1, 'a gate that inspects only keyframes[0] is the same defect one index over');
    assert.ok(shown[0].includes(PAYLOAD));
  });

  test('the preview says how many scripts there are, above the scroll fold', () => {
    answering(ui, true);
    ui.importSettings(asFile(withKeyframePayload(USER_SCRIPT)));

    // The <pre> scrolls at 280px, so a padded main script can push a keyframe
    // body out of sight. The count is the one line that cannot be scrolled off.
    assert.match(shown[0].split('\n')[0], /^\/\/ this preset carries 2 scripts/);
  });

  test('the preview shows the keyframe code the user is consenting to', () => {
    answering(ui, true);
    ui.importSettings(asFile(withKeyframePayload()));

    assert.ok(shown[0].includes(PAYLOAD),
      'the modal asked about code it did not show');
  });

  test('DISCARD CODE discards the keyframe code as well', () => {
    answering(ui, false);
    ui.importSettings(asFile(withKeyframePayload(CP_DEFAULT)));

    const left = ui.camera.cpKeyframes.map(k => k.code).join('');
    assert.equal(left.includes(PAYLOAD), false,
      'the user pressed DISCARD CODE and the keyframe payload was installed anyway');
    assert.deepEqual(ui.toasts.at(-1), ['✔ State loaded (script discarded)', false]);
    // DISCARD CODE is about code. Everything else the preset carries is a
    // setting the user did accept — a decline that also wipes the camera
    // parameters is a different button.
    assert.equal(ui.camera.cpParams.radius, 9,
      'declining the script threw away the non-code half of camScript too');
  });

  test('DISCARD CODE still drops the main script', () => {
    answering(ui, false);
    ui.importSettings(asFile(withKeyframePayload(USER_SCRIPT)));

    assert.equal(ui.called('loadScript').length, 0);
    assert.equal(document.getElementById('ce-code').value, CP_DEFAULT,
      'the declined script was written into the editor');
  });

  test('KEEP CODE keeps both halves, and neither runs by itself', () => {
    answering(ui, true);
    ui.importSettings(asFile(withKeyframePayload(USER_SCRIPT)));

    assert.equal(document.getElementById('ce-code').value, USER_SCRIPT);
    assert.deepEqual(ui.camera.cpKeyframes, [{ t: 0, code: PAYLOAD }]);
    assert.equal(ui.called('loadScript').length, 0,
      'imported state must never auto-run, kept or not');
    assert.deepEqual(ui.toasts.at(-1), ['✔ State loaded (script kept, not auto-running)', false]);
  });

  // Controls — these pass on both sides of the fix.
  test('a preset with no script at all raises no modal', () => {
    answering(ui, false);
    ui.importSettings(asFile({ _version: 2, gridVisible: false }));

    assert.equal(shown.length, 0, 'the gate fired on a preset carrying no code');
    assert.deepEqual(ui.toasts.at(-1), ['✔ State loaded', false]);
  });

  test('empty keyframe code is not a script', () => {
    answering(ui, false);
    ui.importSettings(asFile({
      _version: 2, camScript: { active: false, code: '', params: {}, keyframes: [{ t: 0.5, code: '   ' }] },
    }));

    assert.equal(shown.length, 0,
      'whitespace in a keyframe is not code and must not raise the modal');
  });

  test('a main-script-only preset still gates as it always did', () => {
    answering(ui, false);
    ui.importSettings(asFile({
      _version: 2, camScript: { active: true, code: USER_SCRIPT, params: {}, keyframes: [] },
    }));

    assert.equal(shown.length, 1);
    assert.ok(shown[0].includes(USER_SCRIPT));
    assert.equal(document.getElementById('ce-code').value, CP_DEFAULT);
  });

  test('a camScript with no keyframes field at all still gates on its main code', () => {
    // A hand-written camScript is a valid preset (FIX(#18, r3)), so the gate's
    // Array.isArray guard is load-bearing: without it the loop throws out of
    // reader.onload — no modal, no toast, nothing — and on the boot path the
    // same throw takes the user's whole snapshot with it.
    answering(ui, false);
    ui.importSettings(asFile({ _version: 2, camScript: { active: true, code: USER_SCRIPT, params: {} } }));

    assert.equal(shown.length, 1);
    assert.deepEqual(ui.toasts.at(-1), ['✔ State loaded (script discarded)', false]);
  });

  test('a camScript that is not an object, and a keyframe that is null', () => {
    // sanitizeKeyframes defends against both shapes, so both occur.
    answering(ui, false);
    ui.importSettings(asFile({ _version: 2, camScript: 'not an object' }));
    assert.equal(shown.length, 0);
    assert.deepEqual(ui.toasts.at(-1), ['✔ State loaded', false]);

    ui.importSettings(asFile({
      _version: 2,
      camScript: { active: false, code: '', params: {}, keyframes: [null, { t: 0.5, code: PAYLOAD }] },
    }));
    assert.equal(shown.length, 1, 'a null keyframe ahead of the payload swallowed the gate');
  });

  test('a keyframe whose t is unusable is still shown, labelled as such', () => {
    // sanitizeKeyframes drops it, so this over-warns — the safe direction, and
    // the label is what tells the user why it looks odd.
    answering(ui, false);
    ui.importSettings(asFile({
      _version: 2,
      camScript: { active: false, code: '', params: {}, keyframes: [{ t: '0.5', code: PAYLOAD }] },
    }));

    assert.equal(shown.length, 1);
    assert.ok(shown[0].includes('// keyframe @ t=?'));
  });

  test('malformed JSON is refused before the gate is reached', () => {
    answering(ui, true);
    ui.importSettings({ _text: '{not json' });

    assert.equal(shown.length, 0);
    assert.deepEqual(ui.toasts.at(-1), ['⚠ Invalid state file', true]);
  });
});
