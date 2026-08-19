// tests/shape-lateral-surface.test.js
//
// Every shape the app builds must be a CLOSED surface with the area its own
// parameters say it has. Round 10 §1.1: three r169's CylinderGeometry.buildTorso
// tests the PARAMETER radiusTop rather than the radius of the row it is on —
//
//     if ( radiusTop    > 0 ) { indices.push( a, b, d ); }
//     if ( radiusBottom > 0 ) { indices.push( b, c, d ); }
//
// so a ConeGeometry (radiusTop === 0) never emits the (a, b, d) half of ANY
// torso quad. At heightSegments = 1 that triangle really is degenerate and
// nothing is lost, which is why the defect is invisible in three's own tests
// and why it survived nine review rounds here. The app asks for
// heightSegments = 80 (desktop) / 40 (mobile), so 3240 of 6480 triangles went
// missing from 'cone', 'pyramid' and the BOOT shape 'pyramid-smooth' — measured
// 64.51 units of surface where the mesh's own parameters give 96.08, and 18960
// boundary edges on a body that has no boundary. The app boots in wireframe,
// where a missing diagonal reads as a quad mesh rather than as a hole.
//
// Run:
//   NODE_OPTIONS=--max-old-space-size=2048 node --test tests/shape-lateral-surface.test.js
//
// The oracle is not a remembered number: it is the exact area of the N-gon
// solid three is asked to build (regular N-gon caps of circumradius r, lateral
// faces trapezia), so it re-derives itself if anyone changes a radius or a
// segment count. Its own control is the heightSegments = 1 cone, which the
// current code already draws correctly — the same formula must call that one
// exact, or the formula is what is broken.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  getElementById: () => ({ value: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  querySelectorAll: () => [],
};

let RenderEngine, THREE;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  THREE = await import('three');
});

const build = (shape, isMobile) => RenderEngine.prototype._buildShapeGeo.call(
  { CFG: { planeSegs: 160, planeSize: 7 }, isMobile,
    _buildStarGeo: RenderEngine.prototype._buildStarGeo }, shape);

// Summed triangle area of the actual index buffer.
function area(g) {
  const p = g.attributes.position, idx = g.index;
  const n = idx ? idx.count : p.count;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const set = (v, i) => { const j = idx ? idx.getX(i) : i; v.set(p.getX(j), p.getY(j), p.getZ(j)); };
  let a = 0;
  for (let i = 0; i < n; i += 3) { set(A, i); set(B, i + 1); set(C, i + 2); a += B.sub(A).cross(C.sub(A)).length() / 2; }
  return a;
}

// Edges used by exactly one non-degenerate triangle, after merging vertices that
// share a position. Nine decimals: it folds the theta = 0 / theta = 2π seam
// (sin 2π is −2.4e-16) without merging anything a mesh actually separates.
function boundaryEdges(g) {
  const p = g.attributes.position, idx = g.index;
  const zero = (0).toFixed(9);
  const q = v => { const s = v.toFixed(9); return s === '-' + zero ? zero : s; };
  const key = j => q(p.getX(j)) + ',' + q(p.getY(j)) + ',' + q(p.getZ(j));
  const vid = i => key(idx ? idx.getX(i) : i);
  const m = new Map();
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const v = [vid(i), vid(i + 1), vid(i + 2)];
    if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) continue;
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? a + '|' + b : b + '|' + a;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  let bnd = 0;
  for (const c of m.values()) if (c === 1) bnd++;
  return bnd;
}

// Exact area of the solid three is asked for: two regular N-gon caps of
// circumradius rt / rb, N trapezoidal lateral faces between them.
function exactArea(rt, rb, h, N) {
  const cap = r => 0.5 * N * r * r * Math.sin(2 * Math.PI / N);
  const edge = r => 2 * r * Math.sin(Math.PI / N);
  const apo  = r => r * Math.cos(Math.PI / N);
  return N * 0.5 * (edge(rt) + edge(rb)) * Math.hypot(h, apo(rb) - apo(rt)) + cap(rt) + cap(rb);
}

// r, h, N as _buildShapeGeo passes them; lo is 80 on desktop, 40 on mobile.
const CONES = [
  ['cone',           3.2, 5.5, lo => lo],
  ['pyramid',        3.2, 5,   () => 4],
  ['pyramid-smooth', 3.2, 5,   lo => lo],
];

for (const [isMobile, lo] of [[false, 80], [true, 40]]) {
  const where = isMobile ? 'mobile' : 'desktop';
  for (const [shape, r, h, nOf] of CONES) {
    test(`${shape} is a closed solid with its own surface area (${where}) (#R10 §1.1)`, () => {
      const g = build(shape, isMobile);
      const want = exactArea(0, r, h, nOf(lo));
      const got = area(g);
      assert.ok(boundaryEdges(g) === 0,
        `${shape} (${where}) has ${boundaryEdges(g)} boundary edges — a solid has none; ` +
        `three drops the (a,b,d) half of every torso quad when radiusTop is 0`);
      assert.ok(Math.abs(got / want - 1) < 0.005,
        `${shape} (${where}) draws ${got.toFixed(4)} units of surface, its parameters give ` +
        `${want.toFixed(4)} — ${((got / want - 1) * 100).toFixed(2)} % off`);
    });
  }
}

// ── CONTROLS: these already pass on the unpatched code and must keep passing ──
// If a control ever fires, the measurement is broken, not the geometry.

test('CONTROL — the heightSegments = 1 cone was always exact (#R10 §1.1)', () => {
  // The one case where the dropped triangle is genuinely degenerate. It pins the
  // oracle: the same exactArea() that calls the app's cone 33 % short calls this
  // one exact, so the shortfall is in the mesh and not in the formula.
  const g = new THREE.ConeGeometry(3.2, 5.5, 80, 1);
  assert.ok(boundaryEdges(g) === 0, 'the heightSegments = 1 cone is closed');
  assert.ok(Math.abs(area(g) / exactArea(0, 3.2, 5.5, 80) - 1) < 1e-9,
    `oracle disagrees with a mesh known to be right: ${area(g)} vs ${exactArea(0, 3.2, 5.5, 80)}`);
});

test('CONTROL — the app shapes that were never broken stay quiet (#R10 §1.1)', () => {
  for (const [shape, want] of [
    ['sphere',   4 * Math.PI * 3.5 * 3.5],            // smooth reference, mesh is inscribed
    ['disc',     exactArea(3.5, 3.5, 0.08, 80)],
    ['cylinder', exactArea(2.5, 2.5, 5, 80)],
  ]) {
    const g = build(shape, false);
    assert.ok(boundaryEdges(g) === 0, `${shape} must be closed`);
    assert.ok(Math.abs(area(g) / want - 1) < 0.005,
      `${shape} draws ${area(g).toFixed(4)}, expected ${want.toFixed(4)}`);
  }
});
