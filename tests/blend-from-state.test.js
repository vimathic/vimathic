// tests/blend-from-state.test.js
//
// Round 10, wave 2. One property, stated once: the formula-transition blend
// starts from the field the mesh is CARRYING.
//
// Run:
//   node --test tests/blend-from-state.test.js
//
// ── Why this file exists ─────────────────────────────────────────────────────
// Round 10 changed where setFormula reads the "from" state. It used to read Y
// back off the live geometry, which was right only on the plane once
// applyHeightField started sampling at each vertex's own (x, z); it now reads
// `_lastHF`, the field _applyHF last wrote. That is the correct source — and it
// introduced a lifetime that nothing owned: four methods put the pristine shape
// back on the mesh (setMode, setVolumeFormula, setVolumeFn, deactivate) and none
// of them cleared `_lastHF`. Measured on the shipped tree before this file
// existed: Surface → Collapse → Surface → pick a new formula put the OLD
// formula's plate on screen for one frame, 0.9795 world units above a mesh that
// had just been restored flat, and then blended away from it. On the committed
// HEAD (c629b53) the same sequence read 0.0001. So it was a regression, not an
// old defect, and it was invisible to the whole suite.
//
// ── How this file avoids being a stencil that cannot fail ────────────────────
// Three things, because "the first frame is close to the mesh" is trivially
// satisfiable by breaking the blend outright:
//
//   * the blend is stretched to 1e9 ms, so the first frame's blend parameter is
//     ~4e-27 and the assertion can be tight (1e-6) instead of a tolerance that
//     hides a small pop;
//   * every jump assertion is paired with an assertion that the mesh is NOT
//     already the new field — deleting the blend makes the first frame the
//     full new field, which fails;
//   * the no-mode-trip case is asserted to jump ZERO too but from the OTHER
//     side: there the from-state legitimately IS the old field, and the test
//     asserts the mesh stays on it. A "clear _lastHF everywhere" fix that broke
//     ordinary transitions would fail that one.
//
// The aliasing test drives MathVisualizer's real onmessage handler through a
// stub Worker, because the ordering that matters — a reply landing between an
// apply and the next tick — cannot be produced any other way in node.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let THREE, RenderEngine, MathVisualizer, VOLUME_FORMULAS,
    generateSurfaceFromFormula, getFormula;

// ── A stub Worker, installed before the modules are imported ────────────────
// It only records posts and hands the test a handle to reply through; the
// message shapes are math-worker.js's own contract
// (OUT { type: 'result', hf, gen }).
const posts = [];
class StubWorker {
  constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; StubWorker.last = this; }
  postMessage(m) { posts.push(m); }
  terminate() {}
}

before(async () => {
  THREE = await import('three');
  globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? (fn => { fn(); return 0; });
  ({ RenderEngine }   = await import('../src/render.js'));
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  ({ VOLUME_FORMULAS, generateSurfaceFromFormula, getFormula } =
    await import('../src/math-collections.js'));
});
after(() => { delete globalThis.Worker; });

// ── The stage: the REAL setShape on a stand-in carrying what it touches ─────
function build(shape = 'plane') {
  const stage = Object.create(RenderEngine.prototype);
  Object.assign(stage, {
    CFG: { planeSegs: 160, planeSize: 7 },
    isMobile: false, isShapeChanging: false, pendingShape: null, currentShape: null,
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
    gpuPtsProxy: null,
    clearSolarSystem() {}, _buildSolarSystem() {},
    U: { uMathMode: { value: 0 }, uVHField: { value: 0 }, uMorphProgress: { value: 1 } },
    cb: {},
  });
  stage.setShape(shape);
  const mv = new MathVisualizer(stage, { bass: 0, mid: 0, treble: 0, beatInt: 0, amp: 1, waveInt: 1 });
  stage.cb.onShapeChange = () => mv.onShapeChange();
  mv.onShapeChange();
  return { stage, mv };
}

const ys = stage => {
  const p = stage.gpuMesh.geometry.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = p.getY(i);
  return a;
};
const maxdiff = (a, b) => {
  let m = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

const A = ['fractals', 'lorenz'];
const B = ['fractals', 'chua'];

/**
 * Make the first frame after a formula change land at blend parameter ~0
 * without touching the clock. The blend reads
 * easeInOutCubic(min(1, (now - start) / duration)); stretching the duration to
 * 1e9 ms makes that ~4e-27 for any wall-clock delay this machine can produce,
 * so the assertions below can be tight (1e-6) instead of tolerating a pop.
 *
 * The first draft patched performance.now globally instead. It worked, but it
 * hung node's test runner the moment a test FAILED — which is the one moment a
 * guard has to work — so the mutation run could not tell a red from a wedge.
 */
function slowBlend(mv) { mv._blendDuration = 1e9; return mv; }
const slowBlendOf = ({ stage, mv }) => ({ stage, mv: slowBlend(mv) });

describe('the formula blend starts from the field the mesh is carrying', () => {

  test('a Surface -> Collapse -> Surface round trip does not resurrect the old field', () => {
    const { stage, mv } = slowBlendOf(build('plane'));
    const pristine = ys(stage);

    let t = 0;
    const tick = () => { t += 0.008; mv.tick(t); };
    mv.setFormula(...A);
    for (let i = 0; i < 5; i++) tick();
    const fieldA = ys(stage);
    assert.ok(maxdiff(fieldA, pristine) > 0.5,
      `precondition: formula A must actually deform the mesh (got ${maxdiff(fieldA, pristine)})`);

    mv.setMode('collapse');
    for (let i = 0; i < 5; i++) tick();
    mv.setMode('surface');
    const restored = ys(stage);
    assert.ok(maxdiff(restored, pristine) < 1e-6,
      'precondition: leaving and re-entering Surface restores the pristine shape');

    mv.setFormula(...B);
    tick();
    const frame1 = ys(stage);

    // The property. At blend parameter ~0 the first frame must BE the restored
    // mesh; anything else is a pop the blend exists to prevent.
    assert.ok(maxdiff(frame1, restored) < 1e-6,
      `first frame after the round trip jumped ${maxdiff(frame1, restored).toFixed(4)} world units ` +
      '— the blend is starting from a field the mesh no longer carries');

    // The paired assertion: this must not be passing because the blend died.
    // A dead blend would put the whole of formula B on screen at once.
    assert.ok(mv._blendActive, 'the blend must still be running, not skipped');
    assert.ok(maxdiff(frame1, fieldA) > 0.5,
      'the first frame is the OLD formula\'s plate — exactly the regression');
  });

  test('CONTROL: with no mode trip the blend still starts from the outgoing field', () => {
    const { stage, mv } = slowBlendOf(build('plane'));
    let t = 0;
    const tick = () => { t += 0.008; mv.tick(t); };
    mv.setFormula(...A);
    for (let i = 0; i < 5; i++) tick();
    const fieldA = ys(stage);

    mv.setFormula(...B);
    tick();
    const frame1 = ys(stage);

    // Same 1e-6, opposite expectation: here the mesh IS carrying A, so the
    // from-state must be A. A fix that nulled _lastHF too eagerly passes the
    // test above and fails this one.
    assert.ok(maxdiff(frame1, fieldA) < 1e-6,
      `an ordinary formula change jumped ${maxdiff(frame1, fieldA).toFixed(4)} world units`);
    assert.ok(mv._blendActive, 'the blend must be running');
  });

  test('the same round trip on a shape whose own Y is not zero', () => {
    const { stage, mv } = slowBlendOf(build('sphere'));
    const pristine = ys(stage);
    let t = 0;
    const tick = () => { t += 0.008; mv.tick(t); };
    mv.setFormula(...A);
    for (let i = 0; i < 5; i++) tick();
    assert.ok(maxdiff(ys(stage), pristine) > 0.5, 'precondition: the field deforms the sphere');

    mv.setMode('collapse');
    for (let i = 0; i < 5; i++) tick();
    mv.setMode('surface');
    const restored = ys(stage);

    mv.setFormula(...B);
    tick();
    assert.ok(maxdiff(ys(stage), restored) < 1e-6,
      `sphere: first frame jumped ${maxdiff(ys(stage), restored).toFixed(4)} world units`);
  });

  test('every path that puts the pristine shape back drops the from-state with it', () => {
    const vkey = Object.keys(VOLUME_FORMULAS)[0];
    const paths = {
      'setMode(collapse)':  mv => mv.setMode('collapse'),
      'setMode(volume)':    mv => mv.setMode('volume'),
      'setVolumeFormula':   mv => mv.setVolumeFormula(vkey),
      'setVolumeFn':        mv => mv.setVolumeFn(() => ({ dx: 0.1, dy: 0.1, dz: 0.1 })),
      'deactivate':         mv => mv.deactivate(),
    };
    for (const [name, leave] of Object.entries(paths)) {
      const { stage, mv } = slowBlendOf(build('plane'));
      let t = 0;
      mv.setFormula(...A);
      for (let i = 0; i < 3; i++) { t += 0.008; mv.tick(t); }
      // CONTROL, per path: while the mesh carries the field, the from-state
      // exists. If this ever stopped being true the check below would pass for
      // the wrong reason.
      assert.ok(mv._lastHF, `${name}: precondition — a field is on the mesh`);
      assert.ok(maxdiff(ys(stage), new Float32Array(ys(stage).length)) > 0.5,
        `${name}: precondition — the mesh is visibly deformed`);

      leave(mv);
      // `assert.ok(x === null)`, never `assert.equal(x, null)`: when this check
      // is RIGHT, x is a 25921-element Float32Array, and node builds the
      // failure message by inspecting and diffing it — the assertion that only
      // misbehaves when it catches something. Found the hard way: the first
      // version of this line wedged the whole test process under the mutation
      // it exists to catch, reporting "0 pass, 0 fail, 1 cancelled".
      assert.ok(mv._lastHF === null,
        `${name} restored the pristine shape but kept _lastHF (length ` +
        `${mv._lastHF ? mv._lastHF.length : 0}) — the next formula will blend ` +
        'away from a field the user is no longer looking at');
    }
  });

  test('the from-state is a copy: a buffer rewritten after the apply cannot change it', async () => {
    // Direct, no worker: _applyHF is handed an array and must not keep it.
    const { stage, mv } = slowBlendOf(build('plane'));
    const g = Math.round(Math.sqrt(stage.gpuMesh.geometry.attributes.position.count));
    const hf = generateSurfaceFromFormula(getFormula(...A).f, { amp: 1, freq: 1, comp: 0.5 }, g, 3.5, 1);
    mv.setFormula(...A);
    mv._applyHF(hf);
    const seen = Float32Array.from(mv._lastHF);
    hf.fill(99);                                   // what the worker reply / blend buffer does
    assert.ok(maxdiff(mv._lastHF, seen) < 1e-9,
      '_lastHF changed when the caller\'s array was rewritten — it is an alias, not the field applied');
  });
});

describe('the worker path cannot hand the blend a field that never reached the mesh', () => {

  test('a reply landing between an apply and the next tick is not the from-state', async () => {
    globalThis.Worker = StubWorker;
    // Re-import is unnecessary: createMathWorker reads globalThis.Worker at
    // call time, so installing it here is enough for the instances built below.
    const { stage, mv } = slowBlendOf(build('plane'));
    assert.ok(mv._worker instanceof StubWorker, 'precondition: the stub worker was picked up');

    const grid = Math.round(Math.sqrt(stage.gpuMesh.geometry.attributes.position.count));
    const fn = getFormula(...A).f;
    const field = time => generateSurfaceFromFormula(fn, { amp: 1, freq: 1, comp: 0.5 }, grid, 3.5, time);
    const reply = hf => mv._worker.onmessage({ data: { type: 'result', hf, gen: mv._generation } });

    mv.setFormula(...A);
    let t = 0;
    for (let i = 0; i < 3; i++) { reply(field(t)); t += 0.008; mv.tick(t); }
    const onMesh = Float32Array.from(mv._lastHF);

    // A field far enough along in time to be distinguishable — helicoid and
    // voronoiCA move by more than their own peak in ONE frame, so this is not
    // an unreachable amount of drift, only a legible one.
    const never = field(t + 5.0);
    assert.ok(maxdiff(never, onMesh) > 1e-3, 'precondition: the two candidates differ');

    reply(never);                 // lands in _hfBuffer; no tick consumes it
    mv.setFormula(...B);          // reads the from-state HERE

    assert.ok(maxdiff(mv._prevHF, onMesh) < 1e-6,
      'the blend started from the field the worker had just delivered, not from the one on the mesh');
    delete globalThis.Worker;
  });
});

describe('aBaseY falls back to a value the app chose', () => {

  test('the vertex programs really do read the attribute', async () => {
    const { VS } = await import('../src/shaders.js');
    assert.match(VS, /attribute\s+float\s+aBaseY\s*;/,
      'VS no longer declares aBaseY — this whole describe block is then obsolete, not passing');
    assert.match(VS, /aBaseY/, 'VS declares aBaseY without using it');
  });

  test('the points proxy material declares the default', () => {
    // setVizModeGPU('points') builds the proxy material for real; no WebGL
    // context is involved in constructing a ShaderMaterial.
    const host = {
      scene: { add() {}, remove() {} },
      vizMode: 'surface',
      gpuMesh: { visible: true, geometry: { attributes: {}, morphAttributes: {} } },
      gpuMat: { wireframe: false },
      gpuPtsProxy: null,
      modelMeshes: [],
      currentParticleStyle: 'dots',
      activeVS: 'VS', activeFS: 'FS',
      U: { uPointSize: { value: 1 }, uPtStyle: { value: 0 }, uLighting: { value: 0 } },
      setAfterglow() {},
    };
    host.setParticleStyle = n => RenderEngine.prototype.setParticleStyle.call(host, n);
    RenderEngine.prototype.setVizModeGPU.call(host, 'points');
    const dav = host.gpuPtsProxy.material.defaultAttributeValues;
    assert.deepEqual(dav.aBaseY, [0],
      'the points material has no aBaseY default: a geometry without the attribute ' +
      'would read whatever generic value another program left at that location');
    // CONTROL: three's own three defaults are still there, so this is not
    // asserting against an object we replaced wholesale.
    assert.deepEqual(dav.color, [1, 1, 1]);
  });

  test('every material in render.js that runs the shipped vertex program declares it', () => {
    const raw = readFileSync(join(ROOT, 'src/render.js'), 'utf8');
    // Strip comments first. The first draft did not, counted the sentence in
    // attachBaseY's own doc block as a third declaration, and failed — a guard
    // that reads prose as code is the blind spot round 10's mutation matrix
    // already recorded once.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(/defaultAttributeValues\.aBaseY/.test(raw) && src.length < raw.length,
      'CONTROL: the comment stripper ran and the file still has the declaration');
    // The materials that get VS: the surface material (vertexShader: VS) and
    // the points proxy (vertexShader: this.activeVS).
    const decls = [...src.matchAll(/vertexShader:\s*(VS|this\.activeVS)\b/g)];
    assert.equal(decls.length, 2,
      `expected exactly two materials built from the shipped VS, found ${decls.length} ` +
      '— the scan below would miss the others');
    const defaults = [...src.matchAll(/defaultAttributeValues\.aBaseY\s*=\s*\[\s*0\s*\]/g)];
    assert.equal(defaults.length, 2,
      'each of those two materials needs its own aBaseY default; see attachBaseY for why');
  });
});
