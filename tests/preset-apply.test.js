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

import { test, describe, before, beforeEach, after } from 'node:test';
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
    // Runs the work immediately by default (most tests only care that it was
    // queued at all). deferMorph models the real 400 ms gap between queueing and
    // the flat frame, which is where a superseding selection lands.
    deferMorph: false,
    _queuedFlat: [],
    triggerMorphTransition(onFlat) {
      calls.push(['morph']);
      if (!onFlat) return;
      if (this.deferMorph) this._queuedFlat.push(onFlat); else onFlat();
    },
    flatFrame() { const q = this._queuedFlat; this._queuedFlat = []; q.forEach(fn => fn()); },
    tweenCameraTo(target, opts = {}) {
      calls.push(['tweenCameraTo', opts.duration, target]);
      // Same contract as the real one: duration <= 0 commits synchronously,
      // and a second tween pre-empts the first — transitions.js cancels the
      // slot, which runs onCancel and never onDone, so the outgoing tween's
      // onDone is dropped here exactly as the engine drops it.
      if ((opts.duration ?? 800) <= 0) opts.onDone?.();
      else this._pendingOnDone = opts.onDone;
    },
    finishTween() { const f = this._pendingOnDone; this._pendingOnDone = null; f?.(); },
  };
  const camera = {
    autoRot: false, cpActive: false, cpParams: {}, cpKeyframes: [], cpSelectedKf: null,
    cb: { onAutoRotChanged() {}, onSetCode() {}, onParamsChanged: () => calls.push(['paramsChanged']) },
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
      // FIX(r11): the real editor records the BODIES that compiled, and
      // captureState stores those rather than the assembled programs
      // (shaders.js onSuccess). A stub without them makes "is this shader
      // already live?" unanswerable, and the draft buffer indistinguishable
      // from the applied source.
      this._appliedVert = this._vert;
      this._appliedFrag = this._frag;
      render.gpuMat.vertexShader   = this.customVS;
      render.gpuMat.fragmentShader = this.customFS;
      calls.push(['compileAndApply']);
    },
    revertToBuiltIn() {
      this.customVS = null; this.customFS = null; this._appliedVert = null; this._appliedFrag = null;
      render.gpuMat.vertexShader   = BUILTIN_VS;
      render.gpuMat.fragmentShader = BUILTIN_FS;
      calls.push(['revertToBuiltIn']);
    },
    reset() { this.revertToBuiltIn(); this._vert = 'default vert'; this._frag = 'default frag'; this._appliedVert = null; this._appliedFrag = null; calls.push(['reset']); },
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

// ── The camera tween is a borrower, not a setting ─────────────────────────────
// _applyStateFields used to pause the physics loop by writing cam.autoRot =
// false for the tween's duration, without telling the button that reads the
// same flag. For the whole tween — with the default "Auto (40% of step)" that
// is around 30% of every clip step — the label said ON while the flag said
// OFF, so a click in that window did the opposite of what it promised: it
// switched rotation ON and claimed the camera away from the clip player
// instead of switching it off and handing it back. Restoring afterwards did
// not save it either, because the onDone re-check drops the whole queue once
// the user has taken the camera.
//
// The tween now holds the camera through a flag of its own (cam.tweenHold,
// which isScriptDriving() and main.js's physics branch both honour), and the
// user's setting is never touched.
describe('applyState — a camera tween must not touch the auto-rotate setting', () => {
  const CAM = { _version: 2, camera: { x: 3, y: 4, z: 5, tx: 0, ty: 0, tz: 0, fov: 50 } };
  let ui;
  beforeEach(() => { ui = makeUi(); });

  test('the setting the button shows is the setting that survives the tween', () => {
    ui.camera.autoRot = true;                       // the user switched it on

    assert.equal(ui.applyState(CAM, { cameraTransitionMs: 2000, preserveCamera: false }), true);
    assert.equal(ui.camera.autoRot, true,
      'the button still reads ON, so a click in this window must read ON too');
    assert.equal(ui.camera.tweenHold, true,
      'the tween needs the physics loop to stand down — through its own flag');

    ui.render.finishTween();
    assert.equal(ui.camera.tweenHold, false);
    assert.equal(ui.camera.autoRot, true);
  });

  test('the hold is released even when the user takes the camera mid-tween', () => {
    ui.camera.autoRot = true;
    assert.equal(ui.applyState(CAM, { cameraTransitionMs: 2000, preserveCamera: false }), true);

    ui._clip = { camOverride: true };               // AUTO-ROTATE pressed mid-step
    ui.render.finishTween();                        // onDone drops the queued wishes

    assert.equal(ui.camera.tweenHold, false,
      'a hold left standing would freeze the camera for the rest of the session');
  });

  // A real control: this passes before and after, and it is what stops the fix
  // from being "stop touching autoRot anywhere", which would silently drop the
  // wishes a snapshot is allowed to carry.
  test('control — a preset that carries an auto-rotate wish still applies it', () => {
    ui.camera.autoRot = true;
    const snap = { _version: 2, camera: { ...CAM.camera, autoRot: false } };

    assert.equal(ui.applyState(snap, { cameraTransitionMs: 2000, preserveCamera: false }), true);
    ui.render.finishTween();
    assert.equal(ui.camera.autoRot, false, 'the snapshot asked for OFF and gets it');
  });

  test('the instant path releases the hold too', () => {
    ui.camera.autoRot = true;
    assert.equal(ui.applyState(CAM, { cameraTransitionMs: 0, preserveCamera: false }), true);
    assert.equal(ui.camera.tweenHold, false, '"Snap (instant, old)" commits synchronously');
  });
});

// ── A camera block from JSON we didn't write ─────────────────────────────────
// Since hand-written presets became a supported input (#18), s.camera reaches
// the tween unread: every coordinate went into `pos`/`target` as it stood, so a
// block with a missing or stringly-typed coordinate interpolated to NaN and the
// tween's commit wrote that into camera.position and orbit.target — a dead
// viewport under a toast that read "✔ State loaded". A present but non-numeric
// fov is worse still: `target.fov ?? fromFov` does not catch it, so it reaches
// camera.fov and updateProjectionMatrix(), where ⟲ RESET CAMERA cannot undo it.
// The rule is sanitizeKeyframes' rule, three statements away in the same file:
// unusable entries are dropped rather than repaired.
describe('applyState — an unusable camera coordinate is dropped, not tweened to', () => {
  let ui;
  beforeEach(() => { ui = makeUi(); });
  const tweenTarget = () => ui.called('tweenCameraTo')[0][2];

  test('a camera block with nothing in it moves the camera nowhere', () => {
    assert.equal(ui.applyState({ _version: 2, camera: {} },
      { cameraTransitionMs: 800, preserveCamera: false }), true);

    const to = tweenTarget();
    assert.equal(to.pos, undefined,
      'undefined coordinates lerp to NaN and the commit writes them through');
    assert.equal(to.target, undefined);
    assert.equal(to.fov, undefined);
  });

  test('a stringly-typed block is refused the same way — fov included', () => {
    assert.equal(ui.applyState({
      _version: 2, camera: { x: 'far', y: 'up', z: 'back', tx: '0', ty: '0', tz: '0', fov: 'wide' },
    }, { cameraTransitionMs: 800, preserveCamera: false }), true);

    const to = tweenTarget();
    assert.equal(to.pos, undefined);
    assert.equal(to.target, undefined);
    assert.equal(to.fov, undefined,
      "'wide' is not nullish, so nothing downstream stops it reaching camera.fov");
  });

  test('a half-written block loses the half that is unusable, not the other', () => {
    // The easy hand-editing mistake: name two of the three axes.
    assert.equal(ui.applyState({
      _version: 2, camera: { x: 5, z: 8, tx: 1, ty: 2, tz: 3, fov: 50 },
    }, { cameraTransitionMs: 800, preserveCamera: false }), true);

    const to = tweenTarget();
    assert.equal(to.pos, undefined, 'y is missing, so the position is not a position');
    assert.deepEqual(to.target, { x: 1, y: 2, z: 3 }, 'the target is complete and survives');
    assert.equal(to.fov, 50);
  });

  test('an out-of-range fov is clamped, as the camera script commit clamps it', () => {
    assert.equal(ui.applyState({ _version: 2, camera: { fov: 99999 } },
      { cameraTransitionMs: 800, preserveCamera: false }), true);
    assert.equal(tweenTarget().fov, 160,
      'camera.js clamps a runaway fov for the same reason: the projection matrix');
  });

  test('control — a well-formed camera block reaches the tween untouched', () => {
    assert.equal(ui.applyState({
      _version: 2, camera: { x: 1, y: 2, z: 3, tx: 4, ty: 5, tz: 6, fov: 55 },
    }, { cameraTransitionMs: 800, preserveCamera: false }), true);

    const to = tweenTarget();
    assert.deepEqual(to.pos,    { x: 1, y: 2, z: 3 });
    assert.deepEqual(to.target, { x: 4, y: 5, z: 6 });
    assert.equal(to.fov, 55, 'an ordinary fov must not be rounded, clamped or dropped');
  });

  test('control — the rest of a junk camera block still applies', () => {
    // The drop is of the unusable FIELDS. physics and the auto-rotate wish are
    // not coordinates and carry no hazard, so a fix that skipped the whole
    // block would take away state the snapshot is entitled to restore.
    assert.equal(ui.applyState({
      _version: 2, camera: { x: 'far', physics: 'dark_matter', autoRot: true },
    }, { cameraTransitionMs: 800, preserveCamera: false }), true);
    ui.render.finishTween();

    assert.deepEqual(ui.called('setCamPhysics')[0], ['setCamPhysics', 'dark_matter']);
    assert.equal(ui.camera.autoRot, true);
  });
});

// ── A pre-empted tween is a tween that ended ─────────────────────────────────
// Everything a camera apply defers — the physics mode, the auto-rotate wish,
// the preset's Camera Programmer script — lives in tweenCameraTo's onDone, and
// so does the release of cam.tweenHold. A tween that is pre-empted by the next
// one never reaches that callback: TransitionManager.start cancels the slot and
// runs onCancel instead, and tweenCameraTo's onCancel only hands OrbitControls'
// damping back. Set the clip's camera transition to "Cinematic (3s)" against a
// hold shorter than that and every step pre-empts the one before it, so no
// step's physics, auto-rotate wish or script was ever applied and the hold
// stayed standing for the whole run — which main.js reads as "stand down" for
// both the physics loop and the programmer script.
describe('applyState — a camera apply hands back what it borrowed, even pre-empted', () => {
  const stepSnap = (n, script) => ({
    _version: 2,
    camera: { x: n, y: n, z: n, tx: 0, ty: 0, tz: 0, fov: 50, physics: 'dark_matter', autoRot: true },
    camScript: { active: true, code: script, params: {}, keyframes: [] },
  });
  let ui;
  beforeEach(() => { ui = makeUi(); });

  test('the queue of a step cut short by the next one still runs', () => {
    assert.equal(ui.applyState(stepSnap(1, 'ctx.cam.y = 1;'),
      { cameraTransitionMs: 3000, preserveCamera: false }), true);
    assert.equal(ui.called('setCamPhysics').length, 0, 'precondition: deferred, not run');

    // The next clip step arrives 2.6 s later — before the 3 s tween finished.
    assert.equal(ui.applyState(stepSnap(2, 'ctx.cam.y = 2;'),
      { cameraTransitionMs: 3000, preserveCamera: false }), true);

    assert.deepEqual(ui.called('setCamPhysics').map(c => c[1]), ['dark_matter'],
      'the pre-empted step\'s physics mode was dropped on the floor');
    assert.deepEqual(ui.called('loadScript').map(c => c[1]), ['ctx.cam.y = 1;'],
      'and so was its camera script — for every step of the clip');
  });

  test('the hold is handed back before the next tween takes it', () => {
    // cam.tweenHold gates main.js's physics branch and isScriptDriving(). The
    // release must happen on the handover, not only when a tween is lucky
    // enough to finish: with each step pre-empting the last, no tween ever is.
    let holdSeenAtHandover = null;
    ui.camera.setCamPhysics = () => { holdSeenAtHandover = ui.camera.tweenHold; };

    assert.equal(ui.applyState(stepSnap(1, 'a'), { cameraTransitionMs: 3000, preserveCamera: false }), true);
    assert.equal(ui.applyState(stepSnap(2, 'b'), { cameraTransitionMs: 3000, preserveCamera: false }), true);

    assert.equal(holdSeenAtHandover, false,
      'the pre-empted apply must release the hold before the replacement re-takes it');
    assert.equal(ui.camera.tweenHold, true, 'and the replacement tween holds it in turn');
    ui.render.finishTween();
    assert.equal(ui.camera.tweenHold, false);
  });

  test('control — an uninterrupted apply still defers its queue to the tween', () => {
    // The anti-overcorrection guard: "run the queue when a new apply arrives"
    // must not become "run the queue immediately", which would put the physics
    // loop and the script back on top of the tween the queue exists to protect.
    assert.equal(ui.applyState(stepSnap(1, 'ctx.cam.y = 1;'),
      { cameraTransitionMs: 3000, preserveCamera: false }), true);
    assert.equal(ui.called('setCamPhysics').length, 0);
    assert.equal(ui.called('loadScript').length, 0);
    ui.render.finishTween();
    assert.deepEqual(ui.called('loadScript').map(c => c[1]), ['ctx.cam.y = 1;']);
  });

  test('control — a camera taken mid-tween still cancels the pre-empted queue', () => {
    // The ownership re-check inside the settle callback has to hold on the
    // handover path too, or the moment the next apply arrives the clip would
    // switch the user's own rotation back off. Passes before and after: it is
    // what stops the fix from becoming "spend every queue unconditionally".
    assert.equal(ui.applyState(stepSnap(1, 'ctx.cam.y = 1;'),
      { cameraTransitionMs: 3000, preserveCamera: false }), true);
    ui._clip = { camOverride: true };                 // AUTO-ROTATE pressed mid-step

    // A preset clicked by hand carries no opts — an explicit request for ITS
    // camera — and pre-empts the clip step's tween. This one has no script of
    // its own, so any loadScript below could only be the abandoned step's.
    const byHand = { _version: 2, camera: { x: 9, y: 9, z: 9, tx: 0, ty: 0, tz: 0, fov: 50 } };
    assert.equal(ui.applyState(byHand), true);

    assert.equal(ui.called('loadScript').length, 0,
      'the user owns the camera now — the abandoned queue must stay unspent');
    ui.render.finishTween();
    assert.equal(ui.camera.tweenHold, false);
  });
});

// ── Regression on the fix itself (found by adversarial review of 49c69cd) ─────
// applyState queues the snapshot's formula for a flat frame up to 400 ms away.
// If a GPU shader takes the surface in that window — the operator picking one,
// or the next clip step — arming the formula sets uMathMode = 1 and the shader
// draws nothing at all. The first attempt at this rule was
// render.cancelPendingMorph(), called from the dropdown and the hotkeys but not
// from applyState, which is how the stale formula still reached the preset's own
// morph. Every queued callback now checks the live selection itself.
describe('applyState — a queued formula asks whether it is still the selection', () => {
  const SNAP = { _version: 2, gpuSelVal: 'm:fractals:henon' };
  let ui;
  beforeEach(() => { ui = makeUi(); ui.render.deferMorph = true; });

  test('a shader taken during the morph window disarms it', () => {
    assert.equal(ui.applyState(SNAP), true);
    assert.equal(ui.called('setFormula').length, 0, 'precondition: queued, not run');

    document.getElementById('gpu-sel').value = '20';   // a shader, from anywhere
    ui.render.flatFrame();

    assert.equal(ui.called('setFormula').length, 0,
      'uMathMode would go back to 1 and the shader\'s displacement is gated on 0');
  });

  test('control — nothing supersedes it, so it arms at the flat frame', () => {
    assert.equal(ui.applyState(SNAP), true);
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setFormula')[0], ['setFormula', 'fractals:henon']);
  });

  test('control — the rest of the queued work is untouched by the check', () => {
    assert.equal(ui.applyState({ ...SNAP, shape: 'torus' }), true);
    document.getElementById('gpu-sel').value = '20';
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setShape')[0], ['setShape', 'torus'],
      'the shape dropdown was written synchronously; the swap has to land');
  });
});

// ── The branch beside it (R4-80) ─────────────────────────────────────────────
// The check above guards the formula branch. The deform branch three statements
// down pushes setVolumeFormula into the SAME onFlatActions array, and had no
// check at all — so for the ordinary snapshot that pairs a CPU formula with
// DEFORM: VOLUME the guarded neighbour was cancelled out by its unguarded
// sibling: setVolumeFormula sets uMathMode = 1, and a shader picked inside the
// 400 ms window has its whole displacement gated on uMathMode == 0. Both doors
// in controls.js (⬡ VOLUME and #volume-formula-sel) already ask this question;
// this is the third writer of the same engine call.
//
// The question is "is this still the selection this apply was made against", so
// the value is captured AFTER the snapshot has written its own gpuSelVal into
// #gpu-sel — capturing it earlier would make a snapshot that carries a formula
// disarm its own volume mode. The first control below is what says so.
describe('applyState — the queued volume deformation asks the same question', () => {
  const SNAP = { _version: 2, gpuSelVal: 'm:fractals:henon', deformMode: 'volume', volumeKey: 'twist' };
  let ui;
  beforeEach(() => {
    ui = makeUi();
    ui.render.deferMorph = true;
    document.getElementById('gpu-sel').value = '';   // the stub outlives the test
  });

  test('a shader taken during the morph window disarms it', () => {
    assert.equal(ui.applyState(SNAP), true);
    assert.equal(ui.called('setVolumeFormula').length, 0, 'precondition: queued, not run');

    document.getElementById('gpu-sel').value = '20';   // a shader, from anywhere
    ui.render.flatFrame();

    assert.equal(ui.called('setVolumeFormula').length, 0,
      'the formula beside it stands down and this one armed anyway — uMathMode goes ' +
      'to 1 and the shader the operator just picked draws nothing at all');
    assert.equal(ui.render.uMathMode, 0,
      'the GPU displacement is gated on uMathMode == 0');
  });

  test('control — nothing supersedes it, so it arms at the flat frame', () => {
    // #gpu-sel starts on a shader and the snapshot writes its own formula over
    // it: the question is asked against the value THIS apply left behind, not
    // against whatever was selected before it ran.
    document.getElementById('gpu-sel').value = '20';
    assert.equal(ui.applyState(SNAP), true);
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setVolumeFormula')[0], ['setVolumeFormula', 'twist']);
    assert.equal(ui.render.uMathMode, 1, 'this is what DEFORM: VOLUME is for');
  });

  test('control — a snapshot carrying no gpuSelVal still arms its volume mode', () => {
    // A preset saved before the field existed, or one taken with the built-in
    // surface selected. There is no snapshot value to compare against, so the
    // comparison is against the live selection — which nothing here moves.
    document.getElementById('gpu-sel').value = 'm:waves:standing';
    assert.equal(ui.applyState({ _version: 2, deformMode: 'volume', volumeKey: 'twist' }), true);
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setVolumeFormula')[0], ['setVolumeFormula', 'twist']);
  });

  test('the check is one callback standing down, not a cancelled queue', () => {
    // The shape dropdown is written synchronously, so dropping its swap makes it
    // a lie — the historical wrong fix (cancelPendingMorph) dropped the whole
    // closure. This one asserts both halves of the same flat frame, so it is a
    // second pin as well as the guard against that over-correction.
    assert.equal(ui.applyState({ ...SNAP, shape: 'torus' }), true);
    document.getElementById('gpu-sel').value = '20';
    ui.render.flatFrame();

    assert.deepEqual(ui.called('setShape')[0], ['setShape', 'torus']);
    assert.equal(ui.called('setVolumeFormula').length, 0);
  });
});

// The camera editor's eight sliders read cpParams and nothing told them when a
// snapshot rewrote it wholesale — so after applying a preset the thumbs still
// sat at the previous values, and the next drag wrote from there.
describe('applyState — a snapshot that carries camera params says so', () => {
  test('the panel is told when cpParams is rewritten', () => {
    const ui = makeUi();

    assert.equal(ui.applyState({
      _version: 2,
      camScript: { active: false, code: 'ctx.cam.y = 1;', params: { radius: 15 }, keyframes: [] },
    }), true);

    assert.equal(ui.camera.cpParams.radius, 15, 'precondition: the params were applied');
    assert.equal(ui.called('paramsChanged').length, 1,
      'the sliders show these values; nothing else can move them');
  });

  test('control — a snapshot with no params does not fire it', () => {
    const ui = makeUi();
    assert.equal(ui.applyState({ _version: 2, colorIdx: 9 }), true);
    assert.equal(ui.called('paramsChanged').length, 0);
  });
});

// ── A delete that storage refused (R4-87) ────────────────────────────────────
// deletePreset writes the shortened list through _writePresetList, which returns
// false when the write was refused — quota exceeded, private mode, storage
// blocked for the origin — and then redraws the list from storage, so the row
// the operator just clicked ✕ on simply reappears. The other two writers in this
// file report that (SAVE keeps the typed name and toasts; the hold editor
// toasts); the delete button dropped the value on the floor, so the only signal
// was a row that would not go away.
//
// The button's handler is built inside _renderPresets and is not reachable any
// other way, so the list is rendered against a recording createElement and the
// ✕ button's onclick is called the way a click calls it.
describe('_renderPresets — a delete the storage refuses is reported', () => {
  const plainCreate = document.createElement;
  let store;

  /** localStorage the way the browser hands it over: setItem may throw. */
  const installStorage = (presets, { refuseWrites = false } = {}) => {
    store = { raw: JSON.stringify(presets) };
    globalThis.localStorage = {
      getItem: k => (k === 'vimathic_presets' ? store.raw : null),
      setItem: (k, v) => {
        // DOMException: QuotaExceededError — what a full or blocked origin does.
        if (refuseWrites) throw new Error('QuotaExceededError');
        if (k === 'vimathic_presets') store.raw = v;
      },
      removeItem() {},
    };
  };
  const storedNames = () => JSON.parse(store.raw).map(p => p.name);

  // Everything _renderPresets builds, in creation order. row.append is the one
  // method the real list needs that the shared stub does not carry.
  let made = [];
  const recordingCreate = tag => {
    const el = makeEl();
    el.tagName = tag;
    el.children = [];
    el.append = (...kids) => el.children.push(...kids);
    made.push(el);
    return el;
  };
  const delButtons = () => made.filter(el => el.tagName === 'button' && el.textContent === '✕');
  const rowNames   = () => made.filter(el => el.tagName === 'button' && el.textContent !== '✕')
    .map(el => el.textContent);

  const uiWithToasts = () => {
    const ui = makeUi();
    ui._showToast = (msg, isError) => ui.calls.push(['toast', msg, isError]);
    return ui;
  };

  beforeEach(() => { document.createElement = recordingCreate; made = []; });
  after(() => { document.createElement = plainCreate; delete globalThis.localStorage; });

  test('the ✕ that could not delete says why', () => {
    installStorage([{ name: 'Alpha', state: { _version: 2 } }], { refuseWrites: true });
    const ui = uiWithToasts();

    ui._renderPresets();
    const del = delButtons()[0];
    assert.ok(del, 'precondition: the row and its ✕ were built');

    made = [];                       // the click redraws the list; watch that too
    del.onclick();

    const toasts = ui.called('toast');
    assert.equal(toasts.length, 1,
      'the write was refused and the row comes straight back — silence reads as a broken button');
    assert.equal(toasts[0][2], true, 'reported as a failure, not as a success');
    assert.match(toasts[0][1], /delete/i, 'and it has to say which action failed');
    assert.deepEqual(rowNames(), ['Alpha'],
      'precondition for the toast being the only signal: the row was redrawn from storage');
  });

  test('control — a delete that lands stays quiet', () => {
    installStorage([{ name: 'Alpha', state: { _version: 2 } },
                    { name: 'Beta',  state: { _version: 2 } }]);
    const ui = uiWithToasts();

    ui._renderPresets();
    const del = delButtons()[0];     // Alpha's
    made = [];
    del.onclick();

    assert.equal(ui.called('toast').length, 0,
      'a warning on every successful delete would be worse than the silence it replaced');
    assert.deepEqual(storedNames(), ['Beta'], 'and the delete still happened');
    assert.deepEqual(rowNames(), ['Beta']);
  });

  test('control — the other rows keep their own names on the handler', () => {
    // The handler closes over `p`, so a report bolted onto the wrong closure
    // would delete the right preset and name the wrong one — or delete row 0
    // whichever ✕ was pressed.
    installStorage([{ name: 'Alpha', state: { _version: 2 } },
                    { name: 'Beta',  state: { _version: 2 } }]);
    const ui = uiWithToasts();

    ui._renderPresets();
    delButtons()[1].onclick();       // Beta's

    assert.deepEqual(storedNames(), ['Alpha']);
    assert.equal(ui.called('toast').length, 0);
  });
});


// ── Round 11: a preset must not type over the operator ──────────────────────
describe('applying a preset whose shader is already live leaves the editor alone', () => {

  const SNAP = { _version: 2, shader: { hasCustom: true, vert: 'V1', frag: 'F1' } };

  test('the second apply neither recompiles nor rewrites the draft buffer', () => {
    const ui = makeUi();
    ui.applyState({ ...SNAP });
    assert.equal(ui.called('compileAndApply').length, 1, 'precondition: the first apply compiles');

    // The operator starts typing and has not applied it yet. A clip stepping
    // through presets arrives every few seconds.
    ui.shaderEditor._frag = 'half-typed idea';
    ui.applyState({ ...SNAP });

    assert.equal(ui.shaderEditor._frag, 'half-typed idea',
      'the preset overwrote source the operator had not applied — the rule the ' +
      'revert branch states fifteen lines below in the same file');
    assert.equal(ui.called('compileAndApply').length, 1, 'and it recompiled a program that was already live');
  });

  test('control — a preset carrying a DIFFERENT shader still applies', () => {
    const ui = makeUi();
    ui.applyState({ ...SNAP });
    ui.applyState({ _version: 2, shader: { hasCustom: true, vert: 'V2', frag: 'F2' } });

    assert.equal(ui.called('compileAndApply').length, 2);
    assert.equal(ui.shaderEditor._frag, 'F2');
  });
});
