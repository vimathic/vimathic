// tests/preset-capture.test.js
//
// Contract tests for PresetMixin.captureState — what a snapshot RECORDS.
//
// Run:
//   node --test tests/preset-capture.test.js
//
// ── Why this file exists at all ───────────────────────────────────────────────
// Until now captureState() was called by no test in the suite: it appeared in
// tests/ exactly once, inside a comment. Only the apply half of the round trip
// was pinned (tests/preset-apply.test.js), so every defect on the capture side
// was invisible to the suite by construction — including both of the ones below,
// which two audit passes walked past.
//
// ── The two defects pinned here ───────────────────────────────────────────────
// Both are the same shape: a flag read from the ENGINE glued to text read from
// an EDITOR BUFFER, with nothing keeping the two describing the same thing.
//
// 1. shader. `hasCustom` came from se.customVS — set only when a program
//    actually compiled — while vert/frag came from se._vert/_frag, which are
//    draft buffers. The gallery writes them without compiling (shaders.js
//    _buildPresets), switchTab writes them, and compileAndApply itself writes
//    them BEFORE the trial compile, so a failed APPLY leaves broken source
//    there. Click "Plasma" and APPLY, then click "Vortex" just to read it, then
//    save: the preset said hasCustom:true and carried Vortex's body. Loading it
//    compiles Vortex — a look the user never applied and may never have seen.
//
// 2. camScript. `active` came from cam.cpActive — set only by loadScript — while
//    code came from #ce-code, which the camera gallery and selectKeyframe both
//    overwrite without loading anything. Same trap, same result: the preset
//    carried a script that was merely being read, and restoring it ran that one.
//    The running script's source was not retained anywhere; loadScript kept only
//    the compiled cpFn. So the fix had to add it (cam.cpSource).
//
// The restore side is what makes these bite rather than merely look untidy:
// presets.js applies a snapshot with hasCustom by running compileAndApply() on
// the carried body, and a camScript with active by calling loadScript(code).
//
// ── Controls ──────────────────────────────────────────────────────────────────
// The "control" cases below pass both before and after the fix. They are here so
// the failing assertions cannot be satisfied by a change that simply always
// reads the applied source: with nothing compiled, or with editor and program in
// agreement, the snapshot must still carry the editor text — and FIX(#17)'s
// blanking of untouched default camera code must survive.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

function makeEl() {
  return {
    value: '', textContent: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
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

let PresetMixin;
before(async () => { ({ PresetMixin } = await import('../src/ui/presets.js')); });

const DEFAULT_CAM_CODE = 'orbit(p.radius, p.rotSpeed, p.height);';

/**
 * A host shaped like UIController. The shader-editor and camera fakes model the
 * real classes on the one point that matters here: the draft buffers move
 * independently of the live program, exactly as they do in shaders.js and
 * camera.js. A fake that keeps them in lockstep — as the apply-side harness
 * does — cannot express the state either defect needs.
 */
function makeUi(over = {}) {
  const render = {
    currentShape: 'sphere', vizMode: 'surface', currentMaterial: 'matte',
    currentParticleStyle: 'squares',
    U: { uMode: { value: 3 } },
    camera: { position: { x: 1, y: 2, z: 3 }, fov: 45 },
    orbit:  { target: { x: 0, y: 0, z: 0 } },
    grid:   { visible: true },
    bloomPass: { strength: 0.55 },      // PARAMS.bloom reads through this
  };
  const camera = {
    camPhysics: 'dark_matter', autoRot: false,
    cpActive: false, cpSource: null,
    cpParams: { rotSpeed: 0.00002 }, cpKeyframes: [],
    getDefaultCode: () => DEFAULT_CAM_CODE,
    ...over.camera,
  };
  const shaderEditor = {
    _vert: 'DEFAULT_VERT', _frag: 'DEFAULT_FRAG',
    customVS: null, customFS: null,
    _appliedVert: null, _appliedFrag: null,
    ...over.shaderEditor,
  };
  // Every PARAM_FIELDS getter reads through this or through render.bloomPass.
  const audio = { amp: 0.7, waveInt: 1.0, bassSens: 1.2, trebleSens: 1.0, colorIdx: 3 };
  return Object.assign(Object.create(PresetMixin), {
    render, camera, mathViz: { _mode: 'surface', _volumeKey: null }, shaderEditor, audio,
  });
}

describe('captureState — the custom shader half', () => {

  test('records the program that is live, not the body sitting in the editor', () => {
    // Applied "Plasma", then clicked "Vortex" in the gallery just to read it:
    // _buildPresets writes the draft and does not compile.
    const ui = makeUi({ shaderEditor: {
      _vert: 'VORTEX_BODY', _frag: 'DEFAULT_FRAG',
      customVS: 'VS{PLASMA_BODY}', customFS: 'FS{DEFAULT_FRAG}',
      _appliedVert: 'PLASMA_BODY', _appliedFrag: 'DEFAULT_FRAG',
    }});

    const snap = ui.captureState();

    assert.equal(snap.shader.hasCustom, true);
    assert.equal(snap.shader.vert, 'PLASMA_BODY',
      'the snapshot must carry the body that is actually running');
  });

  test('a failed APPLY leaves the snapshot on the last body that compiled', () => {
    // compileAndApply writes _vert before its trial compile, so broken source
    // is in the draft while customVS still points at the last good program.
    const ui = makeUi({ shaderEditor: {
      _vert: 'BROKEN {{{', customVS: 'VS{GOOD_BODY}', customFS: 'FS{DEFAULT_FRAG}',
      _appliedVert: 'GOOD_BODY', _appliedFrag: 'DEFAULT_FRAG',
    }});

    assert.equal(ui.captureState().shader.vert, 'GOOD_BODY');
  });

  test('control — with no custom program live, the editor text is what gets saved', () => {
    const ui = makeUi({ shaderEditor: { _vert: 'SCRATCH_BODY' } });

    const snap = ui.captureState();

    assert.equal(snap.shader.hasCustom, false);
    assert.equal(snap.shader.vert, 'SCRATCH_BODY');
  });

  test('control — editor and program in agreement round-trip unchanged', () => {
    const ui = makeUi({ shaderEditor: {
      _vert: 'SAME_BODY', customVS: 'VS{SAME_BODY}', _appliedVert: 'SAME_BODY',
    }});

    assert.equal(ui.captureState().shader.vert, 'SAME_BODY');
  });
});

describe('captureState — the camera-programmer half', () => {

  test('records the running script, not the one being read in the gallery', () => {
    // Applied "Cinematic", then clicked "Telescope" to read it: modals.js
    // writes #ce-code and does not call loadScript.
    const ui = makeUi({ camera: { cpActive: true, cpSource: 'CINEMATIC_CODE' } });
    document.getElementById('ce-code').value = 'TELESCOPE_CODE';

    const snap = ui.captureState();

    assert.equal(snap.camScript.active, true);
    assert.equal(snap.camScript.code, 'CINEMATIC_CODE',
      'the snapshot must carry the script the camera is actually running');
  });

  test('control — with no script running, the editor text is what gets saved', () => {
    const ui = makeUi({ camera: { cpActive: false } });
    document.getElementById('ce-code').value = 'HALF_TYPED_CODE';

    const snap = ui.captureState();

    assert.equal(snap.camScript.active, false);
    assert.equal(snap.camScript.code, 'HALF_TYPED_CODE');
  });

  test('control — FIX(#17): untouched default code is still blanked', () => {
    const ui = makeUi({ camera: { cpActive: false } });
    document.getElementById('ce-code').value = DEFAULT_CAM_CODE;

    assert.equal(ui.captureState().camScript.code, '',
      'seeded default text must not be baked into every preset');
  });

  test('control — a running script equal to the default text is still saved', () => {
    const ui = makeUi({ camera: { cpActive: true, cpSource: DEFAULT_CAM_CODE } });
    document.getElementById('ce-code').value = DEFAULT_CAM_CODE;

    assert.equal(ui.captureState().camScript.code, DEFAULT_CAM_CODE,
      'blanking applies to an untouched editor, not to a script that is running');
  });
});

// The finish a snapshot records is not always the one on screen: WIRE and PTS
// force Matte for as long as they are on screen, so a preset saved in either
// mode used to record Matte and hand it back on the way out. The panel knows
// the difference and now answers it; captureState asks.
describe('captureState — the surface material', () => {

  test('a preset saved in WIRE records the finish, not the forced Matte', () => {
    const ui = makeUi();
    ui.render.vizMode = 'wireframe';
    ui.render.currentMaterial = 'matte';          // what WIRE forces
    ui.getPresetMaterial = () => 'mirror';        // what the panel would restore

    assert.equal(ui.captureState().material, 'mirror');
  });

  test('control — with no panel reader it still records the live finish', () => {
    const ui = makeUi();
    ui.render.currentMaterial = 'glass';
    delete ui.getPresetMaterial;                  // a stripped build, or a test host

    assert.equal(ui.captureState().material, 'glass');
  });
});

// ── The rest of the snapshot ─────────────────────────────────────────────────
//
// The three sections above pin `shader.*`, `camScript.active/code` and
// `material`. That left the other three quarters of captureState — the scene
// fields, the whole camera block, camScript.params/keyframes, the six flat
// param fields and the version stamp — written by presets.js and read by no
// assertion: each of them could be replaced by a constant with the suite green,
// and `x: r.camera.position.z` was invisible to both the unit suite and e2e.
//
// The fields below are given values that are distinct from each other and from
// every plausible default, so a transposed axis or a hard-coded constant cannot
// coincide with the right answer.

/** A host whose every captured field is a distinctive non-default value. */
function makeDistinctUi() {
  const ui = makeUi({
    camera: {
      camPhysics: 'cosmos', autoRot: true,
      cpActive: false, cpSource: null,
      cpParams: { rotSpeed: 0.00071, radius: 9.25, height: 4.5, fov: 61, roll: 0.125 },
      cpKeyframes: [
        { t: 0.8, code: 'LATE', _selected: true },
        { t: 0.2, code: 'EARLY' },
      ],
      getDefaultCode: () => DEFAULT_CAM_CODE,
    },
  });
  Object.assign(ui.render, {
    currentShape: 'torus', vizMode: 'points', currentParticleStyle: 'sparks',
    U: { uMode: { value: 27 } },
    camera: { position: { x: 1.5, y: -2.25, z: 3.75 }, fov: 61.5 },
    orbit:  { target: { x: -0.5, y: 0.25, z: -0.75 } },
    grid:   { visible: false },
    bloomPass: { strength: 1.35 },
  });
  ui.mathViz = { _mode: 'volume', _volumeKey: 'fields/curl' };
  ui.audio   = { amp: 1.11, waveInt: 2.22, bassSens: 0.33, trebleSens: 1.44, colorIdx: 29 };
  document.getElementById('gpu-sel').value = 'm:waves:standingWave';
  return ui;
}

describe('captureState — the scene fields', () => {

  test('every visual field records what the engine holds', () => {
    const ui = makeDistinctUi();
    const snap = ui.captureState();

    assert.equal(snap.shape, 'torus');
    assert.equal(snap.vizMode, 'points');
    assert.equal(snap.particleStyle, 'sparks');
    assert.equal(snap.gpuSelVal, 'm:waves:standingWave',
      'gpuSelVal is what the restore path reads to put the dropdown back');
    assert.equal(snap.gpuMode, 27);
    assert.equal(snap.deformMode, 'volume');
    assert.equal(snap.volumeKey, 'fields/curl');
    assert.equal(snap.gridVisible, false);
  });

  test('control — gpuSelVal falls back to the live mode when the dropdown is empty', () => {
    const ui = makeDistinctUi();
    document.getElementById('gpu-sel').value = '';
    assert.equal(ui.captureState().gpuSelVal, '27');
  });

  test('control — a host with no grid or no particle style records the defaults', () => {
    const ui = makeDistinctUi();
    delete ui.render.grid;
    ui.render.currentParticleStyle = null;
    ui.mathViz = null;

    const snap = ui.captureState();
    assert.equal(snap.gridVisible, true);
    assert.equal(snap.particleStyle, 'squares');
    assert.equal(snap.deformMode, 'surface');
    assert.equal(snap.volumeKey, null);
  });
});

describe('captureState — the camera block', () => {

  test('each of the nine camera fields records its own source', () => {
    // Every number here is distinct, so an axis read from the wrong one — the
    // `x: r.camera.position.z` class of slip — cannot pass.
    const ui = makeDistinctUi();
    const snap = ui.captureState();

    assert.equal(snap.camera.x, 1.5);
    assert.equal(snap.camera.y, -2.25);
    assert.equal(snap.camera.z, 3.75);
    assert.equal(snap.camera.tx, -0.5, 'the target comes from the orbit control');
    assert.equal(snap.camera.ty, 0.25);
    assert.equal(snap.camera.tz, -0.75);
    assert.equal(snap.camera.fov, 61.5);
    assert.equal(snap.camera.physics, 'cosmos');
    assert.equal(snap.camera.autoRot, true);
  });

  test('the position and the target are not confused for each other', () => {
    // A snapshot that recorded the target as the position restores the camera
    // to a place it was never at, and the fault is invisible in a still frame.
    const ui = makeDistinctUi();
    const snap = ui.captureState();
    assert.notDeepEqual(
      [snap.camera.x, snap.camera.y, snap.camera.z],
      [snap.camera.tx, snap.camera.ty, snap.camera.tz]);
    assert.deepEqual([snap.camera.x, snap.camera.y, snap.camera.z],
      [ui.render.camera.position.x, ui.render.camera.position.y, ui.render.camera.position.z]);
  });

  test('control — auto-rotate off is recorded as off, not merely as falsy', () => {
    const ui = makeDistinctUi();
    ui.camera.autoRot = false;
    ui.camera.camPhysics = 'moon';
    const snap = ui.captureState();
    assert.equal(snap.camera.autoRot, false);
    assert.equal(snap.camera.physics, 'moon');
  });
});

describe('captureState — the camera programmer\'s params and keyframes', () => {

  test('the params tab is recorded field for field', () => {
    const ui = makeDistinctUi();
    assert.deepEqual(ui.captureState().camScript.params, ui.camera.cpParams);
  });

  test('the params are a copy — a saved preset cannot be edited from under itself', () => {
    const ui = makeDistinctUi();
    const snap = ui.captureState();
    ui.camera.cpParams.radius = 999;
    assert.equal(snap.camScript.params.radius, 9.25,
      'the snapshot shares the live params object; the next slider drag rewrites the preset');
  });

  test('the keyframes are recorded as {t, code}, in the order they are held', () => {
    const ui = makeDistinctUi();
    const snap = ui.captureState();
    assert.deepEqual(snap.camScript.keyframes,
      [{ t: 0.8, code: 'LATE' }, { t: 0.2, code: 'EARLY' }]);
    // Editor-only bookkeeping must not travel into the file.
    assert.equal('_selected' in snap.camScript.keyframes[0], false);
  });

  test('the keyframe list is detached from the live one', () => {
    const ui = makeDistinctUi();
    const snap = ui.captureState();
    ui.camera.cpKeyframes.push({ t: 0.5, code: 'ADDED_AFTER' });
    ui.camera.cpKeyframes[0].code = 'EDITED_AFTER';

    assert.equal(snap.camScript.keyframes.length, 2);
    assert.equal(snap.camScript.keyframes[0].code, 'LATE');
  });

  test('control — an empty timeline records an empty list, not a missing one', () => {
    const ui = makeDistinctUi();
    ui.camera.cpKeyframes = [];
    assert.deepEqual(ui.captureState().camScript.keyframes, []);
  });
});

describe('captureState — the version stamp and the flat param fields', () => {

  test('the stamp is sourced from CURRENT_PRESET_VERSION, not written by hand', async () => {
    // presets.js: "Sourced from CURRENT_PRESET_VERSION so the writer can never
    // drift from the reader." A round trip cannot see this — only a direct
    // comparison can — and the drift it guards against goes unnoticed until the
    // first migration block exists, at which point every snapshot ever written
    // by this build runs the wrong chain.
    const { CURRENT_PRESET_VERSION } = await import('../src/ui/presets.js');
    assert.equal(makeDistinctUi().captureState()._version, CURRENT_PRESET_VERSION);
  });

  test('a fresh snapshot is recognised by the loader that reads it back', async () => {
    const { migratePreset } = await import('../src/ui/presets.js');
    const snap = makeDistinctUi().captureState();
    const back = migratePreset(snap);
    assert.ok(back, 'captureState produced something migratePreset rejects as not-a-preset');
    assert.equal(back._version, snap._version);
  });

  test('the six flat param fields record the live engine values', async () => {
    // These are top-level rather than nested for v1 file compatibility, and
    // they are what RESET-then-LOAD restores. They are read through the PARAMS
    // registry, so the test asks the registry the same question.
    const { PARAMS } = await import('../src/params.js');
    const ui   = makeDistinctUi();
    const snap = ui.captureState();
    const ctx  = { audio: ui.audio, render: ui.render, camera: ui.camera };

    for (const id of ['bassSens', 'trebleSens', 'amp', 'waveInt', 'bloom', 'colorIdx']) {
      assert.ok(id in snap, `the snapshot carries no ${id} — the preset restores a default instead`);
      assert.equal(snap[id], PARAMS[id].get(ctx), `${id} was not read from the engine`);
    }
    // Sanity: the fixture really does differ from the registry defaults, so the
    // loop above cannot pass on a snapshot that hard-codes them.
    assert.notEqual(snap.bassSens, PARAMS.bassSens.default);
    assert.notEqual(snap.colorIdx, PARAMS.colorIdx.default);
  });
});
