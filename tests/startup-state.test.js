// tests/startup-state.test.js
//
// The startup state: what a first launch opens in when this browser holds no
// saved session (src/ui/startup-state.js, applied by bootPersist in
// src/ui/presets.js).
//
// Run:
//   node --test tests/startup-state.test.js
//
// bootPersist runs for real on a bare object carrying PresetMixin, with
// applyState recorded instead of executed and the browser globals it touches
// stubbed: localStorage, document (no panel), window, and setInterval — its
// save loop is not what is under test here.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let PresetMixin, migratePreset, CURRENT_PRESET_VERSION, startupState, CameraSystem, CP_PRESETS;

const saved = {};
const stub = (name, value) => {
  saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
};
before(async () => {
  // Imports first: dom.js reads the presence of `document` at import time to
  // decide whether it is in a browser, and a stub would send it looking for
  // the page's ids.
  ({ PresetMixin, migratePreset, CURRENT_PRESET_VERSION } = await import('../src/ui/presets.js'));
  ({ startupState } = await import('../src/ui/startup-state.js'));
  ({ CameraSystem, CP_PRESETS } = await import('../src/camera.js'));
  stub('document', { querySelector: () => null, getElementById: () => null });
  stub('window', { addEventListener() {} });
  stub('setInterval', () => 0);
});
after(() => {
  for (const [name, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name];
  }
});

/** Boot with this storage and launch flag; returns what applyState was handed. */
function boot({ persisted = null, firstLaunch = false, refuse = () => false } = {}) {
  const store = new Map(persisted ? [['vimathic_persisted_state', JSON.stringify(persisted)]] : []);
  stub('localStorage', {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  });
  const applied = [];
  const ui = Object.assign({}, PresetMixin, {
    _firstLaunch: firstLaunch,
    applyState(s) { applied.push(s); return !refuse(s); },
  });
  ui.bootPersist();
  return { applied, store };
}

describe('which state a launch opens in', () => {

  test('a first launch with nothing saved opens in the startup state, its camera script running', () => {
    const { applied } = boot({ firstLaunch: true });
    assert.equal(applied.length, 1);
    assert.equal(applied[0].shape, 'box');
    assert.equal(applied[0].camScript.active, true, 'the startup script was scrubbed like a foreign import');
  });

  test('a saved session wins — the startup state is not applied over it', () => {
    const { applied } = boot({ firstLaunch: true, persisted: { _version: 4, shape: 'cone', camScript: { active: true, code: 'x' } } });
    assert.equal(applied.length, 1);
    assert.equal(applied[0].shape, 'cone');
    assert.equal(applied[0].camScript.active, false, 'a restored script must still come back switched off');
  });

  test('not a first launch and nothing saved: the defaults stand', () => {
    const { applied } = boot({ firstLaunch: false });
    assert.deepEqual(applied, []);
  });

  test('a saved session that is refused, on a first launch: the startup state, and the dead blob dropped', () => {
    const { applied, store } = boot({ firstLaunch: true, persisted: { _version: 4, shape: 'bad' }, refuse: s => s.shape === 'bad' });
    assert.deepEqual(applied.map(s => s.shape), ['bad', 'box']);
    assert.equal(store.has('vimathic_persisted_state'), false);
  });
});

describe('the startup state itself', () => {

  test('is a snapshot this build accepts, at the current version', () => {
    const m = migratePreset(startupState());
    assert.ok(m, 'migratePreset refused it');
    assert.equal(m._version, CURRENT_PRESET_VERSION);
  });

  test('carries the exported look', () => {
    const s = startupState();
    const pick = o => Object.fromEntries(Object.entries(o).filter(([k]) => !['camera', 'camScript', 'shader'].includes(k)));
    assert.deepEqual(pick(s), {
      _version: 4, shape: 'box', vizMode: 'points', material: 'matte', particleStyle: 'smoke',
      wireStyle: 'classic', gpuSelVal: '37', gpuMode: 37, deformMode: 'collapse', volumeKey: null,
      gridVisible: false, starsOn: false, nightly: true, bandCharacter: true,
      bassSens: 1.2, trebleSens: 1, amp: 8.233837008744876, waveInt: 1.5768333333333338,
      bloom: 1.002499999999999, colorIdx: 45, bandDepth: 0.1,
      k0: 0, k1: 0, k2: 0, k3: 0, detail: 0.5, phase: 0,
    });
    assert.deepEqual(s.shader, { hasCustom: false });
    assert.deepEqual([s.camera.physics, s.camera.autoRot, s.camera.fov], ['dark_matter', true, 45]);
  });

  test("its camera script is the gallery's Top Flip, and the camera starts where the script does", () => {
    const s = startupState();
    const topFlip = CP_PRESETS.find(p => p.name.includes('Top Flip'));
    assert.equal(s.camScript.code, topFlip.code);
    assert.equal(s.camScript.active, true);

    // Run the script for its first frame on a camera parked elsewhere.
    const realNow = performance.now;
    performance.now = () => 1_000_000;
    try {
      const v = (x, y, z) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } });
      const camera = { position: v(5, 4, 6), fov: 45, updateProjectionMatrix() {}, rotateZ() {} };
      const sys = new CameraSystem(camera, { target: v(0, 0, 0), update() {} }, { autoRotRadius: 7.2 });
      Object.assign(sys.cpParams, s.camScript.params);
      assert.equal(sys.loadScript(s.camScript.code), true);
      sys.autoRot = true;
      sys.runScript(0, 0, 0, 0, 0);
      const p = camera.position;
      for (const [axis, got] of [['x', p.x], ['y', p.y], ['z', p.z]]) {
        assert.ok(Math.abs(got - s.camera[axis]) < 1e-9, `script starts at ${axis}=${got}, the state parks the camera at ${s.camera[axis]}`);
      }
    } finally { performance.now = realNow; }
  });

  test('every call hands out its own copy', () => {
    const a = startupState();
    a.camera.y = -1; a.camScript.params.radius = 1; a.shape = 'cone';
    const b = startupState();
    assert.deepEqual([b.camera.y, b.camScript.params.radius, b.shape], [7.2 * 1.3, 7.2, 'box']);
  });
});
