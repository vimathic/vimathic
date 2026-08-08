// tests/preset-apply.test.js
//
// Contract tests for PresetMixin._applyStateFields — what a snapshot restores,
// and just as importantly what it must UNDO.
//
// Run:
//   node --test tests/preset-apply.test.js
//
// ── The three defects pinned here ─────────────────────────────────────────────
// 1. GPU shader vs CPU deform. MathVisualizer.deactivate() deliberately leaves
//    _mode/_volumeKey alone, so a snapshot taken after switching from
//    DEFORM: VOLUME to a GPU shader carries deformMode:'volume' next to a
//    numeric gpuSelVal. Applying it re-armed setVolumeFormula, which sets
//    uMathMode = 1, and the GPU displacement is gated on uMathMode == 0 — so
//    the restored shader drew nothing and the mesh showed the CPU deformation
//    the user had already switched away from. Reproduced by a plain page
//    reload, not just by preset loading: bootPersist applies the same snapshot.
//
// 2. A snapshot with shader.hasCustom === false could not undo a live custom
//    shader — the block had no else. One shader-carrying step in a clip locked
//    its program in for every later step, and no preset in the list could get
//    the built-in look back.
//
// 3. Clip camera mode "Snap (instant, old)" dropped each preset's Camera
//    Programmer script. postTweenCameraActions was drained by tweenCameraTo's
//    onDone, which with duration <= 0 fires synchronously — before the
//    camera-programmer block downstream had pushed loadScript into the queue.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// dom.js resolves its element table at import, so a document whose
// getElementById answers every id with a stub is installed BEFORE the import;
// DOM then holds stubs and the real code writes into them. Everything else is a
// fake with recording methods, and the morph transition runs its onFlat
// callback synchronously instead of after 400 ms.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl() {
  return {
    value: '', textContent: '', checked: false, disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
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
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
globalThis.requestAnimationFrame = () => 0;

let PresetMixin;
before(async () => { ({ PresetMixin } = await import('../src/ui/presets.js')); });

const BUILTIN_VS = 'BUILTIN_VS';
const BUILTIN_FS = 'BUILTIN_FS';

function makeUi() {
  const calls = [];
  const render = {
    vizMode: 'surface',
    grid: { visible: true },
    uMathMode: 0,                       // stand-in for U.uMathMode.value
    gpuMat: { vertexShader: BUILTIN_VS, fragmentShader: BUILTIN_FS },
    setShape: s => calls.push(['setShape', s]),
    // applyParam writes colorIdx through this; without it applyState catches a
    // TypeError, returns false, and a test asserting "nothing changed" passes
    // for the wrong reason. Every test below asserts applyState() === true.
    setColorSchemeAnimated: i => calls.push(['setColorSchemeAnimated', i]),
    setVizModeGPU: m => calls.push(['setVizModeGPU', m]),
    setSurfaceMaterial: m => calls.push(['setSurfaceMaterial', m]),
    setGPUModeAnimated(n) { calls.push(['setGPUModeAnimated', n]); this.uMathMode = 0; },
    triggerMorphTransition(onFlat) { calls.push(['morph']); onFlat?.(); },
    tweenCameraTo(target, opts = {}) {
      calls.push(['tweenCameraTo', opts.duration]);
      // Same contract as the real one: duration <= 0 commits synchronously.
      if ((opts.duration ?? 800) <= 0) opts.onDone?.();
      else this._pendingOnDone = opts.onDone;
    },
    finishTween() { const f = this._pendingOnDone; this._pendingOnDone = null; f?.(); },
  };
  const camera = {
    autoRot: false, cpActive: false, cpParams: {}, cpKeyframes: [], cpSelectedKf: null,
    cb: { onAutoRotChanged() {}, onSetCode() {} },
    setCamPhysics: p => calls.push(['setCamPhysics', p]),
    loadScript(code) { this.cpActive = true; calls.push(['loadScript', code]); },
    buildTimeline() {},
  };
  const mathViz = {
    _mode: 'surface', _volumeKey: null, active: false,
    deactivate() { this.active = false; render.uMathMode = 0; calls.push(['deactivate']); },
    setFormula(c, k) { this.active = true; calls.push(['setFormula', `${c}:${k}`]); },
    setMode(m) { this._mode = m; calls.push(['setMode', m]); },
    setVolumeFormula(k) {
      this.active = true; this._mode = 'volume'; this._volumeKey = k;
      render.uMathMode = 1;                   // math-visualizer.js does exactly this
      calls.push(['setVolumeFormula', k]);
    },
  };
  const shaderEditor = {
    _tab: 'frag', _vert: 'default vert', _frag: 'default frag',
    customVS: null, customFS: null,
    compileAndApply() {
      this.customVS = `VS{${this._vert}}`;
      this.customFS = `FS{${this._frag}}`;
      render.gpuMat.vertexShader   = this.customVS;
      render.gpuMat.fragmentShader = this.customFS;
      calls.push(['compileAndApply']);
    },
    revertToBuiltIn() {
      this.customVS = null; this.customFS = null;
      render.gpuMat.vertexShader   = BUILTIN_VS;
      render.gpuMat.fragmentShader = BUILTIN_FS;
      calls.push(['revertToBuiltIn']);
    },
    reset() { this.revertToBuiltIn(); this._vert = 'default vert'; this._frag = 'default frag'; calls.push(['reset']); },
  };

  return Object.assign(Object.create(PresetMixin), {
    calls, render, camera, mathViz, shaderEditor,
    audio: { colorIdx: 16, bassSens: 1.2, trebleSens: 1, amp: 0.7, waveInt: 1 },
    _clip: null,
    syncVizModeUI() {}, syncDeformUI() {}, _showToast() {},
    called(name) { return this.calls.filter(c => c[0] === name); },
  });
}

describe('applyState — a GPU shader snapshot must not be re-armed as a CPU deformation', () => {
  let ui;
  beforeEach(() => { ui = makeUi(); });

  test('deformMode:volume alongside a numeric gpuSelVal is ignored', () => {
    // What captureState() records after: click ⬡ VOLUME, then pick GPU shader 3.
    assert.equal(ui.applyState({
      _version: 2, gpuSelVal: '3', deformMode: 'volume', volumeKey: 'twist',
    }), true);

    assert.equal(ui.called('setVolumeFormula').length, 0,
      'the CPU volume deformation was re-armed over a GPU shader');
    assert.equal(ui.render.uMathMode, 0,
      'uMathMode must stay 0 or the GPU shader draws no displacement');
    assert.deepEqual(ui.called('setGPUModeAnimated')[0], ['setGPUModeAnimated', 3]);
  });

  test('the CPU path still honours deformMode and volumeKey', () => {
    // Anti-overcorrection guard: an 'm:' formula owns the deform mode.
    assert.equal(ui.applyState({
      _version: 2, gpuSelVal: 'm:fractals:henon', deformMode: 'volume', volumeKey: 'twist',
    }), true);
    assert.deepEqual(ui.called('setVolumeFormula')[0], ['setVolumeFormula', 'twist']);
    assert.equal(ui.render.uMathMode, 1);
  });

  test('a snapshot with no gpuSelVal at all still restores its deform mode', () => {
    assert.equal(ui.applyState({ _version: 2, deformMode: 'collapse' }), true);
    assert.deepEqual(ui.called('setMode')[0], ['setMode', 'collapse']);
  });
});

describe('applyState — a preset without a custom shader reverts a live one', () => {
  let ui;
  beforeEach(() => { ui = makeUi(); });

  const CLEAN = { _version: 2, shader: { hasCustom: false, vert: 'default vert', frag: 'default frag' } };
  const DIRTY = { _version: 2, shader: { hasCustom: true,  vert: 'v custom',     frag: 'c = vec3(1.,0.,0.);' } };

  test('a clean snapshot puts the built-in program back', () => {
    assert.equal(ui.applyState(DIRTY), true);
    assert.equal(ui.render.gpuMat.fragmentShader, 'FS{c = vec3(1.,0.,0.);}');

    assert.equal(ui.applyState(CLEAN), true);
    assert.equal(ui.render.gpuMat.vertexShader,   BUILTIN_VS);
    assert.equal(ui.render.gpuMat.fragmentShader, BUILTIN_FS);
    assert.equal(ui.shaderEditor.customVS, null);
  });

  test('a dirty snapshot still installs its shader — the fix is not over-applied', () => {
    assert.equal(ui.applyState(CLEAN), true);
    assert.equal(ui.applyState(DIRTY), true);
    assert.equal(ui.render.gpuMat.fragmentShader, 'FS{c = vec3(1.,0.,0.);}');
  });

  test('a clean apply over a clean state is a no-op, not a reset', () => {
    assert.equal(ui.applyState(CLEAN), true);
    assert.equal(ui.called('revertToBuiltIn').length, 0);
    assert.equal(ui.called('reset').length, 0);
  });

  test('applying a preset never touches the editor text — not even to revert', () => {
    // The user's source is theirs, including keystrokes they have not applied.
    // A clip step arrives every few seconds, so a branch that rewrote _vert /
    // _frag / #se-code would quietly destroy work in progress. Every preset
    // this build saves carries a shader record, so this covers the common path.
    const typed = 'c = vec3(0.2, 0.9, 0.4); // half-finished';
    ui.shaderEditor._frag = typed;
    document.getElementById('se-code').value = typed;

    assert.equal(ui.applyState(CLEAN), true);
    assert.equal(ui.shaderEditor._frag, typed);
    assert.equal(document.getElementById('se-code').value, typed);

    // Same with a live custom program: the program reverts, the text survives.
    ui.applyState(DIRTY);
    ui.shaderEditor._frag = typed;
    document.getElementById('se-code').value = typed;
    assert.equal(ui.applyState(CLEAN), true);
    assert.equal(ui.render.gpuMat.fragmentShader, BUILTIN_FS, 'the program must revert');
    assert.equal(ui.shaderEditor._frag, typed, 'the editor text must not');
    assert.equal(document.getElementById('se-code').value, typed);
  });

  test('a legacy snapshot with no shader field leaves a live shader alone', () => {
    assert.equal(ui.applyState(DIRTY), true);
    assert.equal(ui.applyState({ _version: 2, colorIdx: 5 }), true);
    assert.equal(ui.render.gpuMat.fragmentShader, 'FS{c = vec3(1.,0.,0.);}');
  });

  test('a clip cycling dirty → clean → clean ends on the built-in program', () => {
    for (const s of [DIRTY, CLEAN, CLEAN]) assert.equal(ui.applyState(s, { preserveCamera: true }), true);
    assert.equal(ui.render.gpuMat.fragmentShader, BUILTIN_FS);
  });
});

describe('applyState — the camera-programmer script survives every clip camera mode', () => {
  let ui;
  const SNAP = {
    _version: 2,
    camera: { x: 3, y: 4, z: 5, tx: 0, ty: 0, tz: 0, fov: 50, physics: 'dark_matter', autoRot: true },
    camScript: { active: true, code: 'ctx.cam.y = 99;', params: {}, keyframes: [] },
  };

  beforeEach(() => { ui = makeUi(); });

  test('"Snap (instant, old)" — duration 0 — loads the script', () => {
    assert.equal(ui.applyState(SNAP, { cameraTransitionMs: 0, preserveCamera: false }), true);
    assert.equal(ui.camera.cpActive, true, 'the preset\'s camera script was dropped');
    assert.deepEqual(ui.called('loadScript')[0], ['loadScript', 'ctx.cam.y = 99;']);
  });

  test('the smooth path loads it too, and only after the tween', () => {
    assert.equal(ui.applyState(SNAP, { cameraTransitionMs: 800, preserveCamera: false }), true);
    assert.equal(ui.camera.cpActive, false, 'the script must wait for the tween');
    ui.render.finishTween();
    assert.equal(ui.camera.cpActive, true);
  });

  test('queue order stays physics → auto-rotate → script', () => {
    assert.equal(ui.applyState(SNAP, { cameraTransitionMs: 0, preserveCamera: false }), true);
    const order = ui.calls.map(c => c[0]).filter(n => n === 'setCamPhysics' || n === 'loadScript');
    assert.deepEqual(order, ['setCamPhysics', 'loadScript']);
  });

  test('a clip step that does not own the camera still skips the camera block', () => {
    assert.equal(ui.applyState(SNAP, { cameraTransitionMs: 0, preserveCamera: true }), true);
    assert.equal(ui.called('tweenCameraTo').length, 0);
    assert.equal(ui.camera.cpActive, false);
  });

  test('a mid-tween camera claim still cancels the queued auto-rotate wish', () => {
    // The ownership re-check inside onDone must survive the reordering.
    assert.equal(ui.applyState(SNAP, { cameraTransitionMs: 800, preserveCamera: false }), true);
    ui._clip = { camOverride: true };
    ui.render.finishTween();
    assert.equal(ui.called('loadScript').length, 0);
    assert.equal(ui.called('setCamPhysics').length, 0);
  });
});
