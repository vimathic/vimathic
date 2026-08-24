// tests/pts-proxy-shared-geometry.test.js
//
// FIX(#52). The points proxy BORROWS gpuMesh.geometry (render.js FIX(#3):
// construction shares it, every shape swap re-shares it), so every
// "and now the same for the proxy" branch in MathVisualizer was doing its
// per-vertex work a second time on the same buffers: Collapse recomputed the
// whole scalar field once per tick, Volume re-ran the displacement pass, and
// the snapshot methods held byte-identical second copies of the pristine and
// base arrays. _tickSurface has guarded with `ptsGeo !== geo` since FIX(r11);
// FIX(#52) routes every proxy branch through that one guard.
//
// Run:
//   node --test tests/pts-proxy-shared-geometry.test.js
//
// ── How this file avoids the guard-that-cannot-fail ─────────────────────────
// Each direction is pinned by the run that must read the OTHER way:
//   • shared proxy  → formula work per tick identical to no proxy at all
//     (delete the guard and the collapse count doubles — this is red on the
//     pre-fix tree);
//   • distinct proxy → the proxy still gets deformed and still gets restored
//     (make the guard "always skip" instead of "skip when shared" and these
//     go red instead).

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', style: {}, textContent: '', classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

class FakeWorker {
  constructor() { this.posted = []; this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
}
globalThis.Worker = class { constructor() { return new FakeWorker(); } };

let MathVisualizer, THREE;
before(async () => {
  ({ MathVisualizer } = await import('../src/math-visualizer.js'));
  THREE = await import('three');
});

const GRID = 9;

// Same stand-in as tests/math-visualizer.test.js, plus a proxy in one of the
// two arrangements the guard distinguishes.
function makeViz({ proxy = 'none' } = {}) {
  const geometry = new THREE.PlaneGeometry(7, 7, GRID - 1, GRID - 1);
  geometry.rotateX(-Math.PI / 2);
  let ptsGeometry = null;
  if (proxy === 'distinct') {
    ptsGeometry = new THREE.PlaneGeometry(7, 7, 4, 4);   // its own, smaller
    ptsGeometry.rotateX(-Math.PI / 2);
  } else if (proxy === 'shared') {
    ptsGeometry = geometry;                              // what the app ships
  }
  const render = {
    isMobile: false,
    U: { uMathMode: { value: 0 }, uMorphProgress: { value: 1 } },
    gpuMesh: { geometry },
    gpuPtsProxy: ptsGeometry ? { geometry: ptsGeometry } : null,
    cb: {},
  };
  const audio = { bass: 0.4, mid: 0.3, treble: 0.2, beatInt: 0, amp: 0.7, waveInt: 1 };
  const viz = new MathVisualizer(render, audio);
  viz._workerReady = true;
  viz.onShapeChange();
  return { viz, render, geometry, ptsGeometry };
}

const xyz = geometry => {
  const p = geometry.attributes.position;
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
};
const maxDeltaAny = (a, b) =>
  Math.max(...a.map((v, i) => Math.max(...[0, 1, 2].map(ax => Math.abs(v[ax] - b[i][ax])))));

/** Formula evaluations across four collapse ticks, with _formulaFn wrapped. */
function collapseEvals(fixture) {
  const { viz } = fixture;
  viz.setFormula('trigonometry', 'travelingWave');
  viz.setMode('collapse');
  let calls = 0;
  const real = viz._formulaFn;
  viz._formulaFn = (...a) => { calls++; return real(...a); };
  for (let f = 0; f < 4; f++) viz.tick(1 + f * 0.1);
  return calls;
}

describe('a shared proxy adds no work (FIX #52)', () => {

  test('collapse: formula evaluations with the shipped shared proxy equal no-proxy exactly', () => {
    const baseline = collapseEvals(makeViz({ proxy: 'none' }));
    const shared   = collapseEvals(makeViz({ proxy: 'shared' }));
    assert.ok(baseline > 0, 'precondition: the collapse tick evaluates the formula at all');
    assert.equal(shared, baseline,
      `the shared proxy re-bought ${shared - baseline} formula evaluations that were already in its own buffers`);
  });

  test('shared proxy holds no second copy of the snapshots', () => {
    const { viz } = makeViz({ proxy: 'shared' });
    viz.setFormula('trigonometry', 'travelingWave');
    viz.setMode('collapse');
    viz.tick(1);
    // The proxy shares the mesh's buffers, so the mesh's own snapshots ARE its
    // snapshots; a second byte-identical Float32Array (~1.2 MB at 161²) is the
    // memory half of the same duplication.
    assert.equal(viz._pristinePtsPositions, null);
    assert.equal(viz._basePtsPositions, null);
  });
});

describe('a proxy with its own geometry is still served — the guard is "shared", not "always"', () => {

  test('collapse deforms the distinct proxy', () => {
    const fx = makeViz({ proxy: 'distinct' });
    const before = xyz(fx.ptsGeometry);
    collapseEvals(fx);
    assert.ok(maxDeltaAny(xyz(fx.ptsGeometry), before) > 1e-4,
      'the distinct proxy never moved — the guard is skipping it');
  });

  test('volume deforms the distinct proxy, and deactivate hands it back', () => {
    const fx = makeViz({ proxy: 'distinct' });
    const pristine = xyz(fx.ptsGeometry);
    fx.viz.setVolumeFormula('twist');
    for (let f = 0; f < 3; f++) fx.viz.tick(1 + f * 0.1);
    assert.ok(maxDeltaAny(xyz(fx.ptsGeometry), pristine) > 1e-4,
      'precondition: volume mode moved the distinct proxy');
    fx.viz.deactivate();
    assert.ok(maxDeltaAny(xyz(fx.ptsGeometry), pristine) < 1e-6,
      'deactivate left the distinct proxy displaced');
  });
});
