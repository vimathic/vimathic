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

// ── The one body with an inside ──────────────────────────────────────────────
// Every other shape here is a shell: a closed surface with nothing behind it.
// `sierpinski-tetra` is the exception, and that is the whole reason it exists —
// a fractal defined by what it REMOVES from a solid cannot be a height field
// over the floor, and cannot be a formula, because a formula moves vertices and
// never makes new ones. What a viewer sees in POINTS mode is exactly this
// property: a cloud with depth in it rather than a lit skin.
//
// The hull is derived from the geometry rather than written down, so the test
// cannot go stale against a change of radius: the four points furthest from the
// centroid ARE the corners of a regular tetrahedron, and the four planes follow.
function tetraHullInterior(g) {
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    seen.set(v.map(x => (Math.round(x * 1e5) / 1e5 + 0).toFixed(5)).join(','), v);
  }
  const pts = [...seen.values()];
  const c = pts.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map(x => x / pts.length);
  const d2 = v => (v[0]-c[0])**2 + (v[1]-c[1])**2 + (v[2]-c[2])**2;
  const corners = [...pts].sort((a, b) => d2(b) - d2(a)).slice(0, 4);

  const planes = [];
  for (const skip of [0, 1, 2, 3]) {
    const [a, b, cc] = [0, 1, 2, 3].filter(i => i !== skip).map(i => corners[i]);
    const u = b.map((v, j) => v - a[j]), w = cc.map((v, j) => v - a[j]);
    let n = [u[1]*w[2] - u[2]*w[1], u[2]*w[0] - u[0]*w[2], u[0]*w[1] - u[1]*w[0]];
    const L = Math.hypot(...n);
    n = n.map(v => v / L);
    let dd = n[0]*a[0] + n[1]*a[1] + n[2]*a[2];
    const o = corners[skip];
    if (n[0]*o[0] + n[1]*o[1] + n[2]*o[2] - dd > 0) { n = n.map(v => -v); dd = -dd; }
    planes.push([n, dd]);
  }
  let inside = 0;
  for (const v of pts) {
    if (planes.every(([n, dd]) => n[0]*v[0] + n[1]*v[1] + n[2]*v[2] - dd < -1e-6)) inside++;
  }
  return { inside, total: pts.length };
}

test('sierpinski-tetra is the one shape with vertices strictly inside its own hull', () => {
  const g = build('sierpinski-tetra', false);
  const { inside, total } = tetraHullInterior(g);
  assert.equal(total, 2050, `depth 5 has 2050 distinct corners; this build has ${total}`);
  assert.equal(inside, 780,
    `${inside} of ${total} vertices are strictly inside the hull; depth 5 gives 780 (38.0 %), and ` +
    'a body whose vertices are all on the skin cannot draw a cloud with depth in it');
  // POINTS shares the mesh buffer, so the cloud is the un-welded count: the
  // figure is written out per triangle precisely so those 780 are not welded
  // away with the rest.
  assert.equal(g.attributes.position.count, 12288);

  const m = build('sierpinski-tetra', true);
  const mob = tetraHullInterior(m);
  assert.equal(mob.inside, 120, `mobile depth 4 gives 120 interior of 514; measured ${mob.inside}`);
  assert.equal(m.attributes.position.count, 3072);
});

test('CONTROL — the plain tetrahedron has none, on the identical measurement', () => {
  // Same hull derivation, same shape family, and the answer must be zero: a
  // TetrahedronGeometry is a skin over four corners. If this ever reports an
  // interior, the measurement above is counting something other than depth.
  const { inside, total } = tetraHullInterior(build('tetrahedron', false));
  assert.equal(inside, 0, `the plain tetrahedron reports ${inside} interior vertices of ${total}`);
  assert.equal(total, 4);
});
