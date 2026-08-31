// tests/model-import-stage.test.js
//
// Contract tests for the stage: who is allowed to draw while an imported model
// is on it. One structural fact is behind all four defects pinned here — a
// loaded model is a second drawer of the scene, and nothing in the engine knew
// it existed. ModelLoader poked r.gpuMesh.visible = false once and hoped.
//
// Run:
//   node --test tests/model-import-stage.test.js
//
// ── Defect 1: the procedural mesh comes straight back ─────────────────────────
// setVizModeGPU() sets gpuMesh.visible = true unconditionally, so any viz-mode
// button, any preset apply (presets.js reapplies vizMode) and RESET ALL popped
// the built-in pyramid back into the scene, intersecting the imported model at
// the origin — with no way to hide it again from the UI.
//
// ── Defect 2: the particle mask over triangles ────────────────────────────────
// Importing while PTS is active left uPtStyle raised, and the model's meshes
// share the engine's uniform object. gl_PointCoord is undefined for triangles;
// read as (0,0) — the common driver behaviour — the mask's `if (_pd > 1.0)
// discard` throws away every fragment and the model is invisible. The invariant
// "outside PTS the mask is provably off" was guarded against viz-mode changes
// only, and the second drawer walked around the guard.
//
// ── Defect 3: APPLY reported success and changed nothing ──────────────────────
// applyShaderSource() is the deliberate single owner of the live program, but
// it walked gpuMat and the POINTS proxy only. With a model up, those are both
// invisible, so every APPLY and RESET in the shader editor printed
// "✔ Compiled & applied" while the only thing on screen kept the old program.
//
// ── Defect 4: no way back ─────────────────────────────────────────────────────
// clear() removed the group but never gave the stage back, so even once the
// dead ✕ CLEAR MODEL button is wired up it would leave an empty scene.
//
// ── Controls ──────────────────────────────────────────────────────────────────
// The "no model loaded" cases pin that none of this changes ordinary behaviour:
// the mesh still appears, the proxy is still built, the mask still rises.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, textContent: '', classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

let RenderEngine, ModelLoader;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  ({ ModelLoader }  = await import('../src/shaders.js'));
});

let host, scene;

beforeEach(() => {
  scene = { added: [], removed: [], add(o) { this.added.push(o); }, remove(o) { this.removed.push(o); } };
  host = {
    scene,
    vizMode:      'surface',
    // morphAttributes because THREE.Points reads it while constructing the proxy.
    gpuMesh:      { visible: true, geometry: { attributes: {}, morphAttributes: {} } },
    gpuMat:       { wireframe: false },
    gpuPtsProxy:  null,
    modelMeshes:  [],
    currentParticleStyle: 'dots',
    activeVS: 'VS-SOURCE', activeFS: 'FS-SOURCE',
    U: { uPointSize: { value: 1 }, uPtStyle: { value: 0 }, uLighting: { value: 0 } },
    setAfterglow(on) { this._afterglow = on; },
  };
  // The real style and viz-mode paths, so the engine's own calls between them
  // are the ones under test rather than stand-ins.
  host.setParticleStyle = n => RenderEngine.prototype.setParticleStyle.call(host, n);
  host.setVizModeGPU    = m => RenderEngine.prototype.setVizModeGPU.call(host, m);
});

const vizMode  = m => host.setVizModeGPU(m);
const applySrc = (vs, fs) => RenderEngine.prototype.applyShaderSource.call(host, vs, fs);
const stage    = m => RenderEngine.prototype.setExternalModel.call(host, m);
const modelMesh = () => ({ material: { vertexShader: 'OLD', fragmentShader: 'OLD' } });

describe('an imported model owns the stage', () => {

  test('a viz-mode change does not bring the procedural mesh back', () => {
    stage([modelMesh()]);
    assert.equal(host.gpuMesh.visible, false, 'precondition: taking the stage hides it');

    vizMode('wireframe');    // ⬡ WIRE, a preset apply or RESET ALL
    assert.equal(host.gpuMesh.visible, false,
      'the built-in pyramid must not pop back inside the imported model');
  });

  test('PTS while a model is up builds no proxy and leaves the mask down', () => {
    stage([modelMesh()]);
    vizMode('points');

    // `assert.ok(x === null)` and not `assert.equal(x, null)`: gpuPtsProxy is a
    // THREE.Points holding a geometry, a material and a path back to the scene,
    // and the failing branch of assert.equal formats it through util.inspect at
    // depth 1000 and diffs it. Cheap here only by accident — this fixture's
    // gpuMesh.geometry is a stub, so it costs 201 lines; the same proxy over a
    // real 161² plane costs 361 241, which is how two VM boots died 2026-08-30.
    assert.ok(host.gpuPtsProxy === null,
      'a points proxy over hidden geometry is a second invisible drawer');
    assert.equal(host.U.uPtStyle.value, 0,
      'gl_PointCoord is undefined for the model triangles — a raised mask discards them');
    assert.equal(host.gpuMesh.visible, false);
  });

  test('importing while PTS is live lowers the mask that is already up', () => {
    vizMode('points');
    host.setParticleStyle('dots');
    assert.ok(host.U.uPtStyle.value > 0, 'precondition: the mask is up for the point cloud');

    stage([modelMesh()]);
    assert.equal(host.U.uPtStyle.value, 0, 'the model must not be drawn through the sprite mask');
    assert.ok(host.gpuPtsProxy === null,
      'the points proxy survived the import and still draws the hidden geometry');
  });

  test('picking a particle style while a model is up does not raise the mask', () => {
    vizMode('points');
    stage([modelMesh()]);

    host.setParticleStyle('dots');
    assert.equal(host.U.uPtStyle.value, 0);
    assert.equal(host.currentParticleStyle, 'dots', 'but the choice is remembered for later');
  });

  test('the shader editor reaches the model, not just the hidden mesh', () => {
    const meshes = [modelMesh(), modelMesh()];
    stage(meshes);

    applySrc('NEW-VS', 'NEW-FS');
    for (const m of meshes) {
      assert.equal(m.material.vertexShader, 'NEW-VS',
        'APPLY reported success, so the thing on screen has to change');
      assert.equal(m.material.fragmentShader, 'NEW-FS');
      assert.equal(m.material.needsUpdate, true);
    }
  });

  test('giving the stage back restores the viz mode that was selected', () => {
    vizMode('points');
    host.setParticleStyle('dots');
    stage([modelMesh()]);

    stage(null);                                   // ✕ CLEAR MODEL
    assert.ok(host.gpuPtsProxy, 'PTS was the live mode, so its proxy comes back');
    assert.ok(host.U.uPtStyle.value > 0, 'and so does the style that was chosen');
  });

  test('ModelLoader.clear gives the stage back', () => {
    const calls = [];
    const loader = {
      _render: { scene: { remove() {} }, setExternalModel: m => calls.push(m) },
      _model:  { name: 'group' },
      _meshes: [],
    };
    ModelLoader.prototype.clear.call(loader);

    assert.equal(calls.length, 1, 'removing the group without saying so leaves an empty stage');
    assert.equal(calls[0], null);
  });
});

describe('control — nothing changes when no model is loaded', () => {

  test('the procedural mesh still appears on a viz-mode change', () => {
    host.gpuMesh.visible = false;
    vizMode('surface');
    assert.equal(host.gpuMesh.visible, true);
    assert.equal(host.U.uLighting.value, 1, 'and SURF still lights it');
  });

  test('PTS still builds its proxy and raises the mask', () => {
    vizMode('points');
    assert.ok(host.gpuPtsProxy, 'the points proxy is what draws in PTS');
    assert.equal(host.gpuMesh.visible, false, 'and the mesh steps aside for it');
    assert.ok(host.U.uPtStyle.value > 0);
  });

  test('applyShaderSource still writes the mesh material', () => {
    host.gpuMat.vertexShader = 'OLD';
    applySrc('NEW-VS', 'NEW-FS');
    assert.equal(host.gpuMat.vertexShader, 'NEW-VS');
    assert.equal(host.gpuMat.fragmentShader, 'NEW-FS');
    assert.equal(host.activeVS, 'NEW-VS', 'and remembers it for a proxy built later');
  });
});
