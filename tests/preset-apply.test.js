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
    // The no-helper fallback in _applyStateFields drives the material dropdown
    // by dispatching a change event; without this the fallback throws and the
    // apply is refused for a reason that has nothing to do with the test.
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
    currentMaterial: 'matte',           // what setSurfaceMaterial* keeps updated
    currentParticleStyle: 'squares',    // and what setParticleStyle keeps updated
    setParticleStyle: s => calls.push(['setParticleStyle', s]),
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
    // Recorded, not just swallowed: this is where the material half of an apply
    // ends up (controls.js owns the WIRE/PTS rule), so the material a snapshot
    // actually pushed is only observable through this argument.
    syncVizModeUI(mode, mat, pts) { calls.push(['syncVizModeUI', mode, mat, pts]); },
    syncDeformUI() {}, _showToast() {},
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

describe('applyState — the PTS particle style rides with the snapshot', () => {
  // The style is a look parameter like the material, so it has to survive a
  // preset the same way. It needs no mode rule of its own: outside POINTS it
  // simply is not drawn, and the engine files the choice away until it is.
  let ui;
  beforeEach(() => { ui = makeUi(); });

  test('a snapshot carrying a style hands it to the viz-mode adapter', () => {
    assert.equal(ui.applyState({
      _version: 2, vizMode: 'points', material: 'matte', particleStyle: 'smoke',
    }), true);
    assert.deepEqual(ui.called('syncVizModeUI')[0],
      ['syncVizModeUI', 'points', 'matte', 'smoke']);
  });

  test('a snapshot from before the field existed reads as squares', () => {
    // Every preset saved by an earlier build. Silently leaving the live style
    // in place would make old presets load differently depending on what the
    // user happened to be looking at.
    assert.equal(ui.applyState({ _version: 2, vizMode: 'points' }), true);
    assert.equal(ui.called('syncVizModeUI')[0][3], 'squares');
  });

  test('without the adapter the style goes straight to the engine', () => {
    // Stripped build: no syncVizModeUI. The material half has a dropdown-event
    // fallback; the style has none, so it must be pushed directly or a preset
    // would silently lose it.
    delete ui.syncVizModeUI;
    assert.equal(ui.applyState({
      _version: 2, vizMode: 'points', particleStyle: 'dots',
    }), true);
    assert.deepEqual(ui.called('setParticleStyle')[0], ['setParticleStyle', 'dots']);
  });

  // The capture half (`particleStyle: r.currentParticleStyle ?? 'squares'`) is
  // not pinned here: captureState reads the camera, the shader editor and the
  // math visualizer too, and a fake complete enough for it would be a second
  // harness testing one property assignment. The save → change → load round
  // trip in tests/e2e/particle-styles.spec.js covers it against the real thing.
});

describe('applyState — AUTO COLOUR / AUTO MATERIAL outrank a clip step', () => {
  // The other side of tests/auto-cycle.test.js: ClipPlayer decides WHO owns the
  // parameter, this decides what the apply then does about it. A clip step that
  // rewrote the palette every few seconds is what made an unattended cycle look
  // broken; preserveColor / preserveMaterial are how it stops — and they must
  // stop nothing else.
  let ui;
  const SNAP = {
    _version: 2,
    colorIdx: 5, material: 'mirror', vizMode: 'surface',
    // bassSens is the sibling param that rides along: it writes to audio only,
    // where amp / waveInt / bloom would need render.U and render.bloomPass,
    // which this fake deliberately does not carry.
    bassSens: 1.9, shape: 'torus',
  };

  beforeEach(() => { ui = makeUi(); });

  test('without the flags a step applies both, as before', () => {
    assert.equal(ui.applyState(SNAP), true);
    assert.deepEqual(ui.called('setColorSchemeAnimated')[0], ['setColorSchemeAnimated', 5]);
    assert.deepEqual(ui.called('syncVizModeUI')[0], ['syncVizModeUI', 'surface', 'mirror', 'squares']);
  });

  test('preserveColor leaves the live palette — and only the palette', () => {
    ui.audio.colorIdx = 28;
    assert.equal(ui.applyState(SNAP, { preserveColor: true }), true);

    assert.equal(ui.called('setColorSchemeAnimated').length, 0, 'the crossfade must not run');
    assert.equal(ui.audio.colorIdx, 28, 'the engine value must not move');
    // Everything else in the same snapshot still lands.
    assert.equal(ui.audio.bassSens, 1.9);
    assert.deepEqual(ui.called('setShape')[0], ['setShape', 'torus']);
    assert.deepEqual(ui.called('syncVizModeUI')[0], ['syncVizModeUI', 'surface', 'mirror', 'squares']);
  });

  test('preserveMaterial hands the live finish through, not the snapshot\'s', () => {
    ui.render.currentMaterial = 'velvet';
    assert.equal(ui.applyState(SNAP, { preserveMaterial: true }), true);
    assert.deepEqual(ui.called('syncVizModeUI')[0], ['syncVizModeUI', 'surface', 'velvet', 'squares']);
    // The colour half is independent: this snapshot's palette still applies.
    assert.deepEqual(ui.called('setColorSchemeAnimated')[0], ['setColorSchemeAnimated', 5]);
  });

  test('both flags together still apply the rest of the snapshot', () => {
    ui.render.currentMaterial = 'glass';
    ui.audio.colorIdx = 12;
    assert.equal(ui.applyState(SNAP, { preserveColor: true, preserveMaterial: true }), true);
    assert.equal(ui.called('setColorSchemeAnimated').length, 0);
    assert.equal(ui.audio.colorIdx, 12);
    assert.deepEqual(ui.called('syncVizModeUI')[0], ['syncVizModeUI', 'surface', 'glass', 'squares']);
    assert.equal(ui.audio.bassSens, 1.9);
    assert.equal(ui.render.grid.visible, true);
  });

  test('the viz-mode rule still outranks a preserved material', () => {
    // WIRE cannot draw reflections at all — preserving the finish means
    // "carry it", not "show it here". controls.js enforces that; what this
    // pins is that the mode reaching it is the snapshot's, unchanged.
    ui.render.currentMaterial = 'mirror';
    assert.equal(ui.applyState({ ...SNAP, vizMode: 'wireframe' }, { preserveMaterial: true }), true);
    assert.deepEqual(ui.called('syncVizModeUI')[0], ['syncVizModeUI', 'wireframe', 'mirror', 'squares']);
    assert.deepEqual(ui.called('setVizModeGPU')[0], ['setVizModeGPU', 'wireframe']);
  });

  test('a snapshot with no material at all is unaffected by preserveColor', () => {
    assert.equal(ui.applyState({ _version: 2, colorIdx: 9 }, { preserveColor: true }), true);
    assert.equal(ui.called('setColorSchemeAnimated').length, 0);
    // vizMode absent → the engine's own mode is what the material rule keys off.
    assert.deepEqual(ui.called('syncVizModeUI')[0], ['syncVizModeUI', 'surface', 'matte', 'squares']);
  });
});
