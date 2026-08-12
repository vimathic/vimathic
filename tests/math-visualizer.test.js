// tests/math-visualizer.test.js
//
// Contract tests for MathVisualizer — the CPU deformation path. The first ones
// it has: nothing in tests/ constructed this class before, which is the same
// structural hole that hid the two defects below.
//
// Run:
//   node --test tests/math-visualizer.test.js
//
// ── Defect 1: deactivate() hands back one axis out of three ───────────────────
// Its doc block promises the GPU shader "starts from a flat surface". It zeroes
// Y and stops there, while Volume and Collapse write all three components
// (math-collections.js setXYZ). So switching from DEFORM: VOLUME to a GPU
// shader left the mesh permanently displaced sideways under the shader — the
// shape stayed wrong until something else rebuilt the geometry. The class
// already owns the right tool: _restorePristineToMesh(), which every mode
// transition uses for exactly this reason.
//
// ── Defect 2: a late worker reply overwrites a newer field ────────────────────
// _tickSurface applies whatever the worker delivered at the top, then — if the
// worker is busy — computes and applies a fresh field synchronously at the
// bottom. The early return happens only when it actually posts. So the main
// thread can move the geometry to t=2.0 while a worker reply for t=1.0 is still
// in flight; that reply carries the current generation, is accepted, and is
// applied at the top of the next tick. The animation steps backwards for one
// frame and then forwards again.
//
// ── Why this runs in plain Node ───────────────────────────────────────────────
// The constructor's only environmental need is `Worker`; a stub gives the tests
// hand-delivered replies, which is what makes the ordering above expressible at
// all. Geometry is a real THREE.BufferGeometry — the code under test walks its
// position attribute, and a hand-rolled stand-in would pin the stand-in.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, textContent: '', classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

/** Records what the app posts, and lets a test deliver a reply by hand. */
class FakeWorker {
  constructor() { this.posted = []; this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  /** Deliver a result as the real worker would, with whatever gen we choose. */
  reply(hf, gen) { this.onmessage?.({ data: { type: 'result', hf, gen } }); }
}
let lastWorker = null;
globalThis.Worker = class { constructor() { lastWorker = new FakeWorker(); return lastWorker; } };

let MathVisualizer, THREE;
before(async () => {
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  THREE = await import('three');
});

const GRID = 9;

function makeViz() {
  // A plane with GRID×GRID vertices: the surface path indexes the position
  // attribute as a square grid of exactly that size.
  const geometry = new THREE.PlaneGeometry(7, 7, GRID - 1, GRID - 1);
  const render = {
    isMobile: false,
    U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 } },
    gpuMesh: { geometry },
    gpuPtsProxy: null,
    cb: {},
  };
  const audio = { bass: 0.4, mid: 0.3, treble: 0.2, beatInt: 0, amp: 0.7, waveInt: 1 };
  const viz = new MathVisualizer(render, audio);
  // The worker only becomes usable once the app has seen its ready message.
  viz._workerReady = true;
  viz.onShapeChange();                 // captures the pristine snapshot, as main.js does
  return { viz, render, geometry };
}

const xyz = geometry => {
  const p = geometry.attributes.position;
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
};
const maxDelta = (a, b, axis) =>
  Math.max(...a.map((v, i) => Math.abs(v[axis] - b[i][axis])));

describe('deactivate hands the whole mesh back, not just its height', () => {

  test('a volume deformation is undone on every axis', () => {
    const { viz, geometry } = makeViz();
    const pristine = xyz(geometry);

    viz.setVolumeFormula('twist');
    for (let f = 0; f < 3; f++) viz.tick(1 + f * 0.1);
    assert.ok(maxDelta(xyz(geometry), pristine, 0) > 0.01,
      'precondition: volume mode moved X as well as Y');

    viz.deactivate();

    const now = xyz(geometry);
    assert.ok(maxDelta(now, pristine, 0) < 1e-6, `X left displaced by ${maxDelta(now, pristine, 0)}`);
    assert.ok(maxDelta(now, pristine, 1) < 1e-6, `Y left displaced by ${maxDelta(now, pristine, 1)}`);
    assert.ok(maxDelta(now, pristine, 2) < 1e-6, `Z left displaced by ${maxDelta(now, pristine, 2)}`);
  });

  test('so is a collapse deformation', () => {
    const { viz, geometry } = makeViz();
    const pristine = xyz(geometry);

    viz.setFormula('trigonometry', 'travelingWave');
    viz.setMode('collapse');
    for (let f = 0; f < 3; f++) viz.tick(1 + f * 0.1);

    viz.deactivate();

    const now = xyz(geometry);
    assert.ok(maxDelta(now, pristine, 0) < 1e-6);
    assert.ok(maxDelta(now, pristine, 2) < 1e-6);
  });

  test('control — it still hands the height back to the shader', () => {
    const { viz, render } = makeViz();
    viz.setFormula('trigonometry', 'travelingWave');
    viz.tick(1.0);
    assert.equal(render.U.uMathMode.value, 1, 'precondition: the CPU path owns pos.y');

    viz.deactivate();

    assert.equal(render.U.uMathMode.value, 0, 'the shader is gated on this being 0');
    assert.equal(viz.active, false);
  });

  test('control — deactivate before any shape was announced still flattens Y', () => {
    const { viz, geometry } = makeViz();
    viz._pristinePositions = null;              // nothing captured yet
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, 1.5);

    viz.deactivate();

    assert.ok(Math.max(...xyz(geometry).map(v => Math.abs(v[1]))) < 1e-6,
      'the fallback path is what the old code did, and it still has to work');
  });
});

describe('a worker reply cannot move the surface backwards', () => {

  test('a reply overtaken by a main-thread frame is discarded', () => {
    const { viz, geometry } = makeViz();
    viz.setFormula('trigonometry', 'travelingWave');

    viz.tick(1.0);                              // posts for t=1.0, returns
    const posted = lastWorker.posted.at(-1);
    assert.equal(posted.type, 'tick', 'precondition: the frame posted rather than computing');

    viz.tick(2.0);                              // worker busy → main thread applies t=2.0
    const newest = xyz(geometry);

    lastWorker.reply(new Float32Array(GRID * GRID).fill(0.9), posted.gen);   // the late t=1.0 answer
    viz.tick(3.0);

    assert.ok(maxDelta(xyz(geometry), newest, 1) < 0.5,
      'the older field must not be applied over the newer one the operator is watching');
  });

  test('control — a reply that nothing overtook is still applied', () => {
    const { viz, geometry } = makeViz();
    viz.setFormula('trigonometry', 'travelingWave');

    viz.tick(1.0);
    const posted = lastWorker.posted.at(-1);
    const before = xyz(geometry);

    lastWorker.reply(new Float32Array(GRID * GRID).fill(0.9), posted.gen);
    viz.tick(1.1);

    assert.ok(maxDelta(xyz(geometry), before, 1) > 0.1,
      'the worker path is the normal path — dropping every reply would be a worse bug');
  });

  test('control — the channel keeps being used afterwards', () => {
    const { viz } = makeViz();
    viz.setFormula('trigonometry', 'travelingWave');

    viz.tick(1.0);
    const posted = lastWorker.posted.at(-1);
    viz.tick(2.0);
    lastWorker.reply(new Float32Array(GRID * GRID).fill(0.9), posted.gen);
    viz.tick(3.0);
    viz.tick(4.0);

    assert.ok(lastWorker.posted.length >= 2, 'a discarded reply must not starve the worker');
  });
});
