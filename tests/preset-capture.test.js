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
