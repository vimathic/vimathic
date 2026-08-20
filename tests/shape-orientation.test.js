// tests/shape-orientation.test.js
//
// Round 10, family B. The plate shapes must lie IN the plane the field
// displaces out of — and must still be a plate when they get there.
//
// Run:
//   node --test tests/shape-orientation.test.js
//
// ── The contract ─────────────────────────────────────────────────────────────
// Everything in this app pushes geometry along +Y: the GPU path writes
// `pos.y = (pos.y + mix(y, yNxt, uModeBlend)) * uMorphProgress` (shaders.js) and
// the CPU path writes `pos.setY(i, base + heightField[i])` (math-collections.js
// applyHeightField). A shape meant to read as a plate therefore has to lie in
// XZ, so that the displacement leaves it and the startup camera — which sits at
// (0, −7, 0.001) and looks straight up the Y axis — sees the face rather than
// the rim.
//
// setShape() enforces that with one quarter turn about X, followed by zeroing
// the plate's own Y (the turn leaves 2.14e-16 of numerical dust behind, and
// since round 10 the field is ADDED to Y rather than replacing it, so the dust
// would survive into the picture). The turn is only correct for geometries
// three.js authors in XY. PlaneGeometry and CircleGeometry are such geometries.
// CylinderGeometry is not: it is built with its axis already along Y, so the
// same rotation stands it on edge. `disc` and `hex` are CylinderGeometry.
//
// ── Two measures, because one of them was not enough ─────────────────────────
// The first is the area-weighted mean of |n·ŷ| over face normals, computed from
// positions only (so it cannot be fooled by a stale normal attribute). 1 = the
// field displaces straight out of the surface, 0 = the displacement runs purely
// along it.
//
// That number alone is worthless, and the round-10 mutation matrix proved it
// (L-01, row B1). Put `disc` and `hex` back into the rotate-AND-zero-Y branch
// and the guard reads mean |n·ŷ| = 1.0000, thinnest axis Y — both assertions
// satisfied, perfectly — because zeroing a cylinder's Y crushes it into a
// pancake, and a pancake's normals all point along ŷ. Measured
// (L-B-blindspot.txt): the disc keeps all 6883 vertices and all 12960 triangles
// but its surface falls from 78.649 to 1.120, 98.6 % gone, with 160 triangles
// drawing literally nothing; the hex falls from 62.809 to 5.543 with 332
// degenerate triangles. Every assertion the guard made was true of the wreck.
//
// So the second measure is the one that actually discriminates, and it is an
// invariant rather than a threshold: **rotation preserves area**. setShape's
// whole job on the geometry _buildShapeGeo hands it is a rigid motion, so the
// surface it swaps in must have exactly the area of the surface it was given —
// measured on the shipped tree, all twenty shapes agree to 0.00e+0 relative,
// and the B1 mutation reads 9.86e-1 for disc and 9.12e-1 for hex.
// (The Y-zeroing is not rigid in principle; it is on plane and circle, where
// the amount removed is 2.14e-16 and the double-precision area sum does not
// move by one ulp. That is measured, not assumed — see the table above.)
//
// ── Why there are control blocks ─────────────────────────────────────────────
// A test that only knows how to fail proves nothing.
//   • cylinder, sphere and box are shapes the rotation must never touch; they
//     are measured by exactly the same code and pinned to exactly the values
//     they have today. If a future "fix" reaches wider than the two names, that
//     block goes red first.
//   • the area invariant gets its own control: the same measurement is run on a
//     disc that HAS been rotated and flattened by hand, and must report the
//     loss. An invariant nothing can violate is not an invariant.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// setShape() schedules its geometry dispose in a rAF. Queue the callbacks
// without running them: nothing here needs the dispose, and running it would
// free the buffer this file measures.
const rafQueue = [];
globalThis.requestAnimationFrame = cb => rafQueue.push(cb);

let RenderEngine, THREE, SHAPE_NAMES, DEFAULT_SHAPE;
before(async () => {
  ({ RenderEngine } = await import('../src/render.js'));
  ({ SHAPE_NAMES, DEFAULT_SHAPE } = await import('../src/shapes.js'));
  THREE = await import('three');
});

// A host carrying only the fields setShape()/_buildShapeGeo() actually touch.
// isMobile:false and planeSegs:160 are the desktop numbers (src/main.js:32).
function makeHost() {
  return {
    CFG: { planeSize: 7, planeSegs: 160 },
    isMobile: false,
    isShapeChanging: false,
    pendingShape: null,
    currentShape: 'plane',
    gpuMesh: { geometry: new THREE.PlaneGeometry(1, 1, 1, 1) },
    gpuPtsProxy: null,
    cb: {},
    clearSolarSystem() {},
    _buildSolarSystem() {},
    _buildStarGeo(...a)  { return RenderEngine.prototype._buildStarGeo.apply(this, a); },
    _buildShapeGeo(...a) { return RenderEngine.prototype._buildShapeGeo.apply(this, a); },
    setShape(...a)       { return RenderEngine.prototype.setShape.apply(this, a); },
  };
}

// ── the measurements ────────────────────────────────────────────────────────
// One walk over the triangles, from positions only. Returns the three numbers
// every assertion below is built on:
//   ny     area-weighted mean |n·ŷ|
//   area   total surface area
//   degen  triangles with exactly zero area — they draw nothing
function survey(geo) {
  const p = geo.attributes.position, idx = geo.index;
  const n = idx ? idx.count : p.count;
  const at = i => { const j = idx ? idx.getX(i) : i; return [p.getX(j), p.getY(j), p.getZ(j)]; };
  let num = 0, area = 0, degen = 0, tris = 0;
  for (let i = 0; i < n; i += 3) {
    const A = at(i), B = at(i + 1), C = at(i + 2);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = Math.hypot(cr[0], cr[1], cr[2]);
    tris++;
    if (m === 0) { degen++; continue; }
    num  += Math.abs(cr[1]) / 2;
    area += m / 2;
  }
  return { ny: area === 0 ? NaN : num / area, area, degen, tris };
}

const meanNormalAlignmentY = geo => survey(geo).ny;

const extents = geo => {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
};

// The number of distinct (x, z) columns the geometry occupies. A sheet standing
// in XY has as many columns as it has grid lines (161 for the 7×7 plate); the
// same sheet lying in XZ has one per vertex (25921).
const columns = geo => {
  const p = geo.attributes.position, s = new Set();
  for (let i = 0; i < p.count; i++) s.add(p.getX(i) + '|' + p.getZ(i));
  return s.size;
};

const geoFor = shape => { const h = makeHost(); h.setShape(shape); return h.gpuMesh.geometry; };

describe('the plate shapes lie in the plane the field displaces out of', () => {
  // disc and hex are CylinderGeometry: already flat when built, so the quarter
  // turn must NOT be applied to them.
  for (const [shape, floor] of [['disc', 0.8], ['hex', 0.8]]) {
    test(`${shape} faces the displacement, not away from it — and is still a plate`, () => {
      const h = makeHost();
      const before = survey(h._buildShapeGeo(shape));   // what setShape was handed
      h.setShape(shape);
      const geo = h.gpuMesh.geometry;
      const after = survey(geo);                        // what it swapped in

      assert.ok(after.ny > floor,
        `${shape}: area-weighted mean |n.y| is ${after.ny.toFixed(3)}, expected > ${floor} — ` +
        `the plate is standing on edge, so the +Y displacement runs along it instead of out of it`);
      const e = extents(geo);
      assert.ok(e.y < e.x && e.y < e.z,
        `${shape}: thinnest axis must be Y, got ${e.x.toFixed(3)} x ${e.y.toFixed(3)} x ${e.z.toFixed(3)}`);

      // The two assertions above are both TRUE of a pancake — this is the pair
      // that is not. A rotation cannot change area and cannot create a triangle
      // with no area; crushing the shape flat does both.
      const lost = Math.abs(after.area - before.area) / before.area;
      assert.ok(lost < 1e-9,
        `${shape}: setShape changed the surface from ${before.area.toFixed(3)} to ` +
        `${after.area.toFixed(3)} (${(lost * 100).toFixed(1)} % of it gone). setShape may only ` +
        `rotate this geometry, and a rotation preserves area — this is the flattened-plate ` +
        `failure that mean |n.y| reads as a perfect 1.000`);
      assert.equal(after.degen, before.degen,
        `${shape}: ${after.degen} of ${after.tris} triangles now draw nothing (${before.degen} did ` +
        `before setShape touched the geometry)`);
    });
  }

  // plane and circle ARE authored in XY, so for them the turn is required.
  // These two would go red if the fix removed the rotation altogether.
  for (const shape of ['plane', 'circle']) {
    test(`${shape} still gets its quarter turn into XZ`, () => {
      const geo = geoFor(shape);
      const m = meanNormalAlignmentY(geo);
      assert.ok(m > 0.9,
        `${shape}: area-weighted mean |n.y| is ${m.toFixed(3)}, expected > 0.9`);
      const e = extents(geo);
      // Exactly 0, not 1e-6: setShape zeroes the plate's Y after the turn, so
      // the rotateX residue is gone rather than merely small.
      assert.ok(e.y === 0 && e.x > 0 && e.z > 0,
        `${shape}: must be flat in XZ, got ${e.x.toExponential(2)} x ${e.y.toExponential(2)} x ${e.z.toExponential(2)}`);
    });
  }
});

describe('setShape only moves geometry — it never destroys any', () => {
  // The invariant, over the whole catalogue rather than the two names the
  // rotate list happens to hold today. Whatever setShape does to a shape, the
  // shape must come out with the surface it went in with.
  test('every shape keeps the area and the triangle count _buildShapeGeo gave it', () => {
    const rows = [];
    for (const shape of SHAPE_NAMES) {
      const h = makeHost();
      const before = survey(h._buildShapeGeo(shape));
      h.setShape(shape);
      const after = survey(h.gpuMesh.geometry);
      rows.push([shape, before, after, Math.abs(after.area - before.area) / before.area]);
    }
    const bad = rows.filter(([, b, a, rel]) => rel >= 1e-9 || a.degen !== b.degen || a.tris !== b.tris);
    assert.deepEqual(bad.map(r => r[0]), [],
      'setShape changed the surface of ' + bad.map(([s, b, a, rel]) =>
        `${s} (${b.area.toFixed(3)} -> ${a.area.toFixed(3)}, rel ${rel.toExponential(2)}, ` +
        `degenerate ${b.degen} -> ${a.degen})`).join('; ') +
      ' — the only thing setShape is allowed to do to these buffers is turn them');
  });

  // ── CONTROL — the invariant above must be able to fail ────────────────────
  test('control — the same measurement reports a plate that HAS been crushed', () => {
    // Exactly the B1 mutation, done here by hand instead of in src/: the disc
    // put through the plane/circle treatment. If this reads "no loss", the
    // assertion above is decorative.
    const h = makeHost();
    const g = h._buildShapeGeo('disc');
    const before = survey(g);
    g.rotateX(-Math.PI / 2);
    const py = g.attributes.position;
    for (let i = 0; i < py.count; i++) py.setY(i, 0);
    py.needsUpdate = true;
    const after = survey(g);
    const lost = (before.area - after.area) / before.area;
    assert.ok(lost > 0.9,
      `a disc rotated into XY and flattened kept ${(after.area / before.area * 100).toFixed(1)} % of ` +
      `its area; the invariant above cannot see the failure it exists for`);
    assert.ok(after.degen > 0 && before.degen === 0,
      `the crushed disc has ${after.degen} degenerate triangles and the intact one ${before.degen}; ` +
      `the degeneracy count is not discriminating`);
    // …and the two assertions the guard used to rely on are both HAPPY with it,
    // which is the whole reason this file was rewritten.
    assert.ok(after.ny > 0.8, 'the crushed disc still passes the mean |n.y| floor');
    const e = extents(g);
    assert.ok(e.y < e.x && e.y < e.z, 'and still passes "the thinnest axis is Y"');
  });
});

describe('CONTROL — shapes the rotation never names are untouched', () => {
  // Same measurement, on shapes that are correct today and must read the same
  // after any change to the rotation list. Values are the ones today's build
  // produces; they are properties of the raw three.js geometry, so they hold
  // whether or not the list changes — unless the change reaches too far.
  const cases = [
    ['cylinder', 1 / 3, { x: 5, y: 5, z: 5 }],
    ['sphere',   0.5,   { x: 7, y: 7, z: 7 }],
    ['box',      1 / 3, { x: 5, y: 5, z: 5 }],
  ];
  for (const [shape, expected, size] of cases) {
    test(`${shape} keeps mean |n.y| = ${expected.toFixed(3)} and its bounding box`, () => {
      const geo = geoFor(shape);
      const m = meanNormalAlignmentY(geo);
      assert.ok(Math.abs(m - expected) < 0.005,
        `${shape}: mean |n.y| moved to ${m.toFixed(4)} (was ${expected.toFixed(4)})`);
      const e = extents(geo);
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(e[axis] - size[axis]) < 1e-6,
          `${shape}: ${axis} extent ${e[axis].toFixed(4)} != ${size[axis]}`);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("_buildShapeGeo's default: arm is a shape, not a plate standing on edge", () => {
  // Round 10 gave `default:` a job: delegate to DEFAULT_SHAPE. Before that it
  // returned an unrotated PlaneGeometry, and since the rotate list in setShape
  // keys off the NAME, an unknown name got a 7×7 plate standing in XY — 161
  // distinct (x,z) columns instead of 25921, mean |n·ŷ| exactly 0, the whole
  // scene a line seen edge-on from the boot camera. On a boot path, silently:
  // bootPersist() restores a persisted shape name on every page open.
  //
  // normalizeShape() now catches an unknown name before it ever reaches here,
  // and that is why the mutation matrix found this arm unguarded (L-01, row
  // E1): putting the plate back is invisible through setShape. It is still the
  // arm that catches a name added to the picker and forgotten in the switch, or
  // a `case` deleted with its whitelist entry left behind — the second line of
  // defence, which is exactly the kind of code that rots unwatched. So it is
  // called DIRECTLY here, with a name no whitelist knows.
  const UNKNOWN = 'no-such-shape-in-any-build';

  test('an unknown name comes back as DEFAULT_SHAPE, float for float', () => {
    const h = makeHost();
    assert.ok(!SHAPE_NAMES.includes(UNKNOWN), 'precondition: the probe name must not be a real shape');
    const a = h._buildShapeGeo(UNKNOWN).attributes.position.array;
    const b = h._buildShapeGeo(DEFAULT_SHAPE).attributes.position.array;
    assert.equal(a.length, b.length,
      `default: returned ${a.length / 3} vertices, DEFAULT_SHAPE ('${DEFAULT_SHAPE}') ${b.length / 3} — ` +
      'the fallback is not the boot shape, so an unresolvable name lands somewhere no rotation rule knows about');
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
    assert.equal(differ, 0, `${differ} of ${a.length} position floats differ from '${DEFAULT_SHAPE}'`);
  });

  test('CONTROL — that comparison can tell two geometries apart', () => {
    // If the check above passed because the comparison is blind, it proves
    // nothing. Same code, against some shape that is not the boot shape —
    // chosen by name rather than written in, so that changing DEFAULT_SHAPE
    // does not turn this control into a false alarm (it did: mutation row C2).
    const h = makeHost();
    // findLast, not find: the FIRST entry is 'plane', and the defect this
    // suite exists for is a default arm that returns a PlaneGeometry — the
    // control would then be comparing two buffers that really are identical
    // and would fire alongside the test it is supposed to vouch for.
    const other = SHAPE_NAMES.findLast(n => n !== DEFAULT_SHAPE);
    const a = h._buildShapeGeo(UNKNOWN).attributes.position.array;
    const b = h._buildShapeGeo(other).attributes.position.array;
    assert.ok(a.length > 0 && b.length > 0,
      'both buffers are empty, so "they differ" could never be reported either way');
    const differ = a.length !== b.length ||
      Array.prototype.some.call(a, (v, i) => v !== b[i]);
    assert.ok(differ,
      `the float comparison reports '${other}' and the '${DEFAULT_SHAPE}' fallback as the same buffer`);
  });

  test('and whatever it returns is not a sheet standing in XY', () => {
    // Name-independent: this survives someone changing DEFAULT_SHAPE, and it is
    // the property that actually mattered — the fallback reaches the picture
    // WITHOUT passing through the rotate list, so it has to be usable as built.
    const h = makeHost();
    const g = h._buildShapeGeo(UNKNOWN);
    const s = survey(g), cols = columns(g), verts = g.attributes.position.count;
    // Shipped ('pyramid-smooth'): 0.7002. The pre-round-10 plate: exactly 0.
    assert.ok(s.ny > 0.05,
      `the fallback geometry has area-weighted mean |n.y| = ${s.ny.toFixed(4)}: the +Y displacement ` +
      `runs along its surface instead of out of it, which is what an unrotated PlaneGeometry does`);
    // Shipped: 6562 of 6883 vertices sit on their own (x,z). The plate: 161 of
    // 25921, because 160 of its 161 grid lines are stacked along Y.
    assert.ok(cols > verts / 2,
      `the fallback's ${verts} vertices occupy only ${cols} distinct (x,z) columns; its footprint ` +
      `has collapsed to a line, so the displacement field can only address ${cols} of them`);
  });

  test('CONTROL — a legitimate alternative fallback passes that check', () => {
    // The two assertions above must be about "standing on edge", not about
    // "is pyramid-smooth". A plate laid down in XZ is a perfectly good fallback
    // and must read as one; only the unrotated plate must not.
    const g = new THREE.PlaneGeometry(7, 7, 160, 160);
    g.rotateX(-Math.PI / 2);
    const s = survey(g);
    assert.ok(s.ny > 0.05 && columns(g) > g.attributes.position.count / 2,
      `a rotated plate reads as ny=${s.ny.toFixed(4)}, ${columns(g)} columns — the check above is ` +
      `rejecting a correct fallback, so it is testing identity rather than orientation`);
    // …and the unrotated one, which is the E1 defect, does not.
    const bad = new THREE.PlaneGeometry(7, 7, 160, 160);
    const sb = survey(bad);
    assert.ok(!(sb.ny > 0.05 && columns(bad) > bad.attributes.position.count / 2),
      `an unrotated 7x7 plate reads as ny=${sb.ny.toFixed(4)}, ${columns(bad)} columns and passes ` +
      `the check — which is the exact geometry the check exists to reject`);
  });
});
